import { and, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type {
  MatchDeal,
  MatchDealSide,
  MatchDetail,
  MatchStatus,
  MatchSummary,
  Seat,
  StatsPeriod,
  UserStats,
} from "../contract/types.js";
import type { Pagination, StatsStore } from "./types.js";
import { buildAnalysis, emptyAnalysis, periodStartMs, type RawAggregate } from "./analysis.js";

/**
 * Implementazione Drizzle/Neon di StatsStore (attiva con `DATABASE_URL`).
 * Calcolo ON-THE-FLY (decisione A): nessuna tabella denormalizzata. Tutte le
 * query sono PARAMETRIZZATE tramite il query builder / template `sql` di Drizzle
 * (nessuna concatenazione di stringhe): l'`userId`, gli id di pagina e il confine
 * di periodo viaggiano come parametri, mai interpolati nel testo SQL.
 *
 * Il blocco analisi e le soglie sono condivisi con lo store in-memory via
 * `analysis.ts`: le due implementazioni restano numericamente identiche.
 */
type Db = NodePgDatabase<typeof schema>;

const num = (v: unknown): number => Number(v ?? 0);

export class DrizzleStatsStore implements StatsStore {
  constructor(private readonly db: Db) {}

  async getStats(userId: string, periodo: StatsPeriod = "all"): Promise<UserStats> {
    const fromMs = periodStartMs(periodo);
    const fromDate = fromMs === null ? null : new Date(fromMs);
    const periodConds = (): SQL[] =>
      fromDate ? [gte(schema.matches.endedAt, fromDate)] : [];

    // Partite CONCLUSE dell'utente col suo posto e il vincitore (per played/won/lost).
    const rows = await this.db
      .select({ seat: schema.matchPlayers.seat, winnerSeat: schema.matches.winnerSeat })
      .from(schema.matchPlayers)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPlayers.matchId))
      .where(
        and(
          eq(schema.matchPlayers.userId, userId),
          eq(schema.matches.status, "completed"),
          ...periodConds(),
        ),
      );

    const matchesPlayed = rows.length;
    let matchesWon = 0;
    for (const r of rows) {
      if (r.winnerSeat !== null && r.winnerSeat === r.seat) matchesWon += 1;
    }
    const matchesLost = matchesPlayed - matchesWon;
    const winRate = matchesPlayed === 0 ? 0 : matchesWon / matchesPlayed;

    // Partite ABBANDONATE (status='abandoned'): non pesano su vinte/perse.
    const [abandonedRow] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.matchPlayers)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPlayers.matchId))
      .where(
        and(
          eq(schema.matchPlayers.userId, userId),
          eq(schema.matches.status, "abandoned"),
          ...periodConds(),
        ),
      );
    const matchesAbandoned = num(abandonedRow?.n);

    // Aggregati d'analisi (smazzate del SOLO posto dell'utente, completed, periodo).
    const hs = schema.handScores;
    const dealsWhere = and(
      eq(schema.matchPlayers.userId, userId),
      eq(schema.matches.status, "completed"),
      ...periodConds(),
    );
    const [aggRow] = await this.db
      .select({
        dealsPlayed: sql<number>`count(*)`,
        sumPuliti: sql<number>`coalesce(sum(${hs.burrachiPuliti}), 0)`,
        sumSporchi: sql<number>`coalesce(sum(${hs.burrachiSporchi}), 0)`,
        pozzettiPresi: sql<number>`coalesce(sum(case when ${hs.ptsPozzetto} = 0 then 1 else 0 end), 0)`,
        pozzettiDiretta: sql<number>`coalesce(sum(case when ${hs.pozzettoInDiretta} then 1 else 0 end), 0)`,
        closures: sql<number>`coalesce(sum(case when ${schema.hands.closerSeat} = ${hs.seat} then 1 else 0 end), 0)`,
        sumPenalty: sql<number>`coalesce(sum(${hs.ptsPenaltyHand}), 0)`,
        sumDelta: sql<number>`coalesce(sum(${hs.totalDelta}), 0)`,
        malusCount: sql<number>`coalesce(sum(case when ${hs.ptsPozzetto} = -100 then 1 else 0 end), 0)`,
      })
      .from(hs)
      .innerJoin(schema.hands, eq(schema.hands.id, hs.handId))
      .innerJoin(
        schema.matchPlayers,
        and(
          eq(schema.matchPlayers.matchId, schema.hands.matchId),
          eq(schema.matchPlayers.seat, hs.seat),
        ),
      )
      .innerJoin(schema.matches, eq(schema.matches.id, schema.hands.matchId))
      .where(dealsWhere);

    const agg: RawAggregate = {
      dealsPlayed: num(aggRow?.dealsPlayed),
      sumPuliti: num(aggRow?.sumPuliti),
      sumSporchi: num(aggRow?.sumSporchi),
      pozzettiPresi: num(aggRow?.pozzettiPresi),
      pozzettiDiretta: num(aggRow?.pozzettiDiretta),
      closures: num(aggRow?.closures),
      sumPenalty: num(aggRow?.sumPenalty),
      sumDelta: num(aggRow?.sumDelta),
      malusCount: num(aggRow?.malusCount),
    };
    const totalPoints = agg.sumDelta;

    // Per-partita: totale (avgFinalScore) e media per smazzata (trend), ordinati per fine.
    const perMatch = await this.db
      .select({
        matchId: schema.hands.matchId,
        endedAt: schema.matches.endedAt,
        matchTotal: sql<number>`coalesce(sum(${hs.totalDelta}), 0)`,
        avgDelta: sql<number>`coalesce(avg(${hs.totalDelta}), 0)`,
      })
      .from(hs)
      .innerJoin(schema.hands, eq(schema.hands.id, hs.handId))
      .innerJoin(
        schema.matchPlayers,
        and(
          eq(schema.matchPlayers.matchId, schema.hands.matchId),
          eq(schema.matchPlayers.seat, hs.seat),
        ),
      )
      .innerJoin(schema.matches, eq(schema.matches.id, schema.hands.matchId))
      .where(dealsWhere)
      .groupBy(schema.hands.matchId, schema.matches.endedAt)
      .orderBy(sql`${schema.matches.endedAt} desc nulls last`);

    const avgFinalScore =
      perMatch.length === 0
        ? null
        : perMatch.reduce((a, r) => a + num(r.matchTotal), 0) / perMatch.length;

    // Trend: ultime 20 partite, poi in ordine cronologico ascendente.
    const trendPoints = perMatch
      .slice(0, 20)
      .reverse()
      .map((r) => Math.round(num(r.avgDelta)));

    const analysis = matchesPlayed === 0 ? emptyAnalysis() : buildAnalysis(agg, trendPoints);

    return {
      matchesPlayed,
      matchesWon,
      matchesLost,
      matchesAbandoned,
      winRate,
      totalPoints,
      avgFinalScore,
      analysis,
      periodo,
    };
  }

  async getRecentMatches(userId: string, page: Pagination): Promise<MatchSummary[]> {
    // Pagina di partite CONCLUSE dell'utente, ordinate per matches.ended_at
    // (già valorizzato da completeMatch), poi created_at come tie-break.
    const paged = await this.db
      .select({
        matchId: schema.matches.id,
        winnerSeat: schema.matches.winnerSeat,
        seat: schema.matchPlayers.seat,
        endedAt: schema.matches.endedAt,
        createdAt: schema.matches.createdAt,
      })
      .from(schema.matchPlayers)
      .innerJoin(schema.matches, eq(schema.matches.id, schema.matchPlayers.matchId))
      .where(and(eq(schema.matchPlayers.userId, userId), eq(schema.matches.status, "completed")))
      .orderBy(
        sql`${schema.matches.endedAt} desc nulls last`,
        sql`${schema.matches.createdAt} desc`,
      )
      .limit(page.limit)
      .offset(page.offset);

    if (paged.length === 0) return [];

    const matchIds = paged.map((r) => r.matchId);

    // Nomi + flag ospite di tutti i posti delle partite in pagina (join users).
    const players = await this.db
      .select({
        matchId: schema.matchPlayers.matchId,
        seat: schema.matchPlayers.seat,
        displayName: schema.matchPlayers.displayName,
        isGuest: schema.users.isGuest,
      })
      .from(schema.matchPlayers)
      .leftJoin(schema.users, eq(schema.users.id, schema.matchPlayers.userId))
      .where(inArray(schema.matchPlayers.matchId, matchIds));

    // Somma punteggi e conteggio smazzate per match + posto.
    const scores = await this.db
      .select({
        matchId: schema.hands.matchId,
        seat: schema.handScores.seat,
        total: sql<number>`coalesce(sum(${schema.handScores.totalDelta}), 0)`,
        deals: sql<number>`count(*)`,
      })
      .from(schema.handScores)
      .innerJoin(schema.hands, eq(schema.hands.id, schema.handScores.handId))
      .where(inArray(schema.hands.matchId, matchIds))
      .groupBy(schema.hands.matchId, schema.handScores.seat);

    const playerOf = (matchId: string, seat: Seat) =>
      players.find((p) => p.matchId === matchId && p.seat === seat);
    const scoreOf = (matchId: string, seat: Seat): number =>
      num(scores.find((s) => s.matchId === matchId && s.seat === seat)?.total);
    const dealsOf = (matchId: string, seat: Seat): number =>
      num(scores.find((s) => s.matchId === matchId && s.seat === seat)?.deals);

    return paged.map((r) => {
      const yourSeat = r.seat as Seat;
      const oppSeat = (1 - yourSeat) as Seat;
      const opp = playerOf(r.matchId, oppSeat);
      const result: "won" | "lost" =
        r.winnerSeat !== null && r.winnerSeat === yourSeat ? "won" : "lost";
      const ended = r.endedAt ? new Date(r.endedAt).getTime() : null;
      return {
        matchId: r.matchId,
        endedAt: ended,
        result,
        opponentName: opp?.displayName ?? "Avversario",
        opponentIsGuest: opp?.isGuest ?? false,
        yourScore: scoreOf(r.matchId, yourSeat),
        opponentScore: scoreOf(r.matchId, oppSeat),
        dealsCount: dealsOf(r.matchId, yourSeat),
      };
    });
  }

  async getMatchDetail(userId: string, matchId: string): Promise<MatchDetail | null> {
    // Autorizzazione per PARTECIPAZIONE: nessuna riga → null (l'HTTP mappa a 404).
    const [meRow] = await this.db
      .select({ seat: schema.matchPlayers.seat })
      .from(schema.matchPlayers)
      .where(and(eq(schema.matchPlayers.matchId, matchId), eq(schema.matchPlayers.userId, userId)))
      .limit(1);
    if (!meRow) return null;

    const [m] = await this.db
      .select({
        status: schema.matches.status,
        winnerSeat: schema.matches.winnerSeat,
        endedAt: schema.matches.endedAt,
        targetScore: schema.matches.targetScore,
      })
      .from(schema.matches)
      .where(eq(schema.matches.id, matchId))
      .limit(1);
    if (!m) return null;

    const yourSeat = meRow.seat as Seat;
    const oppSeat = (1 - yourSeat) as Seat;

    // Posti (nome + flag ospite via join users).
    const players = await this.db
      .select({
        seat: schema.matchPlayers.seat,
        displayName: schema.matchPlayers.displayName,
        isGuest: schema.users.isGuest,
      })
      .from(schema.matchPlayers)
      .leftJoin(schema.users, eq(schema.users.id, schema.matchPlayers.userId))
      .where(eq(schema.matchPlayers.matchId, matchId));
    const opp = players.find((p) => p.seat === oppSeat);

    // Smazzate ordinate per numero.
    const handRows = await this.db
      .select({
        handId: schema.hands.id,
        handNumber: schema.hands.handNumber,
        dealerSeat: schema.hands.dealerSeat,
        closerSeat: schema.hands.closerSeat,
      })
      .from(schema.hands)
      .where(eq(schema.hands.matchId, matchId))
      .orderBy(schema.hands.handNumber);

    // Punteggi di tutte le smazzate della partita.
    const scoreRows = await this.db
      .select({
        handId: schema.handScores.handId,
        seat: schema.handScores.seat,
        ptsPenaltyHand: schema.handScores.ptsPenaltyHand,
        ptsPozzetto: schema.handScores.ptsPozzetto,
        totalDelta: schema.handScores.totalDelta,
        burrachiPuliti: schema.handScores.burrachiPuliti,
        burrachiSporchi: schema.handScores.burrachiSporchi,
        pozzettoInDiretta: schema.handScores.pozzettoInDiretta,
      })
      .from(schema.handScores)
      .innerJoin(schema.hands, eq(schema.hands.id, schema.handScores.handId))
      .where(eq(schema.hands.matchId, matchId));

    const sideOf = (handId: string, seat: Seat, closerSeat: number | null): MatchDealSide => {
      const s = scoreRows.find((r) => r.handId === handId && r.seat === seat);
      return {
        puntiSmazzata: s ? num(s.totalDelta) : 0,
        puntiCarteInMano: s ? num(s.ptsPenaltyHand) : 0,
        burrachiPuliti: s ? num(s.burrachiPuliti) : 0,
        burrachiSporchi: s ? num(s.burrachiSporchi) : 0,
        pozzettoPreso: s ? num(s.ptsPozzetto) === 0 : false,
        pozzettoInDiretta: s?.pozzettoInDiretta ?? false,
        haChiuso: closerSeat === seat,
        malusPozzetto: s ? num(s.ptsPozzetto) === -100 : false,
      };
    };

    const deals: MatchDeal[] = handRows.map((h) => ({
      numeroSmazzata: h.handNumber,
      dealerSeat: h.dealerSeat as Seat,
      closerSeat: h.closerSeat === null ? null : (h.closerSeat as Seat),
      you: sideOf(h.handId, yourSeat, h.closerSeat),
      opponent: sideOf(h.handId, oppSeat, h.closerSeat),
    }));

    const status = m.status as MatchStatus;
    const result: "won" | "lost" | null =
      status !== "completed"
        ? null
        : m.winnerSeat !== null && m.winnerSeat === yourSeat
          ? "won"
          : "lost";

    const you = num(scoreRows.filter((r) => r.seat === yourSeat).reduce((a, r) => a + num(r.totalDelta), 0));
    const opponentScore = num(
      scoreRows.filter((r) => r.seat === oppSeat).reduce((a, r) => a + num(r.totalDelta), 0),
    );

    return {
      matchId,
      endedAt: m.endedAt ? new Date(m.endedAt).getTime() : null,
      status,
      result,
      opponent: { name: opp?.displayName ?? "Avversario", isGuest: opp?.isGuest ?? false },
      targetScore: num(m.targetScore),
      yourSeat,
      finalScore: { you, opponent: opponentScore },
      deals,
    };
  }
}
