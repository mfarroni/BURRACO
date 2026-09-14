import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStatsStore } from "../src/stats/store.memory.js";
import type { Seat, TeamId } from "../src/contract/types.js";

/**
 * ITEM 2 — AGGREGAZIONE STATISTICHE DI COPPIA (2v2) nello StatsStore in-memory.
 *
 * Verifica il DELTA rispetto alla logica per-posto, SENZA cambiare la forma dei DTO
 * (MatchSummary/MatchDeal/MatchDetail restano com'erano: `opponentName: string`,
 * `you`/`opponent` singoli; cambia solo COSA ci mettiamo dentro):
 *  - VINTA per `winner_team` (non `winner_seat`): il partner può aver chiuso, ma
 *    vince la COPPIA. Con `winnerSeat` che punta al COMPAGNO, la vecchia logica
 *    per-posto avrebbe detto "persa"; la nuova dice "vinta".
 *  - `you` = aggregato della PROPRIA coppia (somma dei due posti); `opponent` =
 *    aggregato della coppia avversaria; `opponentName` = i due nomi ("Bea e Dan").
 *  - i fatti di coppia (burrachi/pozzetto/chiusura) NON si duplicano fra i due posti.
 *
 * Layout tavolo 2v2: posti 0..3; coppie per posto opposto → team = seat % 2.
 *  - squadra 0 = posti 0 (Ada) + 2 (Cid);  squadra 1 = posti 1 (Bea) + 3 (Dan).
 */

const A = "user-ada"; // seat 0, squadra 0
const B = "user-bea"; // seat 1, squadra 1
const C = "user-cid"; // seat 2, squadra 0
const D = "user-dan"; // seat 3, squadra 1

const MATCH = "M2v2";

/**
 * Semina UNA partita 2v2 completed con una sola smazzata. La squadra 0 VINCE, e a
 * chiudere materialmente è il COMPAGNO (posto 2), non il posto canonico (0): così il
 * test distingue `winner_team` da `winner_seat`.
 *
 * Attribuzione (spec §5): i fatti di coppia stanno sulla riga CANONICA (posto minore),
 * l'altra riga porta solo la penalità di mano. Totali di coppia (somma delle 2 righe):
 *  - squadra 0: seat0 280 (canonica) + seat2 0 = 280
 *  - squadra 1: seat1 60 (canonica) + seat3 -50 = 10
 */
function seed2v2(store: MemoryStatsStore): void {
  store.putMatch({
    id: MATCH,
    status: "completed",
    // Il posto che ha materialmente chiuso è il 2 (compagno di 0). La squadra
    // vincitrice è la 0. Con la vecchia logica `winner_seat === seat`, il posto 0
    // NON avrebbe visto "vinta": è il caso che prova il passaggio a winner_team.
    winnerSeat: 2 as Seat,
    winnerTeam: 0 as TeamId,
    endedAt: new Date("2026-09-01T10:00:00Z"),
    targetScore: 2005,
  });
  store.putPlayer({ matchId: MATCH, seat: 0, team: 0, displayName: "Ada", userId: A });
  store.putPlayer({ matchId: MATCH, seat: 1, team: 1, displayName: "Bea", userId: B, isGuest: true });
  store.putPlayer({ matchId: MATCH, seat: 2, team: 0, displayName: "Cid", userId: C });
  store.putPlayer({ matchId: MATCH, seat: 3, team: 1, displayName: "Dan", userId: D });
  store.putDeal({
    matchId: MATCH,
    handNumber: 1,
    closerSeat: 2, // il compagno di squadra 0 chiude
    endedAt: new Date("2026-09-01T10:00:00Z"),
    sides: [
      // Squadra 0, posto canonico: giochi/burrachi/pozzetto della coppia + penalità.
      { seat: 0, totalDelta: 280, ptsPenaltyHand: -20, ptsPozzetto: 0, burrachiPuliti: 1, pozzettoInDiretta: true },
      // Squadra 1, posto canonico: NON ha preso il pozzetto (malus -100).
      { seat: 1, totalDelta: 60, ptsPenaltyHand: -40, ptsPozzetto: -100 },
      // Squadra 0, compagno (ha chiuso): solo la sua riga, niente fatti di coppia.
      { seat: 2, totalDelta: 0, ptsPenaltyHand: 0, ptsPozzetto: 0 },
      // Squadra 1, compagno: solo penalità di mano.
      { seat: 3, totalDelta: -50, ptsPenaltyHand: -50, ptsPozzetto: 0 },
    ],
  });
}

