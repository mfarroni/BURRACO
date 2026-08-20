import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { RoomManager } from "../src/room/RoomManager.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { AuthService } from "../src/auth/service.js";
import type { ServerMessage } from "../src/contract/types.js";

/**
 * Gating SEC-08 di `join_room` con authToken, a livello RoomManager (socket
 * finti deterministici, nessuna rete). Verifica:
 *  - senza authToken (auth obbligatoria) → join_rejected AUTH_REQUIRED, nessun posto;
 *  - authToken invalido → join_rejected AUTH_INVALID, nessun posto;
 *  - authToken valido → room_joined col displayName AUTORITATIVO (ignora quello del client);
 *  - con gating OFF (legacy) → join col displayName del client (suite preesistenti verdi).
 */

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
  first<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
  has(type: string): boolean {
    return this.sent.some((m) => m.type === type);
  }
}

/** Piccola attesa per lasciar risolvere l'handleJoin asincrono (await sul token). */
const tick = () => new Promise((r) => setTimeout(r, 5));

test("gating ON: join senza authToken → AUTH_REQUIRED, nessun room_joined", async () => {
  const auth = new AuthService(new MemoryAuthStore());
  const mgr = new RoomManager({ authService: auth, requireAuth: true });
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "GATE1", displayName: "Chiunque" });
  await tick();

  const rej = a.first("join_rejected");
  assert.ok(rej, "arriva join_rejected");
  assert.equal(rej!.code, "AUTH_REQUIRED");
  assert.equal(a.has("room_joined"), false, "nessun posto occupato");
});

test("gating ON: authToken invalido → AUTH_INVALID, nessun room_joined", async () => {
  const auth = new AuthService(new MemoryAuthStore());
  const mgr = new RoomManager({ authService: auth, requireAuth: true });
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "join_room",
    roomCode: "GATE2",
    displayName: "Chiunque",
    authToken: "token-fasullo",
  });
  await tick();

  const rej = a.first("join_rejected");
  assert.ok(rej, "arriva join_rejected");
  assert.equal(rej!.code, "AUTH_INVALID");
  assert.equal(a.has("room_joined"), false);
});

test("gating ON: authToken valido → room_joined col displayName AUTORITATIVO (ignora il client)", async () => {
  const auth = new AuthService(new MemoryAuthStore());
  const { sessionToken } = await auth.register("player@example.com", "password12", "NomeVero");
  const mgr = new RoomManager({ authService: auth, requireAuth: true });
  const a = new FakeSocket();

  mgr.handleMessage(a.as(), {
    type: "join_room",
    roomCode: "GATE3",
    displayName: "NomeFalsoDaSpoofare",
    authToken: sessionToken,
  });
  await tick();

  const joined = a.first("room_joined");
  assert.ok(joined, "room_joined ricevuto");
  const me = joined!.players.find((p) => p.seat === joined!.yourSeat);
  assert.equal(me!.displayName, "NomeVero", "usa il nome del principale, non quello del client");
  assert.equal(a.has("join_rejected"), false);
});

test("gating ON: ospite con token valido entra (identità unificata is_guest)", async () => {
  const auth = new AuthService(new MemoryAuthStore());
  const { sessionToken } = await auth.createGuest("OspiteAlTavolo");
  const mgr = new RoomManager({ authService: auth, requireAuth: true });
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "join_room",
    roomCode: "GATE4",
    displayName: "ignorato",
    authToken: sessionToken,
  });
  await tick();
  const joined = a.first("room_joined");
  assert.ok(joined, "l'ospite entra");
  const me = joined!.players.find((p) => p.seat === joined!.yourSeat);
  assert.equal(me!.displayName, "OspiteAlTavolo");
});

test("gating OFF (legacy): join senza authToken usa il displayName del client", async () => {
  // Nessun authService o requireAuth=false → comportamento preesistente invariato.
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "LEG1", displayName: "Legacy" });
  await tick();
  const joined = a.first("room_joined");
  assert.ok(joined, "join legacy accettato");
  const me = joined!.players.find((p) => p.seat === joined!.yourSeat);
  assert.equal(me!.displayName, "Legacy");
});
