import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { env } from "../config.js";
import { sendEmail } from "./index.js";

/**
 * CICLO Pannello Admin — QUOTA email condivisa e CODA transazionale (§1.3).
 *
 * Responsabilità di questo modulo (BE-only):
 *  - contatore giornaliero degli invii ACCETTATI da Brevo (`email_quota_daily`),
 *    fonte di verità del "già inviato oggi" nel fuso `EMAIL_QUOTA_TZ`;
 *  - accodamento delle email TRANSAZIONALI (oggi solo 'benvenuto') in `email_queue`;
 *  - drenaggio della coda transazionale entro un budget (`processEmailQueue`).
 *
 * Il DISPATCHER unico (mail/dispatcher.ts) orchestra: prima questa coda (priorità),
 * poi i broadcast, entrambi entro la quota residua. Qui NON si decide la quota globale.
 *
 * Best-effort come il resto del layer email: senza DB o su errore non solleva.
 */

/** Quante email transazionali processare al massimo per singola passata. */
export const EMAIL_QUEUE_BATCH = 40;

/** Tentativi massimi di invio di una email in coda prima di marcarla 'fallita'. */
export const EMAIL_QUEUE_MAX_ATTEMPTS = 5;

/**
 * Giorno-chiave (YYYY-MM-DD) nel fuso del contatore. `en-CA` formatta proprio come
 * YYYY-MM-DD; `timeZone` applica il fuso del circolo, così il "giorno" segue l'ora
 * locale e non l'UTC del server. Un fuso invalido ripiega su UTC (mai un crash).
 */
