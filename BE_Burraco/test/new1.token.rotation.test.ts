import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Room } from "../src/room/Room.js";
import { defaultGameConfig } from "../src/config.js";
import type { ServerMessage, Seat } from "../src/contract/types.js";

/**
 * NEW-1 (rotazione token alla riconnessione, no lockout da race) verificato in
 * modo DETERMINISTICO a livello Room, con socket finti e ispezione dello stato
 * interno degli slot. Copre i due modi di "commit" del token precedente
 * (heartbeat NON qui — è coperto dall'integrazione; qui: AZIONE DI GIOCO valida)
 * e il ramo di SCADENZA TTL senza commit. Preserva SEC-04 (nessun takeover del
 * legittimo connesso con token corrente NÉ precedente entro TTL) e SEC-10 (il
 * vecchio token non resta rigiocabile a lungo).
 */

/** Socket finto: readyState OPEN, cattura messaggi inviati e chiusura. */
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
  has(type: string): boolean {
    return this.sent.some((m) => m.type === type);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SlotView {
  seat: Seat;
  token: string;
  prevToken: string | null;
  prevTokenExpiry: number | null;
  status: string;
}
const slotsOf = (room: Room): SlotView[] =>
  (room as unknown as { players: SlotView[] }).players;
const tokenOf = (s: FakeSocket): string => s.roomJoined()!.yourToken;

// Ambiente mutabile ripristinato dopo ogni test time-sensitive.
const ORIG = {
  ttl: process.env.TOKEN_ROTATION_TTL_MS,
  grace: process.env.RECONNECT_GRACE_MS,
};
afterEach(() => {
  if (ORIG.ttl === undefined) delete process.env.TOKEN_ROTATION_TTL_MS;
  else process.env.TOKEN_ROTATION_TTL_MS = ORIG.ttl;
  if (ORIG.grace === undefined) delete process.env.RECONNECT_GRACE_MS;
  else process.env.RECONNECT_GRACE_MS = ORIG.grace;
});

/** Crea una room 1v1 avviata; ritorna room, socket, seat attivo e relativi token. */
function startedRoom(code: string) {
  process.env.RECONNECT_GRACE_MS = "100000"; // grace lunga: nessun forfeit nei test
  const room = new Room(code, { ...defaultGameConfig(), turnTimeoutMs: 100_000 });
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice"); // seat 0
  room.join(b.as(), undefined, "Bob"); // seat 1 → avvia la partita
  const s = a.lastState()!;
  const activeSeat = s.whoseTurn as Seat;
  const activeSock = activeSeat === 0 ? a : b;
  return { room, a, b, activeSeat, activeSock, tokenA: tokenOf(a), tokenB: tokenOf(b) };
}

/* ─── NEW-1 (a): commit del prevToken tramite AZIONE DI GIOCO valida ─── */

test("NEW-1: una AZIONE DI GIOCO valida sul nuovo socket 'committa' il token → il precedente non è più accettato", () => {
  const { room, activeSeat, activeSock } = startedRoom("CMTACT");
  const oldToken = tokenOf(activeSock);

  // Disconnessione + riconnessione legittima con il vecchio token → rotazione.
  room.onDisconnect(activeSock.as());
  const a2 = new FakeSocket();
  room.join(a2.as(), oldToken, "Alice");
  const slot = slotsOf(room).find((p) => p.seat === activeSeat)!;
  assert.equal(slot.prevToken, oldToken, "prevToken = vecchio token appena presentato");
  assert.ok(slot.prevTokenExpiry && slot.prevTokenExpiry > Date.now(), "prevToken entro TTL");
  const newToken = a2.roomJoined()!.yourToken;
  assert.notEqual(newToken, oldToken, "token ruotato");

  // AZIONE DI GIOCO valida: è il turno del seat attivo, phase must_draw → draw legale.
  room.onMessage(a2.as(), { type: "draw", source: "deck" });
  const advanced = a2.states().some((st) => st.phase === "may_meld");
  assert.ok(advanced, "l'azione è stata applicata (phase → may_meld): draw davvero valido");

  // COMMIT: il prevToken è stato scartato.
  assert.equal(slot.prevToken, null, "prevToken azzerato dopo l'azione (commit)");
  assert.equal(slot.prevTokenExpiry, null, "prevTokenExpiry azzerato dopo l'azione (commit)");

  // Il vecchio token NON riammette più: slot disconnesso → trattato come nuovo
  // ingresso → room piena. Nessun resume.
  room.onDisconnect(a2.as());
  const a3 = new FakeSocket();
  room.join(a3.as(), oldToken, "Alice");
  assert.ok(
    a3.sent.some((m) => m.type === "error" && /completo/i.test((m as { message: string }).message)),
    "vecchio token committato → room piena (nessuna riconnessione)",
  );
  assert.ok(!a3.has("room_joined"), "nessun room_joined per il vecchio token committato");
  assert.ok(!a3.has("state"), "nessuno stato al vecchio token committato");

  // Il NUOVO token invece riconnette correttamente.
  const a4 = new FakeSocket();
  room.join(a4.as(), newToken, "Alice");
  assert.equal(a4.roomJoined()?.resumed, true, "il nuovo token riconnette (resumed)");

  (room as unknown as { dispose(): void }).dispose();
});

/* ─── NEW-1 (b): commit del prevToken tramite HEARTBEAT (unit, deterministico) ─── */

test("NEW-1: un heartbeat valido sul nuovo socket 'committa' il token → il precedente non è più accettato", () => {
  const { room, activeSeat, activeSock } = startedRoom("CMTHB");
  const oldToken = tokenOf(activeSock);

  room.onDisconnect(activeSock.as());
  const a2 = new FakeSocket();
  room.join(a2.as(), oldToken, "Alice");
  const slot = slotsOf(room).find((p) => p.seat === activeSeat)!;
  assert.equal(slot.prevToken, oldToken, "prevToken impostato al vecchio token");

  // HEARTBEAT: raggiunge onMessage → commitToken() prima del branch heartbeat.
  room.onMessage(a2.as(), { type: "heartbeat" });
  assert.equal(slot.prevToken, null, "prevToken azzerato dopo heartbeat (commit)");
  assert.equal(slot.prevTokenExpiry, null, "prevTokenExpiry azzerato dopo heartbeat (commit)");

  // Vecchio token non riammette più.
  room.onDisconnect(a2.as());
  const a3 = new FakeSocket();
  room.join(a3.as(), oldToken, "Alice");
  assert.ok(!a3.has("room_joined"), "vecchio token committato: nessun resume dopo heartbeat");

  (room as unknown as { dispose(): void }).dispose();
});

/* ─── SEC-10 / NEW-1: scadenza TTL SENZA commit ─── */

test("SEC-10/NEW-1: senza alcun commit, il prevToken smette di essere accettato una volta superato il TTL", async () => {
  process.env.TOKEN_ROTATION_TTL_MS = "50"; // TTL brevissimo, iniettato
  const { room, activeSeat, activeSock } = startedRoom("TTLEXP");
  const oldToken = tokenOf(activeSock);

  // Riconnessione: ruota il token, prevToken = oldToken entro 50ms. Nessun commit.
  room.onDisconnect(activeSock.as());
  const a2 = new FakeSocket();
  room.join(a2.as(), oldToken, "Alice");
  const slot = slotsOf(room).find((p) => p.seat === activeSeat)!;
  assert.equal(slot.prevToken, oldToken, "prevToken impostato");

  // a2 si disconnette SENZA aver committato (nessuna azione/heartbeat).
  room.onDisconnect(a2.as());

  // Oltre il TTL: il prevToken è scaduto → trattato come nuovo ingresso → room piena.
  await delay(90); // > 50ms TTL
  assert.ok(slot.prevTokenExpiry !== null && slot.prevTokenExpiry <= Date.now(), "TTL superato");
  const a3 = new FakeSocket();
  room.join(a3.as(), oldToken, "Alice");
  assert.ok(
    a3.sent.some((m) => m.type === "error" && /completo/i.test((m as { message: string }).message)),
    "prevToken scaduto: room piena, nessun resume",
  );
  assert.ok(!a3.has("room_joined"), "nessun room_joined dopo scadenza TTL");

  (room as unknown as { dispose(): void }).dispose();
});

test("NEW-1: ENTRO il TTL e con slot disconnesso, il prevToken riammette (resume) — no lockout", () => {
  process.env.TOKEN_ROTATION_TTL_MS = "10000"; // TTL ampio: siamo dentro finestra
  const { room, activeSeat, activeSock } = startedRoom("TTLIN");
  const oldToken = tokenOf(activeSock);

  room.onDisconnect(activeSock.as());
  const a2 = new FakeSocket();
  room.join(a2.as(), oldToken, "Alice"); // rotazione, prevToken=oldToken, nessun commit
  const rotated = a2.roomJoined()!.yourToken;

  // room_joined "perso": a2 chiude senza commit; il client riprova col vecchio token.
  room.onDisconnect(a2.as());
  const a3 = new FakeSocket();
  room.join(a3.as(), oldToken, "Alice");
  assert.equal(a3.roomJoined()?.resumed, true, "entro TTL il vecchio token riammette (no lockout)");
  const rotated2 = a3.roomJoined()!.yourToken;
  assert.notEqual(rotated2, oldToken, "riceve comunque un nuovo token ruotato");
  assert.notEqual(rotated2, rotated, "nuova rotazione a ogni riconnessione");
  assert.equal(slotsOf(room).find((p) => p.seat === activeSeat)!.status, "connected", "slot riconnesso");

  (room as unknown as { dispose(): void }).dispose();
});

/* ─── NEW-3 (a): flusso NORMALE — auto-play da must_draw non forfetta mai ─── */

test("NEW-3(a): l'auto-play che parte da must_draw pesca d'ufficio e scarta legalmente → nessun forfeit indebito, il turno avanza", () => {
  const { room, a, b, activeSeat } = startedRoom("NOFORF");
  const eng = (room as unknown as { engine: { phase: string; currentSeat: Seat; status: string } }).engine;
  assert.equal(eng.phase, "must_draw", "inizio turno: must_draw");
  assert.equal(eng.currentSeat, activeSeat, "turno del seat attivo");

  // Esegue l'auto-play come farebbe il turn timer allo scadere del turno.
  (room as unknown as { autoPlayTurn(s: Seat): void }).autoPlayTurn(activeSeat);

  // Nessun game_ended per forfeit: il ramo di stallo NON è raggiungibile dal
  // flusso normale (mano piena → scarto ordinario sempre legale).
  const forfeitEmitted = [a, b].some((s) =>
    s.sent.some((m) => m.type === "game_ended" && (m as { reason?: string }).reason === "forfeit"),
  );
  assert.equal(forfeitEmitted, false, "nessun forfeit indebito nel flusso normale");
  // Il turno è avanzato all'avversario e la partita prosegue.
  assert.equal(eng.status, "playing", "la partita prosegue");
  assert.equal(eng.currentSeat, (1 - activeSeat) as Seat, "turno passato all'avversario");

  (room as unknown as { dispose(): void }).dispose();
});

/* ─── SEC-04 PRESERVATO: legittimo connesso → né token corrente né precedente danno accesso ─── */

test("SEC-04: con il legittimo CONNESSO, un secondo socket è rifiutato (1008) sia col token CORRENTE sia col PRECEDENTE entro TTL", () => {
  const { room, activeSeat, activeSock } = startedRoom("SEC04U");
  const oldToken = tokenOf(activeSock);

  // Riconnessione per creare un prevToken ancora valido, con il legittimo (a2) CONNESSO.
  room.onDisconnect(activeSock.as());
  const a2 = new FakeSocket();
  room.join(a2.as(), oldToken, "Alice"); // a2 connesso; prevToken=oldToken (no commit)
  const currentToken = a2.roomJoined()!.yourToken;
  const slot = slotsOf(room).find((p) => p.seat === activeSeat)!;
  assert.equal(slot.prevToken, oldToken, "prevToken ancora valido (nessun commit)");
  assert.equal(slot.status, "connected", "legittimo connesso");

  // Intruso col token CORRENTE → rifiutato, close 1008, nessuna mano.
  const i1 = new FakeSocket();
  room.join(i1.as(), currentToken, "Mallory");
  assert.ok(
    i1.sent.some((m) => m.type === "error" && /già attiva/i.test((m as { message: string }).message)),
    "token corrente: rifiutato (sessione già attiva)",
  );
  assert.equal(i1.closed?.code, 1008, "token corrente: close 1008");
  assert.ok(!i1.has("room_joined") && !i1.has("state"), "token corrente: nessun room_joined/stato");

  // Intruso col token PRECEDENTE (entro TTL) → ANCHE questo rifiutato: SEC-04 vale
  // per entrambi i token finché il legittimo è connesso.
  const i2 = new FakeSocket();
  room.join(i2.as(), oldToken, "Mallory");
  assert.ok(
    i2.sent.some((m) => m.type === "error" && /già attiva/i.test((m as { message: string }).message)),
    "token precedente: rifiutato (sessione già attiva)",
  );
  assert.equal(i2.closed?.code, 1008, "token precedente: close 1008");
  assert.ok(!i2.has("room_joined") && !i2.has("state"), "token precedente: nessun room_joined/stato");

  // Il tentativo dell'intruso NON ha committato né alterato lo stato del legittimo.
  assert.equal(slot.prevToken, oldToken, "prevToken intatto dopo i tentativi di takeover");
  assert.equal(slot.status, "connected", "legittimo ancora connesso");

  (room as unknown as { dispose(): void }).dispose();
});
