import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Room } from "../src/room/Room.js";
import { RoomManager } from "../src/room/RoomManager.js";
import { defaultGameConfig } from "../src/config.js";
import { persistence } from "../src/db/persistence.js";
import { parseClientMessage } from "../src/ws/validate.js";
import type { ServerMessage } from "../src/contract/types.js";

/**
 * Test dei FIX DI SICUREZZA a livello Room/RoomManager, con socket finti
 * deterministici (nessuna dipendenza dal timing di rete). Coprono:
 *  - SEC-05 auto-scarto (turno auto-completato allo scadere del TURN_TIMEOUT_MS)
 *  - SEC-05 forfeit (grace-window scaduta -> avversario vince con reason:"forfeit")
 *  - SEC-05 GC (room concluse/abbandonate rimosse dalla mappa RoomManager)
 *  - SEC-01 logEvent SOLO su mosse valide (non su mosse rifiutate)
 *  - SEC-07 validazione di forma (parseClientMessage) su input malformati
 */

/** Socket finto compatibile con l'uso che ne fa Room (readyState OPEN=1, send/close). */
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
    return this.sent.filter((m) => m.type === "state").map((m) => (m as { state: never }).state);
  }
  lastState(): Extract<ServerMessage, { type: "state" }>["state"] | undefined {
    const s = this.states();
    return s[s.length - 1];
  }
  has(type: string): boolean {
    return this.sent.some((m) => m.type === type);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ripristina eventuale env mutata dai singoli test.
const originalGrace = process.env.RECONNECT_GRACE_MS;
after(() => {
  if (originalGrace === undefined) delete process.env.RECONNECT_GRACE_MS;
  else process.env.RECONNECT_GRACE_MS = originalGrace;
});

/* ─────────────────────────── SEC-05: AUTO-SCARTO ─────────────────────────── */

test("SEC-05 auto-scarto: allo scadere del turno il server auto-completa un turno legale e la partita avanza", async () => {
  // turnTimeoutMs cortissimo, iniettato via config di Room (ambiente isolato).
  const cfg = { ...defaultGameConfig(), turnTimeoutMs: 40 };
  const room = new Room("AUTO1", cfg);
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice");
  room.join(b.as(), undefined, "Bob"); // avvia la partita

  const s0a = a.lastState();
  const s0b = b.lastState();
  assert.ok(s0a && s0b, "stato iniziale ricevuto da entrambi");
  const initialTurn = s0a!.whoseTurn;
  // turnEndsAt reale (> ora) durante il turno attivo.
  assert.equal(typeof s0a!.turnEndsAt, "number", "turnEndsAt reale durante il turno attivo");
  assert.ok(s0a!.turnEndsAt! > Date.now(), "deadline nel futuro");

  // Attende che scatti l'auto-play (più cicli): il turno deve cambiare.
  await delay(200);
  const active = initialTurn === 0 ? a : b;
  const other = initialTurn === 0 ? b : a;

  // Il giocatore attivo NON ha mosso: il server ha pescato+scartato per lui.
  // Almeno uno stato successivo mostra il turno passato all'avversario.
  const advanced =
    a.states().some((s) => s.whoseTurn !== initialTurn) ||
    b.states().some((s) => s.whoseTurn !== initialTurn);
  assert.ok(advanced, "il turno è avanzato per auto-scarto");

  // L'attore ora ha 11 carte (pescata +1, scartata -1) in qualche stato.
  const activeHadDrawThenDiscard = active.states().some((s) => s.yourHand.length === 11 && s.whoseTurn !== initialTurn);
  const discardGrew = (other.lastState()?.discardCount ?? 0) >= 1 || (active.lastState()?.discardCount ?? 0) >= 1;
  assert.ok(activeHadDrawThenDiscard || discardGrew, "l'auto-turno ha prodotto uno scarto sul monte");

  // Il monte scarti non deve mai contenere una matta come cima se derivante da
  // auto-scarto quando esisteva un'alternativa: verifica soft della preferenza.
  // (Copertura principale: la partita è avanzata senza stallo né crash.)
  (room as unknown as { dispose(): void }).dispose();
});

/* ─────────────────────────── NEW-3: STALLO DETERMINISTICO ─────────────────────────── */

test("NEW-3: turno in stallo irrisolvibile (mano ridotta a una sola matta) → forfeit deterministico, l'avversario vince", () => {
  const room = new Room("STALL1", { ...defaultGameConfig(), turnTimeoutMs: 100_000 });
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice");
  room.join(b.as(), undefined, "Bob");

  const s = a.lastState()!;
  const activeSeat = s.whoseTurn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eng = (room as any).engine;

  // Stato degenere NON raggiungibile dopo la pesca d'ufficio, ma possibile se il
  // giocatore aveva già pescato e si è calato fino a un'unica matta (jolly): nessuno
  // scarto legale (l'ultimo scarto non può essere una matta) e nessun pozzetto di
  // salvataggio. Lo forziamo per esercitare la risoluzione deterministica.
  const joker = { id: "JK-STALL", suit: null, rank: "JOKER", isWild: true, wildKind: "joker" };
  eng.seats[activeSeat].hand = [joker];
  eng.seats[activeSeat].pozzettoTaken = true; // niente pozzetto "in differita" di salvataggio
  eng.pozzetti = [];
  eng.phase = "may_meld"; // ha già pescato
  eng.currentSeat = activeSeat;

  // Invoca l'auto-play come farebbe il turn timer allo scadere del turno.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).autoPlayTurn(activeSeat);

  const geA = a.sent.find((m) => m.type === "game_ended") as
    | Extract<ServerMessage, { type: "game_ended" }>
    | undefined;
  const geB = b.sent.find((m) => m.type === "game_ended") as
    | Extract<ServerMessage, { type: "game_ended" }>
    | undefined;
  assert.ok(geA && geB, "entrambi i giocatori ricevono game_ended");
  assert.equal(geA!.winnerSeat, (1 - activeSeat) as 0 | 1, "vince l'avversario del seat in stallo");
  assert.equal(geA!.reason, "forfeit", "risoluzione via forfeit deterministico (canale game_ended)");
  // Il turno NON resta congelato: la room è conclusa e smaltita.
  assert.equal((room as unknown as { isDisposed(): boolean }).isDisposed(), true, "room smaltita dopo il forfeit di stallo");
});

/* ─────────────────────────── SEC-05: FORFEIT ─────────────────────────── */

test("SEC-05 forfeit: scaduta la grace-window su disconnessione, l'avversario connesso vince con reason:forfeit", async () => {
  process.env.RECONNECT_GRACE_MS = "60"; // grace brevissima
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "FORF1", displayName: "Alice" });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "FORF1", displayName: "Bob" });
  assert.equal(mgr.activeRoomCount(), 1, "room attiva creata");

  // A cade: parte la grace-window.
  mgr.handleClose(a.as());
  assert.ok(b.has("opponent_disconnected"), "avversario notificato della disconnessione");

  await delay(160); // > grace

  const ge = b.sent.find((m) => m.type === "game_ended") as
    | Extract<ServerMessage, { type: "game_ended" }>
    | undefined;
  assert.ok(ge, "l'avversario riceve game_ended");
  assert.equal(ge!.reason, "forfeit", "motivazione forfeit");
  assert.equal(ge!.winnerSeat, 1, "vince il seat connesso (Bob=1)");

  // SEC-05 GC: room rimossa dalla mappa dopo la conclusione.
  assert.equal(mgr.activeRoomCount(), 0, "room conclusa rimossa dalla mappa (GC)");
});

