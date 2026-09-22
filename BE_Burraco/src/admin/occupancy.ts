import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, schema } from "../db/client.js";
import { RETENTION } from "../retention/constants.js";
import type { AdminOccupancy } from "./types.js";

/**
 * FASE 4 (§4.4) — Contatore di OCCUPAZIONE per la pagina webmaster: righe per
 * tabella, totale, percentuale sul budget di 10k righe e soglia d'allarme (80%).
 * Sola lettura. Senza DB ritorna zeri (nessun errore).
 */

// Le tabelle sotto osservazione (quelle che crescono e concorrono al budget).
const TRACKED: { name: string; table: PgTable }[] = [
  { name: "users", table: schema.users },
  { name: "sessions", table: schema.sessions },
  { name: "matches", table: schema.matches },
  { name: "match_players", table: schema.matchPlayers },
  { name: "hands", table: schema.hands },
  { name: "hand_scores", table: schema.handScores },
  { name: "game_events", table: schema.gameEvents },
  { name: "checkpoints", table: schema.checkpoints },
  { name: "login_attempts", table: schema.loginAttempts },
  { name: "contact_messages", table: schema.contactMessages },
  { name: "admin_audit_log", table: schema.adminAuditLog },
  { name: "user_stats_totals", table: schema.userStatsTotals },
  { name: "broadcasts", table: schema.broadcasts },
  { name: "broadcast_recipients", table: schema.broadcastRecipients },
  { name: "app_events", table: schema.appEvents },
  // CICLO Pannello Admin (mig 0010/0011): concorrono al budget 10k; volumi bassi.
  { name: "email_quota_daily", table: schema.emailQuotaDaily },
  { name: "email_queue", table: schema.emailQueue },
  { name: "events", table: schema.events },
  { name: "shop_products", table: schema.shopProducts },
];

export async function getOccupancy(): Promise<AdminOccupancy> {
  const budget = RETENTION.budgetRows;
  const warnRatio = RETENTION.budgetWarnRatio;
  if (!db) {
    return { tables: [], total: 0, budget, usedRatio: 0, warnRatio, alert: false };
  }
  const counts = await Promise.all(
    TRACKED.map(async ({ name, table }) => {
      const [row] = await db!.select({ n: sql<number>`count(*)` }).from(table);
      return { table: name, rows: Number(row?.n ?? 0) };
    }),
  );
  const total = counts.reduce((a, c) => a + c.rows, 0);
  const usedRatio = budget > 0 ? total / budget : 0;
  return {
    tables: counts.sort((a, b) => b.rows - a.rows),
    total,
    budget,
    usedRatio,
    warnRatio,
    alert: usedRatio >= warnRatio,
  };
}
