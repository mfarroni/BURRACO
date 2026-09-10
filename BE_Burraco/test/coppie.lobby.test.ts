import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Room } from "../src/room/Room.js";
import { RoomManager } from "../src/room/RoomManager.js";
import { defaultGameConfig } from "../src/config.js";
import { teamOfSeat } from "../src/engine/teams.js";
import type { GameConfig, ServerMessage, Seat } from "../src/contract/types.js";

/**
 * MODALITA' A COPPIE (2v2) — TAPPA 3a: la LOBBY/ROOM capace di 4 posti in coppie.
 *
 * Test DETERMINISTICI a livello Room/RoomManager con socket finti (nessun server,
 * nessun timing di rete). Coprono la parte BACKEND della Tappa 3a:
 *  - apertura tavolo 2v2 (open_table config-driven) + vista d'attesa che lo distingue;
 *  - 4 giocatori si siedono ai posti 0..3, coppie 0+2 / 1+3, AVVIO A TAVOLO PIENO
 *    (non all'ingresso del secondo);
 *  - quick_match 2v2 che fonde SOLO con tavoli 2v2;
 *  - un quick_match 2v2 che NON entra in un tavolo 1v1.
 * Include ganci di NON-REGRESSIONE 1v1 (due sessioni stesso browser possono sedersi;
 * posto disconnesso occupabile al rientro) per accertare che il default resti invariato.
 *
 * Il forfait DI COPPIA è coperto più sotto, aggiunto con la sua unità logica.
 */

class FakeSocket {
  readyState = 1; // OPEN
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
  has(type: string): boolean {
    return this.sent.some((m) => m.type === type);
  }
  find<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
  lastState(): Extract<ServerMessage, { type: "state" }>["state"] | undefined {
    const s = this.sent.filter(
      (m): m is Extract<ServerMessage, { type: "state" }> => m.type === "state",
    );
    return s[s.length - 1]?.state;
  }
}

interface SlotView {
  seat: Seat;
  status: string;
  clientId?: string;
  userId: string | null;
}
const slotsOf = (room: Room): SlotView[] => (room as unknown as { players: SlotView[] }).players;
const engineStarted = (room: Room): boolean =>
  (room as unknown as { engine: unknown }).engine !== null;
const disposeOf = (room: Room): void => (room as unknown as { dispose(): void }).dispose();

/** Config 2v2 (coppie a 4 posti), turn timeout lungo per non far scattare l'auto-play. */
const coppie4 = (): GameConfig => ({
  ...defaultGameConfig(),
  numeroGiocatori: 4,
  modalita: "coppie",
  turnTimeoutMs: 100_000,
});

const ORIG = {
  grace: process.env.RECONNECT_GRACE_MS,
  waiting: process.env.WAITING_GRACE_MS,
};
afterEach(() => {
  if (ORIG.grace === undefined) delete process.env.RECONNECT_GRACE_MS;
  else process.env.RECONNECT_GRACE_MS = ORIG.grace;
  if (ORIG.waiting === undefined) delete process.env.WAITING_GRACE_MS;
  else process.env.WAITING_GRACE_MS = ORIG.waiting;
});

/* ─────────────────── APERTURA TAVOLO 2v2 (config-driven) ─────────────────── */

test("2v2: open_table {4, coppie} crea un tavolo a 4 posti e la lista lo distingue", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "CPP1", private: false, displayName: "Alice",
    clientId: "cA", numeroGiocatori: 4, modalita: "coppie",
  });
  const room = mgr.findByCode("CPP1")!;
  assert.equal(room.config.numeroGiocatori, 4, "config-driven: 4 posti");
  assert.equal(room.config.modalita, "coppie");
  assert.equal(room.seatsTotal(), 4);
  assert.equal(room.isFull(), false, "un solo posto occupato: non pieno");

  const row = mgr.listPublicWaitingTables().find((t) => t.code === "CPP1")!;
  assert.equal(row.seatsTotal, 4, "la lista mostra 4 posti totali");
  assert.equal(row.seatsTaken, 1);
  assert.equal(row.modalita, "coppie", "la lista distingue il tavolo 2v2");
});

test("2v2: la vista d'attesa 1v1 resta senza campo modalita (whitelist a 5 chiavi)", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "IND1", private: false, displayName: "Alice", clientId: "cA",
  });
  const row = mgr.listPublicWaitingTables().find((t) => t.code === "IND1")!;
  assert.deepEqual(
    Object.keys(row).sort(),
    ["code", "creatorName", "openedAt", "seatsTaken", "seatsTotal"],
    "1v1 invariato: nessun campo modalita esposto",
  );
});