export function todayKey(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: env.mail.quotaTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Invii accettati oggi (0 se nessuna riga o senza DB). */
export async function getSentToday(): Promise<number> {
  if (!db) return 0;
  const [row] = await db
    .select({ sent: schema.emailQuotaDaily.sent })
    .from(schema.emailQuotaDaily)
    .where(eq(schema.emailQuotaDaily.day, todayKey()))
    .limit(1);
  return row?.sent ?? 0;
}

/**
 * Incrementa il contatore del giorno di `n` (UPSERT). Chiamata SOLO su esiti 'sent'
 * reali (skipped/error non consumano quota Brevo). Il cambio di giorno crea una nuova
 * riga a partire da `n` (nessun job di reset a mezzanotte).
 */
export async function incrementSentToday(n = 1): Promise<void> {
  if (!db || n <= 0) return;
  const day = todayKey();
  await db
    .insert(schema.emailQuotaDaily)
    .values({ day, sent: n })
    .onConflictDoUpdate({
      target: schema.emailQuotaDaily.day,
      set: { sent: sql`${schema.emailQuotaDaily.sent} + ${n}`, updatedAt: new Date() },
    });
}

/** Stato della quota: tetto, inviato oggi, residuo (mai negativo). */
export async function getQuotaStatus(): Promise<{ cap: number; sent: number; remaining: number }> {
  const cap = env.mail.dailyCap;
  const sent = await getSentToday();
  return { cap, sent, remaining: Math.max(0, cap - sent) };
}

/**
 * Accoda una email di BENVENUTO (priorità massima). Solo INSERT, veloce: la chiamata
 * a valle di `POST /auth/register` non deve mai attendere o fallire per l'email. Il
 * corpo è testo semplice, GIÀ composto qui (nessun HTML). Se manca `PUBLIC_SITE_URL`
 * la welcome viene comunque accodata, senza il link.
 *
 * SEC-ADM-02 — RISCHIO ACCETTATO (decisione lead 2026-09-22, R2). Registrando l'email
 * di una vittima non ancora iscritta, questa riceve la welcome col saluto "Ciao <name>,"
 * dove `<name>` (≤40 char) è scelto dall'attaccante: possibile amplificazione phishing.
 * Non è mitigabile con un doppio opt-in senza contraddire la decisione "welcome = solo
 * notifica, nessuna verifica/attivazione, login mai bloccato" (coerente con SEC-A2).
 * Header injection NON applicabile (email validata, `stripCtl`, corpo `text` puro):
 * iniettabile solo il breve saluto. Vettore ridotto da rate-limit (50/15min per IP) e
 * cap giornaliero (BREVO_DAILY_CAP). Nessuna modifica funzionale in questo ciclo.
 */
export async function enqueueWelcome(input: { toEmail: string; displayName: string }): Promise<void> {
  if (!db) return;
  const name = (input.displayName ?? "").trim() || "Giocatore";
  const site = env.publicSiteUrl;
  const subject = "Benvenuto nel Burraco del Circolo Nettuno";
  const body = [
    `Ciao ${name},`,
    "",
    "grazie per esserti registrato al Burraco del Circolo Nettuno.",
    "Da ora puoi accedere, sederti a un tavolo e iniziare a giocare.",
    ...(site ? ["", `Entra qui: ${site}`] : []),
    "",
    "A presto,",
    "il Circolo Nettuno",
  ].join("\n");
  try {
    await db.insert(schema.emailQueue).values({
      tipo: "benvenuto",
      toEmail: input.toEmail,
      toName: name,
      subject,
      body,
      priorita: 0,
    });
  } catch (err) {
    console.error("[mail-queue] enqueue benvenuto fallito:", (err as Error).message);
  }
}

/**
 * Drena la coda transazionale entro `limit` invii (e comunque ≤ EMAIL_QUEUE_BATCH),
 * ordine (priorita, created_at): i più prioritari e a parità i più vecchi. Per ogni
 * item chiama `sendEmail()`:
 *  - 'sent'      → contatore++, stato='inviata', continua;
 *  - 'quota'     → STOP per oggi (l'item resta 'in_attesa': carry-over), quotaHit=true;
 *  - 'disabled'  → STOP senza errore (interruttore spento: l'item resta 'in_attesa');
 *  - 'error'     → tentativi++, e 'fallita' oltre EMAIL_QUEUE_MAX_ATTEMPTS.
 *
 * Ritorna quanti invii 'sent' ha effettuato e se ha incontrato il limite di quota.
 */
export async function processEmailQueue(limit: number): Promise<{ sent: number; quotaHit: boolean }> {
  if (!db || limit <= 0) return { sent: 0, quotaHit: false };
  const batch = Math.min(limit, EMAIL_QUEUE_BATCH);
  const pending = await db
    .select({
      id: schema.emailQueue.id,
      tipo: schema.emailQueue.tipo,
      toEmail: schema.emailQueue.toEmail,
      toName: schema.emailQueue.toName,
      subject: schema.emailQueue.subject,
      body: schema.emailQueue.body,
      tentativi: schema.emailQueue.tentativi,
    })
    .from(schema.emailQueue)
    .where(eq(schema.emailQueue.stato, "in_attesa"))
    .orderBy(asc(schema.emailQueue.priorita), asc(schema.emailQueue.createdAt))
    .limit(batch);

  let sent = 0;
  for (const item of pending) {
    if (sent >= limit) break;
    const result = await sendEmail({
      to: { email: item.toEmail, name: item.toName ?? undefined },
      subject: item.subject,
      text: item.body,
      tags: [`queue:${item.tipo}`],
    });

    if (result.status === "sent") {
      // SEC-ADM-01 (difesa in profondità): l'UPDATE 'inviata' è guardato dallo stato
      // 'in_attesa'; l'invio è "contato" (quota + sent) SOLO se questo tick ha davvero
      // transizionato la riga (`claimed.length === 1`). Su singola istanza la guardia
      // di re-entrancy garantisce un solo runner, quindi il claim va sempre a buon fine;
      // il claim è la rete di sicurezza che evita doppio conteggio se due tick si
      // sovrapponessero comunque. `.returning()` (node-postgres) espone le righe incise.
      const claimed = await db
        .update(schema.emailQueue)
        .set({ stato: "inviata", sentAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.emailQueue.id, item.id), eq(schema.emailQueue.stato, "in_attesa")))
        .returning({ id: schema.emailQueue.id });
      if (claimed.length > 0) {
        await incrementSentToday(1);
        sent += 1;
      }
      continue;
    }
    if (result.status === "skipped" && result.reason === "quota") {
      // Carry-over: l'item resta 'in_attesa' e riparte l'indomani. Stop per oggi.
      return { sent, quotaHit: true };
    }
    if (result.status === "skipped" && result.reason === "disabled") {
      // Interruttore spento: nessun invio possibile ora, l'item resta 'in_attesa'.
      return { sent, quotaHit: false };
    }
    // Errore transitorio/provider: incrementa i tentativi; oltre il tetto → 'fallita'.
    const tentativi = item.tentativi + 1;
    await db
      .update(schema.emailQueue)
      .set({
        tentativi,
        stato: tentativi >= EMAIL_QUEUE_MAX_ATTEMPTS ? "fallita" : "in_attesa",
        updatedAt: new Date(),
      })
      .where(and(eq(schema.emailQueue.id, item.id), eq(schema.emailQueue.stato, "in_attesa")));
  }
  return { sent, quotaHit: false };
}
