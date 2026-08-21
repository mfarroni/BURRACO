import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";

/**
 * COPERTURA EXTRA agente_test (verifica ciclo 2) — gap non coperti dagli 8 test
 * di auth.hardening.ciclo2.test.ts:
 *  - CORS preflight ancora funzionante + security header applicati alla preflight.
 *  - /auth/logout singolo idempotente e invariato (200 ok:true anche senza Bearer).
 *  - pruning: un OSPITE inattivo ma con una sessione ancora presente NON viene potato.
 * Tutto su AuthStore in-memory (senza DB), in DEV.
 */

let server: http.Server;
let base: string;
let store: MemoryAuthStore;
let auth: AuthService;

before(async () => {
  store = new MemoryAuthStore();
  auth = new AuthService(store);
  server = http.createServer(createHttpApp(auth));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("CORS: preflight OPTIONS con Origin in allowlist riflette l'origin e resta 2xx", async () => {
  const res = await fetch(base + "/auth/login", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,authorization",
    },
  });
  assert.ok(res.status === 204 || res.status === 200, `preflight status ${res.status}`);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:3000");
  // I security header devono valere ANCHE sulla preflight (middleware prima di CORS).
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("/auth/logout è idempotente: 200 ok:true con Bearer valido, revocato e sconosciuto", async () => {
  const reg = await fetch(base + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "idem@test.io", password: "password123" }),
  });
  const { token } = (await reg.json()) as { token: string };

  const first = await fetch(base + "/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });

  // ripetuto sullo stesso token (ora revocato): ancora 200 ok:true
  const again = await fetch(base + "/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(again.status, 200);

  // senza alcun Bearer: ancora 200 ok:true (nessun oracolo)
  const noBearer = await fetch(base + "/auth/logout", { method: "POST" });
  assert.equal(noBearer.status, 200);
  assert.deepEqual(await noBearer.json(), { ok: true });
});

test("SEC-A3b: il pruning NON elimina un ospite che ha ancora una sessione presente", async () => {
  const guest = await store.createUser({ email: null, displayName: "Osp", passwordHash: null, isGuest: true });
  // sessione ancora presente (non scaduta, non revocata)
  await store.createSession({ userId: guest.id, tokenHash: "keep-guest", expiresAt: new Date(Date.now() + 1e9) });
  // manutenzione con "now" spostato oltre 7 giorni: l'ospite è vecchio ma protetto dalla sessione
  await auth.runMaintenance(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
  assert.notEqual(await store.getUserById(guest.id), null, "ospite con sessione non deve essere potato");
});
