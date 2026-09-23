import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { env } from "../config.js";
import { sendEmail } from "../mail/index.js";
import { getQuotaStatus, incrementSentToday } from "../mail/queue.js";
import { logAppEvent } from "../events/log.js";
import type { BroadcastCreateResponse, BroadcastCriterio, BroadcastRow, BroadcastTipo } from "../admin/types.js";

/**
 * FASE 5.3 — Comunicazioni ai registrati (Blocco B). Invio ASINCRONO a lotti, mai
 * in linea con la risposta HTTP (centinaia di destinatari → timeout su Render). Un
 * `sendEmail()` per destinatario (mai indirizzi in copia). Idempotenza garantita da
 * UNIQUE(broadcast_id, user_id): un doppio `send` non duplica.
 *
 * Consenso: le comunicazioni di SERVIZIO sono sempre inviabili; le PROMOZIONALI
 * richiedono `promo_opt_in=true` e includono il link di disiscrizione.
 */

/**
 * Dimensione del lotto per tick del worker. ⚠️ Da confermare col TETTO GIORNALIERO
 * reale Brevo (Gate 2): superarlo silenziosamente = comunicazioni perse. Valore di
 * lavoro prudente in attesa della verifica in console.
 */
export const BROADCAST_BATCH_SIZE = 40;

const num = (v: unknown): number => Number(v ?? 0);

interface Recipient {
  userId: string;
  email: string;
  displayName: string;
}

/**
 * Risolve i destinatari REGISTRATI (mai ospiti: is_guest=false) secondo il criterio.
 * Per le promozionali filtra su `promo_opt_in=true` (consenso). Un criterio "vuoto"
 * (nessun filtro e non `all`) → nessun destinatario (evita invii accidentali a tutti).
 */
export async function resolveRecipients(criterio: BroadcastCriterio, tipo: BroadcastTipo): Promise<Recipient[]> {
  if (!db) return [];
  const conds = [eq(schema.users.isGuest, false), isNotNull(schema.users.email)];
  if (tipo === "promozionale") conds.push(eq(schema.users.promoOptIn, true));

  const hasFilter =
    criterio.all === true ||
    criterio.registratiDopo !== undefined ||
    criterio.minPartite !== undefined ||
    criterio.inattiviDaGiorni !== undefined ||
    (criterio.userIds !== undefined && criterio.userIds.length > 0);
  if (!hasFilter) return [];

  if (!criterio.all) {
    if (criterio.registratiDopo !== undefined) {
      conds.push(gte(schema.users.createdAt, new Date(criterio.registratiDopo)));
    }
    if (criterio.inattiviDaGiorni !== undefined) {
      const c = new Date(Date.now() - criterio.inattiviDaGiorni * 24 * 60 * 60 * 1000);
      conds.push(lt(sql`coalesce(${schema.users.lastSeenAt}, ${schema.users.createdAt})`, c));
    }
    if (criterio.minPartite !== undefined) {
      conds.push(
        sql`(select count(*) from ${schema.matchPlayers} mp join ${schema.matches} m on m.id = mp.match_id
             where mp.user_id = ${schema.users.id} and m.status = 'completed') >= ${criterio.minPartite}`,
      );
    }
    // Selezione manuale dalla tab Utenti: si combina (AND) con gli altri filtri e
    // resta soggetta a registrato + email + consenso promozionale.
    if (criterio.userIds !== undefined && criterio.userIds.length > 0) {
      conds.push(inArray(schema.users.id, criterio.userIds));
    }
  }

  const rows = await db
    .select({ userId: schema.users.id, email: schema.users.email, displayName: schema.users.displayName })
    .from(schema.users)
    .where(and(...conds));
  return rows.filter((r): r is Recipient => r.email !== null);
}

