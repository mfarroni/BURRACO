import type { GameConfig } from "./contract/types.js";

/**
 * Variabili d'ambiente del processo (con default sicuri per lo sviluppo locale).
 *
 * ENV OBBLIGATORIE IN PRODUZIONE (SEC-09):
 *  - NODE_ENV=production
 *  - ALLOWED_ORIGINS: allowlist ESPLICITA di origin (CSV), es.
 *      "https://burraco.vercel.app". MAI "*" in produzione: se assente o "*"
 *      ogni connessione WS viene rifiutata (fail-closed).
 *  - DATABASE_URL: connection string Neon con `sslmode=verify-full` (SEC-06).
 * ENV OPZIONALI: PORT, RECONNECT_GRACE_MS, TURN_TIMEOUT_MS.
 */
const isProd = process.env.NODE_ENV === "production";

/**
 * IGIENE SESSIONI — PERIODO DI GRAZIA per la riconnessione (§6.3): UNICA definizione
 * documentata della soglia. Alla disconnessione del socket la sessione è marcata
 * *disconnessa* (non eliminata) e il tavolo resta in piedi per questo intervallo,
 * così un refresh accidentale (F5) a metà partita non la distrugge. Se lo stesso
 * utente rientra entro la soglia riprende dal punto in cui era; scaduta, la partita
 * è marcata 'abandoned', il tavolo è liberato e l'avversario torna in lobby. I
 * contatori non si toccano. Il ritorno VOLONTARIO alla vetrina è un'uscita esplicita
 * e NON gode di questa grazia. Override via env `RECONNECT_GRACE_MS` (i test iniettano
 * finestre brevi/lunghe a runtime, quindi `Room` rilegge l'env a ogni disconnessione
 * ripiegando su QUESTA costante).
 */
export const RECONNECT_GRACE_DEFAULT_MS = 45_000;

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? "",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? (isProd ? "" : "*"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Periodo di grazia riconnessione (§6.3). Vedi `RECONNECT_GRACE_DEFAULT_MS`. */
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? RECONNECT_GRACE_DEFAULT_MS),
  turnTimeoutMs: Number(process.env.TURN_TIMEOUT_MS ?? 90_000),
  /**
   * Macro-ciclo 1 — Auth (SEC-08): quando true, `join_room` richiede un authToken
   * VALIDO (niente ingresso col solo codice tavolo). Default: ON in produzione,
   * OFF in sviluppo/test (così le suite d'integrazione preesistenti — che entrano
   * senza authToken — restano verdi). Override esplicito via REQUIRE_AUTH_JOIN
   * ("true"/"false"). I test del gating passano il flag esplicito al server.
   */
  requireAuthOnJoin:
    process.env.REQUIRE_AUTH_JOIN !== undefined
      ? process.env.REQUIRE_AUTH_JOIN === "true"
      : isProd,
  /** TTL di sessione auth in ms (default 7 giorni). */
  sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000),
  /**
   * Slug del PROGETTO Vercel del frontend, usato dallo strato (b) della policy
   * origin (`net/originPolicy.ts`) per ammettere gli URL generati da Vercel
   * (produzione, branch, preview). Default "burraco"; override su Render.
   */
  vercelProject: (process.env.VERCEL_PROJECT ?? "burraco").trim(),
  /**
   * Slug del TEAM/scope Vercel, presente nelle forme branch/preview
   * (`<progetto>-git-<branch>-<team>.vercel.app`). Default "groupgames";
   * override su Render.
   */
  vercelTeamSlug: (process.env.VERCEL_TEAM_SLUG ?? "groupgames").trim(),
};

/**
 * Configurazione di partita di default per la v1 (scheda di regole bloccata).
 * numero_giocatori=2, individuale, obiettivo 2005, chiusura italiana,
 * pozzetto in diretta e differita, NESSUN limite di calate prima del pozzetto
 * (il cap è una house-rule opzionale, spenta di default: vedi GameConfig).
 */
export function defaultGameConfig(): GameConfig {
  return {
    numeroGiocatori: 2,
    modalita: "individuale",
    punteggioObiettivo: 2005,
    varianteChiusura: "italiana",
    presaPozzetto: "in_diretta_e_differita",
    limiteCalatePrimaDelPozzetto: null, // nessun limite (base); house-rule = numero > 0
    turnTimeoutMs: env.turnTimeoutMs,
  };
}
