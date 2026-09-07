import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { RoomManager } from "../src/room/RoomManager.js";
import type { ServerMessage, Seat } from "../src/contract/types.js";

/**
 * LOBBY — casi complementari a lobby.rooms.test.ts, aggiunti in fase di test
 * (agente_test): F13 (annullamento del proprio tavolo in attesa via reset_room),
 * F15 (NON-regressione dello "stale slot lockout": un posto disconnesso non
 * blocca l'ingresso), S3 (annullamento di un tavolo altrui negato: leaveWaiting è
 * scoped alla sessione chiamante). Socket finti, deterministici, nessuna rete.
 */

class FakeSocket {
  readyState = 1; // OPEN
  sent: ServerMessage[] = [];
  send(s: string): void { this.sent.push(JSON.parse(s) as ServerMessage); }
  close(): void { this.readyState = 3; }
  as(): WebSocket { return this as unknown as WebSocket; }
  has(type: string): boolean { return this.sent.some((m) => m.type === type); }
  find<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
}

interface SlotView { seat: Seat; status: string; clientId?: string }
const slotsOf = (room: unknown): SlotView[] => (room as { players: SlotView[] }).players;

const ORIG = { waiting: process.env.WAITING_GRACE_MS };
afterEach(() => {
  if (ORIG.waiting === undefined) delete process.env.WAITING_GRACE_MS;
  else process.env.WAITING_GRACE_MS = ORIG.waiting;
});

test("F13: annullamento del proprio tavolo in attesa (reset_room) → dispose immediato, fuori dalla lista", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "RST1", private: false, displayName: "Alice", clientId: "cidA",
  });
  assert.equal(mgr.listPublicWaitingTables().length, 1, "tavolo presente prima dell'annullamento");

  mgr.handleMessage(a.as(), { type: "reset_room" });

  assert.equal(mgr.activeRoomCount(), 0, "tavolo smaltito subito");
  assert.equal(mgr.listPublicWaitingTables().length, 0, "sparito dalla lista");
  assert.ok(a.has("room_closed"), "il creatore riceve la chiusura (il FE torna in lobby)");
});

test("F15: non-regressione stale slot lockout — un posto in attesa disconnesso NON blocca un altro giocatore", () => {
  process.env.WAITING_GRACE_MS = "100000"; // grace lunga: il posto disconnesso resta durante il test
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "LOCK", private: false, displayName: "Alice", clientId: "cidA",
  });
  // Il creatore si disconnette: il posto resta "disconnesso" entro la grace.
  mgr.handleClose(a.as());
  const room = mgr.findByCode("LOCK")!;
  assert.equal(slotsOf(room)[0]!.status, "disconnected", "posto del creatore in stato disconnesso");

  // Un ALTRO giocatore (clientId diverso) entra col codice: NON deve essere bloccato.
  const b = new FakeSocket();
  mgr.handleMessage(b.as(), { type: "join_room", roomCode: "LOCK", displayName: "Bob", clientId: "cidB" });
  assert.ok(b.find("room_joined"), "il secondo giocatore entra: nessun lockout");
  assert.ok(!b.has("error"), "nessun errore di posto occupato");

  // E il creatore originale può ancora reclamare il proprio posto (stesso clientId).
  const a2 = new FakeSocket();
  mgr.handleMessage(a2.as(), { type: "join_room", roomCode: "LOCK", displayName: "Alice", clientId: "cidA" });
  assert.equal(a2.find("room_joined")?.resumed, true, "reclaim del posto del creatore");
});

test("S3: annullamento di un tavolo ALTRUI negato — leaveWaiting è scoped alla sessione chiamante", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "open_table", code: "MINE", private: false, displayName: "Alice", clientId: "cidA",
  });
  assert.equal(mgr.listPublicWaitingTables().length, 1);

  // Una sessione diversa tenta di smontare il tavolo di Alice: nessun effetto.
  mgr.leaveWaiting("cidINTRUSO");
  assert.equal(mgr.activeRoomCount(), 1, "il tavolo altrui sopravvive");
  assert.ok(
    mgr.listPublicWaitingTables().some((t) => t.code === "MINE"),
    "il tavolo di Alice è ancora in lista",
  );

  // Solo la sessione proprietaria può smontarlo.
  mgr.leaveWaiting("cidA");
  assert.equal(mgr.activeRoomCount(), 0, "il proprietario smonta il proprio tavolo");
});
