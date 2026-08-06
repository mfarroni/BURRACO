import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type http from "node:http";
import { createServer } from "../src/ws/server.js";
import type { ServerMessage, ClientMessage } from "../src/contract/types.js";

/**
 * Test di INTEGRAZIONE dei fix di sicurezza sul WebSocketServer reale:
 *  - SEC-02: frame oltre maxPayload -> close 1009, nessun crash.
 *  - SEC-01: burst -> messaggi scartati senza reply-per-messaggio, poi close.
 *  - SEC-04: secondo socket con lo STESSO token (vittima connessa) -> rifiutato.
 *  - SEC-10: rotazione del token dopo riconnessione legittima.
 *  - SEC-07: input malformati -> move_rejected MALFORMED, mai "Errore interno".
 *  - Anti-leak: nessun leak verso l'avversario.
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
  closeInfo: { code: number; reason: string } | null = null;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  constructor(u: string, opts?: { origin?: string }) {
    this.ws = new WebSocket(u, opts?.origin ? { origin: opts.origin } : undefined);
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) { w.resolve(m); return false; }
        return true;
      });
    });
    this.ws.on("close", (code, reason) => {
      this.closeInfo = { code, reason: reason.toString() };
    });
  }
  open() { return new Promise<void>((res) => this.ws.on("open", () => res())); }
  send(m: ClientMessage) { this.ws.send(JSON.stringify(m)); }
  raw(s: string) { this.ws.send(s); }
  waitFor(pred: (m: ServerMessage) => boolean, ms = 1500): Promise<ServerMessage> {
    const found = this.msgs.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout in waitFor")), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  waitClose(ms = 1500): Promise<{ code: number; reason: string }> {
    if (this.closeInfo) return Promise.resolve(this.closeInfo);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout in waitClose")), ms);
      this.ws.on("close", (code, reason) => { clearTimeout(t); resolve({ code, reason: reason.toString() }); });
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

/* ─────────────────────────── SEC-02: PAYLOAD OVERSIZE ─────────────────────────── */

test("SEC-02: un frame oltre maxPayload (16KB) chiude il socket con 1009, senza crashare il server", async () => {
  const c = new Client(url); await c.open();
  // Frame ben oltre 16KB.
  const huge = "x".repeat(64 * 1024);
  c.raw(JSON.stringify({ type: "join_room", roomCode: "BIG", displayName: huge }));
  const info = await c.waitClose(2000);
  assert.equal(info.code, 1009, "close code 1009 (message too big)");

  // Il server resta operativo: un nuovo client può ancora giocare.
  const { a, b } = await joinPair("AFTERBIG");
  assert.ok(a.has("room_joined") && b.has("room_joined"), "server ancora operativo dopo l'oversize");
  a.close(); b.close();
});

/* ─────────────────────────── SEC-01: RATE LIMIT / BURST ─────────────────────────── */

test("SEC-01: un burst massiccio viene scartato senza reply-per-messaggio e infine chiude il socket", async () => {
  const c = new Client(url); await c.open();
  // Non fa join: ogni messaggio processato produce al più un 'error' (non in room).
  // Inviamo molti più messaggi della capacità del bucket per forzare i drop.
  const N = 400;
  for (let i = 0; i < N; i++) c.send({ type: "draw", source: "deck" });

  // Attesa della chiusura per rate-limit (drops consecutivi oltre soglia).
  const info = await c.waitClose(3000).catch(() => null);
  assert.ok(info, "il socket viene chiuso per abuso di rate");
  assert.equal(info!.code, 1008, "close 1008 (policy violation / rate limit)");

  // Reply ricevute molto inferiori ai messaggi inviati: i drop NON producono reply.
  const replies = c.msgs.filter((m) => m.type === "error" || m.type === "move_rejected").length;
  assert.ok(replies < N, `reply (${replies}) < messaggi inviati (${N}): nessun reply-per-messaggio`);
  assert.ok(replies <= 60, `reply bounded (~capacità bucket), ottenuto ${replies}`);
});

/* ─────────────────────────── SEC-04: TAKEOVER SESSIONE ATTIVA ─────────────────────────── */

test("SEC-04: un secondo socket con lo STESSO token, vittima connessa, è rifiutato (1008) e NON riceve la mano; la vittima resta viva", async () => {
  const room = "TAKEOVER";
  const { a, b, ja } = await joinPair(room);
  const aStates0 = a.msgs.filter(isState).length;

  // Intruso con il token di A mentre A è ancora connesso.
  const intruder = new Client(url); await intruder.open();
  intruder.send({ type: "join_room", roomCode: room, playerToken: ja.yourToken, displayName: "Mallory" });

  const err = (await intruder.waitFor((m) => m.type === "error")) as Extract<ServerMessage, { type: "error" }>;
  assert.match(err.message, /già attiva/i, "intruso rifiutato: sessione già attiva");
  const info = await intruder.waitClose(1500).catch(() => null);
  assert.ok(info && info.code === 1008, "intruso chiuso con 1008");
  // L'intruso NON deve aver ricevuto stato di gioco né room_joined (nessuna mano).
  assert.ok(!intruder.has("state"), "intruso non riceve alcuno stato (mano)");
  assert.ok(!intruder.has("room_joined"), "intruso non riceve room_joined");

  // La connessione legittima di A resta viva e operativa.
  const sa = [...a.msgs].reverse().find(isState) as Extract<ServerMessage, { type: "state" }>;
  const actor = sa.state.whoseTurn === ja.yourSeat ? a : b;
  actor.send({ type: "draw", source: "deck" });
  await actor.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");
  assert.ok(a.msgs.filter(isState).length >= aStates0, "A continua a ricevere aggiornamenti (viva)");
  a.close(); b.close(); intruder.close();
});

