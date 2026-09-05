import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Room } from "../src/room/Room.js";
import { RoomManager } from "../src/room/RoomManager.js";
import { defaultGameConfig, RECONNECT_GRACE_DEFAULT_MS } from "../src/config.js";
import { persistence } from "../src/db/persistence.js";
import type { ServerMessage } from "../src/contract/types.js";

/**
 * ANNULLAMENTO PARTITA (§5) + ABBANDONO persistito (§6.3) + costante di grazia.
 * Deterministico con socket finti e spy sulla persistenza (no-op senza DB).
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
  find<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
  count(type: string): number {
    return this.sent.filter((m) => m.type === type).length;
  }
}

const cfg = () => ({ ...defaultGameConfig(), turnTimeoutMs: 100_000 });
const isDisposed = (room: Room): boolean => (room as unknown as { disposed: boolean }).disposed;

// Spy sulla persistenza (metodi rimpiazzati per il test, ripristinati dopo).
interface Spy {
  abort: { matchId: string; by: string | null }[];
  abandon: string[];
  complete: string[];
  delCheckpoints: string[];
}
let spy: Spy;
const ORIG = {
  abortMatch: persistence.abortMatch,
  abandonMatch: persistence.abandonMatch,
  completeMatch: persistence.completeMatch,
  deleteCheckpoints: persistence.deleteCheckpoints,
};
const ORIG_GRACE = process.env.RECONNECT_GRACE_MS;

beforeEach(() => {
  spy = { abort: [], abandon: [], complete: [], delCheckpoints: [] };
  persistence.abortMatch = async (matchId, by) => { spy.abort.push({ matchId, by }); };
  persistence.abandonMatch = async (matchId) => { spy.abandon.push(matchId); };
  persistence.completeMatch = async (matchId) => { spy.complete.push(matchId); };
  persistence.deleteCheckpoints = async (matchId) => { spy.delCheckpoints.push(matchId); };
});
afterEach(() => {
  persistence.abortMatch = ORIG.abortMatch;
  persistence.abandonMatch = ORIG.abandonMatch;
  persistence.completeMatch = ORIG.completeMatch;
  persistence.deleteCheckpoints = ORIG.deleteCheckpoints;
  if (ORIG_GRACE === undefined) delete process.env.RECONNECT_GRACE_MS;
  else process.env.RECONNECT_GRACE_MS = ORIG_GRACE;
});

test("la costante di grazia è 45s (§6.3, definizione unica)", () => {
  assert.equal(RECONNECT_GRACE_DEFAULT_MS, 45_000);
});

test("annullamento unilaterale: ENTRAMBI ricevono game_aborted con il nome di chi annulla", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("ABORT1", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cA", "user-alice");
  room.join(b.as(), undefined, "Bob", "cB", "user-bob");

  room.onMessage(a.as(), { type: "game_abort" });

  assert.equal(a.find("game_aborted")?.byName, "Alice");
  assert.equal(b.find("game_aborted")?.byName, "Alice", "notifica in chiaro all'avversario");
  assert.ok(isDisposed(room), "il tavolo è smaltito (codice liberato)");
});

test("annullamento: marca 'aborted' con l'autore + purga i checkpoint; nessun completamento", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("ABORT2", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cA", "user-alice");
  room.join(b.as(), undefined, "Bob", "cB", "user-bob");
  const matchId = room.matchId;

  room.onMessage(b.as(), { type: "game_abort" });

  assert.deepEqual(spy.abort, [{ matchId, by: "user-bob" }], "aborted con autore tracciato");
  assert.deepEqual(spy.delCheckpoints, [matchId], "checkpoint purgati");
  assert.deepEqual(spy.complete, [], "nessun contatore/completamento toccato");
});

test("idempotenza: un secondo abort su tavolo già chiuso non lancia e non ri-notifica", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("ABORT3", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cA");
  room.join(b.as(), undefined, "Bob", "cB");

  room.onMessage(a.as(), { type: "game_abort" });
  assert.doesNotThrow(() => room.onMessage(b.as(), { type: "game_abort" }));
  assert.equal(b.count("game_aborted"), 1, "una sola notifica di annullamento");
  assert.equal(spy.abort.length, 1, "un solo 'aborted' persistito");
});

test("codice tavolo immediatamente riutilizzabile dopo l'annullamento", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "REUSE", displayName: "Alice", clientId: "cA" });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "REUSE", displayName: "Bob", clientId: "cB" });
  mgr.handleMessage(a.as(), { type: "game_abort" });

  // Un nuovo giocatore apre di nuovo lo stesso codice: nuovo tavolo, di nuovo in attesa.
  const c = new FakeSocket();
  mgr.handleMessage(c.as(), { type: "join_room", roomCode: "REUSE", displayName: "Carla", clientId: "cC" });
  const open = mgr.listOpenRooms();
  assert.equal(open.length, 1);
  assert.equal(open[0]!.hostName, "Carla", "il codice è tornato disponibile per una nuova partita");
});

test("autorizzazione: un socket non seduto non può annullare la partita altrui", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "AUTHZ", displayName: "Alice", clientId: "cA" });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "AUTHZ", displayName: "Bob", clientId: "cB" });

  const intruder = new FakeSocket();
  mgr.handleMessage(intruder.as(), { type: "game_abort" }); // mai entrato in alcuna room
  assert.equal(spy.abort.length, 0, "nessun annullamento innescato da un estraneo");
  assert.equal(a.count("game_aborted"), 0);
  assert.equal(b.count("game_aborted"), 0);
});

test("abbandono oltre la grazia → partita marcata 'abandoned' e room_closed all'avversario", async () => {
  process.env.RECONNECT_GRACE_MS = "30"; // grazia brevissima
  const room = new Room("ABAND", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cA", "user-alice");
  room.join(b.as(), undefined, "Bob", "cB", "user-bob");
  const matchId = room.matchId;

  room.onDisconnect(a.as()); // Alice sparisce
  await new Promise((r) => setTimeout(r, 80)); // oltre la grazia

  assert.deepEqual(spy.abandon, [matchId], "partita marcata 'abandoned'");
  assert.deepEqual(spy.complete, [], "nessun completamento (contatori invariati)");
  assert.equal(b.find("room_closed")?.reason, "abandoned", "avversario notificato");
});
