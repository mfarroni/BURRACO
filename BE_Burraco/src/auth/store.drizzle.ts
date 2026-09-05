import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
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
    expiredAt: row.expiredAt,
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

  async revokeAllForUser(userId: string): Promise<number> {
    const rows = await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
      .returning({ id: schema.sessions.id });
    return rows.length;
  }

  async enforceSessionCap(userId: string, max: number, now: Date): Promise<void> {
    // Sessioni ATTIVE dell'utente (non revocate, non scadute), più recenti prima.
    const active = await this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.userId, userId),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, now),
        ),
      )
      .orderBy(sql`${schema.sessions.createdAt} desc`);
    const toRevoke = active.slice(max).map((r) => r.id);
    if (toRevoke.length === 0) return;
    await this.db
      .update(schema.sessions)
      .set({ revokedAt: now })
      .where(inArray(schema.sessions.id, toRevoke));
  }

  async pruneSessions(now: Date, revokedGraceMs: number): Promise<number> {
    const revokedCutoff = new Date(now.getTime() - revokedGraceMs);
    const rows = await this.db
      .delete(schema.sessions)
      .where(
        or(
          lte(schema.sessions.expiresAt, now),
          and(isNotNull(schema.sessions.revokedAt), lte(schema.sessions.revokedAt, revokedCutoff)),
        ),
      )
      .returning({ id: schema.sessions.id });
    return rows.length;
  }

  async pruneInactiveGuests(cutoff: Date): Promise<number> {
    // Elimina gli OSPITI SCADUTI (expired_at valorizzato) o inattivi (last_seen_at o,
    // se null, created_at < cutoff) che NON hanno più sessioni e NON sono referenziati
    // da alcuna partita — né come partecipante (match_players) né come autore di un
    // annullamento (matches.aborted_by) — così nessun vincolo FK può rompersi (§6.4).
    const rows = await this.db
      .delete(schema.users)
      .where(
        and(
          eq(schema.users.isGuest, true),
          or(
            isNotNull(schema.users.expiredAt),
            lte(sql`coalesce(${schema.users.lastSeenAt}, ${schema.users.createdAt})`, cutoff),
          ),
          sql`not exists (select 1 from ${schema.sessions} s where s.user_id = ${schema.users.id})`,
          sql`not exists (select 1 from ${schema.matchPlayers} mp where mp.user_id = ${schema.users.id})`,
          sql`not exists (select 1 from ${schema.matches} m where m.aborted_by = ${schema.users.id})`,
        ),
      )
      .returning({ id: schema.users.id });
    return rows.length;
  }

  async touchLastSeen(userId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  async markGuestExpired(userId: string, now: Date): Promise<void> {
    // Idempotente e ristretto agli OSPITI non ancora scaduti: sui registrati e sugli
    // ospiti già marcati non modifica nulla (il WHERE non seleziona la riga).
    await this.db
      .update(schema.users)
      .set({ expiredAt: now })
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.isGuest, true),
          isNull(schema.users.expiredAt),
        ),
      );
  }
}
