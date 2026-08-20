import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import type { AuthStore, StoredSession, StoredUser } from "./types.js";

/**
 * Implementazione Drizzle/Neon di AuthStore (attiva con `DATABASE_URL`).
 * Mappa 1:1 le tabelle `users`/`sessions` definite in db/schema.ts. Nessun
 * segreto in chiaro: riceve `passwordHash`/`tokenHash` già derivati dal servizio.
 */
type Db = NodePgDatabase<typeof schema>;

function toUser(row: typeof schema.users.$inferSelect): StoredUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    isGuest: row.isGuest,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

function toSession(row: typeof schema.sessions.$inferSelect): StoredSession {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    userId: row.userId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleAuthStore implements AuthStore {
  constructor(private readonly db: Db) {}

  async createUser(input: {
    email: string | null;
    displayName: string;
    passwordHash: string | null;
    isGuest: boolean;
  }): Promise<StoredUser> {
    const [row] = await this.db
      .insert(schema.users)
      .values({
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        isGuest: input.isGuest,
      })
      .returning();
    return toUser(row!);
  }

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    // Confronto case-insensitive: email normalizzata a lowercase.
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return row ? toUser(row) : null;
  }

  async getUserById(id: string): Promise<StoredUser | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return row ? toUser(row) : null;
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredSession> {
    const [row] = await this.db
      .insert(schema.sessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning();
    return toSession(row!);
  }

  async getSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const [row] = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, tokenHash))
      .limit(1);
    return row ? toSession(row) : null;
  }

  async revokeSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.tokenHash, tokenHash), isNull(schema.sessions.revokedAt)));
  }

  async touchLastSeen(userId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.users.id, userId));
  }
}
