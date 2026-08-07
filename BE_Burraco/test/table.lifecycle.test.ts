import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Room } from "../src/room/Room.js";
import { RoomManager } from "../src/room/RoomManager.js";
import { defaultGameConfig } from "../src/config.js";
import type { ServerMessage, Seat } from "../src/contract/types.js";

/**
 * LIFECYCLE del tavolo 1v1 (remediation funzionale + micro-feature).
 * Tutto DETERMINISTICO a livello Room/RoomManager con socket finti, senza
 * dipendere dal timing di rete. Copre:
 *  (1) doppio ingresso corretto → start ricevuto da ENTRAMBI;
 *  (2) riproduzione del bug "slot fantasma" e sua ASSENZA dopo il fix (mai >2 slot);
 *  (3) rientro ENTRO la grazia (token);
 *  (4) rientro OLTRE la grazia → room_closed{abandoned} all'altro;
 *  (5) perdita del token → reclaim via clientId;
 *  (6) reset_room in attesa → room_closed{interrupted} + dispose;
 *  (7) reset_room con avversario disconnesso → interrupted;
 *  (8) reset_room con avversario connesso → rifiutato leggibile;
 *  (9) SEC-04 preservato: posto CONNESSO non reclamabile né via token né via clientId;
 *  (10) anti-leak invariato.
 */

class FakeSocket {
  readyState = 1; // WebSocket.OPEN
  sent: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(s: string): void {
    this.sent.push(JSON.parse(s) as ServerMessage);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3; // CLOSED
  }
  as(): WebSocket {
    return this as unknown as WebSocket;
  }
  states(): Extract<ServerMessage, { type: "state" }>["state"][] {
    return this.sent
      .filter((m): m is Extract<ServerMessage, { type: "state" }> => m.type === "state")
      .map((m) => m.state);
  }
  lastState(): Extract<ServerMessage, { type: "state" }>["state"] | undefined {
    const s = this.states();
    return s[s.length - 1];
  }
  roomJoined(): Extract<ServerMessage, { type: "room_joined" }> | undefined {
    return this.sent.find((m) => m.type === "room_joined") as
      | Extract<ServerMessage, { type: "room_joined" }>
      | undefined;
  }
  find<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
  has(type: string): boolean {
    return this.sent.some((m) => m.type === type);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SlotView {
  seat: Seat;
  status: string;
  clientId?: string;
  ws: unknown;
}
const slotsOf = (room: Room): SlotView[] => (room as unknown as { players: SlotView[] }).players;
const engineStarted = (room: Room): boolean =>
  (room as unknown as { engine: unknown }).engine !== null;
const disposeOf = (room: Room): void => (room as unknown as { dispose(): void }).dispose();
const cfg = () => ({ ...defaultGameConfig(), turnTimeoutMs: 100_000 });

const ORIG_GRACE = process.env.RECONNECT_GRACE_MS;
afterEach(() => {
  if (ORIG_GRACE === undefined) delete process.env.RECONNECT_GRACE_MS;
  else process.env.RECONNECT_GRACE_MS = ORIG_GRACE;
});

/* ─────────────────────────── (1) DOPPIO INGRESSO ─────────────────────────── */

test("(1) doppio ingresso corretto → la partita parte e lo stato iniziale arriva a ENTRAMBI", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("OK1", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");

  assert.equal(slotsOf(room).length, 2, "esattamente 2 slot");
  assert.ok(engineStarted(room), "partita avviata");
  assert.ok(a.has("state") && b.has("state"), "stato iniziale ricevuto da entrambi");
  const sa = a.lastState()!;
  const sb = b.lastState()!;
  assert.equal(sa.whoseTurn, sb.whoseTurn, "stesso turno visto da entrambi");
  disposeOf(room);
});

/* ─────────────────────────── (2) SLOT FANTASMA ─────────────────────────── */

test("(2a) token perso ma clientId noto → RECLAIM del posto (nessuno slot fantasma, mai >2 slot)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("PHANT", cfg());
  const a1 = new FakeSocket();
  room.join(a1.as(), undefined, "Alice", "cidA"); // slot0
  assert.equal(slotsOf(room).length, 1);

  // La connessione flappa: slot0 diventa disconnesso (grazia lunga: non scade).
  room.onDisconnect(a1.as());

  // Auto-reconnect del client con un token NON riconosciuto ma STESSO clientId:
  // senza fix creerebbe slot1 e farebbe partire un match fantasma contro slot0.
  const a2 = new FakeSocket();
  room.join(a2.as(), "token-non-valido", "Alice", "cidA");
  assert.equal(slotsOf(room).length, 1, "reclaim: nessuno slot fantasma creato");
  assert.equal(a2.roomJoined()?.resumed, true, "riagganciato al proprio posto (resumed)");
  assert.ok(!engineStarted(room), "nessun match fantasma: si attende ancora l'avversario");

  // Il vero avversario entra: ora la partita parte per entrambi i socket VIVI.
  const b = new FakeSocket();
  room.join(b.as(), undefined, "Bob", "cidB");
  assert.equal(slotsOf(room).length, 2, "mai più di 2 slot");
  assert.ok(engineStarted(room), "partita avviata con due posti vivi");
  assert.ok(a2.has("state") && b.has("state"), "stato iniziale a ENTRAMBI i socket correnti");
  disposeOf(room);
});

test("(2b) FIX del match fantasma: anche SENZA clientId, un match non parte mai contro un posto disconnesso; mai >2 slot", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("PHANT2", cfg());
  const a1 = new FakeSocket();
  room.join(a1.as(), undefined, "Alice"); // slot0, nessun clientId
  room.onDisconnect(a1.as());

  // Reconnect con token non valido e senza clientId → crea un secondo slot...
  const a2 = new FakeSocket();
  room.join(a2.as(), "garbage", "Alice");
  assert.equal(slotsOf(room).length, 2, "due slot, ma...");
  // ...la partita NON parte: slot0 è disconnesso (regola "due posti vivi").
  assert.ok(!engineStarted(room), "nessun match fantasma contro il posto disconnesso");
  assert.ok(!a2.has("state"), "nessuno stato inviato al socket morto/incompleto");

  // Il vero avversario entra: room piena → fallback reclaim del posto disconnesso.
  const b = new FakeSocket();
  room.join(b.as(), undefined, "Bob");
  assert.equal(slotsOf(room).length, 2, "mai più di 2 slot per codice");
  assert.ok(engineStarted(room), "ora entrambi i posti sono vivi → partita avviata");
  assert.ok(a2.has("state") && b.has("state"), "stato iniziale a entrambi i socket vivi");
  disposeOf(room);
});

