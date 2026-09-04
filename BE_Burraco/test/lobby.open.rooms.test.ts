import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { WebSocket } from "ws";
import { RoomManager } from "../src/room/RoomManager.js";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import type { OpenRoomInfo, ServerMessage } from "../src/contract/types.js";

/**
 * ELENCO TAVOLI APERTI (§4). Deterministico su RoomManager con socket finti +
 * verifica della forma del payload di GET /rooms/open. Copre:
 *  - un tavolo in attesa compare; a partita avviata sparisce (nessun posto libero);
 *  - ordinamento per attesa più lunga in cima; tetto massimo;
 *  - tavolo smaltito non compare;
 *  - il payload espone SOLO i campi del §4.1 (nessun id utente/email/ospite-flag).
 */

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

function joinRoom(mgr: RoomManager, ws: FakeSocket, roomCode: string, displayName: string, clientId: string): void {
  // In assenza di authService/requireAuth, handleJoin procede in modo sincrono
  // (nessun await) fino a room.join: dopo handleMessage il tavolo esiste già.
  mgr.handleMessage(ws.as(), { type: "join_room", roomCode, displayName, clientId });
}

const ORIG_GRACE = process.env.RECONNECT_GRACE_MS;
process.env.RECONNECT_GRACE_MS = "100000"; // grazia lunga: nessun abbandono nei test

test("un solo giocatore in attesa → il tavolo compare con i campi attesi", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  joinRoom(mgr, a, "TAV1", "Marco", "cidA");

  const open = mgr.listOpenRooms();
  assert.equal(open.length, 1);
  const r = open[0]!;
  assert.equal(r.code, "TAV1");
  assert.equal(r.hostName, "Marco");
  assert.equal(r.seats, 1);
  assert.equal(r.maxSeats, 2);
  assert.ok(!Number.isNaN(Date.parse(r.waitingSince)), "waitingSince è ISO8601 valido");
});

test("partita avviata (2 giocatori) → il tavolo NON compare più", () => {
  const mgr = new RoomManager();
  joinRoom(mgr, new FakeSocket(), "TAV2", "Marco", "cidA");
  assert.equal(mgr.listOpenRooms().length, 1);
  joinRoom(mgr, new FakeSocket(), "TAV2", "Lucia", "cidB");
  assert.equal(mgr.listOpenRooms().length, 0, "nessun posto libero e partita iniziata");
});

test("ordinamento: attesa più lunga in cima", () => {
  const mgr = new RoomManager();
  joinRoom(mgr, new FakeSocket(), "OLD", "Primo", "c1");
  // Forza un openedAt più recente sul secondo tavolo per un ordine deterministico.
  joinRoom(mgr, new FakeSocket(), "NEW", "Secondo", "c2");
  const rooms = (mgr as unknown as { rooms: Map<string, { openedAt: number }> }).rooms;
  const oldRoom = rooms.get("OLD")!;
  const newRoom = rooms.get("NEW")!;
  newRoom.openedAt = oldRoom.openedAt + 5000;

  const open = mgr.listOpenRooms();
  assert.deepEqual(open.map((r) => r.code), ["OLD", "NEW"], "il più vecchio è primo");
});

test("tetto massimo rispettato", () => {
  const mgr = new RoomManager();
  for (let i = 0; i < 5; i++) joinRoom(mgr, new FakeSocket(), `T${i}`, `P${i}`, `c${i}`);
  assert.equal(mgr.listOpenRooms(2).length, 2, "limit applicato");
});

test("tavolo smaltito non compare", () => {
  const mgr = new RoomManager();
  joinRoom(mgr, new FakeSocket(), "GONE", "Marco", "cidA");
  const room = (mgr as unknown as { rooms: Map<string, { dispose(): void }> }).rooms.get("GONE")!;
  room.dispose();
  assert.equal(mgr.listOpenRooms().length, 0);
});

test("il payload di listOpenRooms contiene SOLO i campi del §4.1 (nessun leak)", () => {
  const mgr = new RoomManager();
  joinRoom(mgr, new FakeSocket(), "SAFE", "Marco", "cidA");
  const [r] = mgr.listOpenRooms();
  assert.deepEqual(
    Object.keys(r as OpenRoomInfo).sort(),
    ["code", "hostName", "maxSeats", "seats", "waitingSince"],
    "nessun campo extra (email/userId/ospite-flag)",
  );
});

/* ─────────────────────── HTTP GET /rooms/open ─────────────────────── */

let server: http.Server;
let base: string;
let openStub: OpenRoomInfo[] = [];

before(async () => {
  const auth = new AuthService(new MemoryAuthStore());
  const app = createHttpApp(auth, undefined, { openRooms: () => openStub });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("GET /rooms/open è pubblico (nessun Bearer) e ritorna { rooms }", async () => {
  openStub = [
    { code: "TAVOLO1", hostName: "Marco", seats: 1, maxSeats: 2, waitingSince: new Date().toISOString() },
  ];
  const res = await fetch(base + "/rooms/open");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { rooms: OpenRoomInfo[] };
  assert.equal(body.rooms.length, 1);
  assert.deepEqual(
    Object.keys(body.rooms[0]!).sort(),
    ["code", "hostName", "maxSeats", "seats", "waitingSince"],
  );
});

test("GET /rooms/open: elenco vuoto → { rooms: [] }", async () => {
  openStub = [];
  const res = await fetch(base + "/rooms/open");
  const body = (await res.json()) as { rooms: OpenRoomInfo[] };
  assert.deepEqual(body.rooms, []);
});

// Ripristino env alla fine del file.
test("cleanup env", () => {
  if (ORIG_GRACE === undefined) delete process.env.RECONNECT_GRACE_MS;
  else process.env.RECONNECT_GRACE_MS = ORIG_GRACE;
});
