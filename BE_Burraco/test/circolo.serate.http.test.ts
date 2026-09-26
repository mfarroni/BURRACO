import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { WebSocket } from "ws";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryStatsStore } from "../src/stats/store.memory.js";
import { RoomManager } from "../src/room/RoomManager.js";
import { AdminTestAuthStore } from "./adminTestKit.js";
import type { CircoloResponse, ServerMessage } from "../src/contract/types.js";

/**
 * Audit lancio R02 (Ciclo 3) — chi arriva da solo:
 *  - GET /circolo PUBBLICA: serate pubblicate + presenze AGGREGATE (mai nomi o codici);
 *  - /users/me/preferences: consenso agli avvisi delle serate (solo registrati);
 *  - /admin/events/:id e /:id/delete: gate admin (404 ai non admin), validazione.
 * Senza DB: la lista eventi è vuota e pubblica/cancella rispondono 404.
 */

let server: http.Server;
let base: string;
let manager: RoomManager;
const store = new AdminTestAuthStore();

class FakeSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  send(s: string): void {
    this.sent.push(JSON.parse(s) as ServerMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  as(): WebSocket {
    return this as unknown as WebSocket;
  }
}

before(async () => {
  const auth = new AuthService(store);
  manager = new RoomManager({ authService: auth, requireAuth: false });
  server = http.createServer(createHttpApp(auth, new MemoryStatsStore(), manager));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : {} };
}

async function register(email: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/auth/register", { body: { email, password: "password12", displayName: "Serata" } });
  assert.equal(r.status, 201);
  return { token: r.json.token, id: r.json.user.id };
}

test("GET /circolo senza login → 200, forma attesa, nessun evento senza DB", async () => {
  const r = await call("GET", "/circolo");
  assert.equal(r.status, 200);
  const body = r.json as CircoloResponse;
  assert.deepEqual(Object.keys(body).sort(), ["events", "playersOnline", "waitingTables"]);
  assert.deepEqual(body.events, []);
});

test("GET /circolo conta un tavolo pubblico in attesa senza esporre nome né codice", async () => {
  const a = new FakeSocket();
  manager.handleMessage(a.as(), { type: "open_table", code: "SERA1", private: false, displayName: "Nomesegreto", clientId: "c1" });
  const priv = new FakeSocket();
  manager.handleMessage(priv.as(), { type: "open_table", code: "PRIV1", private: true, displayName: "Altro", clientId: "c2" });
  const r = await call("GET", "/circolo");
  assert.equal(r.status, 200);
  assert.equal(r.json.waitingTables, 1, "solo i tavoli PUBBLICI");
  assert.equal(r.json.playersOnline, 2, "entrambi i seduti sono presenti");
  assert.ok(!r.text.includes("Nomesegreto") && !r.text.includes("SERA1") && !r.text.includes("PRIV1"));
  manager.handleClose(a.as());
  manager.handleClose(priv.as());
});

test("preferenze: senza token 401, ospite 403", async () => {
  assert.equal((await call("GET", "/users/me/preferences")).status, 401);
  const g = await call("POST", "/auth/guest", { body: { displayName: "Ospite" } });
  assert.equal((await call("GET", "/users/me/preferences", { token: g.json.token })).status, 403);
});

test("preferenze: default false, attivazione e disattivazione degli avvisi", async () => {
  const { token } = await register("serate@example.com");
  assert.deepEqual((await call("GET", "/users/me/preferences", { token })).json, { avvisiSerate: false });
  const on = await call("POST", "/users/me/preferences", { token, body: { avvisiSerate: true } });
  assert.equal(on.status, 200);
  assert.deepEqual((await call("GET", "/users/me/preferences", { token })).json, { avvisiSerate: true });
  await call("POST", "/users/me/preferences", { token, body: { avvisiSerate: false } });
  assert.deepEqual((await call("GET", "/users/me/preferences", { token })).json, { avvisiSerate: false });
});

test("preferenze: corpo non valido o con campi extra → 400", async () => {
  const { token } = await register("serate2@example.com");
  assert.equal((await call("POST", "/users/me/preferences", { token, body: { avvisiSerate: "si" } })).status, 400);
  assert.equal(
    (await call("POST", "/users/me/preferences", { token, body: { avvisiSerate: true, userId: "altro" } })).status,
    400,
  );
});

test("admin eventi: 404 ai non admin (anche senza token), validazione per l'admin", async () => {
  const id = "00000000-0000-4000-8000-000000000000";
  assert.equal((await call("POST", `/admin/events/${id}`, { body: { pubblicato: true } })).status, 404);
  const { token: userToken } = await register("utente@example.com");
  assert.equal((await call("POST", `/admin/events/${id}`, { token: userToken, body: { pubblicato: true } })).status, 404);
  assert.equal((await call("POST", `/admin/events/${id}/delete`, { token: userToken })).status, 404);

  const admin = await register("capo-serate@example.com");
  store.adminIds.add(admin.id);
  assert.equal((await call("POST", "/admin/events/non-uuid", { token: admin.token, body: { pubblicato: true } })).status, 400);
  assert.equal((await call("POST", `/admin/events/${id}`, { token: admin.token, body: { pubblicato: "si" } })).status, 400);
  // Senza DB l'evento non esiste: 404 esplicito, mai 500.
  const pub = await call("POST", `/admin/events/${id}`, { token: admin.token, body: { pubblicato: true } });
  assert.equal(pub.status, 404);
  assert.equal(pub.json.error, "NOT_FOUND");
  assert.equal((await call("POST", `/admin/events/${id}/delete`, { token: admin.token })).status, 404);
});
