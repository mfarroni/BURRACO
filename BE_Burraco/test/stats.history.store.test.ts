import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStatsStore } from "../src/stats/store.memory.js";
import type { Seat } from "../src/contract/types.js";

/**
 * Test dello StatsStore IN-MEMORY per il DELTA "storico + analisi" (macro-ciclo
 * storico). Copre: contatori nuovi (abbandonate, punteggio medio), blocco analisi
 * con soglie/sampleSize (§5 caso 12), burrachi separati e pozzetto in diretta
 * aggregati (§5 casi 8/11), coerenza somma smazzate = punteggio finale (§5 casi
 * 7/10), dettaglio + autorizzazione per partecipazione (§5 S1), opponentIsGuest e
 * dealsCount, ordinamento per ended_at, filtro periodo. Nessun DB.
 */

const U1 = "user-1";
const U2 = "user-2";

interface DealSpec {
  handNumber: number;
  closerSeat?: Seat | null;
  you: {
    totalDelta: number;
    ptsPenaltyHand?: number;
    ptsPozzetto?: number;
    burrachiPuliti?: number;
    burrachiSporchi?: number;
    pozzettoInDiretta?: boolean;
  };
  opp?: { totalDelta: number; ptsPozzetto?: number };
}

/** Seed di una partita completed con U1 a seat 0 e U2 a seat 1, e N smazzate. */
function seedMatch(
  store: MemoryStatsStore,
  opts: {
    id: string;
    winnerSeat: Seat | null;
    deals: DealSpec[];
    endedAt?: Date;
    oppName?: string;
    oppIsGuest?: boolean;
    status?: "completed" | "abandoned" | "aborted";
  },
): void {
  store.putMatch({
    id: opts.id,
    status: opts.status ?? "completed",
    winnerSeat: opts.winnerSeat,
    endedAt: opts.endedAt,
    targetScore: 2005,
  });
  store.putPlayer({ matchId: opts.id, seat: 0, displayName: "Uno", userId: U1 });
  store.putPlayer({
    matchId: opts.id,
    seat: 1,
    displayName: opts.oppName ?? "Due",
    userId: U2,
    isGuest: opts.oppIsGuest ?? false,
  });
  for (const d of opts.deals) {
    store.putDeal({
      matchId: opts.id,
      handNumber: d.handNumber,
      closerSeat: d.closerSeat ?? null,
      endedAt: opts.endedAt,
      sides: [
        {
          seat: 0,
          totalDelta: d.you.totalDelta,
          ptsPenaltyHand: d.you.ptsPenaltyHand ?? 0,
          ptsPozzetto: d.you.ptsPozzetto ?? 0,
          burrachiPuliti: d.you.burrachiPuliti ?? 0,
          burrachiSporchi: d.you.burrachiSporchi ?? 0,
          pozzettoInDiretta: d.you.pozzettoInDiretta ?? false,
        },
        {
          seat: 1,
          totalDelta: d.opp?.totalDelta ?? 0,
          ptsPozzetto: d.opp?.ptsPozzetto ?? 0,
        },
      ],
    });
  }
}

/** 10 smazzate calibrate per superare le soglie con numeri esatti. */
function tenDeals(): DealSpec[] {
  const deals: DealSpec[] = [];
  for (let i = 1; i <= 10; i++) {
    deals.push({
      handNumber: i,
      // Chiusure: smazzate 1-3 chiuse da U1 (seat 0) → 3/10.
      closerSeat: i <= 3 ? 0 : 1,
      you: {
        totalDelta: 50,
        ptsPenaltyHand: -10,
        // Pozzetto: 1-8 preso (0 pts); 9-10 malus (-100).
        ptsPozzetto: i <= 8 ? 0 : -100,
        // In diretta: 4 fra gli 8 presi.
        pozzettoInDiretta: i <= 4,
        // Burrachi puliti su 1-5 (5 totali); sporchi su 1-2 (2 totali).
        burrachiPuliti: i <= 5 ? 1 : 0,
        burrachiSporchi: i <= 2 ? 1 : 0,
      },
      opp: { totalDelta: 10, ptsPozzetto: 0 },
    });
  }
  return deals;
}

