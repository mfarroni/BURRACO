import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";

/**
 * Test d'integrazione degli endpoint HTTP /auth/* (Express) con AuthService
 * in-memory. Verifica status code, forma delle risposte, gating Bearer e assenza
 * di oracoli. Nessun DB, nessun WS.
 */

let server: http.Server;
let base: string;

before(async () => {
  const auth = new AuthService(new MemoryAuthStore());
  const app = createHttpApp(auth);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, unknown> };
}

test("health: GET /health → 200 ok", async () => {
  const res = await fetch(base + "/health");
  assert.equal(res.status, 200);
  const j = (await res.json()) as { status: string };
  assert.equal(j.status, "ok");
});

test("register → 201 con token+user; me con Bearer → 200", async () => {
  const reg = await post("/auth/register", {
    email: "http@example.com",
    password: "password12",
    displayName: "HttpUser",
  });
  assert.equal(reg.status, 201);
  assert.ok(typeof reg.json.token === "string");
  const user = reg.json.user as { email: string; isGuest: boolean; displayName: string };
  assert.equal(user.email, "http@example.com");
  assert.equal(user.isGuest, false);

  const me = await fetch(base + "/auth/me", {
    headers: { Authorization: `Bearer ${reg.json.token as string}` },
  });
  assert.equal(me.status, 200);
  const meJson = (await me.json()) as { user: { displayName: string } };
  assert.equal(meJson.user.displayName, "HttpUser");
});

test("register: email duplicata → 409", async () => {
  await post("/auth/register", { email: "dupe@example.com", password: "password12" });
  const again = await post("/auth/register", { email: "dupe@example.com", password: "password34" });
  assert.equal(again.status, 409);
  assert.equal(again.json.error, "EMAIL_TAKEN");
});

test("register: password debole → 400 WEAK_PASSWORD", async () => {
  const res = await post("/auth/register", { email: "weakhttp@example.com", password: "123" });
  assert.equal(res.status, 400);
});

test("login: credenziali errate → 401 generico", async () => {
  await post("/auth/register", { email: "loginhttp@example.com", password: "password12" });
  const wrong = await post("/auth/login", { email: "loginhttp@example.com", password: "sbagliata9" });
  const unknown = await post("/auth/login", { email: "ghost@example.com", password: "whatever12" });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.json, unknown.json, "risposta identica: nessun oracolo");
});

test("guest → 201 con isGuest=true", async () => {
  const res = await post("/auth/guest", { displayName: "OspiteHTTP" });
  assert.equal(res.status, 201);
  const user = res.json.user as { isGuest: boolean; email: null };
  assert.equal(user.isGuest, true);
  assert.equal(user.email, null);
});

test("me senza Bearer → 401", async () => {
  const res = await fetch(base + "/auth/me");
  assert.equal(res.status, 401);
});

test("logout: revoca il token (me successivo → 401); idempotente", async () => {
  const reg = await post("/auth/register", { email: "logouthttp@example.com", password: "password12" });
  const token = reg.json.token as string;
  const out1 = await post("/auth/logout", {}, { Authorization: `Bearer ${token}` });
  assert.equal(out1.status, 200);
  const me = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 401, "token revocato");
  const out2 = await post("/auth/logout", {}, { Authorization: `Bearer ${token}` });
  assert.equal(out2.status, 200, "logout idempotente");
});

test("rotta sconosciuta → 404 JSON", async () => {
  const res = await fetch(base + "/nope");
  assert.equal(res.status, 404);
});
