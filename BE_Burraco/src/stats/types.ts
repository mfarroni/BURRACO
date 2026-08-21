import type { MatchSummary, UserStats } from "../contract/types.js";

/**
 * CONTRATTO INTERNO del layer STATISTICHE (BE-only, macro-ciclo 3).
 *
 * Come per l'AuthStore, la persistenza è astratta dietro `StatsStore`
 * (decisione F del PIANO): due implementazioni intercambiabili
 *  - Drizzle/Neon quando `DATABASE_URL` è presente (produzione);
 *  - in-memory quando è assente (sviluppo/test), coerente con lo stato "in RAM".
 *
 * Le statistiche sono calcolate ON-THE-FLY (decisione A): nessuna tabella
 * denormalizzata, solo query aggregate su matches / match_players / hand_scores.
 * Nessun tipo qui è esposto ai client: il CONTRATTO pubblico verso il FE sono i
 * DTO `UserStats`/`MatchSummary` in contract/types.ts (copia FE allineata a mano).
 */

/** Parametri di paginazione dello storico (già validati/cappati a monte, in HTTP). */
export interface Pagination {
  limit: number;
  offset: number;
}

export interface StatsStore {
  /**
   * Statistiche aggregate del solo utente indicato. L'`userId` proviene SEMPRE
   * dal principale risolto dal token (mai dal client): il chiamante HTTP non deve
   * mai passare un id arbitrario → nessun IDOR.
   */
  getStats(userId: string): Promise<UserStats>;

  /**
   * Storico paginato delle partite CONCLUSE dell'utente, dalla più recente.
   * `limit`/`offset` sono già validati (cap ragionevole) dal layer HTTP.
   */
  getRecentMatches(userId: string, page: Pagination): Promise<MatchSummary[]>;
}