test("analisi: sopra soglia calcola le metriche con numeri esatti (casi 8/11)", async () => {
  const store = new MemoryStatsStore();
  seedMatch(store, { id: "M10", winnerSeat: 0, deals: tenDeals(), endedAt: new Date("2026-08-10") });

  const s = await store.getStats(U1);
  assert.equal(s.matchesPlayed, 1);
  assert.equal(s.totalPoints, 500);
  assert.equal(s.avgFinalScore, 500);

  const a = s.analysis;
  assert.equal(a.dealsPlayed, 10);
  assert.equal(a.burrachiPulitiPerDeal.value, 0.5); // 5/10
  assert.equal(a.burrachiSporchiPerDeal.value, 0.2); // 2/10
  assert.equal(a.cleanDirtyRatio.value, 2.5); // 5/2
  assert.equal(a.pozzettoRate.value, 0.8); // 8/10
  assert.equal(a.pozzettoInDirettaShare.value, 0.5); // 4/8
  assert.equal(a.pozzettoInDirettaShare.sampleSize, 8);
  assert.equal(a.closureRate.value, 0.3); // 3/10
  assert.equal(a.avgHandPenalty.value, -10);
  assert.equal(a.avgPointsPerDeal.value, 50);
  assert.equal(a.malusPozzettoCount, 2); // smazzate 9-10
});

test("analisi: SOTTO soglia → value null con sampleSize (caso 12)", async () => {
  const store = new MemoryStatsStore();
  // 3 sole smazzate: sotto la soglia di 10 per le metriche per-smazzata.
  seedMatch(store, {
    id: "M3",
    winnerSeat: 0,
    endedAt: new Date("2026-08-01"),
    deals: [
      { handNumber: 1, closerSeat: 0, you: { totalDelta: 40, ptsPozzetto: 0, burrachiPuliti: 1 } },
      { handNumber: 2, closerSeat: 1, you: { totalDelta: 20, ptsPozzetto: -100 } },
      { handNumber: 3, closerSeat: 1, you: { totalDelta: 30, ptsPozzetto: 0 } },
    ],
  });

  const a = (await store.getStats(U1)).analysis;
  assert.equal(a.dealsPlayed, 3);
  assert.equal(a.burrachiPulitiPerDeal.value, null, "valore non esposto sotto soglia");
  assert.equal(a.burrachiPulitiPerDeal.sampleSize, 3);
  assert.equal(a.burrachiPulitiPerDeal.threshold, 10);
  // malusPozzettoCount è un conteggio (nessuna soglia): resta valorizzato.
  assert.equal(a.malusPozzettoCount, 1);
  // pozzettoInDirettaShare: denominatore = pozzetti presi (2 < soglia 5) → null.
  assert.equal(a.pozzettoInDirettaShare.value, null);
  assert.equal(a.pozzettoInDirettaShare.sampleSize, 2);
});

test("coerenza: somma delle smazzate == punteggio finale (casi 7/10)", async () => {
  const store = new MemoryStatsStore();
  seedMatch(store, { id: "MC", winnerSeat: 0, deals: tenDeals(), endedAt: new Date("2026-08-10") });

  const detail = await store.getMatchDetail(U1, "MC");
  assert.ok(detail);
  const sumYou = detail!.deals.reduce((acc, d) => acc + d.you.puntiSmazzata, 0);
  assert.equal(sumYou, detail!.finalScore.you);
  assert.equal(detail!.finalScore.you, 500);
  assert.equal(detail!.deals.length, 10);

  const list = await store.getRecentMatches(U1, { limit: 10, offset: 0 });
  const row = list.find((m) => m.matchId === "MC")!;
  assert.equal(row.yourScore, 500);
  assert.equal(row.dealsCount, 10, "il conteggio smazzate quadra col numero di smazzate");
});

test("dettaglio: campi di una smazzata (pozzetto/burrachi/chiusura/malus)", async () => {
  const store = new MemoryStatsStore();
  seedMatch(store, {
    id: "MD",
    winnerSeat: 0,
    endedAt: new Date("2026-08-11"),
    deals: [
      {
        handNumber: 1,
        closerSeat: 0,
        you: { totalDelta: 320, ptsPenaltyHand: -40, ptsPozzetto: 0, burrachiPuliti: 1, pozzettoInDiretta: false },
        opp: { totalDelta: 80, ptsPozzetto: -100 },
      },
    ],
  });
  const d = await store.getMatchDetail(U1, "MD");
  assert.ok(d);
  const deal = d!.deals[0]!;
  assert.equal(deal.numeroSmazzata, 1);
  assert.equal(deal.closerSeat, 0);
  assert.equal(deal.you.puntiSmazzata, 320);
  assert.equal(deal.you.puntiCarteInMano, -40);
  assert.equal(deal.you.burrachiPuliti, 1);
  assert.equal(deal.you.pozzettoPreso, true);
  assert.equal(deal.you.pozzettoInDiretta, false);
  assert.equal(deal.you.haChiuso, true);
  assert.equal(deal.you.malusPozzetto, false);
  // Lato avversario: malus subìto.
  assert.equal(deal.opponent.pozzettoPreso, false);
  assert.equal(deal.opponent.malusPozzetto, true);
  assert.equal(deal.opponent.haChiuso, false);
});

