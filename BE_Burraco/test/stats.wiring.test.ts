import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../src/room/Room.js";
import { defaultGameConfig } from "../src/config.js";
import { persistence } from "../src/db/persistence.js";
import type { Seat } from "../src/contract/types.js";

/**
 * Test di WIRING (macro-ciclo 3): quando la partita si avvia, il posto di ciascun
 * giocatore porta il suo `userId` (identità risolta dall'authToken) fino a
 * persistence.addPlayers, che lo scrive in match_players.user_id. Il meccanismo
 * del POSTO (playerToken/clientId, SEC-04/10/11) resta invariato.
 *
 * Si intercetta persistence.addPlayers (no-op senza DATABASE_URL) per catturarne
 * l'argomento, senza toccare rete né DB.
 */

/** Socket finto: espone solo ciò che la Room usa (readyState OPEN=1 + send). */
function fakeWs() {
  return { readyState: 1, send() {} } as unknown as import("ws").WebSocket;
}

test("startMatch propaga userId a addPlayers per entrambi i posti", async () => {
  const original = persistence.addPlayers;
  let captured: { seat: Seat; displayName: string; tokenHash: string; userId?: string | null }[] | null =
    null;
  persistence.addPlayers = async (_matchId, players) => {
    captured = players;
  };

  try {
    const room = new Room("WIRING", defaultGameConfig());
    // Due ingressi autenticati: la partita parte quando entrambi i posti sono vivi.
    room.join(fakeWs(), undefined, "Alice", "client-a", "user-alice");
    room.join(fakeWs(), undefined, "Bob", "client-b", "user-bob");

    assert.ok(captured, "addPlayers deve essere stato chiamato all'avvio partita");
    const players = captured!;
    assert.equal(players.length, 2);
    const bySeat = new Map(players.map((p) => [p.seat, p]));
    assert.equal(bySeat.get(0 as Seat)?.userId, "user-alice");
    assert.equal(bySeat.get(1 as Seat)?.userId, "user-bob");
  } finally {
    persistence.addPlayers = original;
  }
});

test("startMatch: userId null quando il giocatore non ha principale (dev/ospite non risolto)", async () => {
  const original = persistence.addPlayers;
  let captured: { seat: Seat; userId?: string | null }[] | null = null;
  persistence.addPlayers = async (_matchId, players) => {
    captured = players;
  };

  try {
    const room = new Room("WIRING2", defaultGameConfig());
    room.join(fakeWs(), undefined, "Anon1", "client-1"); // nessun userId
    room.join(fakeWs(), undefined, "Anon2", "client-2");

    assert.ok(captured);
    const players = captured!;
    assert.equal(players[0]!.userId ?? null, null);
    assert.equal(players[1]!.userId ?? null, null);
  } finally {
    persistence.addPlayers = original;
  }
});
