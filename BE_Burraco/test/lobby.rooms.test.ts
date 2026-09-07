import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Room } from "../src/room/Room.js";
import { RoomManager } from "../src/room/RoomManager.js";
import { defaultGameConfig } from "../src/config.js";
import { persistence } from "../src/db/persistence.js";
import type { ServerMessage, Seat } from "../src/contract/types.js";

/**
 * LOBBY — apertura tavoli, attesa visibile, anti-stallo. Test DETERMINISTICI a
 * livello Room/RoomManager con socket finti (nessun server, nessun timing di
 * rete). Copre i casi F/S della spec esprimibili qui: lista pubblica, fusione
 * quick_match, ROOM_JUST_TAKEN, grace 60/180, presenza lobby, self-play
 * userId=null, leaveWaiting, whitelist della lista, generazione codice.
 *
 * Nota: senza AuthService/gating il percorso è SINCRONO (nessun await interposto),
 * quindi handleMessage crea/siede nello stesso tick — l'atomicità è osservabile.
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
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SlotView {
  seat: Seat;
  status: string;
  clientId?: string;
  userId: string | null;
}
const slotsOf = (room: Room): SlotView[] => (room as unknown as { players: SlotView[] }).players;
const engineStarted = (room: Room): boolean =>
  (room as unknown as { engine: unknown }).engine !== null;

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

/* ─────────────────────────── LISTA PUBBLICA (F2/F6/F8/S1) ────────────────── */

test("F2: open_table PUBBLICO compare nella lista con la whitelist corretta", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "PUBA", private: false, displayName: "Alice", clientId: "cidA",
  });
  assert.ok(a.find("room_joined"), "creatore seduto (room_joined)");
  const list = mgr.listPublicWaitingTables();
  assert.equal(list.length, 1, "un tavolo pubblico in lista");
  const row = list[0]!;
  assert.equal(row.code, "PUBA");
  assert.equal(row.creatorName, "Alice");
  assert.equal(row.seatsTaken, 1);
  assert.equal(row.seatsTotal, 2);
  assert.equal(typeof row.openedAt, "number");
});

test("S1: la lista NON espone campi interni (userId/clientId/origin/visibility)", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "SECU", private: false, displayName: "Alice", clientId: "cidSEG",
  });
  const row = mgr.listPublicWaitingTables()[0]!;
  assert.deepEqual(
    Object.keys(row).sort(),
    ["code", "creatorName", "openedAt", "seatsTaken", "seatsTotal"],
    "solo la whitelist",
  );
  const json = JSON.stringify(row);
  assert.ok(!json.includes("cidSEG"), "nessun clientId");
  assert.ok(!json.toLowerCase().includes("origin"), "nessun origin");
  assert.ok(!json.toLowerCase().includes("visib"), "nessuna visibility");
});

test("F6/F8: tavolo PRIVATO mai in lista ma raggiungibile col codice", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "PRIV", private: true, displayName: "Alice", clientId: "cidA",
  });
  assert.equal(mgr.listPublicWaitingTables().length, 0, "privato non listato");
  // Raggiungibile solo digitando il codice (join_room).
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "PRIV", displayName: "Bob", clientId: "cidB" });
  assert.ok(a.has("state") && b.has("state"), "partita avviata via codice");
});

/* ─────────────────────────── QUICK MATCH (F3/F4) ─────────────────────────── */

test("F4: due quick_match → UN solo tavolo, due giocatori, nessuno appeso", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "quick_match", displayName: "Alice", clientId: "cidA" });
  assert.equal(mgr.listPublicWaitingTables().length, 1, "primo quick_match in attesa");
  mgr.handleMessage(b.as(), { type: "quick_match", displayName: "Bob", clientId: "cidB" });
  assert.equal(mgr.activeRoomCount(), 1, "un solo tavolo");
  assert.ok(a.has("state") && b.has("state"), "partita avviata per entrambi");
  assert.equal(mgr.listPublicWaitingTables().length, 0, "tavolo pieno → sparito dalla lista");
});

test("idempotenza: quick_match ripetuto dalla stessa sessione non crea un 2° tavolo", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "quick_match", displayName: "Alice", clientId: "cidA" });
  assert.equal(mgr.activeRoomCount(), 1);
  // Stessa sessione (stesso clientId), nuovo socket: nessun secondo tavolo.
  const a2 = new FakeSocket();
  mgr.handleMessage(a2.as(), { type: "quick_match", displayName: "Alice", clientId: "cidA" });
  assert.equal(mgr.activeRoomCount(), 1, "mai un secondo tavolo per la stessa sessione");
});

/* ─────────────────────────── FUSIONE (F5/F7) ─────────────────────────────── */

