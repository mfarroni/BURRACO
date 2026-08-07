import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Room } from "../src/room/Room.js";
import { RoomManager } from "../src/room/RoomManager.js";
import { defaultGameConfig } from "../src/config.js";
import type { ServerMessage, Seat } from "../src/contract/types.js";

/**
 * COPERTURA SUPPLEMENTARE (agente_test, ciclo lifecycle 1v1).
 * Colma lacune non coperte dalla suite table.lifecycle.test.ts:
 *  (E1) anti-leak ESPLICITO sui payload room_closed / game_ended (non solo state);
 *  (E2) nessun clientMoveId nei broadcast di stato;
 *  (E3) stress: mai > 2 slot per codice sotto molti join spuri con posto disconnesso;
 *  (E4) entrambi disconnessi oltre grazia → GC SILENZIOSO (nessun room_closed);
 *  (E5) reset rifiutato NON altera lo stato/partita in corso (idempotenza negativa).
 */

class FakeSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(s: string): void {
    this.sent.push(JSON.parse(s) as ServerMessage);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  as(): WebSocket {
    return this as unknown as WebSocket;
  }
  find<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
  has(type: string): boolean {
    return this.sent.some((m) => m.type === type);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface SlotView { seat: Seat; status: string; ws: unknown }
const slotsOf = (room: Room): SlotView[] => (room as unknown as { players: SlotView[] }).players;
const disposeOf = (room: Room): void => (room as unknown as { dispose(): void }).dispose();
const cfg = () => ({ ...defaultGameConfig(), turnTimeoutMs: 100_000 });

const ORIG_GRACE = process.env.RECONNECT_GRACE_MS;
afterEach(() => {
  if (ORIG_GRACE === undefined) delete process.env.RECONNECT_GRACE_MS;
  else process.env.RECONNECT_GRACE_MS = ORIG_GRACE;
});

/* ── (E1) anti-leak sui payload terminali ── */

test("(E1) room_closed{abandoned} non espone alcuna informazione nascosta", async () => {
  process.env.RECONNECT_GRACE_MS = "40";
  const room = new Room("LKC1", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");
  // carte di B da cercare in un eventuale leak lato A
  const sb = b.sent.filter((m) => m.type === "state").pop() as
    | Extract<ServerMessage, { type: "state" }>
    | undefined;
  const bCards = sb?.state.yourHand.map((c) => c.id) ?? [];

  room.onDisconnect(a.as());
  await delay(80);

  const rc = b.find("room_closed")!;
  assert.ok(rc, "room_closed ricevuto");
  const keys = Object.keys(rc).sort().join(",");
  assert.equal(keys, "reason,type", "payload solo {type,reason}, nessun campo extra");
  const json = JSON.stringify(rc);
  for (const id of bCards) assert.ok(!json.includes(id), `nessuna carta trapelata: ${id}`);
  assert.ok(!json.includes("clientId") && !json.includes("token"), "nessun segreto di sessione");
});

test("(E1b) game_ended (forfeit da stallo) non espone mani/mazzo/pozzetti", () => {
  // Forziamo lo stato terminale via forfeit deterministico e ispezioniamo il payload.
  const room = new Room("LKC2", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  process.env.RECONNECT_GRACE_MS = "100000";
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");
  // invoca il forfeit interno (via cast) per un seat in stallo
  (room as unknown as { forfeitStalledSeat(s: Seat): void }).forfeitStalledSeat(0);
  const ge = a.find("game_ended")!;
  assert.ok(ge, "game_ended emesso");
  const keys = Object.keys(ge).sort().join(",");
  assert.equal(keys, "finalScores,reason,type,winnerSeat", "solo campi pubblici del contratto");
  assert.ok(Array.isArray(ge.finalScores) && ge.finalScores.length === 2, "solo i due totali");
});

/* ── (E2) nessun clientMoveId/segreto nei broadcast di stato ── */

test("(E2) i broadcast di stato non contengono clientMoveId né token/clientId", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("NOID", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");
  const states = a.sent.filter((m) => m.type === "state");
  assert.ok(states.length > 0, "almeno uno stato ricevuto");
  const json = JSON.stringify(states);
  assert.ok(!json.includes("clientMoveId"), "nessun clientMoveId nello stato");
  assert.ok(!json.includes("cidA") && !json.includes("cidB"), "nessun clientId nello stato");
  assert.ok(!json.includes("tokenHash") && !json.includes("prevToken"), "nessun token nello stato");
  disposeOf(room);
});

/* ── (E3) stress: mai > 2 slot per codice ── */

const WebSocketOPEN = 1;
const engineOf = (room: Room): unknown => (room as unknown as { engine: unknown }).engine;
const wsIsLive = (slot: SlotView): boolean =>
  slot.ws !== null && (slot.ws as { readyState?: number }).readyState === WebSocketOPEN;

test("(E3) stress di join spuri: mai più di 2 slot; una partita parte SOLO con due socket VIVI (mai contro un morto)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("STRS", cfg());
  const a1 = new FakeSocket();
  room.join(a1.as(), undefined, "Alice", "cidA"); // seat0
  room.onDisconnect(a1.as()); // disconnesso, grazia lunga

  // 20 join spuri con token garbage e clientId casuali. Invariante forte in ogni
  // iterazione: mai più di 2 slot, e se una partita è avviata DEVE avere entrambi
  // i socket VIVI (il "match fantasma" = avvio contro un posto morto è impossibile).
  for (let i = 0; i < 20; i++) {
    const s = new FakeSocket();
    room.join(s.as(), `garbage-${i}`, `Intruso${i}`, `cid-${i}`);
    assert.ok(slotsOf(room).length <= 2, `iter ${i}: mai più di 2 slot`);
    if (engineOf(room)) {
      assert.ok(
        slotsOf(room).every(wsIsLive),
        `iter ${i}: partita avviata solo con entrambi i socket vivi`,
      );
    }
  }
  disposeOf(room);
});

/* ── (E4) entrambi disconnessi oltre grazia → GC silenzioso ── */

test("(E4) entrambi offline oltre la grazia → dispose SILENZIOSO senza room_closed", async () => {
  process.env.RECONNECT_GRACE_MS = "40";
  const room = new Room("BOTH", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");

  room.onDisconnect(a.as());
  room.onDisconnect(b.as());
  await delay(90);

  assert.equal(room.isDisposed(), true, "room smaltita");
  assert.ok(!a.has("room_closed") && !b.has("room_closed"), "nessun room_closed: entrambi già offline (GC silenzioso)");
});

/* ── (E5) reset rifiutato non altera la partita in corso ── */

test("(E5) reset con avversario connesso: rifiuto NON altera lo stato di gioco", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "RSTX", displayName: "Alice" });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "RSTX", displayName: "Bob" });
  const statesBefore = a.sent.filter((m) => m.type === "state").length;

  mgr.handleMessage(a.as(), { type: "reset_room" });

  assert.ok(a.has("error"), "reset rifiutato");
  assert.ok(!a.has("room_closed"), "nessuna chiusura");
  const statesAfter = a.sent.filter((m) => m.type === "state").length;
  assert.equal(statesAfter, statesBefore, "nessun nuovo stato: la partita non è stata toccata");
  assert.equal(mgr.activeRoomCount(), 1, "room ancora attiva");
});
