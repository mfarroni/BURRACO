import { db } from "../db/client.js";
import { DrizzleStatsStore } from "./store.drizzle.js";
import { MemoryStatsStore } from "./store.memory.js";
import type { StatsStore } from "./types.js";

/**
 * Factory dello StatsStore (decisione F, stessa logica di createAuthStore):
 *  - `DATABASE_URL` presente → `db` valorizzato → store Drizzle/Neon.
 *  - assente → store IN-MEMORY (le statistiche restano a zero finché non c'è un
 *    DB che raccoglie le partite; utile a test e sviluppo locale senza Postgres).
 */
export function createStatsStore(): StatsStore {
  if (db) {
    console.log("[stats] store persistente (Neon) attivo.");
    return new DrizzleStatsStore(db);
  }
  console.warn("[stats] DATABASE_URL assente: statistiche IN-MEMORY (solo RAM).");
  return new MemoryStatsStore();
}