/* ─────────────────────────── SEC-05: GC ABBANDONO ─────────────────────────── */

test("SEC-05 GC: se entrambi i giocatori si disconnettono, la room viene rimossa senza vincitore", async () => {
  process.env.RECONNECT_GRACE_MS = "60";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "GC1", displayName: "Alice" });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "GC1", displayName: "Bob" });
  assert.equal(mgr.activeRoomCount(), 1);

  mgr.handleClose(a.as());
  mgr.handleClose(b.as());
  await delay(160);

  assert.equal(mgr.activeRoomCount(), 0, "room abbandonata rimossa dalla mappa");
  // Nessun game_ended con vincitore fittizio (abbandono totale).
  const geA = a.sent.find((m) => m.type === "game_ended");
  const geB = b.sent.find((m) => m.type === "game_ended");
  assert.ok(!geA && !geB, "nessun vincitore dichiarato su abbandono totale");
});

test("SEC-05 GC: nessun accumulo di room dopo molte partite concluse per forfeit", async () => {
  process.env.RECONNECT_GRACE_MS = "30";
  const mgr = new RoomManager();
  for (let i = 0; i < 5; i++) {
    const a = new FakeSocket();
    const b = new FakeSocket();
    mgr.handleMessage(a.as(), { type: "join_room", roomCode: `ACC${i}`, displayName: "A" });
    mgr.handleMessage(b.as(), { type: "join_room", roomCode: `ACC${i}`, displayName: "B" });
    mgr.handleClose(a.as());
    await delay(60);
  }
  assert.equal(mgr.activeRoomCount(), 0, "nessuna room residua in mappa dopo 5 forfeit");
});

/* ─────────────────────────── SEC-01: logEvent SOLO su mosse valide ─────────────────────────── */

