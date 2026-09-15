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
 * Implementazione IN-MEMORY di StatsStore (decisione F: testabilità senza DB).
 * Attiva quando `DATABASE_URL` è assente. Aggrega da record match/partecipazioni/
 * smazzate/punteggi tenuti in RAM, gli stessi che in produzione vivono su Neon. In
 * v1 senza DB il gioco non popola questi record (la persistenza è no-op): le
 * statistiche risultano a zero finché non c'è un DB. I test popolano i record
 * direttamente tramite i metodi di ingest sottostanti.
 *
 * Le aggregazioni riproducono FEDELMENTE la semantica delle query Drizzle (le due
 * implementazioni condividono `analysis.ts`):
 *  - partite conteggiate = SOLO quelle COMPLETATE (`status='completed'`);
 *  - vinta = la SQUADRA dell'utente == `winnerTeam` (Macro-ciclo 3 / ITEM 2: prima
 *    era `winnerSeat === seat`; in 1v1 team = seat → valore identico);
 *  - `you`/`opponent` sono AGGREGATI DI COPPIA (somma dei posti della squadra); in
 *    1v1 la squadra ha un solo posto → identico a prima;
 *  - `dealsCount`/analisi si contano dalle smazzate del posto dell'utente.
 */

interface MatchRec {
  id: string;
  status: MatchStatus;
  winnerSeat: Seat | null;
  /**
   * Macro-ciclo 3 / ITEM 2: SQUADRA vincitrice (`matches.winner_team`). Nullable:
   * le righe pre-migrazione non la hanno → si legge `winnerTeam ?? winnerSeat`
   * (in 1v1 team = seat → identico). Popolata da `putMatch`.
   */
  winnerTeam: TeamId | null;
  targetScore: number;
  createdAt: Date;
  /** matches.ended_at (fine partita). */
  endedAt: Date | null;
}
interface PlayerRec {
  matchId: string;
  seat: Seat;
  /**
   * Macro-ciclo 3 / ITEM 2: SQUADRA del posto (`match_players.team`). Nullable: le
   * righe pre-migrazione non la hanno → si legge `team ?? seat` (in 1v1 identico).
   */
  team: TeamId | null;
  displayName: string;
  userId: string | null;
  isGuest: boolean;
}

/** Squadra del posto con fallback per le righe pre-migrazione (in 1v1 team = seat). */
const teamOf = (p: PlayerRec): TeamId => p.team ?? p.seat;
/** Squadra vincitrice con fallback al posto vincitore (in 1v1 identico). */
const winnerTeamOf = (m: MatchRec): TeamId | null => m.winnerTeam ?? m.winnerSeat;
interface HandRec {
  handId: string;
  matchId: string;
  handNumber: number;
  dealerSeat: Seat;
  closerSeat: Seat | null;
  endedAt: Date | null;
}
interface HandScoreRec {
  handId: string;
  matchId: string;
  seat: Seat;
  ptsMelds: number;
  ptsBonus: number;
  ptsPenaltyHand: number;
  ptsPozzetto: number;
  totalDelta: number;
  burrachiPuliti: number;
  burrachiSporchi: number;
  pozzettoInDiretta: boolean;
}

export class MemoryStatsStore implements StatsStore {
  private matches = new Map<string, MatchRec>();
  private players: PlayerRec[] = [];
  private hands: HandRec[] = [];
  private handScores: HandScoreRec[] = [];
  private handSeq = 0;

  /* ───────────────────────────── INGEST (test/seed) ───────────────────────── */

  /** Registra/aggiorna una partita. */
  putMatch(rec: {
    id: string;
    status: MatchStatus;
    winnerSeat?: Seat | null;
    /** Macro-ciclo 3 / ITEM 2: SQUADRA vincitrice (default = winnerSeat, in 1v1 identico). */
    winnerTeam?: TeamId | null;
    targetScore?: number;
    createdAt?: Date;
    endedAt?: Date | null;
  }): void {
    this.matches.set(rec.id, {
      id: rec.id,
      status: rec.status,
      winnerSeat: rec.winnerSeat ?? null,
      // Se il chiamante non fornisce winnerTeam (seed 1v1 legacy), resta null e la
      // lettura ripiega su winnerSeat (backfill logico team = seat).
      winnerTeam: rec.winnerTeam ?? null,
      targetScore: rec.targetScore ?? 2005,
      createdAt: rec.createdAt ?? new Date(),
      endedAt: rec.endedAt ?? null,
    });
  }

