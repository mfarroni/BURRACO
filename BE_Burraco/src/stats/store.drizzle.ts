import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { MatchSummary, Seat, UserStats } from "../contract/types.js";
import type { Pagination, StatsStore } from "./types.js";

/**
 * Implementazione Drizzle/Neon di StatsStore (attiva con `DATABASE_URL`).
 * Calcolo ON-THE-FLY (decisione A): nessuna tabella denormalizzata. Tutte le
 * query sono PARAMETRIZZATE tramite il query builder / template `sql` di Drizzle
 * (nessuna concatenazione di stringhe): l'`userId` e gli id di pagina viaggiano
 * come parametri, mai interpolati nel testo SQL.
 *
 * Nessuna colonna aggiuntiva rispetto allo schema esistente: la "fine partita" è
 * derivata best-effort come MAX(hands.ended_at) della partita.
 */
type Db = NodePgDatabase<typeof schema>;

export class DrizzleStatsStore implements StatsStore {
  constructor(private readonly db: Db) {}

  async getStats(userId: string): Promise<UserStats> {
    // Partite CONCLUSE dell'utente col suo posto e il vincitore.
    const rows = await this.db
      .select({ seat: schema.matchPlayers.seat, winnerSeat: schema.matches.winnerSeat })
      .from(schema.matchPlayers)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPlayers.matchId))
      .where(and(eq(schema.matchPlayers.userId, userId), eq(schema.matches.status, "ended")));

    const matchesPlayed = rows.length;
    let matchesWon = 0;
    for (const r of rows) {
      if (r.winnerSeat !== null && r.winnerSeat === r.seat) matchesWon += 1;
    }
    const matchesLost = matchesPlayed - matchesWon;
    const winRate = matchesPlayed === 0 ? 0 : matchesWon / matchesPlayed;

    // totalPoints: somma dei delta di mano per il posto dell'utente nelle sue
    // partite (join hand_scores → hands → match_players su match + seat).
    const [pointsRow] = await this.db
      .select({ total: sql<number>`coalesce(sum(${schema.handScores.totalDelta}), 0)` })
      .from(schema.handScores)
      .innerJoin(schema.hands, eq(schema.hands.id, schema.handScores.handId))
      .innerJoin(
        schema.matchPlayers,
        and(
          eq(schema.matchPlayers.matchId, schema.hands.matchId),
          eq(schema.matchPlayers.seat, schema.handScores.seat),
        ),
      )
      .where(eq(schema.matchPlayers.userId, userId));

    const totalPoints = Number(pointsRow?.total ?? 0);

    return { matchesPlayed, matchesWon, matchesLost, winRate, totalPoints };
  }

  async getRecentMatches(userId: string, page: Pagination): Promise<MatchSummary[]> {
    // Pagina di partite CONCLUSE dell'utente, ordinate dalla più recente
    // (MAX(hands.ended_at), poi created_at come tie-break).
    const paged = await this.db
      .select({
        matchId: schema.matches.id,
        winnerSeat: schema.matches.winnerSeat,
        seat: schema.matchPlayers.seat,
        endedAt: sql<Date | null>`max(${schema.hands.endedAt})`,
        createdAt: schema.matches.createdAt,
      })
      .from(schema.matchPlayers)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPlayers.matchId))
      .leftJoin(schema.hands, eq(schema.hands.matchId, schema.matches.id))
      .where(and(eq(schema.matchPlayers.userId, userId), eq(schema.matches.status, "ended")))
      .groupBy(
        schema.matches.id,
        schema.matches.winnerSeat,
        schema.matchPlayers.seat,
        schema.matches.createdAt,
      )
      .orderBy(sql`max(${schema.hands.endedAt}) desc nulls last`, sql`${schema.matches.createdAt} desc`)
      .limit(page.limit)
      .offset(page.offset);

    if (paged.length === 0) return [];

    const matchIds = paged.map((r) => r.matchId);

    // Nomi di tutti i posti delle partite in pagina (per l'avversario).
    const players = await this.db
      .select({
        matchId: schema.matchPlayers.matchId,
        seat: schema.matchPlayers.seat,
        displayName: schema.matchPlayers.displayName,
      })
      .from(schema.matchPlayers)
      .where(inArray(schema.matchPlayers.matchId, matchIds));

    // Somma dei punteggi per match + posto, per le partite in pagina.
    const scores = await this.db
      .select({
        matchId: schema.hands.matchId,
        seat: schema.handScores.seat,
        total: sql<number>`coalesce(sum(${schema.handScores.totalDelta}), 0)`,
      })
      .from(schema.handScores)
      .innerJoin(schema.hands, eq(schema.hands.id, schema.handScores.handId))
      .where(inArray(schema.hands.matchId, matchIds))
      .groupBy(schema.hands.matchId, schema.handScores.seat);

    const nameOf = (matchId: string, seat: Seat): string | undefined =>
      players.find((p) => p.matchId === matchId && p.seat === seat)?.displayName;
    const scoreOf = (matchId: string, seat: Seat): number =>
      Number(scores.find((s) => s.matchId === matchId && s.seat === seat)?.total ?? 0);

    return paged.map((r) => {
      const yourSeat = r.seat as Seat;
      const oppSeat = (1 - yourSeat) as Seat;
      const result: "won" | "lost" =
        r.winnerSeat !== null && r.winnerSeat === yourSeat ? "won" : "lost";
      const ended = r.endedAt ? new Date(r.endedAt).getTime() : null;
      return {
        matchId: r.matchId,
        endedAt: ended,
        result,
        opponentName: nameOf(r.matchId, oppSeat) ?? "Avversario",
        yourScore: scoreOf(r.matchId, yourSeat),
        opponentScore: scoreOf(r.matchId, oppSeat),
      };
    });
  }
}
