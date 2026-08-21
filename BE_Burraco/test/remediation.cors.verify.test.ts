import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * REMEDIATION CORS — verifica funzionale agente_test (iterazione dedicata).
 * Copre i gap non asseriti dalle suite esistenti:
 *  - preflight da branch origin ammesso: NESSUN Access-Control-Allow-Credentials,
 *    ACAO = origin specifico (mai '*').
 *  - origin del tutto estranea (no 'vercel.app') -> nessun header CORS.
 *  - contratto /auth/guest e /auth/register: displayName opzionale E valorizzato.
 * Env impostata PRIMA dell'import dinamico (file dedicato per isolamento env).
 */

process.env.NODE_ENV = "production";
delete process.env.ALLOWED_ORIGINS;
delete process.env.VERCEL_PROJECT;
delete process.env.VERCEL_TEAM_SLUG;

const BRANCH_ORIGIN = "https://burraco-git-main-groupgames.vercel.app";
const PROD_ORIGIN = "https://burraco.vercel.app";
const UNRELATED = "https://evil.example.com";

let server: http.Server;
let base: string;

before(async () => {
  const { createHttpApp } = await import("../src/http/app.js");
  const { AuthService } = await import("../src/auth/service.js");
  const { MemoryAuthStore } = await import("../src/auth/store.memory.js");
  const auth = new AuthService(new MemoryAuthStore());
  server = http.createServer(createHttpApp(auth));
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function preflight(origin: string, path: string) {
  return fetch(base + path, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,authorization",
    },
  });
}

for (const path of ["/auth/login", "/auth/register"]) {
  test(`preflight ${path}: branch ammesso -> ACAO specifico e NESSUN Allow-Credentials`, async () => {
    const res = await preflight(BRANCH_ORIGIN, path);
    assert.ok(res.status === 200 || res.status === 204, `status ${res.status}`);
    assert.equal(res.headers.get("access-control-allow-origin"), BRANCH_ORIGIN);
    assert.notEqual(res.headers.get("access-control-allow-origin"), "*");
    // Bearer, NO cookie: mai credenziali abilitate.
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
  });
}

test("preflight: origin del tutto estranea (no vercel.app) -> nessun header CORS", async () => {
  for (const path of ["/auth/login", "/auth/register"]) {
    const res = await preflight(UNRELATED, path);
    assert.equal(res.headers.get("access-control-allow-origin"), null, `ACAO trapelato per ${path}`);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
  }
});

test("produzione Vercel ammessa: ACAO specifico, no credentials", async () => {
  const res = await preflight(PROD_ORIGIN, "/auth/login");
  assert.equal(res.headers.get("access-control-allow-origin"), PROD_ORIGIN);
  assert.equal(res.headers.get("access-control-allow-credentials"), null);
});

/* ── Contratto guest/register: displayName opzionale e valorizzato ──────────── */

async function postJson(path: string, body: unknown) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BRANCH_ORIGIN },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

test("guest: displayName ASSENTE -> 201 con token e user", async () => {
  const { status, json } = await postJson("/auth/guest", {});
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(typeof json.token === "string" && (json.token as string).length > 0);
  assert.ok(json.user && typeof (json.user as { displayName?: unknown }).displayName === "string");
});

test("guest: displayName VALORIZZATO -> 201 e displayName riflesso", async () => {
  const { status, json } = await postJson("/auth/guest", { displayName: "TavoloUno" });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal((json.user as { displayName?: unknown }).displayName, "TavoloUno");
});

test("register: displayName ASSENTE -> 201 (opzionale)", async () => {
  const { status, json } = await postJson("/auth/register", {
    email: "a@example.com",
    password: "password123",
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(typeof json.token === "string");
});

test("register: displayName VALORIZZATO -> 201 e riflesso", async () => {
  const { status, json } = await postJson("/auth/register", {
    email: "b@example.com",
    password: "password123",
    displayName: "Mario",
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal((json.user as { displayName?: unknown }).displayName, "Mario");
});

test("login: credenziali errate -> 401 generico (nessun oracolo email vs password)", async () => {
  // email inesistente
  const r1 = await postJson("/auth/login", { email: "nope@example.com", password: "password123" });
  // email esistente (b@example.com registrata sopra) ma password errata
  const r2 = await postJson("/auth/login", { email: "b@example.com", password: "wrongpassword" });
  assert.equal(r1.status, 401);
  assert.equal(r2.status, 401);
  // Stesso codice/messaggio: nessuna distinzione tra i due casi.
  assert.deepEqual(r1.json, r2.json);
});
