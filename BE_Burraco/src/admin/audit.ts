import { db, schema } from "../db/client.js";

/**
 * FASE 5.1 — Traccia amministrativa (`admin_audit_log`). Ogni operazione webmaster
 * (invio broadcast, dry-run/pulizia, ecc.) scrive qui l'esito. La regola forte
 * (§5.1) è: audit scritto PRIMA dell'esecuzione, nella STESSA transazione. Per
 * questo si espongono due forme:
 *  - `auditValues(...)` → l'oggetto da passare a `tx.insert(...).values(...)`
 *    dentro la transazione dell'operazione (uso preferito quando c'è una mutazione);
 *  - `recordAdminAudit(...)` → scrittura standalone best-effort (dry-run, o
 *    operazioni senza una transazione propria).
 */

export type AuditOutcome = "ok" | "rejected" | "error" | "dry_run";

export interface AuditEntry {
  actorId: string;
  action: string;
  target?: unknown;
  outcome: AuditOutcome;
}

/** Valori pronti per l'INSERT (uso dentro una transazione dell'operazione). */
export function auditValues(entry: AuditEntry): typeof schema.adminAuditLog.$inferInsert {
  return {
    actorId: entry.actorId,
    action: entry.action,
    target: (entry.target ?? null) as object | null,
    outcome: entry.outcome,
  };
}

/** Scrittura standalone best-effort (mai fatale): usata per dry-run e simili. */
export async function recordAdminAudit(entry: AuditEntry): Promise<void> {
  if (!db) return;
  try {
    await db.insert(schema.adminAuditLog).values(auditValues(entry));
  } catch (err) {
    console.error("[admin_audit] scrittura fallita:", (err as Error).message);
  }
}
