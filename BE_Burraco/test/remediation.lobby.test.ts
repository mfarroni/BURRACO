import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { RoomManager } from "../src/room/RoomManager.js";
import type { ServerMessage } from "../src/contract/types.js";

/**
 * REMEDIATION lobby — regressione dei fix SEC-LOBBY-01/02/03.
 *  R1a — open_table idempotente per sessione (SEC-LOBBY-01): niente creazione
 *        massiva di tavoli pubblici da una sola identità.
 *  R1b — un socket = una room viva (SEC-LOBBY-02): join_room ripetuti sullo stesso
 *        socket non lasciano room orfane mai sottoposte a GC.
 *  R2a — tetto globale MAX_ROOMS (SEC-LOBBY-03): oltre la soglia la CREAZIONE è
 *        rifiutata, ma la seduta a una room ESISTENTE resta ammessa.
 * Socket finti, deterministici (percorso sincrono senza auth).
 */

class FakeSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  send(s: string): void { this.sent.push(JSON.parse(s) as ServerMessage); }
  close(): void { this.readyState = 3; }
  as(): WebSocket { return this as unknown as WebSocket; }
  has(type: string): boolean { return this.sent.some((m) => m.type === type); }
  find<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ORIG = { max: process.env.MAX_ROOMS, waiting: process.env.WAITING_GRACE_MS };
afterEach(() => {
  if (ORIG.max === undefined) delete process.env.MAX_ROOMS; else process.env.MAX_ROOMS = ORIG.max;
  if (ORIG.waiting === undefined) delete process.env.WAITING_GRACE_MS; else process.env.WAITING_GRACE_MS = ORIG.waiting;
});

/* ─────────────────────────── R1a (SEC-LOBBY-01) ─────────────────────────── */

test("R1a: open_table con codice diverso mentre la sessione ha già un tavolo → nessun secondo tavolo per quel codice", () => {
  const mgr = new RoomManager();
  const a1 = new FakeSocket();
  mgr.handleMessage(a1.as(), {
    type: "open_table", code: "OPN1", private: false, displayName: "Alice", clientId: "cidA",
  });
  // Stessa identità, NUOVO socket, codice DIVERSO. Con la guardia di idempotenza
  // (§6.1) la sessione viene RIAGGANCIATA al proprio tavolo esistente: il codice
  // distinto NON diventa un secondo tavolo. (Se il secondo socket è VIVO, il
  // riaggancio prende il 2° posto → self-play, comportamento permesso §5.4-D:
  // l'importante è che NON si moltiplichino i tavoli pubblici.)
  const a2 = new FakeSocket();
  mgr.handleMessage(a2.as(), {
    type: "open_table", code: "OPN2", private: false, displayName: "Alice", clientId: "cidA",
  });
  assert.equal(mgr.findByCode("OPN2"), undefined, "il secondo codice NON crea un secondo tavolo");
  assert.equal(mgr.activeRoomCount(), 1, "una sola room per la sessione");
  assert.ok(a2.has("room_joined"), "il secondo socket è riagganciato al tavolo esistente");
  assert.ok(!a2.has("open_rejected"), "idempotenza, non collisione CODE_IN_USE");
});

test("R1a+R2a: raffica di open_table da una sola identità → nessuno spam della lista pubblica, room limitate dal tetto", () => {
  process.env.MAX_ROOMS = "5";
  const mgr = new RoomManager();
  for (let i = 0; i < 25; i++) {
    const s = new FakeSocket();
    mgr.handleMessage(s.as(), {
      type: "open_table", code: `CODE${i}`, private: false, displayName: "Attacker", clientId: "attacker",
    });
    // Invariante a OGNI passo: al massimo 1 tavolo PUBBLICO in attesa per la sessione.
    assert.ok(mgr.listPublicWaitingTables().length <= 1, "la lista pubblica non viene mai spammata");
  }
  assert.ok(mgr.listPublicWaitingTables().length <= 1, "nessuno spam della lista pubblica");
  assert.ok(mgr.activeRoomCount() <= 5, "crescita delle room limitata dal tetto globale (R2a)");
});

/* ─────────────────────────── R1b (SEC-LOBBY-02) ─────────────────────────── */

test("R1b: join_room multipli sullo STESSO socket → nessuna room orfana", async () => {
  process.env.WAITING_GRACE_MS = "40";
  const mgr = new RoomManager();
  const s = new FakeSocket();
  mgr.handleMessage(s.as(), { type: "join_room", roomCode: "AAAAA", displayName: "A", clientId: "cidA" });
  mgr.handleMessage(s.as(), { type: "join_room", roomCode: "BBBBB", displayName: "A", clientId: "cidA" });
  mgr.handleMessage(s.as(), { type: "join_room", roomCode: "CCCCC", displayName: "A", clientId: "cidA" });
  assert.equal(mgr.activeRoomCount(), 1, "un solo socket → una sola room (nessuna orfana)");

  // Alla chiusura la singola room viene smaltita: nessun residuo appeso.
  mgr.handleClose(s.as());
  await delay(80); // > 40ms di grace
  assert.equal(mgr.activeRoomCount(), 0, "room smaltita alla scadenza della grace: nessun leak");
});

/* ─────────────────────────── R2a (SEC-LOBBY-03) ─────────────────────────── */

test("R2a: oltre MAX_ROOMS la CREAZIONE è rifiutata; la seduta a una room esistente resta ammessa", () => {
  process.env.MAX_ROOMS = "2";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "open_table", code: "CAP1", private: false, displayName: "A", clientId: "cidA" });
  mgr.handleMessage(b.as(), { type: "open_table", code: "CAP2", private: false, displayName: "B", clientId: "cidB" });
  assert.equal(mgr.activeRoomCount(), 2, "due room al tetto");

  // Terza CREAZIONE: rifiutata con errore leggibile, nessuna nuova room.
  const c = new FakeSocket();
  mgr.handleMessage(c.as(), { type: "open_table", code: "CAP3", private: false, displayName: "C", clientId: "cidC" });
  assert.ok(c.has("error"), "creazione oltre soglia → errore");
  assert.ok(!c.has("room_joined"), "nessun tavolo creato");
  assert.equal(mgr.activeRoomCount(), 2, "il numero di room non cresce oltre il tetto");

  // Sedersi a una room ESISTENTE non è creazione: deve essere ammesso anche al tetto.
  const d = new FakeSocket();
  mgr.handleMessage(d.as(), { type: "join_room", roomCode: "CAP1", displayName: "D", clientId: "cidD" });
  assert.ok(d.has("state") || d.has("room_joined"), "la seduta a una room esistente non è bloccata dal cap");
});

test("R2a: quick_match oltre il tetto → errore, nessuna nuova room", () => {
  process.env.MAX_ROOMS = "1";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "open_table", code: "ONLY", private: false, displayName: "A", clientId: "cidA" });
  assert.equal(mgr.activeRoomCount(), 1);
  const b = new FakeSocket();
  mgr.handleMessage(b.as(), { type: "quick_match", displayName: "B", clientId: "cidB" });
  assert.ok(b.has("error"), "quick_match oltre soglia → errore");
  assert.equal(mgr.activeRoomCount(), 1, "nessuna nuova room creata");
});