  /** Registra la partecipazione (posto) di un utente a una partita. */
  putPlayer(rec: {
    matchId: string;
    seat: Seat;
    /** Macro-ciclo 3 / ITEM 2: SQUADRA del posto (default = seat, in 1v1 identico). */
    team?: TeamId | null;
    displayName: string;
    userId: string | null;
    isGuest?: boolean;
  }): void {
    this.players.push({
      matchId: rec.matchId,
      seat: rec.seat,
      team: rec.team ?? null,
      displayName: rec.displayName,
      userId: rec.userId,
      isGuest: rec.isGuest ?? false,
    });
  }

  /**
   * Registra il punteggio di una smazzata per un posto (retro-compatibile: la
   * firma storica `{ matchId, seat, totalDelta }` resta valida). Se `handId` non è
   * fornito, sintetizza una smazzata dedicata (una riga hand per chiamata), coerente
   * col fatto che `dealsPlayed`/`dealsCount` si contano dai punteggi del posto.
   */
  putHandScore(rec: {
    matchId: string;
    seat: Seat;
    totalDelta: number;
    handId?: string;
    handNumber?: number;
    dealerSeat?: Seat;
    closerSeat?: Seat | null;
    endedAt?: Date | null;
    ptsMelds?: number;
    ptsBonus?: number;
    ptsPenaltyHand?: number;
    ptsPozzetto?: number;
    burrachiPuliti?: number;
    burrachiSporchi?: number;
    pozzettoInDiretta?: boolean;
  }): void {
    const handId = rec.handId ?? `hand-${this.handSeq++}`;
    let hand = this.hands.find((h) => h.handId === handId);
    if (!hand) {
      hand = {
        handId,
        matchId: rec.matchId,
        handNumber: rec.handNumber ?? this.hands.filter((h) => h.matchId === rec.matchId).length + 1,
        dealerSeat: rec.dealerSeat ?? 0,
        closerSeat: rec.closerSeat ?? null,
        endedAt: rec.endedAt ?? null,
      };
      this.hands.push(hand);
    } else if (rec.closerSeat !== undefined) {
      hand.closerSeat = rec.closerSeat;
    }
    this.handScores.push({
      handId,
      matchId: rec.matchId,
      seat: rec.seat,
      ptsMelds: rec.ptsMelds ?? 0,
      ptsBonus: rec.ptsBonus ?? 0,
      ptsPenaltyHand: rec.ptsPenaltyHand ?? 0,
      ptsPozzetto: rec.ptsPozzetto ?? 0,
      totalDelta: rec.totalDelta,
      burrachiPuliti: rec.burrachiPuliti ?? 0,
      burrachiSporchi: rec.burrachiSporchi ?? 0,
      pozzettoInDiretta: rec.pozzettoInDiretta ?? false,
    });
  }

  /**
   * Ingest di una smazzata COMPLETA (una hand + i punteggi dei due lati): comodità
   * per i test del dettaglio/analisi che seedano dati realistici.
   */
  putDeal(rec: {
    matchId: string;
    handNumber: number;
    dealerSeat?: Seat;
    closerSeat?: Seat | null;
    endedAt?: Date | null;
    sides: {
      seat: Seat;
      ptsMelds?: number;
      ptsBonus?: number;
      ptsPenaltyHand?: number;
      ptsPozzetto?: number;
      totalDelta: number;
      burrachiPuliti?: number;
      burrachiSporchi?: number;
      pozzettoInDiretta?: boolean;
    }[];
  }): void {
    const handId = `hand-${this.handSeq++}`;
    this.hands.push({
      handId,
      matchId: rec.matchId,
      handNumber: rec.handNumber,
      dealerSeat: rec.dealerSeat ?? 0,
      closerSeat: rec.closerSeat ?? null,
      endedAt: rec.endedAt ?? null,
    });
    for (const s of rec.sides) {
      this.handScores.push({
        handId,
        matchId: rec.matchId,
        seat: s.seat,
        ptsMelds: s.ptsMelds ?? 0,
        ptsBonus: s.ptsBonus ?? 0,
        ptsPenaltyHand: s.ptsPenaltyHand ?? 0,
        ptsPozzetto: s.ptsPozzetto ?? 0,
        totalDelta: s.totalDelta,
        burrachiPuliti: s.burrachiPuliti ?? 0,
        burrachiSporchi: s.burrachiSporchi ?? 0,
        pozzettoInDiretta: s.pozzettoInDiretta ?? false,
      });
    }
  }