/* ─────────────────────────── SEC-10: ROTAZIONE TOKEN ─────────────────────────── */

test("SEC-10: dopo la riconnessione il token è RUOTATO; CONFERMATO il nuovo token, il vecchio non funziona più", async () => {
  // NOTA (NEW-1): il token vecchio non è più invalidato ISTANTANEAMENTE al
  // rebind, ma resta accettato entro un breve TTL o finché il client non
  // conferma il nuovo token con la prima azione valida (qui un heartbeat).
  // SEC-10 resta sostanzialmente chiuso: dopo la conferma, il vecchio è morto.
  const room = "ROTATE";
  const { a, b, ja } = await joinPair(room);
  const oldToken = ja.yourToken;

  // A cade e rientra con il vecchio token (riconnessione legittima).
  a.close();
  await delay(80);
  const a2 = new Client(url); await a2.open();
  a2.send({ type: "join_room", roomCode: room, playerToken: oldToken, displayName: "Alice" });
  const rj = (await a2.waitFor((m) => m.type === "room_joined")) as Extract<ServerMessage, { type: "room_joined" }>;
  assert.equal(rj.resumed, true, "riconnessione legittima");
  assert.ok(rj.yourToken && rj.yourToken !== oldToken, "SEC-10: token RUOTATO (diverso dal precedente)");
  const newToken = rj.yourToken;
  await a2.waitFor(isState);

  // NEW-1/SEC-10: A2 CONFERMA il nuovo token con un'azione valida (heartbeat):
  // il token precedente viene "committato" e diventa non più rigiocabile.
  a2.send({ type: "heartbeat" });
  await delay(80);

  // A2 cade; il VECCHIO token, ormai committato, non deve più consentire il rientro.
  a2.close();
  await delay(80);
  const a3 = new Client(url); await a3.open();
  a3.send({ type: "join_room", roomCode: room, playerToken: oldToken, displayName: "Alice" });
  // Vecchio token committato -> trattato come nuovo ingresso -> room piena.
  const err = (await a3.waitFor((m) => m.type === "error")) as Extract<ServerMessage, { type: "error" }>;
  assert.match(err.message, /completo/i, "vecchio token committato: nessuna riconnessione");
  assert.ok(!a3.has("room_joined") || (a3.msgs.find((m) => m.type === "room_joined") as { resumed?: boolean } | undefined)?.resumed !== true,
    "vecchio token non produce un resume");

  // Il NUOVO token invece riconnette correttamente.
  const a4 = new Client(url); await a4.open();
  a4.send({ type: "join_room", roomCode: room, playerToken: newToken, displayName: "Alice" });
  const rj2 = (await a4.waitFor((m) => m.type === "room_joined")) as Extract<ServerMessage, { type: "room_joined" }>;
  assert.equal(rj2.resumed, true, "il nuovo token riconnette");
  a3.close(); a4.close(); b.close();
});

/* ─────────────────────────── NEW-1: GRAZIA TOKEN ALLA RICONNESSIONE ─────────────────────────── */

test("NEW-1: se room_joined si perde (nessuna conferma), il token precedente resta valido entro il TTL e riammette (no lockout)", async () => {
  const room = "GRACE1";
  const { a, b, ja } = await joinPair(room);
  const oldToken = ja.yourToken;

  // A cade e riprova: il server ruota il token e invia room_joined... ma
  // simuliamo la PERDITA di quel frame: A2 non conferma (nessuna azione) e chiude.
  a.close();
  await delay(60);
  const a2 = new Client(url); await a2.open();
  a2.send({ type: "join_room", roomCode: room, playerToken: oldToken, displayName: "Alice" });
  await a2.waitFor((m) => m.type === "room_joined"); // ricevuto dal test, ma "perso" lato client
  a2.close(); // nessun commit del nuovo token
  await delay(60);

  // Ritentativo con lo STESSO vecchio token (quello ancora in localStorage lato
  // client): NEW-1 lo riammette invece di lasciare il giocatore fuori (forfeit).
  const a3 = new Client(url); await a3.open();
  a3.send({ type: "join_room", roomCode: room, playerToken: oldToken, displayName: "Alice" });
  const rj = (await a3.waitFor((m) => m.type === "room_joined")) as Extract<ServerMessage, { type: "room_joined" }>;
  assert.equal(rj.resumed, true, "NEW-1: vecchio token riammesso dopo room_joined perso (no lockout)");
  assert.ok(rj.yourToken && rj.yourToken !== oldToken, "riceve comunque un nuovo token ruotato");
  await a3.waitFor(isState);
  a3.close(); b.close();
});

