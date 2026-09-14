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
  TeamId,
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

    // Partite CONCLUSE dell'utente con la sua SQUADRA e la squadra vincitrice.
    const rows = await this.db
      .select({
        seat: schema.matchPlayers.seat,
        team: schema.matchPlayers.team,
        winnerSeat: schema.matches.winnerSeat,
        winnerTeam: schema.matches.winnerTeam,
      })
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
      // ITEM 2: vinta = SQUADRA dell'utente == squadra vincitrice. In 1v1
      // (team ?? seat, winner_team ?? winner_seat) coincide col vecchio
      // `winner_seat === seat`: righe pre-migrazione incluse.
      const t = r.team ?? r.seat;
      const w = r.winnerTeam ?? r.winnerSeat;
      if (w !== null && w === t) matchesWon += 1;
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
        winnerTeam: schema.matches.winnerTeam,
        seat: schema.matchPlayers.seat,
        team: schema.matchPlayers.team,
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

    // Nomi + flag ospite + SQUADRA di tutti i posti delle partite in pagina (join users).
    const players = await this.db
      .select({
        matchId: schema.matchPlayers.matchId,
        seat: schema.matchPlayers.seat,
        team: schema.matchPlayers.team,
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

    // Posti di una partita ordinati per seat (ITEM 2: la coppia può avere 2 posti).
    const playersOf = (matchId: string) =>
      players.filter((p) => p.matchId === matchId).sort((a, b) => a.seat - b.seat);
    const scoreOf = (matchId: string, seat: Seat): number =>
      num(scores.find((s) => s.matchId === matchId && s.seat === seat)?.total);
    const dealsOf = (matchId: string, seat: Seat): number =>
      num(scores.find((s) => s.matchId === matchId && s.seat === seat)?.deals);

    return paged.map((r) => {
      const yourSeat = r.seat as Seat;
      const yourTeam = (r.team ?? r.seat) as TeamId;
      // ITEM 2: coppia = posti della propria squadra; avversari = posti dell'altra.
      // In 1v1 (una squadra = un posto) "mine"/"opp" hanno un solo posto → aggregati
      // e nomi coincidono con la vecchia logica per-posto.
      const all = playersOf(r.matchId);
      const mine = all.filter((p) => (p.team ?? p.seat) === yourTeam);
      const opp = all.filter((p) => (p.team ?? p.seat) !== yourTeam);
      const w = r.winnerTeam ?? r.winnerSeat;
      const result: "won" | "lost" = w !== null && w === yourTeam ? "won" : "lost";
      const ended = r.endedAt ? new Date(r.endedAt).getTime() : null;
      return {
        matchId: r.matchId,
        endedAt: ended,
        result,
        opponentName: opp.map((p) => p.displayName).join(" e ") || "Avversario",
        // Rappresentante della coppia avversaria (posto minore) per il flag ospite.
        opponentIsGuest: opp[0]?.isGuest ?? false,
        yourScore: mine.reduce((acc, p) => acc + scoreOf(r.matchId, p.seat), 0),
        opponentScore: opp.reduce((acc, p) => acc + scoreOf(r.matchId, p.seat), 0),
        // Conteggio smazzate = righe del PROPRIO posto (una per smazzata), mai la
        // somma dei due posti della coppia.
        dealsCount: dealsOf(r.matchId, yourSeat),
      };
    });
  }

  async getMatchDetail(userId: string, matchId: string): Promise<MatchDetail | null> {
    // Autorizzazione per PARTECIPAZIONE: nessuna riga → null (l'HTTP mappa a 404).
    const [meRow] = await this.db
      .select({ seat: schema.matchPlayers.seat, team: schema.matchPlayers.team })
      .from(schema.matchPlayers)
      .where(and(eq(schema.matchPlayers.matchId, matchId), eq(schema.matchPlayers.userId, userId)))
      .limit(1);
    if (!meRow) return null;

    const [m] = await this.db
      .select({
        status: schema.matches.status,
        winnerSeat: schema.matches.winnerSeat,
        winnerTeam: schema.matches.winnerTeam,
        endedAt: schema.matches.endedAt,
        targetScore: schema.matches.targetScore,
      })
      .from(schema.matches)
      .where(eq(schema.matches.id, matchId))
      .limit(1);
    if (!m) return null;

    const yourSeat = meRow.seat as Seat;
    const yourTeam = (meRow.team ?? meRow.seat) as TeamId;

    // Posti (nome + flag ospite + SQUADRA via join users), ordinati per seat.
    const players = (
      await this.db
        .select({
          seat: schema.matchPlayers.seat,
          team: schema.matchPlayers.team,
          displayName: schema.matchPlayers.displayName,
          isGuest: schema.users.isGuest,
        })
        .from(schema.matchPlayers)
        .leftJoin(schema.users, eq(schema.users.id, schema.matchPlayers.userId))
        .where(eq(schema.matchPlayers.matchId, matchId))
    ).sort((a, b) => a.seat - b.seat);
    // ITEM 2: coppia dell'utente vs coppia avversaria (in 1v1 un posto per lato).
    const mine = players.filter((p) => (p.team ?? p.seat) === yourTeam);
    const opp = players.filter((p) => (p.team ?? p.seat) !== yourTeam);
    const mySeats = mine.map((p) => p.seat as Seat);
    const oppSeats = opp.map((p) => p.seat as Seat);

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

    // ITEM 2: lato di UNA smazzata AGGREGATO sui posti di una coppia. I fatti di
    // coppia vivono sulla riga CANONICA (l'altra ha ptsMelds/ptsBonus/ptsPozzetto =
    // 0) → la SOMMA non li duplica; le penalità di mano si sommano (carte di
    // entrambi i compagni). In 1v1 `seats` ha un solo posto → identico a prima.
    const sideOfTeam = (handId: string, seats: Seat[], closerSeat: number | null): MatchDealSide => {
      const rows = scoreRows.filter((r) => r.handId === handId && seats.includes(r.seat as Seat));
      const sum = (f: (r: (typeof rows)[number]) => number): number =>
        rows.reduce((a, r) => a + num(f(r)), 0);
      return {
        puntiSmazzata: sum((r) => r.totalDelta),
        puntiCarteInMano: sum((r) => r.ptsPenaltyHand),
        burrachiPuliti: sum((r) => r.burrachiPuliti),
        burrachiSporchi: sum((r) => r.burrachiSporchi),
        // Il MALUS (-100) compare su UNA sola riga (canonica); "preso" = nessun malus.
        pozzettoPreso: rows.length > 0 && rows.every((r) => num(r.ptsPozzetto) === 0),
        pozzettoInDiretta: rows.some((r) => r.pozzettoInDiretta),
        haChiuso: closerSeat !== null && seats.includes(closerSeat as Seat),
        malusPozzetto: rows.some((r) => num(r.ptsPozzetto) === -100),
      };
    };

    const deals: MatchDeal[] = handRows.map((h) => ({
      numeroSmazzata: h.handNumber,
      dealerSeat: h.dealerSeat as Seat,
      closerSeat: h.closerSeat === null ? null : (h.closerSeat as Seat),
      you: sideOfTeam(h.handId, mySeats, h.closerSeat),
      opponent: sideOfTeam(h.handId, oppSeats, h.closerSeat),
    }));

    const status = m.status as MatchStatus;
    const w = m.winnerTeam ?? m.winnerSeat;
    const result: "won" | "lost" | null =
      status !== "completed" ? null : w !== null && w === yourTeam ? "won" : "lost";

    const teamTotal = (seats: Seat[]): number =>
      num(scoreRows.filter((r) => seats.includes(r.seat as Seat)).reduce((a, r) => a + num(r.totalDelta), 0));

    return {
      matchId,
      endedAt: m.endedAt ? new Date(m.endedAt).getTime() : null,
      status,
      result,
      opponent: {
        name: opp.map((p) => p.displayName).join(" e ") || "Avversario",
        isGuest: opp[0]?.isGuest ?? false,
      },
      targetScore: num(m.targetScore),
      yourSeat,
      finalScore: { you: teamTotal(mySeats), opponent: teamTotal(oppSeats) },
      deals,
    };
  }
}