test("2v2: combinazioni non ammesse sono normalizzate a 1v1 (config-driven, sicuro)", () => {
  const mgr = new RoomManager();
  // {4, individuale} e {2, coppie} sono fuori scope → normalizzate a {2, individuale}.
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "BAD1", private: false, displayName: "A", clientId: "cA",
    numeroGiocatori: 4, modalita: "individuale",
  });
  const b = new FakeSocket();
  mgr.handleMessage(b.as(), {
    type: "open_table", code: "BAD2", private: false, displayName: "B", clientId: "cB",
    numeroGiocatori: 2, modalita: "coppie",
  });
  const r1 = mgr.findByCode("BAD1")!;
  const r2 = mgr.findByCode("BAD2")!;
  assert.deepEqual(
    [r1.config.numeroGiocatori, r1.config.modalita], [2, "individuale"],
    "{4, individuale} → 1v1",
  );
  assert.deepEqual(
    [r2.config.numeroGiocatori, r2.config.modalita], [2, "individuale"],
    "{2, coppie} → 1v1",
  );
});

/* ─────────────────── SEDUTA A 4 + AVVIO A TAVOLO PIENO ───────────────────── */

test("2v2: quattro giocatori ai posti 0..3, coppie 0+2 / 1+3, AVVIO A TAVOLO PIENO", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  const c = new FakeSocket();
  const d = new FakeSocket();
  // Il creatore apre un tavolo 2v2; gli altri entrano col codice.
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "TBL4", private: false, displayName: "A",
    clientId: "cA", numeroGiocatori: 4, modalita: "coppie",
  });
  const room = mgr.findByCode("TBL4")!;

  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "TBL4", displayName: "B", clientId: "cB" });
  assert.equal(engineStarted(room), false, "a 2 posti NON parte (non è più l'avvio 1v1)");
  mgr.handleMessage(c.as(), { type: "join_room", roomCode: "TBL4", displayName: "C", clientId: "cC" });
  assert.equal(engineStarted(room), false, "a 3 posti NON parte");
  assert.ok(!a.has("state") && !b.has("state") && !c.has("state"), "nessuno stato prima del pieno");

  mgr.handleMessage(d.as(), { type: "join_room", roomCode: "TBL4", displayName: "D", clientId: "cD" });
  assert.equal(engineStarted(room), true, "a TAVOLO PIENO (4 posti vivi) la partita parte");
  assert.ok(
    a.has("state") && b.has("state") && c.has("state") && d.has("state"),
    "stato iniziale a tutti e quattro",
  );

  // Posti assegnati in ordine d'arrivo 0..3.
  assert.deepEqual(
    slotsOf(room).map((s) => s.seat).sort(),
    [0, 1, 2, 3],
    "posti 0..3 assegnati in ordine d'arrivo",
  );

  // Coppie: 0+2 = squadra 0, 1+3 = squadra 1 (via teamOfSeat, dalla redazione stato).
  const seats = a.lastState()!.seats;
  const teamAt = (seat: Seat) => seats.find((s) => s.seat === seat)!.team;
  assert.equal(teamAt(0), 0);
  assert.equal(teamAt(2), 0, "il compagno del posto 0 è il posto 2 (squadra 0)");
  assert.equal(teamAt(1), 1);
  assert.equal(teamAt(3), 1, "il compagno del posto 1 è il posto 3 (squadra 1)");
  // Coerenza con l'autorità di dominio (teamOfSeat).
  for (const s of [0, 1, 2, 3] as Seat[]) assert.equal(teamAt(s), teamOfSeat(s, room.config));

  // Anti-leak (P3): lo stato del posto 0 non contiene la mano di NESSUN altro posto,
  // compagno (posto 2) incluso — solo i conteggi.
  const jsonA = JSON.stringify(a.lastState());
  for (const other of [b, c, d]) {
    for (const card of other.lastState()!.yourHand) {
      assert.ok(!jsonA.includes(card.id), `nessuna carta del posto altrui nello stato del posto 0: ${card.id}`);
    }
  }
  disposeOf(room);
});

