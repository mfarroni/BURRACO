import type { MatchSummary, Seat, UserStats } from "../contract/types.js";
import type { Pagination, StatsStore } from "./types.js";

/**
 * Implementazione IN-MEMORY di StatsStore (decisione F: testabilità senza DB).
 * Attiva quando `DATABASE_URL` è assente. Aggrega da record match/partecipazioni/
 * punteggi tenuti in RAM, gli stessi che in produzione vivono su Neon. In v1
 * senza DB il gioco non popola questi record (la persistenza è no-op): le
 * statistiche risultano a zero finché non c'è un DB. I test popolano i record
 * direttamente tramite i metodi di ingest sottostanti.
 *
 * Le aggregazioni riproducono FEDELMENTE la semantica delle query Drizzle:
 *  - partite CONCLUSE (`status='ended'`);
 *  - vinta = il posto dell'utente == `winnerSeat`;
 *  - totalPoints = somma dei `totalDelta` per il posto dell'utente nelle sue partite.
 */

interface MatchRec {
  id: string;
  status: "playing" | "ended";
  winnerSeat: Seat | null;
  createdAt: Date;
  /** Best-effort: ultima mano conclusa (fine partita). */
  endedAt: Date | null;
}
interface PlayerRec {
  matchId: string;
  seat: Seat;
  displayName: string;
  userId: string | null;
}
interface HandScoreRec {
  matchId: string;
  seat: Seat;
  totalDelta: number;
}

export class MemoryStatsStore implements StatsStore {
  private matches = new Map<string, MatchRec>();
  private players: PlayerRec[] = [];
  private handScores: HandScoreRec[] = [];

  /* ───────────────────────────── INGEST (test/seed) ───────────────────────── */

  /** Registra/aggiorna una partita. */
  putMatch(rec: {
    id: string;
    status: "playing" | "ended";
    winnerSeat?: Seat | null;
    createdAt?: Date;
    endedAt?: Date | null;
  }): void {
    this.matches.set(rec.id, {
      id: rec.id,
      status: rec.status,
      winnerSeat: rec.winnerSeat ?? null,
      createdAt: rec.createdAt ?? new Date(),
      endedAt: rec.endedAt ?? null,
    });
  }

  /** Registra la partecipazione (posto) di un utente a una partita. */
  putPlayer(rec: { matchId: string; seat: Seat; displayName: string; userId: string | null }): void {
    this.players.push({ ...rec });
  }

  /** Registra il punteggio di una mano per un posto (delta della smazzata). */
  putHandScore(rec: { matchId: string; seat: Seat; totalDelta: number }): void {
    this.handScores.push({ ...rec });
  }

  /* ─────────────────────────────── LETTURA ────────────────────────────────── */

  async getStats(userId: string): Promise<UserStats> {
    // Partite CONCLUSE cui l'utente ha partecipato, con il suo posto.
    const participations = this.players
      .filter((p) => p.userId === userId)
      .map((p) => ({ player: p, match: this.matches.get(p.matchId) }))
      .filter((x): x is { player: PlayerRec; match: MatchRec } => !!x.match && x.match.status === "ended");

    const matchesPlayed = participations.length;
    let matchesWon = 0;
    for (const { player, match } of participations) {
      if (match.winnerSeat !== null && match.winnerSeat === player.seat) matchesWon += 1;
    }
    const matchesLost = matchesPlayed - matchesWon;
    const winRate = matchesPlayed === 0 ? 0 : matchesWon / matchesPlayed;

    // totalPoints: somma dei delta di mano per il posto dell'utente nelle SUE partite
    // (join hand_scores → match_players per seat + match).
    const seatByMatch = new Map<string, Seat>();
    for (const p of this.players) {
      if (p.userId === userId) seatByMatch.set(p.matchId, p.seat);
    }
    let totalPoints = 0;
    for (const hs of this.handScores) {
      const seat = seatByMatch.get(hs.matchId);
      if (seat !== undefined && seat === hs.seat) totalPoints += hs.totalDelta;
    }

    return { matchesPlayed, matchesWon, matchesLost, winRate, totalPoints };
  }

  async getRecentMatches(userId: string, page: Pagination): Promise<MatchSummary[]> {
    const participations = this.players
      .filter((p) => p.userId === userId)
      .map((p) => ({ player: p, match: this.matches.get(p.matchId) }))
      .filter((x): x is { player: PlayerRec; match: MatchRec } => !!x.match && x.match.status === "ended");

    // Ordina dalla più recente (endedAt, poi createdAt come tie-break).
    participations.sort((a, b) => {
      const ta = (a.match.endedAt ?? a.match.createdAt).getTime();
      const tb = (b.match.endedAt ?? b.match.createdAt).getTime();
      return tb - ta;
    });

    const pageItems = participations.slice(page.offset, page.offset + page.limit);

    return pageItems.map(({ player, match }) => {
      const yourSeat = player.seat;
      const oppSeat = (1 - yourSeat) as Seat;
      const opp = this.players.find((p) => p.matchId === match.id && p.seat === oppSeat);
      const yourScore = this.sumScore(match.id, yourSeat);
      const opponentScore = this.sumScore(match.id, oppSeat);
      const result: "won" | "lost" =
        match.winnerSeat !== null && match.winnerSeat === yourSeat ? "won" : "lost";
      return {
        matchId: match.id,
        endedAt: match.endedAt ? match.endedAt.getTime() : null,
        result,
        opponentName: opp?.displayName ?? "Avversario",
        yourScore,
        opponentScore,
      };
    });
  }

  private sumScore(matchId: string, seat: Seat): number {
    let total = 0;
    for (const hs of this.handScores) {
      if (hs.matchId === matchId && hs.seat === seat) total += hs.totalDelta;
    }
    return total;
  }
}