/* ─────────────────────────── (3) RIENTRO ENTRO GRAZIA ─────────────────────────── */

test("(3) rientro ENTRO la grazia via token → resumed e stato ripristinato, nessuna chiusura", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("REJ", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");
  const tokenA = a.roomJoined()!.yourToken;

  room.onDisconnect(a.as());
  const a2 = new FakeSocket();
  room.join(a2.as(), tokenA, "Alice", "cidA");

  assert.equal(a2.roomJoined()?.resumed, true, "rientro per token = resumed");
  assert.ok(a2.has("state"), "stato corrente ripristinato");
  assert.ok(!a2.has("room_closed"), "nessuna chiusura entro la grazia");
  assert.ok(b.has("opponent_reconnected"), "l'avversario è notificato del rientro");
  disposeOf(room);
});

/* ─────────────────────────── (4) RIENTRO OLTRE GRAZIA ─────────────────────────── */

test("(4) OLTRE la grazia → room_closed{abandoned} all'altro, room smaltita, nessun vincitore", async () => {
  process.env.RECONNECT_GRACE_MS = "50"; // grazia brevissima iniettata
  const room = new Room("ABAN", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");

  room.onDisconnect(a.as());
  await delay(90); // > grazia

  const rc = b.find("room_closed");
  assert.ok(rc, "l'avversario riceve room_closed");
  assert.equal(rc!.reason, "abandoned", "motivazione abbandono");
  assert.ok(!b.has("game_ended"), "nessun forfeit-win");
  assert.equal(room.isDisposed(), true, "room smaltita");

  // Rientro TARDIVO col vecchio token: room conclusa → messaggio chiaro, nessun resume.
  const a2 = new FakeSocket();
  room.join(a2.as(), undefined, "Alice", "cidA");
  assert.ok(a2.has("error"), "rientro tardivo respinto con errore");
  assert.ok(!a2.has("room_joined"), "nessun room_joined dopo la chiusura");
});

/* ─────────────────────────── (5) RECLAIM VIA clientId ─────────────────────────── */

test("(5) token perso del tutto → reclaim via clientId con stato ripristinato", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("LOST", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");

  room.onDisconnect(a.as());
  // Nessun token (perso), ma stesso clientId per-browser.
  const a2 = new FakeSocket();
  room.join(a2.as(), undefined, "Alice", "cidA");

  assert.equal(a2.roomJoined()?.resumed, true, "reclaim via clientId = resumed");
  assert.ok(a2.has("state"), "stato di gioco ripristinato (match in corso)");
  assert.equal(slotsOf(room).length, 2, "nessuno slot in più");
  assert.equal(slotsOf(room).find((s) => s.seat === 0)?.status, "connected", "posto riagganciato");
  disposeOf(room);
});

/* ─────────────────────────── (6) RESET IN ATTESA ─────────────────────────── */

test("(6) reset_room in attesa (nessun avversario) → room_closed{interrupted} + dispose", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "RST1", displayName: "Alice" });
  assert.equal(mgr.activeRoomCount(), 1);

  mgr.handleMessage(a.as(), { type: "reset_room" });
  const rc = a.find("room_closed");
  assert.ok(rc, "il richiedente riceve room_closed");
  assert.equal(rc!.reason, "interrupted", "chiusura interrupted");
  assert.equal(mgr.activeRoomCount(), 0, "room smaltita (GC)");
});

