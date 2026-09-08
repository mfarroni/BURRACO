import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { WebSocket } from "ws";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { RoomManager } from "../src/room/RoomManager.js";
import type { ServerMessage, TablesResponse, NewCodeResponse } from "../src/contract/types.js";

/**
 * LOBBY — rotte HTTP (GET /tables, GET /tables/new-code, POST /session/leave)
 * con AuthService in-memory e RoomManager wire-ato. Verifica gating Bearer (S4),
 * whitelist anti-leak della lista (S1), contatore presenza, generazione codice e
 * chiusura pulita del proprio tavolo. Nessun DB, nessun WebSocket reale.
 */

let server: http.Server;
let base: string;
let auth: AuthService;
let manager: RoomManager;

/** Socket finto per seminare un tavolo in attesa via il manager. */
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

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  auth = new AuthService(new MemoryAuthStore());
  // requireAuth false: la seduta via FakeSocket non richiede token, ma se lo
  // passiamo l'identità (userId) viene comunque risolta dal token.
  manager = new RoomManager({ authService: auth, requireAuth: false });
  const app = createHttpApp(auth, undefined, manager);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function guestToken(name: string): Promise<{ token: string }> {
  const res = await fetch(base + "/auth/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: name }),
  });
  const j = (await res.json()) as { token: string };
  return { token: j.token };
}

test("S4: GET /tables senza Bearer → 401", async () => {
  const res = await fetch(base + "/tables");
  assert.equal(res.status, 401);
});

test("GET /tables con Bearer → 200, whitelist della lista (S1) e lobbyPlayers numerico", async () => {
  const { token } = await guestToken("Osservatore");
  // Semina un tavolo pubblico in attesa via il manager, con l'identità di un ospite.
  const creator = await guestToken("Creatore");
  const ws = new FakeSocket();
  manager.handleMessage(ws.as(), {
    type: "open_table",
    code: "HTTP1",
    private: false,
    displayName: "IGNORATO",
    clientId: "cid-http",
    authToken: creator.token,
  });
  await delay(30); // risoluzione async dell'identità dal token

  const res = await fetch(base + "/tables", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as TablesResponse;
  assert.ok(Array.isArray(body.tables), "tables è un array");
  const row = body.tables.find((t) => t.code === "HTTP1");
  assert.ok(row, "il tavolo pubblico è in lista");
  assert.deepEqual(
    Object.keys(row!).sort(),
    ["code", "creatorName", "openedAt", "seatsTaken", "seatsTotal"],
    "solo la whitelist (nessun campo interno)",
  );
  // Il nome è quello AUTORITATIVO del token, non "IGNORATO" del client.
  assert.equal(row!.creatorName, "Creatore");
  const json = JSON.stringify(body);
  assert.ok(!json.includes("cid-http"), "nessun clientId nel payload");
  assert.ok(!json.includes(creator.token), "nessun token nel payload");
  assert.equal(typeof body.lobbyPlayers, "number");
});

test("GET /tables/new-code con Bearer → codice a 5 caratteri senza ambiguità", async () => {
  const { token } = await guestToken("NewCode");
  const res = await fetch(base + "/tables/new-code", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as NewCodeResponse;
  assert.match(body.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
});

test("GET /tables/new-code senza Bearer → 401", async () => {
  const res = await fetch(base + "/tables/new-code");
  assert.equal(res.status, 401);
});

test("POST /session/leave → 204 e rimozione del PROPRIO tavolo dalla lista", async () => {
  const owner = await guestToken("Proprietario");
  const ws = new FakeSocket();
  manager.handleMessage(ws.as(), {
    type: "open_table",
    code: "LEAVEME",
    private: false,
    displayName: "x",
    clientId: "cid-leave",
    authToken: owner.token,
  });
  await delay(30);
  // Presente in lista.
  let res = await fetch(base + "/tables", { headers: { Authorization: `Bearer ${owner.token}` } });
  let body = (await res.json()) as TablesResponse;
  assert.ok(body.tables.some((t) => t.code === "LEAVEME"), "tavolo presente prima del leave");

  // Chiusura pulita.
  const leave = await fetch(base + "/session/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({}),
  });
  assert.equal(leave.status, 204);

  res = await fetch(base + "/tables", { headers: { Authorization: `Bearer ${owner.token}` } });
  body = (await res.json()) as TablesResponse;
  assert.ok(!body.tables.some((t) => t.code === "LEAVEME"), "tavolo sparito dopo il leave");
});

test("POST /session/leave senza Bearer → 401", async () => {
  const res = await fetch(base + "/session/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

test("POST /session/leave con token nel BODY (beacon) → 204", async () => {
  const owner = await guestToken("Beacon");
  const res = await fetch(base + "/session/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: owner.token }),
  });
  assert.equal(res.status, 204);
});
