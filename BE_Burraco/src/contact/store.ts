import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import type { ContactSendStatus, ContactStore, ContactSubmission } from "./types.js";

/**
 * Persistenza dei messaggi del form contatti. Due implementazioni intercambiabili
 * (stessa filosofia di AuthStore/StatsStore):
 *  - Drizzle/Neon con `DATABASE_URL`;
 *  - in-memory senza (test/dev): il messaggio "si salva" comunque in RAM, così
 *    l'invariante "sempre salvato prima dell'email" resta verificabile.
 */

class DrizzleContactStore implements ContactStore {
  async save(input: ContactSubmission): Promise<string | null> {
    const [row] = await db!
      .insert(schema.contactMessages)
      .values({
        nome: input.nome,
        email: input.email,
        oggetto: input.oggetto,
        messaggio: input.messaggio,
        userId: input.userId,
        ipHash: input.ipHash,
        statoInvio: "salvato",
      })
      .returning({ id: schema.contactMessages.id });
    return row?.id ?? null;
  }

  async markSendStatus(id: string, status: ContactSendStatus): Promise<void> {
    await db!
      .update(schema.contactMessages)
      .set({ statoInvio: status })
      .where(eq(schema.contactMessages.id, id));
  }
}

export class MemoryContactStore implements ContactStore {
  /** Esposto per i test: elenco dei messaggi salvati con il loro stato d'invio. */
  readonly messages: (ContactSubmission & { id: string; statoInvio: ContactSendStatus })[] = [];

  async save(input: ContactSubmission): Promise<string | null> {
    const id = randomUUID();
    this.messages.push({ ...input, id, statoInvio: "salvato" });
    return id;
  }

  async markSendStatus(id: string, status: ContactSendStatus): Promise<void> {
    const m = this.messages.find((x) => x.id === id);
    if (m) m.statoInvio = status;
  }
}

export function createContactStore(): ContactStore {
  if (db) return new DrizzleContactStore();
  return new MemoryContactStore();
}