/* ─────────────────────────── (7) RESET CON AVVERSARIO OFFLINE ─────────────────────────── */

test("(7) reset_room con avversario DISCONNESSO → room_closed{interrupted} + dispose", () => {
  process.env.RECONNECT_GRACE_MS = "100000"; // grazia lunga: l'abbandono non corre
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "RST2", displayName: "Alice" });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "RST2", displayName: "Bob" });

  mgr.handleClose(b.as()); // Bob offline (grazia in corso)
  mgr.handleMessage(a.as(), { type: "reset_room" });

  const rc = a.find("room_closed");
  assert.ok(rc, "Alice riceve room_closed");
  assert.equal(rc!.reason, "interrupted", "chiusura interrupted");
  assert.equal(mgr.activeRoomCount(), 0, "room smaltita (GC)");
});

/* ─────────────────────────── (8) RESET RIFIUTATO ─────────────────────────── */

test("(8) reset_room con avversario CONNESSO → rifiutato in modo leggibile, room NON smaltita", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "RST3", displayName: "Alice" });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "RST3", displayName: "Bob" });

  mgr.handleMessage(a.as(), { type: "reset_room" });

  const err = a.find("error");
  assert.ok(err, "reset rifiutato con errore leggibile");
  assert.match(err!.message, /avversario/i, "messaggio comprensibile");
  assert.ok(!a.has("room_closed"), "nessuna chiusura");
  assert.equal(mgr.activeRoomCount(), 1, "room ancora attiva (non smaltita)");
});

/* ─────────────────────────── (9) SEC-04 PRESERVATO ─────────────────────────── */

test("(9a) SEC-04: un secondo socket col token del legittimo CONNESSO è rifiutato (1008), la vittima resta viva", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("SEC04T", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");
  const tokenA = a.roomJoined()!.yourToken;

  const intruder = new FakeSocket();
  room.join(intruder.as(), tokenA, "Mallory", "cidZ");
  assert.ok(
    intruder.sent.some((m) => m.type === "error" && /già attiva/i.test((m as { message: string }).message)),
    "token del connesso: rifiutato (sessione già attiva)",
  );
  assert.equal(intruder.closed?.code, 1008, "close 1008");
  assert.ok(!intruder.has("room_joined") && !intruder.has("state"), "nessun accesso all'intruso");
  assert.equal(slotsOf(room).find((s) => s.seat === 0)?.ws, a, "socket legittimo intatto");
  disposeOf(room);
});