  /* ─────────────────────────────── LETTURA ────────────────────────────────── */

  async getStats(userId: string, periodo: StatsPeriod = "all"): Promise<UserStats> {
    const fromMs = periodStartMs(periodo);
    const inPeriod = (m: MatchRec): boolean => {
      if (fromMs === null) return true;
      const t = (m.endedAt ?? m.createdAt).getTime();
      return t >= fromMs;
    };

    // Partecipazioni dell'utente col match risolto, nel periodo.
    const parts = this.players
      .filter((p) => p.userId === userId)
      .map((p) => ({ player: p, match: this.matches.get(p.matchId) }))
      .filter((x): x is { player: PlayerRec; match: MatchRec } => !!x.match && inPeriod(x.match));

    const completed = parts.filter((x) => x.match.status === "completed");
    const matchesPlayed = completed.length;
    let matchesWon = 0;
    for (const { player, match } of completed) {
      // ITEM 2: vinta = SQUADRA dell'utente == squadra vincitrice. In 1v1 (team =
      // seat, winnerTeam ?? winnerSeat) coincide col vecchio `winnerSeat === seat`.
      const w = winnerTeamOf(match);
      if (w !== null && w === teamOf(player)) matchesWon += 1;
    }
    const matchesLost = matchesPlayed - matchesWon;
    const winRate = matchesPlayed === 0 ? 0 : matchesWon / matchesPlayed;
    const matchesAbandoned = parts.filter((x) => x.match.status === "abandoned").length;

    // Seat dell'utente per ciascuna sua partita completed.
    const seatByMatch = new Map<string, Seat>();
    for (const { player, match } of completed) seatByMatch.set(match.id, player.seat);

    // totalPoints + avgFinalScore + aggregati d'analisi, iterando le smazzate del
    // SOLO posto dell'utente nelle sue partite completed.
    let totalPoints = 0;
    const finalByMatch = new Map<string, number>();
    const handById = new Map(this.hands.map((h) => [h.handId, h]));
    const agg: RawAggregate = {
      dealsPlayed: 0,
      sumPuliti: 0,
      sumSporchi: 0,
      pozzettiPresi: 0,
      pozzettiDiretta: 0,
      closures: 0,
      sumPenalty: 0,
      sumDelta: 0,
      malusCount: 0,
    };
    const deltaByMatch = new Map<string, number[]>();

    for (const hs of this.handScores) {
      const seat = seatByMatch.get(hs.matchId);
      if (seat === undefined || seat !== hs.seat) continue; // non è una smazzata del posto dell'utente
      totalPoints += hs.totalDelta;
      finalByMatch.set(hs.matchId, (finalByMatch.get(hs.matchId) ?? 0) + hs.totalDelta);
      agg.dealsPlayed += 1;
      agg.sumPuliti += hs.burrachiPuliti;
      agg.sumSporchi += hs.burrachiSporchi;
      if (hs.ptsPozzetto === 0) {
        agg.pozzettiPresi += 1;
        if (hs.pozzettoInDiretta) agg.pozzettiDiretta += 1;
      }
      if (hs.ptsPozzetto === -100) agg.malusCount += 1;
      const hand = handById.get(hs.handId);
      if (hand && hand.closerSeat === seat) agg.closures += 1;
      agg.sumPenalty += hs.ptsPenaltyHand;
      agg.sumDelta += hs.totalDelta;
      const arr = deltaByMatch.get(hs.matchId) ?? [];
      arr.push(hs.totalDelta);
      deltaByMatch.set(hs.matchId, arr);
    }

    const avgFinalScore =
      matchesPlayed === 0
        ? null
        : [...finalByMatch.values()].reduce((a, b) => a + b, 0) / matchesPlayed;

    // Trend: media punti per smazzata per partita, ultime 20 completed, cronologico.
    const trendPoints = completed
      .slice()
      .sort((a, b) => this.endedTime(b.match) - this.endedTime(a.match))
      .slice(0, 20)
      .reverse()
      .map(({ match }) => {
        const deltas = deltaByMatch.get(match.id) ?? [];
        if (deltas.length === 0) return 0;
        return Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
      });

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
    const parts = this.players
      .filter((p) => p.userId === userId)
      .map((p) => ({ player: p, match: this.matches.get(p.matchId) }))
      .filter(
        (x): x is { player: PlayerRec; match: MatchRec } =>
          !!x.match && x.match.status === "completed",
      );

    // Ordina per matches.ended_at desc (nulls last), poi created_at desc.
    parts.sort((a, b) => {
      const ta = a.match.endedAt ? a.match.endedAt.getTime() : -Infinity;
      const tb = b.match.endedAt ? b.match.endedAt.getTime() : -Infinity;
      if (tb !== ta) return tb - ta;
      return b.match.createdAt.getTime() - a.match.createdAt.getTime();
    });

    const pageItems = parts.slice(page.offset, page.offset + page.limit);

    return pageItems.map(({ player, match }) => {
      const yourSeat = player.seat;
      const yourTeam = teamOf(player);
      // ITEM 2: coppia = tutti i posti della squadra; avversari = i posti dell'altra
      // squadra. In 1v1 (una squadra = un posto) "mine" ha 1 posto e "opp" 1 posto:
      // aggregati e nomi coincidono con la vecchia logica per-posto.
      const { mine, opp } = this.splitByTeam(match.id, yourTeam);
      const w = winnerTeamOf(match);
      const result: "won" | "lost" = w !== null && w === yourTeam ? "won" : "lost";
      return {
        matchId: match.id,
        endedAt: match.endedAt ? match.endedAt.getTime() : null,
        result,
        opponentName: this.teamLabel(opp),
        // Rappresentante della coppia avversaria (posto minore) per il flag ospite.
        opponentIsGuest: opp[0]?.isGuest ?? false,
        yourScore: mine.reduce((acc, p) => acc + this.sumScore(match.id, p.seat), 0),
        opponentScore: opp.reduce((acc, p) => acc + this.sumScore(match.id, p.seat), 0),
        // Conteggio smazzate = righe del PROPRIO posto (una per smazzata): mai la
        // somma dei due posti della coppia (raddoppierebbe le smazzate).
        dealsCount: this.handScores.filter((hs) => hs.matchId === match.id && hs.seat === yourSeat)
          .length,
      };
    });
  }

