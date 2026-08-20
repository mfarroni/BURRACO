import { db } from "../db/client.js";
import { DrizzleAuthStore } from "./store.drizzle.js";
import { MemoryAuthStore } from "./store.memory.js";
import type { AuthStore } from "./types.js";

/**
 * Factory dello store auth (decisione "TESTABILITÀ SENZA DB").
 *  - `DATABASE_URL` presente → `db` valorizzato → store Drizzle/Neon.
 *  - assente → store IN-MEMORY: auth pienamente funzionante in locale/test,
 *    coerente con lo stato "in RAM" del gioco.
 * La scelta è log-gata una volta all'avvio (nessun segreto nel log).
 */
export function createAuthStore(): AuthStore {
  if (db) {
    console.log("[auth] store persistente (Neon) attivo.");
    return new DrizzleAuthStore(db);
  }
  console.warn("[auth] DATABASE_URL assente: store auth IN-MEMORY (solo RAM).");
  return new MemoryAuthStore();
}