test("(9b) SEC-04: clientId che COLLIDE con un posto CONNESSO non lo reclama mai (a partita avviata è respinto, SEC-11)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("SEC04C", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidX"); // seat0 connesso
  room.join(b.as(), undefined, "Bob", "cidY"); // seat1 connesso → engine avviato
  assert.ok(engineStarted(room), "partita avviata");
  room.onDisconnect(b.as()); // seat1 disconnesso; seat0 VIVO

  // Un socket con il clientId di Alice (seat0 VIVO): il reclaim via clientId salta
  // i posti vivi (nessun disconnesso con cidX). A PARTITA AVVIATA il fallback
  // open-table è disattivato (SEC-11): x NON subentra al posto disconnesso di Bob
  // e viene RESPINTO ("al completo"). Il posto di Alice non è mai toccato (SEC-04).
  const x = new FakeSocket();
  room.join(x.as(), undefined, "X", "cidX");
  assert.ok(!x.has("room_joined"), "SEC-11: nessun subentro al posto disconnesso a partita avviata");
  assert.ok(!x.has("state"), "nessuno stato/mano divulgato all'estraneo");
  assert.ok(
    x.sent.some((m) => m.type === "error" && /completo/i.test((m as { message: string }).message)),
    "respinto: la room è al completo",
  );
  assert.equal(slotsOf(room).find((s) => s.seat === 0)?.status, "connected", "seat0 di Alice mai reclamato");
  assert.equal(slotsOf(room).find((s) => s.seat === 0)?.ws, a, "socket di Alice intatto");
  // Il posto di Bob resta il SUO: disconnesso, non ceduto a x (rientra col proprio clientId).
  assert.equal(slotsOf(room).find((s) => s.seat === 1)?.status, "disconnected", "posto di Bob non ceduto");
  assert.equal(slotsOf(room).length, 2, "nessuno slot in più");
  disposeOf(room);
});

/* ─────────────────────────── (11) SEC-11: HIJACK POSTO DISCONNESSO ─────────────────────────── */

test("(11) SEC-11 (PROVA A): a partita avviata un join col solo codice tavolo NON subentra al disconnesso né vede la sua mano", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("HIJK", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB"); // engine avviato
  assert.ok(engineStarted(room), "partita avviata");
  // mani da cercare in un eventuale leak verso l'attaccante
  const bHand = b.lastState()!.yourHand.map((c) => c.id);
  const aHand = a.lastState()!.yourHand.map((c) => c.id);

  room.onDisconnect(b.as()); // seat1 disconnesso (grazia lunga: non scade)

  // Attaccante che conosce SOLO il codice tavolo: nessun token, nessun clientId.
  const attacker = new FakeSocket();
  room.join(attacker.as(), undefined, "Mallory");

  // Deve essere RIFIUTATO: nessun room_joined, nessun resumed, nessuno state.
  assert.ok(!attacker.has("room_joined"), "nessun room_joined{resumed} all'attaccante");
  assert.ok(!attacker.has("state"), "nessuno state redatto all'attaccante");
  assert.ok(
    attacker.sent.some((m) => m.type === "error" && /completo/i.test((m as { message: string }).message)),
    "join respinto: room al completo",
  );
  // Nessuna mano (né di Bob né di Alice) divulgata nei messaggi ricevuti dall'attaccante.
  const json = JSON.stringify(attacker.sent);
  for (const id of [...bHand, ...aHand])
    assert.ok(!json.includes(id), `nessuna carta divulgata all'attaccante: ${id}`);
  // Il posto di Bob resta suo e disconnesso, pronto per il reclaim autenticato.
  assert.equal(slotsOf(room).find((s) => s.seat === 1)?.status, "disconnected", "posto di Bob intatto");
  assert.equal(slotsOf(room).length, 2, "nessuno slot in più");
  disposeOf(room);
});

test("(11b) SEC-11: il legittimo disconnesso rientra col PROPRIO clientId mid-game (reclaim branch 2 preservato)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("HIJK2", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB"); // engine avviato
  room.onDisconnect(b.as());

  // Bob riapre col proprio clientId (token perso): reclaim autenticato → resumed.
  const b2 = new FakeSocket();
  room.join(b2.as(), undefined, "Bob", "cidB");
  assert.equal(b2.roomJoined()?.resumed, true, "reclaim via clientId del legittimo = resumed");
  assert.ok(b2.has("state"), "stato di gioco ripristinato per il legittimo");
  assert.equal(slotsOf(room).find((s) => s.seat === 1)?.status, "connected", "posto riagganciato");
  assert.equal(slotsOf(room).length, 2, "nessuno slot in più");
  disposeOf(room);
});

/* ─────────────────────────── (10) ANTI-LEAK ─────────────────────────── */

test("(10) anti-leak invariato: lo stato di A non contiene mai le carte di B", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("LEAK", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");

  const sa = a.lastState()!;
  const sb = b.lastState()!;
  const jsonA = JSON.stringify(sa);
  for (const c of sb.yourHand) {
    assert.ok(!jsonA.includes(c.id), `leak carta di B nello stato di A: ${c.id}`);
  }
  assert.equal(typeof sa.opponentHandCount, "number", "solo il conteggio della mano avversaria");
  disposeOf(room);
});
