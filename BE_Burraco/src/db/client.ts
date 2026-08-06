import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "../config.js";
import * as schema from "./schema.js";

/**
 * Client Drizzle verso Neon (endpoint POOLED). Il backend Render è un servizio
 * persistente: usiamo un Pool node-postgres a lunga vita.
 *
 * Se DATABASE_URL non è impostata, il client è null e la persistenza diventa
 * un no-op: il gioco resta pienamente funzionante (stato in RAM).
 */

let db: NodePgDatabase<typeof schema> | null = null;
let pool: pg.Pool | null = null;

if (env.databaseUrl) {
  pool = new pg.Pool({
    connectionString: env.databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  pool.on("error", (err) => {
    console.error("[db] errore del pool:", err.message);
  });
  db = drizzle(pool, { schema });
  console.log("[db] persistenza Neon attiva.");
} else {
  console.warn("[db] DATABASE_URL non impostata: persistenza disattivata (solo RAM).");
}

export { db, pool, schema };
export const persistenceEnabled = db !== null;
