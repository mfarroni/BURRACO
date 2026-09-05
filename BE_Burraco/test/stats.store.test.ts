import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStatsStore } from "../src/stats/store.memory.js";
import type { Seat } from "../src/contract/types.js";

/**
 * Test unit dello StatsStore IN-MEMORY (decisione F: testabilità senza DB).
 * Copre l'aggregazione ON-THE-FLY (decisione A): played/won/lost/winRate/points,
 * utente senza partite (zeri), paginazione dello storico e derivazione esito/
 * avversario/punteggi. Nessun DB, nessun WS, nessun motore di gioco.
 */

const U1 = "user-1";
const U2 = "user-2";

/** Popola lo store con una partita 1v1 conclusa tra due utenti. */
function seedMatch(
  store: MemoryStatsStore,
  opts: {
    id: string;
    winnerSeat: Seat | null;
    seat0: { userId: string | null; name: string };
    seat1: { userId: string | null; name: string };
    /** Delta di mano per [seat0, seat1]. */
    scores: [number, number][];
    endedAt?: Date;
  },
): void {
  store.putMatch({ id: opts.id, status: "completed", winnerSeat: opts.winnerSeat, endedAt: opts.endedAt });
  store.putPlayer({ matchId: opts.id, seat: 0, displayName: opts.seat0.name, userId: opts.seat0.userId });
  store.putPlayer({ matchId: opts.id, seat: 1, displayName: opts.seat1.name, userId: opts.seat1.userId });
  for (const [d0, d1] of opts.scores) {
    store.putHandScore({ matchId: opts.id, seat: 0, totalDelta: d0 });
    store.putHandScore({ matchId: opts.id, seat: 1, totalDelta: d1 });
  }
}

test("getStats: aggrega played/won/lost/winRate/points per il posto dell'utente", async () => {
  const store = new MemoryStatsStore();
  // U1 (seat0) vince la partita A; U1 (seat1) perde la partita B.
  seedMatch(store, {
    id: "A",
    winnerSeat: 0,
    seat0: { userId: U1, name: "Uno" },
    seat1: { userId: U2, name: "Due" },
    scores: [[100, 20], [110, 30]], // U1: 210, U2: 50
    endedAt: new Date("2026-08-01T10:00:00Z"),
  });
  seedMatch(store, {
    id: "B",
    winnerSeat: 0, // seat0 vince; U1 è seat1 → perde
    seat0: { userId: U2, name: "Due" },
    seat1: { userId: U1, name: "Uno" },
    scores: [[200, 40]], // U1 (seat1): 40
    endedAt: new Date("2026-08-02T10:00:00Z"),
  });

  const s = await store.getStats(U1);
  assert.equal(s.matchesPlayed, 2);
  assert.equal(s.matchesWon, 1);
  assert.equal(s.matchesLost, 1);
  assert.equal(s.winRate, 0.5);
  // Punti U1: partita A (seat0) 210 + partita B (seat1) 40 = 250.
  assert.equal(s.totalPoints, 250);
});

test("getStats: utente senza partite → tutti zeri, winRate 0 (nessuna divisione per 0)", async () => {
  const store = new MemoryStatsStore();
  const s = await store.getStats("nessuno");
  assert.deepEqual(s, {
    matchesPlayed: 0,
    matchesWon: 0,
    matchesLost: 0,
    winRate: 0,
    totalPoints: 0,
  });
});

test("getStats: le partite non concluse (playing) sono ignorate", async () => {
  const store = new MemoryStatsStore();
  store.putMatch({ id: "P", status: "playing", winnerSeat: null });
  store.putPlayer({ matchId: "P", seat: 0, displayName: "Uno", userId: U1 });
  store.putPlayer({ matchId: "P", seat: 1, displayName: "Due", userId: U2 });
  const s = await store.getStats(U1);
  assert.equal(s.matchesPlayed, 0);
});

test("getRecentMatches: dalla più recente, con esito/avversario/punteggi corretti", async () => {
  const store = new MemoryStatsStore();
  seedMatch(store, {
    id: "A",
    winnerSeat: 0,
    seat0: { userId: U1, name: "Uno" },
    seat1: { userId: U2, name: "Avv-A" },
    scores: [[210, 50]],
    endedAt: new Date("2026-08-01T10:00:00Z"),
  });
  seedMatch(store, {
    id: "B",
    winnerSeat: 0, // U1 è seat1 → sconfitta
    seat0: { userId: U2, name: "Avv-B" },
    seat1: { userId: U1, name: "Uno" },
    scores: [[300, 40]],
    endedAt: new Date("2026-08-05T10:00:00Z"),
  });

  const list = await store.getRecentMatches(U1, { limit: 10, offset: 0 });
  assert.equal(list.length, 2);
  // La più recente (B) è prima.
  assert.equal(list[0]!.matchId, "B");
  assert.equal(list[0]!.result, "lost");
  assert.equal(list[0]!.opponentName, "Avv-B");
  assert.equal(list[0]!.yourScore, 40);
  assert.equal(list[0]!.opponentScore, 300);
  // La più vecchia (A).
  assert.equal(list[1]!.matchId, "A");
  assert.equal(list[1]!.result, "won");
  assert.equal(list[1]!.opponentName, "Avv-A");
  assert.equal(list[1]!.yourScore, 210);
  assert.equal(list[1]!.opponentScore, 50);
});

test("getRecentMatches: paginazione (limit/offset)", async () => {
  const store = new MemoryStatsStore();
  for (let i = 0; i < 5; i++) {
    seedMatch(store, {
      id: `M${i}`,
      winnerSeat: 0,
      seat0: { userId: U1, name: "Uno" },
      seat1: { userId: U2, name: `Avv${i}` },
      scores: [[10 * i, 0]],
      endedAt: new Date(2026, 7, i + 1),
    });
  }
  const page1 = await store.getRecentMatches(U1, { limit: 2, offset: 0 });
  const page2 = await store.getRecentMatches(U1, { limit: 2, offset: 2 });
  assert.equal(page1.length, 2);
  assert.equal(page2.length, 2);
  // Ordine decrescente per data: M4, M3 | M2, M1.
  assert.equal(page1[0]!.matchId, "M4");
  assert.equal(page1[1]!.matchId, "M3");
  assert.equal(page2[0]!.matchId, "M2");
  assert.equal(page2[1]!.matchId, "M1");
  // Nessuna sovrapposizione tra le pagine.
  const ids = new Set([...page1, ...page2].map((m) => m.matchId));
  assert.equal(ids.size, 4);
});

test("getRecentMatches: utente senza partite → lista vuota", async () => {
  const store = new MemoryStatsStore();
  const list = await store.getRecentMatches("nessuno", { limit: 10, offset: 0 });
  assert.deepEqual(list, []);
});
