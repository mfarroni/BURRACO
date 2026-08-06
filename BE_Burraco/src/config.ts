import type { GameConfig } from "./contract/types.js";

/** Variabili d'ambiente del processo (con default sicuri per lo sviluppo locale). */
export const env = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? "",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 120_000),
  turnTimeoutMs: Number(process.env.TURN_TIMEOUT_MS ?? 90_000),
};

/**
 * Configurazione di partita di default per la v1 (scheda di regole bloccata).
 * numero_giocatori=2, individuale, obiettivo 2005, chiusura italiana,
 * pozzetto in diretta e differita, max 2 calate prima del pozzetto.
 */
export function defaultGameConfig(): GameConfig {
  return {
    numeroGiocatori: 2,
    modalita: "individuale",
    punteggioObiettivo: 2005,
    varianteChiusura: "italiana",
    presaPozzetto: "in_diretta_e_differita",
    limiteCalatePrimaDelPozzetto: 2,
    turnTimeoutMs: env.turnTimeoutMs,
  };
}
