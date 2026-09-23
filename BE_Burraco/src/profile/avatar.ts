import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";

/**
 * FOTO PROFILO dell'utente registrato (migrazione 0012, tabella `user_avatars`).
 *
 * Formato: data URL `data:image/(jpeg|png|webp);base64,…` già RIDIMENSIONATO dal client
 * (256×256). Il server NON si fida del client: valida mime in whitelist (niente SVG, che
 * può contenere script), alfabeto base64 e tetto di dimensione. La foto è visibile SOLO
 * al proprietario (`GET /users/me/avatar`): nessun id nel percorso, nessun IDOR.
 *
 * Senza DB (sviluppo/test) si usa una mappa in RAM, coerente con gli altri store.
 */

/** Tetto del data URL (caratteri): ~110 KB di immagine, ampio per un 256×256 JPEG. */
export const AVATAR_MAX_CHARS = 150_000;

/** Data URL d'immagine ammesso: mime in whitelist + base64 puro (nessun parametro extra). */
export const IMAGE_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const memory = new Map<string, string>();

export async function getAvatar(userId: string): Promise<string | null> {
  if (!db) return memory.get(userId) ?? null;
  const [row] = await db
    .select({ data: schema.userAvatars.data })
    .from(schema.userAvatars)
    .where(eq(schema.userAvatars.userId, userId))
    .limit(1);
  return row?.data ?? null;
}

/** Imposta (o rimuove con `null`) la foto dell'utente. Il dato è già validato dal chiamante. */
export async function setAvatar(userId: string, data: string | null): Promise<void> {
  if (!db) {
    if (data === null) memory.delete(userId);
    else memory.set(userId, data);
    return;
  }
  if (data === null) {
    await db.delete(schema.userAvatars).where(eq(schema.userAvatars.userId, userId));
    return;
  }
  const now = new Date();
  await db
    .insert(schema.userAvatars)
    .values({ userId, data, updatedAt: now })
    .onConflictDoUpdate({ target: schema.userAvatars.userId, set: { data, updatedAt: now } });
}
