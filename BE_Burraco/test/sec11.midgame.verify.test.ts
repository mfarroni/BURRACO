import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Room } from "../src/room/Room.js";
import { defaultGameConfig } from "../src/config.js";
import type { ServerMessage, Seat } from "../src/contract/types.js";

/**
 * VERIFICA agente_test (ciclo remediation SEC-11): edge non coperti dai test
 * preesistenti. Il fallback open-table è gated su `!this.engine`; a partita
 * avviata NESSUN join non autenticato deve reclamare il posto disconnesso.
 */

class FakeSocket {
  readyState = 1;
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
}

interface SlotView { seat: Seat; status: string; ws: unknown; }
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

test("SEC-11 edge: mid-game, join con clientId SCONOSCIUTO (non combacia) + nessun token → RIFIUTATO, nessun leak", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("MIDG1", cfg());
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join(a.as(), undefined, "Alice", "cidA");
  room.join(b.as(), undefined, "Bob", "cidB");
  assert.ok(engineStarted(room), "partita avviata");
  room.onDisconnect(b.as()); // seat1 disconnesso

  // clientId che NON combacia con alcuno slot: branch 2 fallisce, room piena
  // (branch 3), fallback open-table gated su !engine (branch 4) → rifiuto.
  const attacker = new FakeSocket();
  room.join(attacker.as(), undefined, "Mallory", "clientId-inesistente-999");

  assert.ok(!attacker.has("room_joined"), "nessun room_joined all'intruso");
  assert.ok(!attacker.has("state"), "nessuno state redatto all'intruso");
  assert.ok(
    attacker.sent.some((m) => m.type === "error" && /completo/i.test((m as { message: string }).message)),
    "join respinto: room al completo",
  );
  assert.equal(slotsOf(room).length, 2, "mai più di 2 slot");
  assert.equal(slotsOf(room).find((s) => s.seat === 1)?.status, "disconnected", "posto di Bob intatto");
  disposeOf(room);
});

test("SEC-11 controprova PRE-partita: il fallback open-table completa la coppia SENZA token/clientId (engine null)", () => {
  process.env.RECONNECT_GRACE_MS = "100000";
  const room = new Room("PRE1", cfg());
  const a1 = new FakeSocket();
  room.join(a1.as(), undefined, "Alice"); // slot0, nessun clientId
  assert.ok(!engineStarted(room), "engine ancora null: pre-partita");
  room.onDisconnect(a1.as()); // slot0 disconnesso, engine ancora null

  // Un secondo join non autenticato PRE-partita reclama il posto disconnesso
  // (fallback consentito) così la coppia si completa senza slot fantasma.
  const a2 = new FakeSocket();
  room.join(a2.as(), undefined, "Alice");
  assert.equal(slotsOf(room).length, 2, "sempre 2 slot: nessuno slot fantasma");

  // Ora arriva il vero avversario e la partita parte con due posti vivi.
  const b = new FakeSocket();
  room.join(b.as(), undefined, "Bob");
  assert.ok(engineStarted(room), "partita avviata: coppia completa e viva");
  assert.equal(slotsOf(room).length, 2, "mai più di 2 slot");
  assert.ok(a2.has("state") && b.has("state"), "stato iniziale a entrambi i vivi");
  disposeOf(room);
});