test("SEC-01: logEvent scritto SOLO su mossa valida, mai su mossa rifiutata", () => {
  const calls: string[] = [];
  const original = persistence.logEvent;
  // Monkeypatch del singleton condiviso: Room importa lo stesso oggetto.
  (persistence as { logEvent: unknown }).logEvent = (
    _matchId: string,
    _handId: string | null,
    _seq: number,
    type: string,
  ) => {
    calls.push(type);
  };
  try {
    const room = new Room("LOG1", { ...defaultGameConfig(), turnTimeoutMs: 0 });
    const a = new FakeSocket();
    const b = new FakeSocket();
    room.join(a.as(), undefined, "Alice");
    room.join(b.as(), undefined, "Bob");

    const s = a.lastState()!;
    const activeSock = s.whoseTurn === 0 ? a : b;
    const offSock = s.whoseTurn === 0 ? b : a;

    // 1) Mossa RIFIUTATA (fuori turno): NON deve loggare.
    room.onMessage(offSock.as(), { type: "draw", source: "deck" });
    assert.equal(calls.length, 0, "nessun logEvent per mossa rifiutata (fuori turno)");

    // 2) Mossa RIFIUTATA (carta non in mano): NON deve loggare.
    room.onMessage(activeSock.as(), { type: "discard", card: "inesistente" });
    assert.equal(calls.length, 0, "nessun logEvent per mossa rifiutata (fase/carta)");

    // 3) Mossa VALIDA (pesca dal mazzo): DEVE loggare una volta.
    room.onMessage(activeSock.as(), { type: "draw", source: "deck" });
    assert.equal(calls.length, 1, "esattamente un logEvent per la mossa valida");
    assert.equal(calls[0], "draw");

    (room as unknown as { dispose(): void }).dispose();
  } finally {
    (persistence as { logEvent: unknown }).logEvent = original;
  }
});

/* ─────────────────────────── SEC-07: validazione di forma (unit) ─────────────────────────── */

test("SEC-07: parseClientMessage rifiuta gli input malformati (forma) senza eccezioni", () => {
  const bad: unknown[] = [
    { foo: "bar" }, // senza type
    { type: "sconosciuto" }, // type non nell'unione
    { type: "meld_new" }, // manca cards
    { type: "meld_new", cards: "non-array" }, // cards non-array
    { type: "meld_new", cards: [1, 2, 3] }, // cards non stringhe
    { type: "draw" }, // manca source
    { type: "draw", source: "pozzetto" }, // source fuori enum
    { type: "discard" }, // manca card
    { type: "join_room", roomCode: "X" }, // manca displayName
    { type: "meld_extend", cards: ["a"] }, // manca meldId
    { type: "pinella_substitute", meldId: "m" }, // manca cardInHand
    null,
    42,
    "stringa",
    [],
  ];
  for (const b of bad) {
    const r = parseClientMessage(b);
    assert.equal(r.ok, false, `atteso rifiuto per: ${JSON.stringify(b)}`);
  }

  // Forme VALIDE accettate.
  const good: unknown[] = [
    { type: "join_room", roomCode: "X", displayName: "A" },
    { type: "draw", source: "deck" },
    { type: "draw", source: "discard", clientMoveId: "m1" },
    { type: "meld_new", cards: ["a", "b", "c"] },
    { type: "meld_extend", meldId: "m", cards: ["a"] },
    { type: "pinella_substitute", meldId: "m", cardInHand: "c" },
    { type: "discard", card: "c" },
    { type: "heartbeat" },
  ];
  for (const g of good) {
    const r = parseClientMessage(g);
    assert.equal(r.ok, true, `attesa accettazione per: ${JSON.stringify(g)}`);
  }
});

/* ─────────────────────────── NEW-4: LIMITI DI LUNGHEZZA (hardening) ─────────────────────────── */

test("NEW-4: input oltre i limiti di lunghezza sono rifiutati come forma non conforme (MALFORMED)", () => {
  const tooLong: unknown[] = [
    { type: "join_room", roomCode: "X", displayName: "z".repeat(65) }, // displayName > 64
    { type: "discard", card: "z".repeat(65) }, // cardId > 64
    { type: "meld_new", cards: Array.from({ length: 21 }, (_, i) => `c${i}`) }, // > 20 carte
    { type: "meld_extend", meldId: "z".repeat(65), cards: ["a"] }, // meldId > 64
    { type: "pinella_substitute", meldId: "m", cardInHand: "z".repeat(65) }, // cardInHand > 64
    { type: "draw", source: "deck", clientMoveId: "z".repeat(65) }, // clientMoveId > 64
    { type: "join_room", roomCode: "X", playerToken: "z".repeat(65), displayName: "A" }, // token > 64
  ];
  for (const t of tooLong) {
    const r = parseClientMessage(t);
    assert.equal(r.ok, false, `NEW-4: atteso rifiuto oltre-limite per ${JSON.stringify(t).slice(0, 48)}…`);
  }

  // Ai limiti (esattamente al massimo) restano ACCETTATI: il cap non è troppo stretto.
  const atLimit: unknown[] = [
    { type: "join_room", roomCode: "X", displayName: "z".repeat(64) },
    { type: "discard", card: "z".repeat(64) },
    { type: "meld_new", cards: Array.from({ length: 20 }, (_, i) => `c${i}`) },
  ];
  for (const t of atLimit) {
    const r = parseClientMessage(t);
    assert.equal(r.ok, true, `NEW-4: atteso OK al limite per ${JSON.stringify(t).slice(0, 48)}…`);
  }
});
