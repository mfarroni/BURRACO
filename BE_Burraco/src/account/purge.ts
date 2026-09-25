import { eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

/** Transazione Drizzle sul nostro schema (quella passata da `db.transaction`). */
type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Nome mostrato nello storico degli avversari al posto di un utente cancellato. */
export const DELETED_USER_NAME = "Utente eliminato";

/**
 * PULIZIA dei dati di un utente registrato, dentro una transazione del chiamante.
 * Unica definizione condivisa da:
 *  - la cancellazione da parte dell'admin (`admin/users.ts#deleteUser`, che scrive
 *    prima la sua riga di audit nella stessa transazione);
 *  - la cancellazione del PROPRIO account (`DrizzleAuthStore#deleteAccount`, Audit
 *    lancio R05).
 *
 *  - rimossi: sessioni, foto profilo, totali statistiche, righe destinatario dei
 *    broadcast, messaggi del form contatti (per id o email), email in coda;
 *  - ANONIMIZZATI (non cancellati): le sue partecipazioni alle partite. Lo storico
 *    appartiene anche agli avversari: la riga resta, ma `user_id` → NULL e il nome →
 *    "Utente eliminato". Idem `matches.aborted_by` → NULL;
 *  - scollegati: eventi/prodotti creati (`created_by` → NULL).
 * Infine la riga `users`.
 */
export async function purgeUserData(tx: Tx, userId: string, email: string | null): Promise<void> {
  await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await tx.delete(schema.userAvatars).where(eq(schema.userAvatars.userId, userId));
  await tx.delete(schema.userStatsTotals).where(eq(schema.userStatsTotals.userId, userId));
  await tx.delete(schema.broadcastRecipients).where(eq(schema.broadcastRecipients.userId, userId));
  await tx.delete(schema.contactMessages).where(
    email
      ? or(eq(schema.contactMessages.userId, userId), sql`lower(${schema.contactMessages.email}) = ${email.toLowerCase()}`)
      : eq(schema.contactMessages.userId, userId),
  );
  if (email) {
    await tx.delete(schema.emailQueue).where(sql`lower(${schema.emailQueue.toEmail}) = ${email.toLowerCase()}`);
  }
  await tx
    .update(schema.matchPlayers)
    .set({ userId: null, displayName: DELETED_USER_NAME })
    .where(eq(schema.matchPlayers.userId, userId));
  await tx.update(schema.matches).set({ abortedBy: null }).where(eq(schema.matches.abortedBy, userId));
  await tx.update(schema.events).set({ createdBy: null }).where(eq(schema.events.createdBy, userId));
  await tx.update(schema.shopProducts).set({ createdBy: null }).where(eq(schema.shopProducts.createdBy, userId));
  await tx.delete(schema.users).where(eq(schema.users.id, userId));
}