test("2v2: reclaim di un posto disconnesso pre-partita col proprio clientId (SEC preservata)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "RCL4", private: false, displayName: "A",
    clientId: "cA", numeroGiocatori: 4, modalita: "coppie",
  });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "RCL4", displayName: "B", clientId: "cB" });
  const room = mgr.findByCode("RCL4")!;
  assert.equal(slotsOf(room).length, 2);

  // Il posto di B flappa (grazia lunga: non scade) e rientra col proprio clientId.
  mgr.handleClose(b.as());
  const b2 = new FakeSocket();
  mgr.handleMessage(b2.as(), { type: "join_room", roomCode: "RCL4", displayName: "B", clientId: "cB" });
  assert.equal(b2.find("room_joined")?.resumed, true, "reclaim del posto disconnesso");
  assert.equal(slotsOf(room).length, 2, "nessuno slot in più (mai > seatsTotal)");
  assert.equal(slotsOf(room).find((s) => s.seat === 1)?.status, "connected", "posto riagganciato");
  disposeOf(room);
});

/* ─────────────────── QUICK MATCH per FIRMA (2v2 vs 1v1) ──────────────────── */

test("2v2: quick_match {4, coppie} NON si siede su un tavolo 1v1 in attesa", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "quick_match", displayName: "A", clientId: "cA" }); // 1v1 waiting
  assert.equal(mgr.activeRoomCount(), 1);

  const b = new FakeSocket();
  mgr.handleMessage(b.as(), {
    type: "quick_match", displayName: "B", clientId: "cB", numeroGiocatori: 4, modalita: "coppie",
  });
  // b deve creare un NUOVO tavolo 2v2, non riempire il tavolo 1v1 di a.
  assert.equal(mgr.activeRoomCount(), 2, "firme diverse → due tavoli distinti");
  assert.ok(!a.has("state"), "il tavolo 1v1 non è stato avviato da un giocatore 2v2");
  const rB = mgr.findByCode(b.find("room_joined")!.code)!;
  assert.equal(rB.config.numeroGiocatori, 4, "b siede su un tavolo 2v2");
  assert.equal(rB.config.modalita, "coppie");
});

test("2v2: due quick_match {4, coppie} siedono sullo STESSO tavolo (firma condivisa)", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "quick_match", displayName: "A", clientId: "cA", numeroGiocatori: 4, modalita: "coppie",
  });
  mgr.handleMessage(b.as(), {
    type: "quick_match", displayName: "B", clientId: "cB", numeroGiocatori: 4, modalita: "coppie",
  });
  assert.equal(mgr.activeRoomCount(), 1, "un solo tavolo 2v2 (b siede da a)");
  const room = mgr.findByCode(a.find("room_joined")!.code)!;
  assert.equal(slotsOf(room).length, 2, "due dei quattro posti occupati");
  assert.equal(engineStarted(room), false, "a 2/4 NON parte: attende il tavolo pieno");
});

test("2v2: la fusione quick_match tocca SOLO tavoli della stessa firma (2v2 non fonde con 1v1)", () => {
  const mgr = new RoomManager();
  const make = (mgr as unknown as {
    makeRoom(code: string, cfg: GameConfig, opts: object): Room;
  }).makeRoom.bind(mgr);
  // Due tavoli 2v2 quick_match in attesa (scenario di corsa) + un 1v1 quick_match.
  const r1 = make("Q4OLD", coppie4(), { visibility: "pubblico", origin: "quick_match" });
  const r2 = make("Q4NEW", coppie4(), { visibility: "pubblico", origin: "quick_match" });
  const rIND = make("Q2IND", defaultGameConfig(), { visibility: "pubblico", origin: "quick_match" });
  const p1 = new FakeSocket();
  const p2 = new FakeSocket();
  const p3 = new FakeSocket();
  r1.join(p1.as(), undefined, "P1", "c1");
  r2.join(p2.as(), undefined, "P2", "c2");
  rIND.join(p3.as(), undefined, "P3", "c3");
  assert.equal(mgr.listPublicWaitingTables().length, 3, "tre tavoli in attesa");

  mgr.mergeQuickMatchTables();

  // I due 2v2 si fondono nel più vecchio (Q4OLD); il 1v1 resta intoccato.
  const merged = p2.find("room_merged");
  assert.ok(merged, "il posto del 2v2 più recente riceve room_merged");
  assert.equal(merged!.newCode, "Q4OLD", "fuso nel tavolo 2v2 più vecchio");
  assert.equal(r2.isDisposed(), true, "il 2v2 svuotato è smaltito");
  assert.equal(slotsOf(r1).length, 2, "il target 2v2 ora ha due posti (attende ancora i 4)");
  assert.equal(engineStarted(r1), false, "non parte: 2/4 posti");
  assert.equal(rIND.isDisposed(), false, "il 1v1 non è toccato dalla fusione");
  assert.ok(!p3.has("room_merged"), "il giocatore 1v1 non è stato spostato");
});

/* ─────────────────── NON-REGRESSIONE 1v1 (default invariato) ─────────────── */

