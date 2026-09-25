import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import type { UserPreferences } from "../contract/types.js";

/**
 * Audit lancio R02/R19 (Ciclo 3) — PREFERENZE dell'utente registrato. Oggi una sola:
 * `avvisiSerate`, il consenso a ricevere via email gli avvisi delle serate del
 * circolo. È la colonna `users.promo_opt_in` (migrazione 0008), letta dai broadcast
 * "promozionali": finora nessuna schermata permetteva di attivarla.
 *
 * Senza DB (sviluppo/test) si usa una mappa in RAM, coerente con gli altri store.
 */
const memory = new Map<string, boolean>();

export async function getPreferences(userId: string): Promise<UserPreferences> {
  if (!db) return { avvisiSerate: memory.get(userId) ?? false };
  const [row] = await db
    .select({ promoOptIn: schema.users.promoOptIn })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return { avvisiSerate: row?.promoOptIn ?? false };
}

export async function setPreferences(userId: string, prefs: UserPreferences): Promise<void> {
  if (!db) {
    memory.set(userId, prefs.avvisiSerate);
    return;
  }
  await db.update(schema.users).set({ promoOptIn: prefs.avvisiSerate }).where(eq(schema.users.id, userId));
}
