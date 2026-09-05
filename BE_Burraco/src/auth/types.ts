/**
 * CONTRATTO INTERNO del layer di autenticazione (BE-only).
 *
 * La persistenza è astratta dietro `AuthStore` (decisione "TESTABILITÀ SENZA DB"
 * del PIANO): due implementazioni intercambiabili
 *  - Drizzle/Neon quando `DATABASE_URL` è presente (produzione);
 *  - in-memory quando è assente (sviluppo/test), coerente con lo stato "in RAM".
 *
 * Nessun tipo qui viene esposto ai client: il CONTRATTO pubblico verso il FE è
 * definito altrove (DTO HTTP in http.ts, evento WS in contract/types.ts). Il FE
 * ne tiene una copia allineata a mano (nessun package condiviso).
 */

/** Record utente COMPLETO come vive nello store (include l'hash password). */
export interface StoredUser {
  id: string;
  email: string | null;
  displayName: string;
  passwordHash: string | null;
  isGuest: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  /**
   * Igiene sessioni (§6.4): marca temporale di SCADENZA del record OSPITE all'uscita.
   * `null` finché l'ospite è attivo e SEMPRE per gli account registrati. Non implica
   * cancellazione: quella avviene nello sweep solo se l'ospite non è più referenziato.
   */
  expiredAt: Date | null;
}

/** Record di sessione come vive nello store (contiene SOLO l'hash del token). */
export interface StoredSession {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * Vista pubblica dell'utente restituita dagli endpoint auth. NON contiene mai
 * l'hash password né alcun segreto.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
  isGuest: boolean;
}

/**
 * Principale risolto da un token di sessione valido. È ciò che il layer WS usa
 * per assegnare il posto: il `displayName` è AUTORITATIVO (dal server), non
 * quello arbitrario inviato dal client (anti-spoof).
 */
export interface AuthPrincipal {
  userId: string;
  displayName: string;
  isGuest: boolean;
}

/**
 * Porta di persistenza dell'auth. Tutte le operazioni sono async per uniformità
 * tra l'implementazione DB (query) e quella in-memory (Promise risolta subito).
 * L'AuthStore NON conosce hashing di password né generazione di token: quelle
 * sono responsabilità del servizio (separazione delle competenze).
 */
export interface AuthStore {
  createUser(input: {
    email: string | null;
    displayName: string;
    passwordHash: string | null;
    isGuest: boolean;
  }): Promise<StoredUser>;

  /** Lookup case-insensitive per email (registrati). `null` se assente. */
  getUserByEmail(email: string): Promise<StoredUser | null>;

  getUserById(id: string): Promise<StoredUser | null>;

  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredSession>;

  getSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;

  /** Revoca idempotente: imposta `revoked_at` se non già revocata. */
  revokeSessionByTokenHash(tokenHash: string): Promise<void>;

  /**
   * SEC-A4: revoca TUTTE le sessioni ATTIVE del principale ("esci da tutti i
   * dispositivi"). Idempotente. Ritorna il numero di sessioni effettivamente
   * revocate (utile ai test; il chiamante può ignorarlo).
   */
  revokeAllForUser(userId: string): Promise<number>;

  /**
   * SEC-A4: mantiene al massimo `max` sessioni ATTIVE (non revocate, non scadute a
   * `now`) per utente, revocando le più VECCHIE in eccesso. Chiamato alla
   * creazione di ogni sessione: limita la crescita illimitata dei token.
   */
  enforceSessionCap(userId: string, max: number, now: Date): Promise<void>;

  /**
   * SEC-A3b (pruning): elimina DEFINITIVAMENTE le sessioni SCADUTE (`expires_at`
   * ≤ `now`) o REVOCATE da oltre `revokedGraceMs` (finestra d'audit). Ritorna il
   * numero di righe eliminate. Nessun impatto sul gioco.
   */
  pruneSessions(now: Date, revokedGraceMs: number): Promise<number>;

  /**
   * SEC-A3b + §6.4 (pruning): elimina fisicamente gli utenti OSPITI che sono
   * SCADUTI (`expired_at` valorizzato dall'uscita) OPPURE inattivi da prima di
   * `cutoff` (per `last_seen_at`, o `created_at` se mai visti), a condizione che NON
   * abbiano più sessioni e NON siano referenziati da alcuna partita (né come
   * partecipante né come autore di un annullamento). Gli ospiti ancora referenziati
   * restano, marcati come scaduti. Gli account registrati non vengono mai eliminati.
   * Ritorna il numero di righe eliminate.
   */
  pruneInactiveGuests(cutoff: Date): Promise<number>;

  /** Best-effort: aggiorna `last_seen_at`. Un fallimento non è mai fatale. */
  touchLastSeen(userId: string): Promise<void>;

  /**
   * §6.4: marca un OSPITE come scaduto (`expired_at = now`) all'uscita. Idempotente
   * (non sovrascrive una scadenza già impostata) e ristretto agli ospiti: sui
   * registrati è un no-op (l'account non viene mai toccato). NON cancella nulla: la
   * cancellazione fisica è demandata allo sweep, e solo se non più referenziato.
   */
  markGuestExpired(userId: string, now: Date): Promise<void>;
}