test("F5: fusione di due tavoli quick_match → lo spostato riceve room_merged e la partita parte", () => {
  const mgr = new RoomManager();
  // Costruzione diretta di DUE tavoli quick_match in attesa (scenario di corsa che
  // la difesa primaria di norma previene): la fusione è la rete di sicurezza.
  const make = (mgr as unknown as {
    makeRoom(code: string, cfg: ReturnType<typeof defaultGameConfig>, opts: object): Room;
  }).makeRoom.bind(mgr);
  const r1 = make("QMOLD", defaultGameConfig(), { visibility: "pubblico", origin: "quick_match" });
  const r2 = make("QMNEW", defaultGameConfig(), { visibility: "pubblico", origin: "quick_match" });
  const a = new FakeSocket();
  const b = new FakeSocket();
  r1.join(a.as(), undefined, "Alice", "cidA");
  r2.join(b.as(), undefined, "Bob", "cidB");
  assert.equal(mgr.listPublicWaitingTables().length, 2, "due tavoli in attesa");

  mgr.mergeQuickMatchTables();

  const merged = b.find("room_merged");
  assert.ok(merged, "lo spostato riceve room_merged");
  assert.equal(merged!.newCode, "QMOLD", "spostato nel tavolo più vecchio");
  assert.ok(engineStarted(r1), "il tavolo di destinazione avvia la partita");
  assert.ok(a.has("state") && b.has("state"), "stato a entrambi");
  assert.equal(r2.isDisposed(), true, "il tavolo svuotato è smaltito");
  assert.equal(mgr.listPublicWaitingTables().length, 0, "nessun tavolo appeso");
});

test("F7: la fusione NON tocca tavoli apertura_manuale né privati", () => {
  const mgr = new RoomManager();
  const make = (mgr as unknown as {
    makeRoom(code: string, cfg: ReturnType<typeof defaultGameConfig>, opts: object): Room;
  }).makeRoom.bind(mgr);
  const manual = make("MANU", defaultGameConfig(), { visibility: "pubblico", origin: "apertura_manuale" });
  const qm = make("QMX", defaultGameConfig(), { visibility: "pubblico", origin: "quick_match" });
  const a = new FakeSocket();
  const b = new FakeSocket();
  manual.join(a.as(), undefined, "Alice", "cidA");
  qm.join(b.as(), undefined, "Bob", "cidB");

  mgr.mergeQuickMatchTables();

  assert.ok(!a.has("room_merged") && !b.has("room_merged"), "nessuna fusione fra tipi diversi");
  assert.ok(!engineStarted(manual) && !engineStarted(qm), "entrambi restano in attesa");
});

/* ─────────────────────────── OPEN_TABLE codice in uso (F9/S6) ────────────── */

test("F9: open_table con codice già in uso → open_rejected{CODE_IN_USE}, nessun takeover", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "DUPL", private: false, displayName: "Alice", clientId: "cidA",
  });
  mgr.handleMessage(b.as(), {
    type: "open_table", code: "DUPL", private: false, displayName: "Bob", clientId: "cidB",
  });
  const rej = b.find("open_rejected");
  assert.ok(rej, "codice occupato → open_rejected");
  assert.equal(rej!.code, "CODE_IN_USE");
  assert.ok(!b.has("room_joined"), "nessun takeover del tavolo altrui");
  // Il creatore originale resta l'unico occupante.
  const room = mgr.findByCode("DUPL")!;
  assert.equal(slotsOf(room).length, 1, "un solo posto occupato");
});

/* ─────────────────────────── ROOM_JUST_TAKEN (F12/S2) ────────────────────── */

test("F12/S2: terzo che si siede su un tavolo pieno (2 posti vivi) → ROOM_JUST_TAKEN", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  const c = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "SEAT", private: false, displayName: "Alice", clientId: "cidA",
  });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "SEAT", displayName: "Bob", clientId: "cidB" });
  assert.ok(a.has("state") && b.has("state"), "partita partita fra i primi due");
  // Il terzo si siede troppo tardi.
  mgr.handleMessage(c.as(), { type: "join_room", roomCode: "SEAT", displayName: "Carol", clientId: "cidC" });
  const rej = c.find("join_rejected");
  assert.ok(rej, "terzo respinto con esito tipizzato");
  assert.equal(rej!.code, "ROOM_JUST_TAKEN");
  assert.ok(!c.has("room_joined") && !c.has("state"), "nessun accesso/leak al terzo");
});

/* ─────────────────────────── GRACE 60/180 (F10/F11) ──────────────────────── */

test("grace: un tavolo in ATTESA usa WAITING_GRACE_MS (breve) e sparisce alla scadenza", async () => {
  process.env.WAITING_GRACE_MS = "40";
  process.env.RECONNECT_GRACE_MS = "100000"; // se venisse usato questo, il test fallirebbe
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "WAIT", private: false, displayName: "Alice", clientId: "cidA",
  });
  assert.equal(mgr.activeRoomCount(), 1);
  mgr.handleClose(a.as()); // creatore chiude la scheda (grace waiting)
  await delay(80); // > 40ms
  assert.equal(mgr.activeRoomCount(), 0, "tavolo in attesa smaltito dopo la grace breve");
  assert.equal(mgr.listPublicWaitingTables().length, 0, "sparito dalla lista");
});

