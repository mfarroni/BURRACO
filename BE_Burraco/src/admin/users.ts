import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import type { AdminUserRow, AdminUsersResponse } from "./types.js";

/**
 * CICLO Pannello Admin — elenco paginato degli utenti REGISTRATI per la tab Utenti
 * (§2.1). Whitelist in POSITIVO: SOLO id/displayName/email/createdAt (mai hash, token,
 * ip_hash, ruolo). Solo registrati (`is_guest=false`): gli ospiti non compaiono.
 *
 * Paginazione KEYSET su `(created_at DESC, id DESC)`: stabile con inserimenti
 * concorrenti (a differenza dell'offset). Il cursore opaco codifica l'ultima riga
 * della pagina; una pagina successiva prende le righe strettamente "prima" di essa.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Cursore opaco `base64url("<createdAtMs>:<id>")`. Non è un segreto (solo ordinamento). */
function encodeCursor(createdAtMs: number, id: string): string {
  return Buffer.from(`${createdAtMs}:${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAtMs: number; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = raw.indexOf(":");
    if (idx < 0) return null;
    const createdAtMs = Number(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (!Number.isFinite(createdAtMs) || !id) return null;
    return { createdAtMs, id };
  } catch {
    return null;
  }
}

export async function listUsers(opts: { limit?: number; cursor?: string }): Promise<AdminUsersResponse> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)));
  if (!db) return { items: [], nextCursor: null, limit };

  const conds = [eq(schema.users.isGuest, false)];
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (c) {
      const ts = new Date(c.createdAtMs);
      // Tupla keyset: righe strettamente prima di (createdAt, id) nell'ordine DESC.
      conds.push(
        sql`(${schema.users.createdAt} < ${ts} or (${schema.users.createdAt} = ${ts} and ${schema.users.id} < ${c.id}))`,
      );
    }
    // Cursore malformato → ignorato (prima pagina): nessun errore, nessun oracolo.
  }

  // Prende una riga in più per sapere se esiste una pagina successiva.
  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(and(...conds))
    .orderBy(desc(schema.users.createdAt), desc(schema.users.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items: AdminUserRow[] = page.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    email: r.email,
    createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
  }));

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(new Date(last.createdAt).getTime(), last.id) : null;
  return { items, nextCursor, limit };
}