test("2v2 getStats: VINTA per winner_team anche se a chiudere è il COMPAGNO (winner_seat ≠ mio posto)", async () => {
  const store = new MemoryStatsStore();
  seed2v2(store);

  // Ada (posto 0, squadra 0 vincente): vinta, benché winner_seat = 2 (il compagno).
  const sa = await store.getStats(A);
  assert.equal(sa.matchesPlayed, 1);
  assert.equal(sa.matchesWon, 1, "vinta per squadra, non per posto (winner_seat=2 ≠ 0)");
  assert.equal(sa.matchesLost, 0);

  // Cid (posto 2, stessa squadra): anche lui ha vinto.
  const sc = await store.getStats(C);
  assert.equal(sc.matchesWon, 1);

  // Bea (posto 1, squadra 1 perdente): persa.
  const sb = await store.getStats(B);
  assert.equal(sb.matchesWon, 0);
  assert.equal(sb.matchesLost, 1);
});

test("2v2 getRecentMatches: you/opponent AGGREGATI per coppia, opponentName coi due nomi", async () => {
  const store = new MemoryStatsStore();
  seed2v2(store);

  const [rowA] = await store.getRecentMatches(A, { limit: 10, offset: 0 });
  assert.ok(rowA);
  assert.equal(rowA!.result, "won");
  assert.equal(rowA!.opponentName, "Bea e Dan", "coppia avversaria: i due nomi in ordine di posto");
  assert.equal(rowA!.opponentIsGuest, true, "rappresentante avversario (posto 1, Bea) è ospite");
  assert.equal(rowA!.yourScore, 280, "somma della propria coppia (280 + 0)");
  assert.equal(rowA!.opponentScore, 10, "somma della coppia avversaria (60 - 50)");
  assert.equal(rowA!.dealsCount, 1, "una smazzata (righe del PROPRIO posto, non della coppia)");

  // Prospettiva avversaria: i lati si invertono, il nome è la coppia 0.
  const [rowB] = await store.getRecentMatches(B, { limit: 10, offset: 0 });
  assert.equal(rowB!.result, "lost");
  assert.equal(rowB!.opponentName, "Ada e Cid");
  assert.equal(rowB!.yourScore, 10);
  assert.equal(rowB!.opponentScore, 280);
});

test("2v2 getMatchDetail: lato coppia aggregato (chiusura del compagno, malus avversario, no doppio conteggio)", async () => {
  const store = new MemoryStatsStore();
  seed2v2(store);

  const detail = await store.getMatchDetail(A, MATCH);
  assert.ok(detail);
  assert.equal(detail!.result, "won");
  assert.equal(detail!.opponent.name, "Bea e Dan");
  assert.equal(detail!.opponent.isGuest, true);
  assert.equal(detail!.finalScore.you, 280);
  assert.equal(detail!.finalScore.opponent, 10);
  assert.equal(detail!.deals.length, 1);

  const you = detail!.deals[0]!.you;
  assert.equal(you.puntiSmazzata, 280, "totale di coppia della smazzata (280 + 0)");
  assert.equal(you.puntiCarteInMano, -20, "penalità di mano di ENTRAMBI i compagni (-20 + 0)");
  assert.equal(you.burrachiPuliti, 1, "burraco della coppia contato UNA volta (solo la riga canonica)");
  assert.equal(you.pozzettoPreso, true, "la coppia ha preso il pozzetto (nessuna riga in malus)");
  assert.equal(you.pozzettoInDiretta, true);
  assert.equal(you.haChiuso, true, "ha chiuso il COMPAGNO (posto 2 ∈ coppia)");
  assert.equal(you.malusPozzetto, false);

  const opp = detail!.deals[0]!.opponent;
  assert.equal(opp.puntiSmazzata, 10);
  assert.equal(opp.puntiCarteInMano, -90, "penalità dei due avversari (-40 - 50)");
  assert.equal(opp.pozzettoPreso, false);
  assert.equal(opp.malusPozzetto, true, "la coppia avversaria ha subìto il malus del pozzetto");
  assert.equal(opp.haChiuso, false);

  // Autorizzazione: anche il compagno vede il dettaglio; un estraneo no.
  assert.ok(await store.getMatchDetail(C, MATCH));
  assert.equal(await store.getMatchDetail("estraneo", MATCH), null);
});
