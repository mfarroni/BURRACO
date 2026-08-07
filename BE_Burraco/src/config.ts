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

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? "",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? (isProd ? "" : "*"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 180_000),
  turnTimeoutMs: Number(process.env.TURN_TIMEOUT_MS ?? 90_000),
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