test("1v1 (default): open_table SENZA campi modalita resta {2, individuale} e parte a 2", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "open_table", code: "DEF2", private: false, displayName: "A", clientId: "cA" });
  const room = mgr.findByCode("DEF2")!;
  assert.deepEqual([room.config.numeroGiocatori, room.config.modalita], [2, "individuale"]);
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "DEF2", displayName: "B", clientId: "cB" });
  assert.equal(engineStarted(room), true, "1v1 parte all'ingresso del secondo (invariato)");
  assert.ok(a.has("state") && b.has("state"));
  disposeOf(room);
});

test("1v1 (non-regressione): due sessioni dallo STESSO browser possono comunque sedersi (self-play avvisato, non bloccato)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("SELF2", { ...defaultGameConfig(), turnTimeoutMs: 100_000 });
  const a = new FakeSocket();
  const b = new FakeSocket();
  // Stesso clientId (stesso browser), userId diversi: si siedono entrambi.
  room.join(a.as(), undefined, "Io1", "sharedCid", "user-1");
  room.join(b.as(), undefined, "Io2", "sharedCid", "user-2");
  assert.equal(slotsOf(room).length, 2, "entrambe le sessioni sedute");
  assert.equal(engineStarted(room), true, "la partita parte comunque");
  assert.ok(a.has("self_play_notice") && b.has("self_play_notice"), "self-play solo AVVISATO");
  disposeOf(room);
});

/* ─────────────────── FORFAIT DI COPPIA (stallo → perde la COPPIA) ────────── */

/** Siede quattro socket in un tavolo 2v2 e avvia la partita (ritorna la Room). */
function start2v2(code: string): {
  room: Room; a: FakeSocket; b: FakeSocket; c: FakeSocket; d: FakeSocket;
} {
  const room = new Room(code, coppie4());
  const a = new FakeSocket();
  const b = new FakeSocket();
  const c = new FakeSocket();
  const d = new FakeSocket();
  room.join(a.as(), undefined, "A", "cA"); // seat 0 (squadra 0)
  room.join(b.as(), undefined, "B", "cB"); // seat 1 (squadra 1)
  room.join(c.as(), undefined, "C", "cC"); // seat 2 (squadra 0)
  room.join(d.as(), undefined, "D", "cD"); // seat 3 (squadra 1)
  return { room, a, b, c, d };
}

test("forfait di coppia: lo stallo del posto 2 (squadra 0) fa VINCERE la squadra 1 (non il compagno)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const { room, a, b, c, d } = start2v2("FF4A");
  assert.equal(engineStarted(room), true, "partita 2v2 avviata a tavolo pieno");

  // Forfait deterministico del posto 2 (squadra 0). Vincitrice attesa: squadra 1.
  (room as unknown as { forfeitStalledSeat(s: Seat): void }).forfeitStalledSeat(2);

  for (const [name, sock] of [["A", a], ["B", b], ["C", c], ["D", d]] as const) {
    const ge = sock.find("game_ended");
    assert.ok(ge, `game_ended ricevuto dal posto ${name}`);
    assert.equal(ge!.winnerTeam, 1, `vince la squadra AVVERSARIA (1), non il compagno — visto da ${name}`);
    assert.equal(ge!.reason, "forfeit");
    assert.equal(ge!.finalScores.length, 2, "due totali di squadra");
  }
  assert.equal((room as unknown as { isDisposed(): boolean }).isDisposed(), true, "room smaltita dopo il forfait");
});

test("forfait di coppia: lo stallo del posto 1 (squadra 1) fa VINCERE la squadra 0", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const { room, a } = start2v2("FF4B");
  (room as unknown as { forfeitStalledSeat(s: Seat): void }).forfeitStalledSeat(1);
  const ge = a.find("game_ended")!;
  assert.equal(ge.winnerTeam, 0, "perde la squadra 1 dello stallato → vince la squadra 0");
  assert.equal(ge.reason, "forfeit");
});

test("forfait 1v1 (non-regressione): stallo del posto 0 → vince la squadra 1 (invariato)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("FF2", { ...defaultGameConfig(), turnTimeoutMs: 100_000 });
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "A", "cA");
  room.join(b.as(), undefined, "B", "cB");
  (room as unknown as { forfeitStalledSeat(s: Seat): void }).forfeitStalledSeat(0);
  const ge = a.find("game_ended")!;
  assert.equal(ge.winnerTeam, 1, "1v1: team = seat → vince il posto 1, valore identico a prima");
  assert.equal(ge.reason, "forfeit");
});