  async getMatchDetail(userId: string, matchId: string): Promise<MatchDetail | null> {
    // Autorizzazione per PARTECIPAZIONE: nessuna riga → null (l'HTTP mappa a 404).
    const me = this.players.find((p) => p.matchId === matchId && p.userId === userId);
    if (!me) return null;
    const match = this.matches.get(matchId);
    if (!match) return null;

    const yourSeat = me.seat;
    const yourTeam = teamOf(me);
    // ITEM 2: lati you/opponent AGGREGATI PER COPPIA. In 1v1 ogni squadra ha un solo
    // posto → aggregati/nomi identici a prima.
    const { mine, opp } = this.splitByTeam(matchId, yourTeam);

    const w = winnerTeamOf(match);
    const result: "won" | "lost" | null =
      match.status !== "completed" ? null : w !== null && w === yourTeam ? "won" : "lost";

    const handsOfMatch = this.hands
      .filter((h) => h.matchId === matchId)
      .sort((a, b) => a.handNumber - b.handNumber);

    const mySeats = mine.map((p) => p.seat);
    const oppSeats = opp.map((p) => p.seat);
    const deals: MatchDeal[] = handsOfMatch.map((h) => ({
      numeroSmazzata: h.handNumber,
      dealerSeat: h.dealerSeat,
      closerSeat: h.closerSeat,
      you: this.sideOfTeam(h, mySeats),
      opponent: this.sideOfTeam(h, oppSeats),
    }));

    return {
      matchId: match.id,
      endedAt: match.endedAt ? match.endedAt.getTime() : null,
      status: match.status,
      result,
      opponent: { name: this.teamLabel(opp), isGuest: opp[0]?.isGuest ?? false },
      targetScore: match.targetScore,
      yourSeat,
      finalScore: {
        you: mySeats.reduce((acc, s) => acc + this.sumScore(matchId, s), 0),
        opponent: oppSeats.reduce((acc, s) => acc + this.sumScore(matchId, s), 0),
      },
      deals,
    };
  }

