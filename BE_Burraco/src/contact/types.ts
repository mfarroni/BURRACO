/**
 * CONTRATTO INTERNO del form contatti (BE-only, §2). I DTO HTTP vivono qui (modulo
 * NUOVO), NON in `contract/types.ts`: quel file è il contratto DI GIOCO e resta
 * intoccato (decisione #8). La copia FE è un file nuovo (`lib/contact.ts`), mai
 * `lib/contract.ts`.
 */

/** Esito d'invio email tracciato sulla riga (mai rivelato all'utente). */
export type ContactSendStatus = "salvato" | "inviato" | "errore_invio" | "skippato";

/** Dati persistiti di un messaggio del form (già validati/sanificati a monte). */
export interface ContactSubmission {
  nome: string;
  email: string;
  oggetto: string;
  messaggio: string;
  /** Utente autenticato che ha inviato, se presente (form pubblico → nullable). */
  userId: string | null;
  /** sha256(ip + salt): mai l'IP in chiaro. */
  ipHash: string;
}

/**
 * Persistenza dei messaggi. Astratta come AuthStore/StatsStore: Drizzle con DB,
 * in-memory senza (test/dev). L'INSERT non deve fallire silenziosamente (§2.4):
 * `save` ritorna l'id creato, o `null` se non c'è persistenza (DB assente).
 */
export interface ContactStore {
  save(input: ContactSubmission): Promise<string | null>;
  markSendStatus(id: string, status: ContactSendStatus): Promise<void>;
}