test("SEC-04 + NEW-1: con il legittimo CONNESSO, nemmeno il token PRECEDENTE (in finestra TTL) consente il takeover", async () => {
  const room = "TAKEOVER2";
  const { a, b, ja } = await joinPair(room);
  const oldToken = ja.yourToken;

  // A si riconnette (ruota il token): oldToken diventa il "precedente" ancora
  // entro il TTL. A2 resta CONNESSO e NON conferma (così il precedente resta vivo).
  a.close();
  await delay(60);
  const a2 = new Client(url); await a2.open();
  a2.send({ type: "join_room", roomCode: room, playerToken: oldToken, displayName: "Alice" });
  await a2.waitFor((m) => m.type === "room_joined");
  await a2.waitFor(isState);

  // Un intruso prova col token PRECEDENTE mentre A2 è connesso: SEC-04 lo blocca.
  const intruder = new Client(url); await intruder.open();
  intruder.send({ type: "join_room", roomCode: room, playerToken: oldToken, displayName: "Mallory" });
  const err = (await intruder.waitFor((m) => m.type === "error")) as Extract<ServerMessage, { type: "error" }>;
  assert.match(err.message, /già attiva/i, "prevToken NON consente takeover se il legittimo è connesso (SEC-04)");
  const info = await intruder.waitClose(1500).catch(() => null);
  assert.ok(info && info.code === 1008, "intruso chiuso con 1008");
  assert.ok(!intruder.has("state"), "intruso non riceve alcuno stato (mano)");
  assert.ok(!intruder.has("room_joined"), "intruso non riceve room_joined");
  a2.close(); b.close(); intruder.close();
});

/* ─────────────────────────── SEC-07: MALFORMED integrazione ─────────────────────────── */

test("SEC-07: input malformati -> move_rejected MALFORMED mirato, mai 'Errore interno del server'", async () => {
  const variants: unknown[] = [
    { type: "meld_new" }, // manca cards
    { type: "meld_new", cards: "non-array" }, // cards non-array
    { type: "draw" }, // manca source
    { type: "discard" }, // manca card
    { type: "draw", source: "pozzetto" }, // enum errato
    { type: "forma_ignota", a: 1 }, // JSON valido, forma errata
  ];
  for (const v of variants) {
    const c = new Client(url); await c.open();
    c.raw(JSON.stringify(v));
    const rej = (await c.waitFor((m) => m.type === "move_rejected")) as Extract<ServerMessage, { type: "move_rejected" }>;
    assert.equal(rej.code, "MALFORMED", `MALFORMED per ${JSON.stringify(v)}`);
    // Non deve mai comparire l'errore interno generico.
    assert.ok(!c.msgs.some((m) => m.type === "error" && /interno/i.test((m as { message: string }).message)),
      "mai 'Errore interno del server'");
    c.close();
  }
});

test("SEC-07: JSON non valido -> error 'JSON non valido', nessuna eccezione interna", async () => {
  const c = new Client(url); await c.open();
  c.raw("{ questo non e' json valido ");
  const err = (await c.waitFor((m) => m.type === "error")) as Extract<ServerMessage, { type: "error" }>;
  assert.match(err.message, /json/i);
  assert.ok(!/interno/i.test(err.message), "non è l'errore interno generico");
  c.close();
});

/* ─────────────────────────── ANTI-LEAK aggiuntivo ─────────────────────────── */

test("Anti-leak: durante una mossa reale l'avversario non riceve clientMoveId né move_applied", async () => {
  const { a, b } = await joinPair("LEAK1");
  const sa = [...a.msgs].reverse().find(isState) as Extract<ServerMessage, { type: "state" }>;
  const actor = sa.state.whoseTurn === 0 ? a : b;
  const other = sa.state.whoseTurn === 0 ? b : a;
  actor.send({ type: "draw", source: "deck", clientMoveId: "secret-move-xyz" });
  await actor.waitFor((m) => m.type === "move_applied");
  await other.waitFor((m) => m.type === "state" && m.state.phase === "may_meld");
  await delay(120);
  assert.ok(!other.has("move_applied"), "move_applied mai broadcast");
  for (const m of other.msgs) {
    assert.ok(!JSON.stringify(m).includes("secret-move-xyz"), "clientMoveId non trapela all'avversario");
  }
  // L'avversario non vede mai la mano dell'attore per intero: solo il conteggio.
  const os = [...other.msgs].reverse().find(isState) as Extract<ServerMessage, { type: "state" }>;
  assert.equal(typeof os.state.opponentHandCount, "number");
  a.close(); b.close();
});