  /* ─────────────────────────────── helper ─────────────────────────────────── */

  private endedTime(m: MatchRec): number {
    return (m.endedAt ?? m.createdAt).getTime();
  }

  private sumScore(matchId: string, seat: Seat): number {
    let total = 0;
    for (const hs of this.handScores) {
      if (hs.matchId === matchId && hs.seat === seat) total += hs.totalDelta;
    }
    return total;
  }

  /**
   * ITEM 2: divide i posti di una partita in "mine" (squadra dell'utente) e "opp"
   * (squadra avversaria), ciascuno ordinato per posto crescente. In 1v1 ogni gruppo
   * ha un solo posto → equivale alla vecchia coppia (yourSeat, 1 - yourSeat).
   */
  private splitByTeam(matchId: string, yourTeam: TeamId): { mine: PlayerRec[]; opp: PlayerRec[] } {
    const all = this.players
      .filter((p) => p.matchId === matchId)
      .sort((a, b) => a.seat - b.seat);
    return {
      mine: all.filter((p) => teamOf(p) === yourTeam),
      opp: all.filter((p) => teamOf(p) !== yourTeam),
    };
  }

  /** Etichetta della coppia (i nomi uniti da " e "); in 1v1 è il solo nome avversario. */
  private teamLabel(players: PlayerRec[]): string {
    return players.map((p) => p.displayName).join(" e ") || "Avversario";
  }

  /**
   * ITEM 2: costruisce il lato di UNA smazzata AGGREGANDO i posti indicati (la coppia).
   * I fatti di coppia vivono sulla riga CANONICA (l'altra ha ptsMelds/ptsBonus/
   * ptsPozzetto = 0), quindi la SOMMA non li duplica; le penalità di mano si sommano
   * (carte di ENTRAMBI i compagni). In 1v1 `seats` ha un solo posto → identico a prima.
   */
  private sideOfTeam(hand: HandRec, seats: Seat[]): MatchDealSide {
    const rows = this.handScores.filter(
      (s) => s.handId === hand.handId && seats.includes(s.seat),
    );
    const sum = (f: (r: HandScoreRec) => number): number => rows.reduce((a, r) => a + f(r), 0);
    return {
      puntiSmazzata: sum((r) => r.totalDelta),
      puntiCarteInMano: sum((r) => r.ptsPenaltyHand),
      burrachiPuliti: sum((r) => r.burrachiPuliti),
      burrachiSporchi: sum((r) => r.burrachiSporchi),
      // Il MALUS (-100) del pozzetto compare su UNA sola riga della coppia (canonica);
      // "preso" = nessuna riga in malus. In 1v1 (1 riga) coincide con `ptsPozzetto === 0`.
      pozzettoPreso: rows.length > 0 && rows.every((r) => r.ptsPozzetto === 0),
      pozzettoInDiretta: rows.some((r) => r.pozzettoInDiretta),
      haChiuso: hand.closerSeat !== null && seats.includes(hand.closerSeat),
      malusPozzetto: rows.some((r) => r.ptsPozzetto === -100),
    };
  }
}
