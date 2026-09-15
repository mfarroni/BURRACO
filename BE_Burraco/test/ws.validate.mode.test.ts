import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { parseClientMessage } from "../src/ws/validate.js";
import { RoomManager } from "../src/room/RoomManager.js";
import type { ServerMessage } from "../src/contract/types.js";

/**
 * SEC-2V2-01 (regressione critica) — la modalità 2v2 era IRRAGGIUNGIBILE via WS
 * reale perché gli schemi zod di `open_table`/`quick_match` non elencavano
 * `numeroGiocatori`/`modalita`: zod (strip mode) SCARTAVA le due chiavi prima che
 * il RoomManager le leggesse, e ogni tavolo nasceva 1v1.
 *
 * Questi test coprono il BORDO che il bug attraversava: `parseClientMessage`
 * (validate.ts) → `RoomManager.handleMessage` (il dispatch reale del server), NON
 * i gestori chiamati a mano con una config già pronta (come fanno gli altri test
 * 2v2, che perciò non intercettavano la lacuna).
 */

/** Socket finto minimale, coerente con l'uso che ne fa il RoomManager. */
class FakeSocket {
  readyState = 1; // OPEN
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
}

/**
 * Riproduce il percorso WS reale (server.ts): valida la FORMA con
 * `parseClientMessage` e SOLO SE conforme instrada il messaggio parsato al
 * dispatch del RoomManager. È la differenza chiave rispetto ai test che passano
 * direttamente un oggetto a `handleMessage`.
 */
function deliver(mgr: RoomManager, ws: FakeSocket, raw: unknown): void {
  const parsed = parseClientMessage(raw);
  assert.equal(parsed.ok, true, `il bordo WS ha scartato un messaggio valido: ${JSON.stringify(raw)}`);
  if (parsed.ok) mgr.handleMessage(ws.as(), parsed.msg);
}

/* ───────────────── il bordo WS CONSERVA i campi di modalità ───────────────── */

test("SEC-2V2-01: parseClientMessage conserva numeroGiocatori/modalita su open_table", () => {
  const parsed = parseClientMessage({
    type: "open_table", code: "CPP1", private: false, displayName: "Alice",
    clientId: "cA", numeroGiocatori: 4, modalita: "coppie",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.msg.type !== "open_table") return assert.fail("open_table non parsato");
  assert.equal(parsed.msg.numeroGiocatori, 4, "numeroGiocatori NON deve essere scartato da zod");
  assert.equal(parsed.msg.modalita, "coppie", "modalita NON deve essere scartato da zod");
});

test("SEC-2V2-01: parseClientMessage conserva numeroGiocatori/modalita su quick_match", () => {
  const parsed = parseClientMessage({
    type: "quick_match", displayName: "Alice", clientId: "cA", numeroGiocatori: 4, modalita: "coppie",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.msg.type !== "quick_match") return assert.fail("quick_match non parsato");
  assert.equal(parsed.msg.numeroGiocatori, 4);
  assert.equal(parsed.msg.modalita, "coppie");
});

/* ─────────── end-to-end: il percorso WS reale crea un tavolo 2v2 ──────────── */

test("SEC-2V2-01: open_table {4,coppie} via bordo WS crea DAVVERO un tavolo 2v2", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  deliver(mgr, a, {
    type: "open_table", code: "E2E4", private: false, displayName: "A",
    clientId: "cA", numeroGiocatori: 4, modalita: "coppie",
  });
  const room = mgr.findByCode("E2E4");
  assert.ok(room, "il tavolo è stato creato");
  assert.equal(room!.config.numeroGiocatori, 4, "config-driven dal messaggio PARSATO: 4 posti");
  assert.equal(room!.config.modalita, "coppie");
  assert.equal(room!.seatsTotal(), 4, "seatsTotal riflette il 2v2, non il 1v1");
});

test("SEC-2V2-01: quick_match {4,coppie} via bordo WS crea DAVVERO un tavolo 2v2", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  deliver(mgr, a, {
    type: "quick_match", displayName: "A", clientId: "cA", numeroGiocatori: 4, modalita: "coppie",
  });
  const joined = a.find("room_joined");
  assert.ok(joined, "quick_match ha fatto sedere il giocatore su un tavolo");
  const room = mgr.findByCode(joined!.code);
  assert.ok(room, "tavolo quick_match reperibile per codice");
  assert.equal(room!.config.numeroGiocatori, 4);
  assert.equal(room!.config.modalita, "coppie");
});

/* ─────────────────── default 1v1 invariato (nessun campo) ─────────────────── */

test("SEC-2V2-01 (default invariato): open_table SENZA campi resta 1v1 al bordo WS", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  deliver(mgr, a, { type: "open_table", code: "DEF2", private: false, displayName: "A", clientId: "cA" });
  const room = mgr.findByCode("DEF2")!;
  assert.deepEqual([room.config.numeroGiocatori, room.config.modalita], [2, "individuale"]);
});

test("SEC-2V2-01 (default invariato): quick_match SENZA campi resta 1v1 al bordo WS", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  deliver(mgr, a, { type: "quick_match", displayName: "A", clientId: "cA" });
  const room = mgr.findByCode(a.find("room_joined")!.code)!;
  assert.deepEqual([room.config.numeroGiocatori, room.config.modalita], [2, "individuale"]);
});

/* ───── combinazione incoerente: FORMA valida, normalizzata a 1v1 a valle ───── */

test("SEC-2V2-01: {4,individuale} passa la forma ma configForMode la normalizza a 1v1", () => {
  // La coerenza della combinazione NON è compito dello schema (che valida solo i
  // singoli campi): resta responsabilità di RoomManager.configForMode, come già.
  const parsed = parseClientMessage({
    type: "open_table", code: "BAD1", private: false, displayName: "A",
    clientId: "cA", numeroGiocatori: 4, modalita: "individuale",
  });
  assert.equal(parsed.ok, true, "forma valida: i due campi sono leciti singolarmente");
  const mgr = new RoomManager();
  const a = new FakeSocket();
  if (parsed.ok) mgr.handleMessage(a.as(), parsed.msg);
  const room = mgr.findByCode("BAD1")!;
  assert.deepEqual(
    [room.config.numeroGiocatori, room.config.modalita], [2, "individuale"],
    "{4,individuale} → normalizzato a 1v1 (invariato)",
  );
});

/* ──────────────── forma: valori fuori dominio sono rifiutati ──────────────── */

test("SEC-2V2-01: valori di modalità fuori forma → MALFORMED (rifiutati al bordo)", () => {
  const bad: unknown[] = [
    { type: "open_table", code: "X", private: false, displayName: "A", numeroGiocatori: 3 }, // 3 non ammesso
    { type: "open_table", code: "X", private: false, displayName: "A", modalita: "solo" }, // enum errato
    { type: "quick_match", displayName: "A", numeroGiocatori: 0 }, // 0 non ammesso
    { type: "quick_match", displayName: "A", modalita: 4 }, // tipo errato
  ];
  for (const b of bad) {
    assert.equal(parseClientMessage(b).ok, false, `atteso rifiuto di forma: ${JSON.stringify(b)}`);
  }
});