test("dettaglio: NON partecipante → null (l'HTTP mapperà a 404, mai 403)", async () => {
  const store = new MemoryStatsStore();
  seedMatch(store, { id: "MX", winnerSeat: 0, deals: tenDeals(), endedAt: new Date() });
  // U2 partecipa (seat 1) → ottiene il dettaglio; un estraneo no.
  assert.ok(await store.getMatchDetail(U2, "MX"));
  assert.equal(await store.getMatchDetail("estraneo", "MX"), null);
  // Partita inesistente → null.
  assert.equal(await store.getMatchDetail(U1, "non-esiste"), null);
});

test("storico: opponentIsGuest e ordinamento per ended_at", async () => {
  const store = new MemoryStatsStore();
  seedMatch(store, {
    id: "OLD",
    winnerSeat: 0,
    deals: [{ handNumber: 1, closerSeat: 0, you: { totalDelta: 30 }, opp: { totalDelta: 5 } }],
    endedAt: new Date("2026-01-01"),
    oppName: "Marco",
    oppIsGuest: true,
  });
  seedMatch(store, {
    id: "NEW",
    winnerSeat: 1,
    deals: [{ handNumber: 1, closerSeat: 1, you: { totalDelta: 10 }, opp: { totalDelta: 40 } }],
    endedAt: new Date("2026-09-01"),
    oppName: "Lucia",
    oppIsGuest: false,
  });

  const list = await store.getRecentMatches(U1, { limit: 10, offset: 0 });
  assert.equal(list[0]!.matchId, "NEW", "più recente per ended_at prima");
  assert.equal(list[1]!.matchId, "OLD");
  const old = list.find((m) => m.matchId === "OLD")!;
  assert.equal(old.opponentName, "Marco");
  assert.equal(old.opponentIsGuest, true);
  const neu = list.find((m) => m.matchId === "NEW")!;
  assert.equal(neu.opponentIsGuest, false);
});

test("contatori: abbandonate NON contano come sconfitte (caso 3)", async () => {
  const store = new MemoryStatsStore();
  seedMatch(store, {
    id: "WON",
    winnerSeat: 0,
    deals: [{ handNumber: 1, you: { totalDelta: 100 } }],
    endedAt: new Date("2026-08-01"),
  });
  seedMatch(store, {
    id: "ABBANDONATA",
    winnerSeat: null,
    status: "abandoned",
    deals: [],
    endedAt: new Date("2026-08-02"),
  });
  const s = await store.getStats(U1);
  assert.equal(s.matchesPlayed, 1, "solo la completed conta come giocata");
  assert.equal(s.matchesWon, 1);
  assert.equal(s.matchesLost, 0, "l'abbandonata NON è una sconfitta");
  assert.equal(s.matchesAbandoned, 1);
});

test("periodo: 30d esclude le partite più vecchie", async () => {
  const store = new MemoryStatsStore();
  const now = Date.now();
  const recente = new Date(now - 5 * 24 * 3600 * 1000);
  const vecchia = new Date(now - 60 * 24 * 3600 * 1000);
  seedMatch(store, { id: "R", winnerSeat: 0, deals: [{ handNumber: 1, you: { totalDelta: 20 } }], endedAt: recente });
  seedMatch(store, { id: "V", winnerSeat: 0, deals: [{ handNumber: 1, you: { totalDelta: 20 } }], endedAt: vecchia });

  const all = await store.getStats(U1, "all");
  assert.equal(all.matchesPlayed, 2);
  assert.equal(all.periodo, "all");
  const last30 = await store.getStats(U1, "30d");
  assert.equal(last30.matchesPlayed, 1, "solo la recente rientra nei 30 giorni");
  assert.equal(last30.periodo, "30d");
});
