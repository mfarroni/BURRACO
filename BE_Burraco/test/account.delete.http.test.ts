import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { AdminTestAuthStore } from "./adminTestKit.js";

/**
 * Audit lancio R05 — POST /users/me/delete: l'utente registrato cancella il PROPRIO
 * account confermando la password. Store in-memory (nessun DB): si verificano gate,
 * esiti e il fatto che, dopo la cancellazione, token e credenziali non valgano più.
 */

let server: http.Server;
let base: string;
const store = new AdminTestAuthStore();

before(async () => {
  const app = createHttpApp(new AuthService(store));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function register(email: string): Promise<{ token: string; id: string }> {
  const r = await post("/auth/register", { email, password: "password12", displayName: "Cancellando" });
  assert.equal(r.status, 201);
  return { token: r.json.token as string, id: (r.json.user as { id: string }).id };
}

test("senza token → 401", async () => {
  const r = await post("/users/me/delete", { password: "password12" });
  assert.equal(r.status, 401);
});

test("password mancante → 400; password errata → 400 e l'account resta", async () => {
  const { token } = await register("resta@example.com");
  assert.equal((await post("/users/me/delete", {}, token)).status, 400);
  const wrong = await post("/users/me/delete", { password: "sbagliata99" }, token);
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, "WRONG_PASSWORD");
  const me = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
});

test("password corretta → 200; token, login e account non esistono più; l'email torna libera", async () => {
  const { token } = await register("via@example.com");
  const r = await post("/users/me/delete", { password: "password12" }, token);
  assert.equal(r.status, 200);
  assert.equal(r.json.deleted, true);

  const me = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 401);
  const login = await post("/auth/login", { email: "via@example.com", password: "password12" });
  assert.equal(login.status, 401);
  const again = await post("/auth/register", { email: "via@example.com", password: "password12", displayName: "Nuovo" });
  assert.equal(again.status, 201);
});

test("ospite → 403 GUEST_NO_PASSWORD", async () => {
  const g = await post("/auth/guest", { displayName: "Ospite" });
  const r = await post("/users/me/delete", { password: "qualsiasi" }, g.json.token as string);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, "GUEST_NO_PASSWORD");
});

test("admin → 403 ADMIN_NO_SELF_DELETE, l'account resta", async () => {
  const { token, id } = await register("capo@example.com");
  store.adminIds.add(id);
  const r = await post("/users/me/delete", { password: "password12" }, token);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, "ADMIN_NO_SELF_DELETE");
  const me = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
});

test("campi extra nel corpo (es. un id altrui) → 400: l'utente viene SOLO dal token", async () => {
  const { token } = await register("idor@example.com");
  const r = await post("/users/me/delete", { password: "password12", userId: "00000000-0000-0000-0000-000000000000" }, token);
  assert.equal(r.status, 400);
});
