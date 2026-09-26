import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { RoomManager } from "../src/room/RoomManager.js";
import { parseClientMessage } from "../src/ws/validate.js";
import type { ServerMessage } from "../src/contract/types.js";

/**
 * Audit lancio R04 — riconnessione dopo un riavvio del server. Lo stato dei tavoli
 * vive solo in RAM: un RoomManager NUOVO simula il processo appena ripartito. Una
 * riconnessione (`join_room.resume`) a un codice che non esiste più riceve
 * `room_closed{lost}` e NON crea un tavolo nuovo; l'ingresso con codice senza
 * `resume` resta invariato (codice sconosciuto → tavolo privato).
 */

class FakeSocket {
  readyState = 1;
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

test("resume su un tavolo sparito (server riavviato) → room_closed{lost}, nessun tavolo creato", () => {
  const mgr = new RoomManager(); // processo appena ripartito: nessuna room in RAM
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), {
    type: "join_room", roomCode: "K7Q2M", displayName: "Anna", clientId: "cidA", playerToken: "vecchio", resume: true,
  });
  assert.deepEqual(a.find("room_closed"), { type: "room_closed", reason: "lost" });
  assert.equal(a.find("room_joined"), undefined, "nessun posto assegnato");
  // Il secondo giocatore che rientra riceve lo stesso esito: nessuna partita nuova.
  const b = new FakeSocket();
  mgr.handleMessage(b.as(), {
    type: "join_room", roomCode: "K7Q2M", displayName: "Bruno", clientId: "cidB", resume: true,
  });
  assert.deepEqual(b.find("room_closed"), { type: "room_closed", reason: "lost" });
  assert.equal(b.find("state"), undefined, "nessuna smazzata distribuita");
});

test("resume su un tavolo ESISTENTE → rientro normale al proprio posto", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "open_table", code: "VIVO1", private: false, displayName: "Anna", clientId: "cidA" });
  const joined = a.find("room_joined");
  assert.ok(joined);
  mgr.handleClose(a.as());
  const a2 = new FakeSocket();
  mgr.handleMessage(a2.as(), {
    type: "join_room", roomCode: "VIVO1", displayName: "Anna", clientId: "cidA", playerToken: joined.yourToken, resume: true,
  });
  assert.equal(a2.find("room_closed"), undefined);
  assert.ok(a2.find("room_joined"), "posto reclamato");
});

test("ingresso con codice SENZA resume: comportamento invariato (codice sconosciuto → tavolo privato)", () => {
  const mgr = new RoomManager();
  const a = new FakeSocket();
  mgr.handleMessage(a.as(), { type: "join_room", roomCode: "NUOVO", displayName: "Anna", clientId: "cidA" });
  assert.ok(a.find("room_joined"));
  assert.equal(a.find("room_closed"), undefined);
});

test("validazione: resume è booleano opzionale", () => {
  const ok = parseClientMessage({ type: "join_room", roomCode: "X", displayName: "A", resume: true });
  assert.ok(ok.ok && ok.msg.type === "join_room" && ok.msg.resume === true);
  const bad = parseClientMessage({ type: "join_room", roomCode: "X", displayName: "A", resume: "si" });
  assert.equal(bad.ok, false);
});
