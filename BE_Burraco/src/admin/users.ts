import { randomInt } from "node:crypto";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { env } from "../config.js";
import { hashPassword } from "../auth/password.js";
import { sendEmail } from "../mail/index.js";
import { incrementSentToday } from "../mail/queue.js";
import { auditValues } from "./audit.js";
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

/* ══════════════ CICLO Webmaster — cancellazione e reset password ══════════════ */

/**
 * Esito di un'operazione amministrativa su un singolo utente. Codici STABILI che
 * l'handler HTTP mappa sugli status: `not_found` (inesistente o ospite) → 404,
 * `forbidden` (se stessi o un altro admin) → 409, `no_db` → 503.
 */
export type AdminUserOpError = "not_found" | "forbidden" | "no_db";

async function loadTarget(
  actorId: string,
  targetId: string,
): Promise<{ ok: true; email: string | null; displayName: string } | { ok: false; error: AdminUserOpError }> {
  if (!db) return { ok: false, error: "no_db" };
  const [u] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      isGuest: schema.users.isGuest,
      role: schema.users.role,
    })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  // Solo REGISTRATI (la tab Utenti non elenca ospiti): un ospite è "non trovato".
  if (!u || u.isGuest) return { ok: false, error: "not_found" };
  // Mai su se stessi né su un altro admin: la revoca di un admin resta manuale (SQL).
  if (u.id === actorId || u.role === "admin") return { ok: false, error: "forbidden" };
  return { ok: true, email: u.email, displayName: u.displayName };
}

/**
 * CANCELLA un utente registrato con PULIZIA dei suoi dati, in UNA transazione con
 * l'audit scritto per primo (§5.1):
 *  - rimossi: sessioni, foto profilo, totali statistiche, righe destinatario dei
 *    broadcast, messaggi del form contatti (per id o email), email in coda;
 *  - ANONIMIZZATI (non cancellati): le sue partecipazioni alle partite. Lo storico
 *    appartiene anche agli avversari: la riga resta, ma `user_id` → NULL e il nome →
 *    "Utente eliminato". Idem `matches.aborted_by` → NULL;
 *  - scollegati: eventi/prodotti creati (`created_by` → NULL).
 * Infine la riga `users`. L'audit registra SOLO l'id (nessun dato personale).
 */
export async function deleteUser(
  actorId: string,
  targetId: string,
): Promise<{ ok: true } | { ok: false; error: AdminUserOpError }> {
  const t = await loadTarget(actorId, targetId);
  if (!t.ok) return t;
  await db!.transaction(async (tx) => {
    await tx.insert(schema.adminAuditLog).values(
      auditValues({ actorId, action: "user.delete", target: { userId: targetId }, outcome: "ok" }),
    );
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, targetId));
    await tx.delete(schema.userAvatars).where(eq(schema.userAvatars.userId, targetId));
    await tx.delete(schema.userStatsTotals).where(eq(schema.userStatsTotals.userId, targetId));
    await tx.delete(schema.broadcastRecipients).where(eq(schema.broadcastRecipients.userId, targetId));
    await tx.delete(schema.contactMessages).where(
      t.email
        ? or(eq(schema.contactMessages.userId, targetId), sql`lower(${schema.contactMessages.email}) = ${t.email.toLowerCase()}`)
        : eq(schema.contactMessages.userId, targetId),
    );
    if (t.email) {
      await tx.delete(schema.emailQueue).where(sql`lower(${schema.emailQueue.toEmail}) = ${t.email.toLowerCase()}`);
    }
    await tx
      .update(schema.matchPlayers)
      .set({ userId: null, displayName: DELETED_USER_NAME })
      .where(eq(schema.matchPlayers.userId, targetId));
    await tx.update(schema.matches).set({ abortedBy: null }).where(eq(schema.matches.abortedBy, targetId));
    await tx.update(schema.events).set({ createdBy: null }).where(eq(schema.events.createdBy, targetId));
    await tx.update(schema.shopProducts).set({ createdBy: null }).where(eq(schema.shopProducts.createdBy, targetId));
    await tx.delete(schema.users).where(eq(schema.users.id, targetId));
  });
  return { ok: true };
}

/** Nome mostrato nello storico degli avversari al posto di un utente cancellato. */
export const DELETED_USER_NAME = "Utente eliminato";

/** Alfabeto della password temporanea: niente caratteri ambigui (0/O, 1/l/I). */
const TEMP_PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const TEMP_PW_LENGTH = 12;

export function generateTempPassword(): string {
  let out = "";
  for (let i = 0; i < TEMP_PW_LENGTH; i++) out += TEMP_PW_ALPHABET[randomInt(TEMP_PW_ALPHABET.length)];
  return out;
}

/**
 * RESET della password di un utente registrato: genera una password TEMPORANEA
 * casuale (CSPRNG), ne salva SOLO l'hash argon2id, REVOCA tutte le sue sessioni e
 * prova a spedirgliela via email (diretta, MAI in coda: il segreto non si persiste in
 * `email_queue`). La password in chiaro torna all'admin UNA volta sola, perché possa
 * comunicarla se l'email non parte (interruttore spento, quota, errore). Audit (solo
 * id + esito email) nella stessa transazione della modifica.
 */
export async function resetUserPassword(
  actorId: string,
  targetId: string,
): Promise<{ ok: true; tempPassword: string; emailed: boolean } | { ok: false; error: AdminUserOpError }> {
  const t = await loadTarget(actorId, targetId);
  if (!t.ok) return t;
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await db!.transaction(async (tx) => {
    await tx.insert(schema.adminAuditLog).values(
      auditValues({ actorId, action: "user.reset_password", target: { userId: targetId }, outcome: "ok" }),
    );
    await tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, targetId));
    await tx
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.userId, targetId), isNull(schema.sessions.revokedAt)));
  });

  let emailed = false;
  if (t.email) {
    const name = t.displayName.trim() || "Giocatore";
    const site = env.publicSiteUrl;
    try {
      const r = await sendEmail({
        to: { email: t.email, name },
        subject: "Burraco del Circolo Nettuno: la tua password è stata reimpostata",
        text: [
          `Ciao ${name},`,
          "",
          "il webmaster ha reimpostato la password del tuo account.",
          `La tua nuova password temporanea è: ${tempPassword}`,
          "",
          "Per sicurezza tutte le sessioni aperte sono state chiuse: accedi di nuovo con",
          "questa password, poi sceglierne una tua dal Profilo con \"Cambia password\".",
          ...(site ? ["", `Entra qui: ${site}`] : []),
          "",
          "Se non hai chiesto tu il reset, rispondi a questa email.",
          "",
          "Il Circolo Nettuno",
        ].join("\n"),
        tags: ["password-reset"],
      });
      if (r.status === "sent") {
        emailed = true;
        await incrementSentToday(1);
      }
    } catch (err) {
      console.error("[admin] email di reset password non inviata:", (err as Error).message);
    }
  }
  return { ok: true, tempPassword, emailed };
}