/**
 * Crea la comunicazione (stato 'bozza'); in dry-run non persiste, solo conta+campione.
 * In entrambi i casi allega lo stato della QUOTA giornaliera (§2.3): `quotaCap`,
 * `quotaRemaining` e `quotaSufficiente` (destinatari ≤ residuo). Con carry-over (D1)
 * l'invio oltre quota non è bloccato: l'UI usa `quotaSufficiente=false` per avvisare
 * che l'invio si completerà in più giorni.
 */
export async function createBroadcast(
  authorId: string,
  input: { oggetto: string; corpo: string; tipo: BroadcastTipo; criterio: BroadcastCriterio; dryRun: boolean },
): Promise<BroadcastCreateResponse> {
  const recipients = await resolveRecipients(input.criterio, input.tipo);
  const sample = recipients.slice(0, 5).map((r) => r.displayName);
  const { cap, remaining } = await getQuotaStatus();
  const quota = { quotaCap: cap, quotaRemaining: remaining, quotaSufficiente: recipients.length <= remaining };
  if (input.dryRun || !db) {
    return { id: null, count: recipients.length, sample, dryRun: true, ...quota };
  }
  const [row] = await db
    .insert(schema.broadcasts)
    .values({
      authorId,
      oggetto: input.oggetto,
      corpo: input.corpo,
      tipo: input.tipo,
      criterio: input.criterio,
      stato: "bozza",
    })
    .returning({ id: schema.broadcasts.id });
  return { id: row?.id ?? null, count: recipients.length, sample, dryRun: false, ...quota };
}

/**
 * Avvia l'invio: marca 'in_invio' e ACCODA i destinatari (in_coda) idempotentemente
 * (ON CONFLICT DO NOTHING su broadcast_id+user_id). Ritorna subito; il worker invia.
 * Un doppio `send` non ricrea le righe già presenti né re-invia quelle 'inviato'.
 */
export async function enqueueSend(broadcastId: string): Promise<{ accepted: boolean; queued: number }> {
  if (!db) return { accepted: false, queued: 0 };
  const [b] = await db
    .select({ id: schema.broadcasts.id, tipo: schema.broadcasts.tipo, criterio: schema.broadcasts.criterio })
    .from(schema.broadcasts)
    .where(eq(schema.broadcasts.id, broadcastId))
    .limit(1);
  if (!b) return { accepted: false, queued: 0 };

  const recipients = await resolveRecipients(b.criterio as BroadcastCriterio, b.tipo as BroadcastTipo);
  await db.update(schema.broadcasts).set({ stato: "in_invio" }).where(eq(schema.broadcasts.id, broadcastId));
  if (recipients.length === 0) {
    await db.update(schema.broadcasts).set({ stato: "completato" }).where(eq(schema.broadcasts.id, broadcastId));
    return { accepted: true, queued: 0 };
  }
  await db
    .insert(schema.broadcastRecipients)
    .values(recipients.map((r) => ({ broadcastId, userId: r.userId, stato: "in_coda" as const })))
    .onConflictDoNothing({ target: [schema.broadcastRecipients.broadcastId, schema.broadcastRecipients.userId] });
  return { accepted: true, queued: recipients.length };
}

/** Costruisce il link di disiscrizione, se è configurato l'URL pubblico. */
function unsubLine(token: string): string {
  if (!env.publicBaseUrl) return "";
  return `\n\n—\nPer non ricevere più comunicazioni promozionali: ${env.publicBaseUrl}/unsubscribe?token=${token}`;
}

/**
 * Processa i destinatari in coda entro un budget di quota (`maxSends`, ≤
 * BROADCAST_BATCH_SIZE per tick), i più vecchi per primi. Un'email per destinatario.
 * Ri-verifica il consenso promozionale al momento dell'invio. Alla fine marca
 * 'completato' i broadcast senza più code. Best-effort: senza DB o su errore non solleva.
 *
 * Quota-aware (§1.3): ogni invio 'sent' incrementa il contatore giornaliero condiviso.
 *  - `sent`      → 'inviato' + contatore++;
 *  - `quota`     → STOP per oggi, l'item resta 'in_coda' (carry-over, D1), quotaHit=true;
 *  - `disabled`  → STOP senza errore, l'item resta 'in_coda';
 *  - errore/consenso/ospite/email assente → 'errore'/'saltato' (nessun carry-over).
 *
 * `maxSends` limita gli INVII, non le righe esaminate: i 'saltato' (consenso/validità)
 * non consumano quota. Default = BROADCAST_BATCH_SIZE (retro-compatibile).
 */