test("grace: in PARTITA usa RECONNECT_GRACE_MS (invariato), non la grace di attesa", async () => {
  process.env.WAITING_GRACE_MS = "100000"; // se venisse usato questo, il test fallirebbe
  process.env.RECONNECT_GRACE_MS = "40";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  const b = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "PLAY", displayName: "Alice", clientId: "cidA" });
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "PLAY", displayName: "Bob", clientId: "cidB" });
  assert.ok(engineStarted(mgr.findByCode("PLAY")!), "partita avviata");
  mgr.handleClose(a.as());
  await delay(80); // > 40ms
  assert.ok(b.has("room_closed"), "abbandono dopo la grace di partita");
  assert.equal(mgr.activeRoomCount(), 0, "room smaltita");
});

test("F11: rientro ENTRO la grace di attesa → il tavolo sopravvive", () => {
  process.env.WAITING_GRACE_MS = "100000";
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "REJN", private: false, displayName: "Alice", clientId: "cidA",
  });
  mgr.handleClose(a.as());
  // Rientro col clientId (token perso): reclaim del posto in attesa.
  const a2 = new FakeSocket();
  mgr.handleMessage(a2.as(), { type: "join_room", roomCode: "REJN", displayName: "Alice", clientId: "cidA" });
  assert.equal(a2.find("room_joined")?.resumed, true, "reclaim del proprio posto in attesa");
  assert.equal(mgr.activeRoomCount(), 1, "tavolo ancora presente");
});

/* ─────────────────────────── PRESENZA LOBBY (F14) ────────────────────────── */

test("F14: il contatore conta chi è in lobby, escludendo chi ha già un tavolo in attesa", () => {
  const mgr = new RoomManager();
  mgr.touchLobby("u1");
  mgr.touchLobby("u2");
  assert.equal(mgr.lobbyPlayerCount(), 2, "due sessioni in lobby");
  // u1 apre un tavolo (clientId = chiave sessione in assenza di auth): esce dal conteggio.
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "LOBT", private: false, displayName: "U1", clientId: "u1",
  });
  assert.equal(mgr.lobbyPlayerCount(), 1, "chi attende non è contato");
});

/* ─────────────────────────── SELF-PLAY (F17 + userId=null) ───────────────── */

test("F17: self-play (stesso clientId) → self_play_notice e persistenza con userId=null", () => {
  const mgr = new RoomManager();
  const make = (mgr as unknown as {
    makeRoom(code: string, cfg: ReturnType<typeof defaultGameConfig>, opts: object): Room;
  }).makeRoom.bind(mgr);
  const room = make("SELF", defaultGameConfig(), { visibility: "pubblico", origin: "quick_match" });
  const a = new FakeSocket();
  const b = new FakeSocket();

  // Cattura gli argomenti passati alla persistenza (che altrimenti è no-op senza DB).
  let captured: { userId: string | null }[] | null = null;
  const original = persistence.addPlayers;
  (persistence as { addPlayers: unknown }).addPlayers = async (
    _matchId: string,
    players: { userId: string | null }[],
  ) => {
    captured = players;
  };
  try {
    // userId DIVERSI (user-1/user-2) ma STESSO clientId → self-play riconosciuto.
    room.join(a.as(), undefined, "Io1", "sharedCid", "user-1");
    room.join(b.as(), undefined, "Io2", "sharedCid", "user-2");
  } finally {
    (persistence as { addPlayers: unknown }).addPlayers = original;
  }

  assert.ok(a.has("self_play_notice") && b.has("self_play_notice"), "avviso a entrambi");
  assert.ok(captured, "addPlayers chiamata");
  assert.ok(
    captured!.every((p) => p.userId === null),
    "self-play escluso dalle statistiche: userId=null su entrambi i posti",
  );
});

/* ─────────────────────────── LEAVE WAITING (F13/F18) ─────────────────────── */

test("F18: leaveWaiting → dispose immediato, prima della grace", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "LEAV", private: false, displayName: "Alice", clientId: "cidA",
  });
  assert.equal(mgr.listPublicWaitingTables().length, 1);
  mgr.leaveWaiting("cidA"); // chiave sessione = clientId (no auth)
  assert.equal(mgr.activeRoomCount(), 0, "tavolo smaltito subito");
  assert.equal(mgr.listPublicWaitingTables().length, 0, "sparito dalla lista");
});

/* ─────────────────────────── CODICE (formato) ────────────────────────────── */

test("generateFreeCode: 5 caratteri dall'alfabeto senza ambiguità (no I,L,O,0,1)", () => {
  const mgr = new RoomManager();
  for (let i = 0; i < 200; i++) {
    const code = mgr.generateFreeCode();
    assert.equal(code.length, 5, "cinque caratteri");
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/, "solo simboli ammessi");
  }
});
