import { randomUUID } from "node:crypto";
import type { AuthStore, LoginAttempt, StoredSession, StoredUser } from "./types.js";

/**
 * Implementazione IN-MEMORY di AuthStore (decisione "TESTABILITÀ SENZA DB").
 * Attiva quando `DATABASE_URL` è assente (sviluppo/test). Coerente con la
 * filosofia "stato in RAM": l'auth funziona in locale e nei test senza un
 * Postgres reale. NON è pensata per il multi-istanza (v1 single-instance).
 *
 * Nessuna logica di hashing qui: riceve già `passwordHash`/`tokenHash` dal
 * servizio e li conserva così come sono (mai il segreto in chiaro).
 */
export class MemoryAuthStore implements AuthStore {
  private usersById = new Map<string, StoredUser>();
  private usersByEmail = new Map<string, StoredUser>(); // chiave: email lowercase
  private sessionsByTokenHash = new Map<string, StoredSession>();
  // Lotto 5 (R8): contatore login falliti per chiave hash(email + IP). In RAM per
  // test/dev; in produzione la persistenza è nello store Drizzle (tabella dedicata).
  private loginAttemptsByKey = new Map<string, LoginAttempt>();

  async createUser(input: {
    email: string | null;
    displayName: string;
    passwordHash: string | null;
    isGuest: boolean;
  }): Promise<StoredUser> {
    const user: StoredUser = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      isGuest: input.isGuest,
      // FASE 5.1: nuovi utenti nascono 'user'. La promozione ad 'admin' avviene
      // solo via query manuale sul DB (nessun endpoint la esegue).
      role: "user",
      createdAt: new Date(),
      lastSeenAt: null,
      expiredAt: null,
    };
    this.usersById.set(user.id, user);
    if (user.email) this.usersByEmail.set(user.email.toLowerCase(), user);
    return { ...user };
  }

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const u = this.usersByEmail.get(email.toLowerCase());
    return u ? { ...u } : null;
  }

  async getUserById(id: string): Promise<StoredUser | null> {
    const u = this.usersById.get(id);
    return u ? { ...u } : null;
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredSession> {
    const session: StoredSession = {
      id: randomUUID(),
      tokenHash: input.tokenHash,
      userId: input.userId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.sessionsByTokenHash.set(session.tokenHash, session);
    return { ...session };
  }

  async getSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const s = this.sessionsByTokenHash.get(tokenHash);
    return s ? { ...s } : null;
  }

  async revokeSessionByTokenHash(tokenHash: string): Promise<void> {
    const s = this.sessionsByTokenHash.get(tokenHash);
    if (s && s.revokedAt === null) s.revokedAt = new Date();
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const now = new Date();
    let revoked = 0;
    for (const s of this.sessionsByTokenHash.values()) {
      if (s.userId === userId && s.revokedAt === null) {
        s.revokedAt = now;
        revoked += 1;
      }
    }
    return revoked;
  }

  async enforceSessionCap(userId: string, max: number, now: Date): Promise<void> {
    // Raccoglie le sessioni ATTIVE (non revocate, non scadute) dell'utente, dalla
    // più recente alla più vecchia, e revoca quelle oltre le `max` più recenti.
    const active = [...this.sessionsByTokenHash.values()]
      .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt.getTime() > now.getTime())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const s of active.slice(max)) s.revokedAt = now;
  }

  async pruneSessions(now: Date, revokedGraceMs: number): Promise<number> {
    let removed = 0;
    for (const [hash, s] of this.sessionsByTokenHash) {
      const expired = s.expiresAt.getTime() <= now.getTime();
      const revokedStale = s.revokedAt !== null && s.revokedAt.getTime() + revokedGraceMs <= now.getTime();
      if (expired || revokedStale) {
        this.sessionsByTokenHash.delete(hash);
        removed += 1;
      }
    }
    return removed;
  }

  async pruneInactiveGuests(cutoff: Date): Promise<number> {
    let removed = 0;
    for (const u of [...this.usersById.values()]) {
      if (!u.isGuest) continue;
      // §6.4: eleggibile se SCADUTO (expired_at) oppure inattivo da prima di cutoff.
      const lastActive = (u.lastSeenAt ?? u.createdAt).getTime();
      const eligible = u.expiredAt !== null || lastActive < cutoff.getTime();
      if (!eligible) continue;
      // Non eliminare un ospite che ha ancora una sessione (attiva o non ancora potata).
      // (Lo store in-memory non traccia le partite: la protezione dagli ospiti
      // referenziati da match è nello store Drizzle, via i vincoli `not exists`.)
      const hasSession = [...this.sessionsByTokenHash.values()].some((s) => s.userId === u.id);
      if (hasSession) continue;
      this.usersById.delete(u.id);
      if (u.email) this.usersByEmail.delete(u.email.toLowerCase());
      removed += 1;
    }
    return removed;
  }

  async touchLastSeen(userId: string): Promise<void> {
    const u = this.usersById.get(userId);
    if (u) u.lastSeenAt = new Date();
  }

  async markGuestExpired(userId: string, now: Date): Promise<void> {
    // Idempotente e ristretto agli ospiti non ancora scaduti (mai sui registrati).
    const u = this.usersById.get(userId);
    if (u && u.isGuest && u.expiredAt === null) u.expiredAt = now;
  }

  /* ─────────── Lotto 5 (R8): lockout progressivo del login (in RAM) ─────────── */

  async getLoginAttempt(key: string): Promise<LoginAttempt | null> {
    const a = this.loginAttemptsByKey.get(key);
    // Copia difensiva (le Date non vanno condivise per riferimento con lo store).
    return a
      ? {
          failedCount: a.failedCount,
          windowStartedAt: new Date(a.windowStartedAt),
          lastFailedAt: new Date(a.lastFailedAt),
        }
      : null;
  }

  async recordFailedLogin(key: string, now: Date, windowMs: number): Promise<number> {
    const existing = this.loginAttemptsByKey.get(key);
    // Finestra scaduta per INATTIVITÀ (ultimo fallimento oltre windowMs fa) → azzera.
    const expired = !existing || existing.lastFailedAt.getTime() < now.getTime() - windowMs;
    if (expired) {
      this.loginAttemptsByKey.set(key, {
        failedCount: 1,
        windowStartedAt: new Date(now),
        lastFailedAt: new Date(now),
      });
      return 1;
    }
    existing.failedCount += 1;
    existing.lastFailedAt = new Date(now);
    return existing.failedCount;
  }

  async clearLoginAttempts(key: string): Promise<void> {
    this.loginAttemptsByKey.delete(key);
  }

  async pruneLoginAttempts(cutoff: Date): Promise<number> {
    let removed = 0;
    for (const [k, a] of this.loginAttemptsByKey) {
      if (a.lastFailedAt.getTime() <= cutoff.getTime()) {
        this.loginAttemptsByKey.delete(k);
        removed += 1;
      }
    }
    return removed;
  }
}
