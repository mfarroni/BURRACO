import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type http from "node:http";
import { createServer } from "../src/ws/server.js";
import type { ServerMessage, ClientMessage } from "../src/contract/types.js";

/**
 * Test di integrazione a DUE client sullo stesso WebSocketServer reale.
 * Il mazzo e' mescolato a caso: verifichiamo proprieta' STRUTTURALI del
 * contratto e dell'anti-leak, non carte specifiche.
 */

let server: http.Server;
let url: string;

before(async () => {
  server = createServer();
  await new Promise<void>((res) => server.listen(0, res));
  const port = (server.address() as AddressInfo).port;
  url = `ws://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

/** Client di test: bufferizza i messaggi e permette di attenderli per predicato. */
class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(u: string) {
    this.ws = new WebSocket(u);
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) { w.resolve(m); return false; }
        return true;
      });
    });
  }
  open() { return new Promise<void>((res) => this.ws.on("open", () => res())); }
  send(m: ClientMessage) { this.ws.send(JSON.stringify(m)); }
  waitFor(pred: (m: ServerMessage) => boolean, ms = 1500): Promise<ServerMessage> {
    const found = this.msgs.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout in waitFor")), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  has(type: string) { return this.msgs.some((m) => m.type === type); }
  close() { this.ws.close(); }
}

const isState = (m: ServerMessage) => m.type === "state";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function joinPair(room: string) {
  const a = new Client(url); await a.open();
  a.send({ type: "join_room", roomCode: room, displayName: "Alice" });
  const ja = (await a.waitFor((m) => m.type === "room_joined")) as Extract<ServerMessage, { type: "room_joined" }>;

  const b = new Client(url); await b.open();
  b.send({ type: "join_room", roomCode: room, displayName: "Bob" });
  const jb = (await b.waitFor((m) => m.type === "room_joined")) as Extract<ServerMessage, { type: "room_joined" }>;

  // attende il primo stato di gioco dopo l'avvio partita
  await a.waitFor(isState);
  await b.waitFor(isState);
  return { a, b, ja, jb };
}

function lastState(c: Client) {
  const s = [...c.msgs].reverse().find(isState) as Extract<ServerMessage, { type: "state" }> | undefined;
  return s!.state;
}

/* ─────────────────────────── HANDSHAKE / CONTRATTO ─────────────────────────── */

test("join a due: room_joined con seat 0/1, resumed=false, token presente", async () => {
  const { a, b, ja, jb } = await joinPair("ROOMA");
  assert.equal(ja.yourSeat, 0);
  assert.equal(jb.yourSeat, 1);
  assert.equal(ja.resumed, false, "primo ingresso non e' resume");
  assert.equal(jb.resumed, false);
  assert.ok(ja.yourToken && jb.yourToken, "token effimero presente");
  assert.equal(ja.config.numeroGiocatori, 2);
  a.close(); b.close();
});

test("stato iniziale redatto coerente per entrambi i client", async () => {
  const { a, b } = await joinPair("ROOMB");
  const sa = lastState(a), sb = lastState(b);
  assert.equal(sa.yourHand.length, 11);
  assert.equal(sb.yourHand.length, 11);
  assert.equal(sa.opponentHandCount, 11);
  assert.equal(sb.opponentHandCount, 11);
  assert.equal(sa.drawPileCount, 64);
  assert.equal(sa.pozzettiRemaining, 2);
  assert.equal(sa.turnEndsAt, null, "v1: nessun countdown");
  assert.equal(sa.whoseTurn, sb.whoseTurn, "stesso turno visto da entrambi");
  assert.equal(sa.phase, "must_draw");
  // anti-leak: nel JSON dello stato di A non compaiono le carte di B
  const jsonA = JSON.stringify(sa);
  for (const c of sb.yourHand) assert.ok(!jsonA.includes(c.id), `leak carta di B in stato di A: ${c.id}`);
  a.close(); b.close();
});

/* ─────────────────────────── AUTORITA' DEL SERVER ─────────────────────────── */

test("mossa fuori turno rifiutata (NOT_YOUR_TURN) e mirata al solo mittente", async () => {
  const { a, b } = await joinPair("ROOMC");
  const sa = lastState(a);
  // individua chi NON e' di turno
  const off = sa.whoseTurn === 0 ? b : a;
  const on = sa.whoseTurn === 0 ? a : b;
  off.send({ type: "draw", source: "deck" });
  const rej = (await off.waitFor((m) => m.type === "move_rejected")) as Extract<ServerMessage, { type: "move_rejected" }>;
  assert.equal(rej.code, "NOT_YOUR_TURN");
  // l'altro giocatore NON deve ricevere il rifiuto
  await delay(150);
  assert.ok(!on.has("move_rejected"), "il rifiuto non trapela all'avversario");
  a.close(); b.close();
});

test("clientMoveId: move_applied targetizzato al solo attore, mai in broadcast", async () => {
  const { a, b } = await joinPair("ROOMD");
  const sa = lastState(a);
  const actor = sa.whoseTurn === 0 ? a : b;
  const other = sa.whoseTurn === 0 ? b : a;
  actor.send({ type: "draw", source: "deck", clientMoveId: "mv-123" });
  const applied = (await actor.waitFor((m) => m.type === "move_applied")) as Extract<ServerMessage, { type: "move_applied" }>;
  assert.equal(applied.clientMoveId, "mv-123");
  // entrambi ricevono un nuovo state; solo l'attore riceve move_applied
  await other.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");
  await delay(150);
  assert.ok(!other.has("move_applied"), "move_applied non deve mai essere broadcast");
  // anti-leak: il clientMoveId non deve comparire in nessun messaggio dell'altro
  for (const m of other.msgs) {
    assert.ok(!JSON.stringify(m).includes("mv-123"), "clientMoveId trapelato all'avversario");
  }
  a.close(); b.close();
});

test("move_rejected riporta il clientMoveId all'attore", async () => {
  const { a, b } = await joinPair("ROOME");
  const sa = lastState(a);
  const off = sa.whoseTurn === 0 ? b : a;
  off.send({ type: "draw", source: "deck", clientMoveId: "mv-rej" });
  const rej = (await off.waitFor((m) => m.type === "move_rejected")) as Extract<ServerMessage, { type: "move_rejected" }>;
  assert.equal(rej.code, "NOT_YOUR_TURN");
  assert.equal(rej.clientMoveId, "mv-rej");
  a.close(); b.close();
});

test("scarto di carta non in mano rifiutato (CARD_NOT_IN_HAND)", async () => {
  const { a, b } = await joinPair("ROOMF");
  const sa = lastState(a);
  const actor = sa.whoseTurn === 0 ? a : b;
  actor.send({ type: "draw", source: "deck" });
  await actor.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");
  actor.send({ type: "discard", card: "carta-che-non-esiste", clientMoveId: "d1" });
  const rej = (await actor.waitFor((m) => m.type === "move_rejected")) as Extract<ServerMessage, { type: "move_rejected" }>;
  assert.equal(rej.code, "CARD_NOT_IN_HAND");
  a.close(); b.close();
});

test("messaggio malformato -> MALFORMED", async () => {
  const c = new Client(url); await c.open();
  c.ws.send(JSON.stringify({ foo: "bar" })); // senza 'type'
  const rej = (await c.waitFor((m) => m.type === "move_rejected")) as Extract<ServerMessage, { type: "move_rejected" }>;
  assert.equal(rej.code, "MALFORMED");
  c.close();
});

test("azione prima del join -> errore 'nessuna room'", async () => {
  const c = new Client(url); await c.open();
  c.send({ type: "draw", source: "deck" });
  const err = await c.waitFor((m) => m.type === "error");
  assert.equal(err.type, "error");
  c.close();
});

test("terzo giocatore nella room piena -> error 'room al completo'", async () => {
  const { a, b } = await joinPair("ROOMG");
  const c = new Client(url); await c.open();
  c.send({ type: "join_room", roomCode: "ROOMG", displayName: "Intruso" });
  const err = (await c.waitFor((m) => m.type === "error")) as Extract<ServerMessage, { type: "error" }>;
  assert.match(err.message, /completo/i);
  a.close(); b.close(); c.close();
});

/* ─────────────────────────── REAL-TIME / COERENZA ─────────────────────────── */

test("dopo una mossa entrambi i client ricevono stato coerente", async () => {
  const { a, b } = await joinPair("ROOMH");
  const sa = lastState(a);
  const actor = sa.whoseTurn === 0 ? a : b;
  actor.send({ type: "draw", source: "deck" });
  await a.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");
  await b.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");
  const na = lastState(a), nb = lastState(b);
  // conteggi speculari coerenti
  assert.equal(na.opponentHandCount, nb.yourHand.length);
  assert.equal(nb.opponentHandCount, na.yourHand.length);
  assert.equal(na.drawPileCount, nb.drawPileCount);
  assert.equal(na.whoseTurn, nb.whoseTurn);
  // chi ha pescato ha 12 carte
  const actorState = sa.whoseTurn === 0 ? na : nb;
  assert.equal(actorState.yourHand.length, 12);
  a.close(); b.close();
});

/* ─────────────────────────── RICONNESSIONE ─────────────────────────── */

test("riconnessione per token: room_joined.resumed=true e stato ripristinato", async () => {
  const room = "ROOMR";
  const { a, b, ja } = await joinPair(room);
  // A fa una mossa se e' il suo turno, per creare stato non banale
  const sa = lastState(a);
  if (sa.whoseTurn === ja.yourSeat) {
    a.send({ type: "draw", source: "deck" });
    await a.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");
  }
  const handBefore = lastState(a).yourHand.map((c) => c.id).sort();

  // A cade
  a.close();
  await delay(100);

  // B deve ricevere opponent_disconnected
  assert.ok(b.has("opponent_disconnected"), "avversario notificato della disconnessione");

  // A rientra con lo stesso token
  const a2 = new Client(url); await a2.open();
  a2.send({ type: "join_room", roomCode: room, playerToken: ja.yourToken, displayName: "Alice" });
  const rj = (await a2.waitFor((m) => m.type === "room_joined")) as Extract<ServerMessage, { type: "room_joined" }>;
  assert.equal(rj.resumed, true, "rientro per token = resumed true");
  assert.equal(rj.yourSeat, ja.yourSeat, "stesso seat");
  const st = (await a2.waitFor(isState)) as Extract<ServerMessage, { type: "state" }>;
  assert.deepEqual(st.state.yourHand.map((c) => c.id).sort(), handBefore, "mano ripristinata identica");
  // B notificato del rientro
  await b.waitFor((m) => m.type === "opponent_reconnected");
  a2.close(); b.close();
});

test("eventi celebrativi NON replayati al rejoin (pozzetto_taken/burraco_made effimeri)", async () => {
  // Verifica contrattuale: al rejoin il client riceve room_joined + state,
  // ma non un replay di eventi effimeri gia' avvenuti.
  const room = "ROOMS";
  const { a, b, ja } = await joinPair(room);
  a.close();
  await delay(80);
  const a2 = new Client(url); await a2.open();
  a2.send({ type: "join_room", roomCode: room, playerToken: ja.yourToken, displayName: "Alice" });
  await a2.waitFor(isState);
  await delay(120);
  assert.ok(!a2.has("pozzetto_taken"), "nessun replay di pozzetto_taken");
  assert.ok(!a2.has("burraco_made"), "nessun replay di burraco_made");
  a2.close(); b.close();
});
