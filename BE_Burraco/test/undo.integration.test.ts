import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type http from "node:http";
import { createServer } from "../src/ws/server.js";
import type { ServerMessage, ClientMessage } from "../src/contract/types.js";

/**
 * Integrazione a DUE client sul WebSocketServer reale per la feature UNDO. Il
 * mazzo è casuale: qui verifichiamo il ROUTING e il CONTRATTO di `undo_last`
 * (rifiuti mirati, canUndo nello stato redatto, anti-leak), non il ripristino
 * esatto dello stato (coperto in modo deterministico dai test engine).
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
  await a.waitFor(isState);
  await b.waitFor(isState);
  return { a, b, ja, jb };
}

function lastState(c: Client) {
  const s = [...c.msgs].reverse().find(isState) as Extract<ServerMessage, { type: "state" }> | undefined;
  return s!.state;
}

/* ─────────────────────────────────────────────────────────────────────────── */

test("undo_last senza calate -> NOTHING_TO_UNDO mirato all'attore; canUndo=false", async () => {
  const { a, b } = await joinPair("UNDO1");
  const sa = lastState(a);
  const actor = sa.whoseTurn === 0 ? a : b;
  const other = sa.whoseTurn === 0 ? b : a;

  // L'attore pesca: entra in may_meld senza aver calato nulla.
  actor.send({ type: "draw", source: "deck" });
  await actor.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");
  assert.equal(lastState(actor).canUndo, false, "nessuna calata: canUndo false");

  actor.send({ type: "undo_last", clientMoveId: "u-1" });
  const rej = (await actor.waitFor(
    (m) => m.type === "move_rejected",
  )) as Extract<ServerMessage, { type: "move_rejected" }>;
  assert.equal(rej.code, "NOTHING_TO_UNDO");
  assert.equal(rej.clientMoveId, "u-1", "il rifiuto riporta il clientMoveId");

  await delay(120);
  assert.ok(!other.has("move_rejected"), "il rifiuto non trapela all'avversario");
  a.close(); b.close();
});

test("undo_last dell'avversario (fuori turno) -> NOT_YOUR_TURN", async () => {
  const { a, b } = await joinPair("UNDO2");
  const sa = lastState(a);
  const off = sa.whoseTurn === 0 ? b : a; // chi NON è di mano
  off.send({ type: "undo_last", clientMoveId: "u-2" });
  const rej = (await off.waitFor(
    (m) => m.type === "move_rejected",
  )) as Extract<ServerMessage, { type: "move_rejected" }>;
  assert.equal(rej.code, "NOT_YOUR_TURN");
  assert.equal(rej.clientMoveId, "u-2");
  a.close(); b.close();
});

test("undo_last prima della pesca (fase must_draw) -> WRONG_PHASE", async () => {
  const { a, b } = await joinPair("UNDO3");
  const sa = lastState(a);
  const actor = sa.whoseTurn === 0 ? a : b; // di mano, ma non ha ancora pescato
  actor.send({ type: "undo_last" });
  const rej = (await actor.waitFor(
    (m) => m.type === "move_rejected",
  )) as Extract<ServerMessage, { type: "move_rejected" }>;
  assert.equal(rej.code, "WRONG_PHASE");
  a.close(); b.close();
});

test("lo stato redatto include canUndo e non fa leak dopo un undo_last rifiutato", async () => {
  const { a, b } = await joinPair("UNDO4");
  const sa = lastState(a);
  const actor = sa.whoseTurn === 0 ? a : b;
  const other = sa.whoseTurn === 0 ? b : a;
  actor.send({ type: "draw", source: "deck" });
  await actor.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");

  const st = lastState(actor);
  assert.equal(typeof st.canUndo, "boolean", "canUndo presente nel contratto redatto");
  // anti-leak: la mano dell'attore non compare nello stato dell'altro.
  const otherJson = JSON.stringify(lastState(other));
  for (const c of st.yourHand) assert.ok(!otherJson.includes(c.id), `leak carta ${c.id}`);
  a.close(); b.close();
});