export async function processPendingBroadcasts(
  maxSends: number = BROADCAST_BATCH_SIZE,
): Promise<{ processed: number; sent: number; quotaHit: boolean }> {
  if (!db) return { processed: 0, sent: 0, quotaHit: false };
  if (maxSends <= 0) return { processed: 0, sent: 0, quotaHit: false };
  try {
    const pending = await db
      .select({
        rid: schema.broadcastRecipients.id,
        broadcastId: schema.broadcastRecipients.broadcastId,
        userId: schema.broadcastRecipients.userId,
        oggetto: schema.broadcasts.oggetto,
        corpo: schema.broadcasts.corpo,
        tipo: schema.broadcasts.tipo,
        email: schema.users.email,
        displayName: schema.users.displayName,
        isGuest: schema.users.isGuest,
        promoOptIn: schema.users.promoOptIn,
        unsubToken: schema.users.unsubToken,
      })
      .from(schema.broadcastRecipients)
      .innerJoin(schema.broadcasts, eq(schema.broadcasts.id, schema.broadcastRecipients.broadcastId))
      .leftJoin(schema.users, eq(schema.users.id, schema.broadcastRecipients.userId))
      .where(eq(schema.broadcastRecipients.stato, "in_coda"))
      .orderBy(schema.broadcastRecipients.updatedAt)
      .limit(Math.min(maxSends, BROADCAST_BATCH_SIZE));

    if (pending.length === 0) {
      // Nessuna coda: promuovi a 'completato' i broadcast 'in_invio' senza pendenti.
      await db.execute(sql`
        update ${schema.broadcasts} set stato = 'completato'
        where stato = 'in_invio'
          and not exists (
            select 1 from ${schema.broadcastRecipients} r
            where r.broadcast_id = ${schema.broadcasts.id} and r.stato = 'in_coda'
          )`);
      return { processed: 0, sent: 0, quotaHit: false };
    }

    let processed = 0;
    let sent = 0;
    for (const r of pending) {
      if (sent >= maxSends) break;
      processed += 1;
      // Destinatario non valido / ospite / consenso promozionale revocato → saltato.
      const promoBlocked = r.tipo === "promozionale" && !r.promoOptIn;
      if (!r.email || r.isGuest || promoBlocked) {
        await db.update(schema.broadcastRecipients).set({ stato: "saltato", updatedAt: new Date() }).where(eq(schema.broadcastRecipients.id, r.rid));
        continue;
      }
      // Per le promozionali assicura un unsub_token (lazy) e aggiunge il link.
      let token = r.unsubToken ?? "";
      if (r.tipo === "promozionale" && !token) {
        token = randomUUID();
        await db.update(schema.users).set({ unsubToken: token }).where(eq(schema.users.id, r.userId));
      }
      const text = r.tipo === "promozionale" ? `${r.corpo}${unsubLine(token)}` : r.corpo;
      const result = await sendEmail({
        to: { email: r.email, name: r.displayName ?? undefined },
        subject: r.oggetto,
        text,
        tags: [`broadcast:${r.broadcastId}`],
      });

      if (result.status === "sent") {
        // SEC-ADM-01 (difesa in profondità): l'UPDATE 'inviato' è guardato dallo stato
        // 'in_coda'; l'invio è "contato" (quota + sent) SOLO se questo tick ha davvero
        // transizionato la riga (`claimed.length === 1`). La guardia di re-entrancy del
        // dispatcher assicura un solo runner (claim sempre riuscito); il claim resta la
        // rete di sicurezza contro il doppio conteggio in caso di sovrapposizione.
        // Non altera i conteggi di `listBroadcasts` (esito finale 'inviato' identico)
        // né il carry-over (quota/disabled continuano a lasciare la riga 'in_coda').
        const claimed = await db
          .update(schema.broadcastRecipients)
          .set({ stato: "inviato", updatedAt: new Date() })
          .where(and(eq(schema.broadcastRecipients.id, r.rid), eq(schema.broadcastRecipients.stato, "in_coda")))
          .returning({ id: schema.broadcastRecipients.id });
        if (claimed.length > 0) {
          await incrementSentToday(1);
          sent += 1;
        }
        continue;
      }
      if (result.status === "skipped" && result.reason === "quota") {
        // Carry-over: l'item resta 'in_coda' e riparte l'indomani. Stop per oggi.
        void logAppEvent("info", "broadcast", `quota esaurita: invio ripreso domani (inviati oggi ${sent})`);
        return { processed, sent, quotaHit: true };
      }
      if (result.status === "skipped" && result.reason === "disabled") {
        // Interruttore spento: l'item resta 'in_coda', nessun errore.
        return { processed, sent, quotaHit: false };
      }
      // Errore transitorio/provider: marca 'errore' (nessun carry-over automatico).
      await db.update(schema.broadcastRecipients).set({ stato: "errore", updatedAt: new Date() }).where(eq(schema.broadcastRecipients.id, r.rid));
    }

    void logAppEvent("info", "broadcast", `lotto broadcast processato: ${processed} (inviati ${sent})`);
    return { processed, sent, quotaHit: false };
  } catch (err) {
    console.error("[broadcast] worker fallito:", (err as Error).message);
    void logAppEvent("error", "broadcast", "worker broadcast fallito", { message: (err as Error).message });
    return { processed: 0, sent: 0, quotaHit: false };
  }
}

