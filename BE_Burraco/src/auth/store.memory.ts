import { randomUUID } from "node:crypto";
import type { AuthStore, StoredSession, StoredUser } from "./types.js";

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
      createdAt: new Date(),
      lastSeenAt: null,
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

  async touchLastSeen(userId: string): Promise<void> {
    const u = this.usersById.get(userId);
    if (u) u.lastSeenAt = new Date();
  }
}