/** Elenco delle comunicazioni con lo stato e i conteggi per destinatario. */
export async function listBroadcasts(): Promise<BroadcastRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: schema.broadcasts.id,
      oggetto: schema.broadcasts.oggetto,
      tipo: schema.broadcasts.tipo,
      stato: schema.broadcasts.stato,
      createdAt: schema.broadcasts.createdAt,
    })
    .from(schema.broadcasts)
    .orderBy(sql`${schema.broadcasts.createdAt} desc`)
    .limit(100);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const counts = await db
    .select({
      broadcastId: schema.broadcastRecipients.broadcastId,
      stato: schema.broadcastRecipients.stato,
      n: sql<number>`count(*)`,
    })
    .from(schema.broadcastRecipients)
    .where(inArray(schema.broadcastRecipients.broadcastId, ids))
    .groupBy(schema.broadcastRecipients.broadcastId, schema.broadcastRecipients.stato);

  return rows.map((r) => {
    const c = counts.filter((x) => x.broadcastId === r.id);
    const of = (s: string) => num(c.find((x) => x.stato === s)?.n);
    return {
      id: r.id,
      oggetto: r.oggetto,
      tipo: r.tipo as BroadcastTipo,
      stato: r.stato,
      createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
      recipients: { inCoda: of("in_coda"), inviato: of("inviato"), errore: of("errore"), saltato: of("saltato") },
    };
  });
}

/**
 * Disiscrizione promozionale via token pubblico. Idempotente: token ignoto → false
 * (nessun oracolo utile). Azzera solo `promo_opt_in`; non tocca altro.
 */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  if (!db || !token) return false;
  const rows = await db
    .update(schema.users)
    .set({ promoOptIn: false })
    .where(and(eq(schema.users.unsubToken, token), eq(schema.users.promoOptIn, true)))
    .returning({ id: schema.users.id });
  // Anche se era già disiscritto (0 righe) rispondiamo "ok" a livello di endpoint:
  // qui distinguiamo solo se il token esiste, per il log.
  if (rows.length > 0) return true;
  const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.unsubToken, token)).limit(1);
  return !!exists;
}
