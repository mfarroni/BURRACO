import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { logAppEvent } from "../events/log.js";
import { recordAdminAudit } from "../admin/audit.js";
import { RETENTION, scheduledRetentionMode, type RetentionMode } from "./constants.js";
import { supportClicksExpiredCond } from "../metrics/supportClicks.js";

/**
 * FASE 4 — Framework di RETENTION. Ogni processo:
 *  - supporta DRY-RUN (conta senza cancellare) — default dello scheduler (§4.4);
 *  - scrive un AUDIT/EVENTO con quante righe (avrebbe) rimosso e da quale tabella;
 *  - è best-effort: senza DB (o su errore) non solleva mai.
 *
 * ATTENZIONE ai limiti dello scope:
 *  - la pulizia OSPITI (referenziati, via denormalizzazione del nome) è pienamente
 *    implementata (real, quando la modalità è "live");
 *  - l'ANONIMIZZAZIONE di account REGISTRATI inattivi è SOLO DETECTION + DRY-RUN
 *    (nessun percorso live): resta in attesa del Gate 4.
 */

export type RetentionStep =
  | "contact_messages"
  | "app_events"
  | "app_events_cap"
  | "admin_audit_log"
  | "broadcast_recipients"
  | "support_clicks"
  | "detail"
  | "game_events"
  | "matches"
  | "referenced_guests"
  | "inactive_accounts_detected";

export interface RetentionStepReport {
  step: RetentionStep;
  /** Righe che soddisfano il criterio (in dry-run = quante sarebbero rimosse). */
  matched: number;
  /** Righe effettivamente rimosse (0 in dry-run). */
  removed: number;
  dryRun: boolean;
}

function cutoff(ms: number): Date {
  return new Date(Date.now() - ms);
}

/** Conta le righe che soddisfano una condizione su una tabella. */
async function countWhere(table: typeof schema.contactMessages | typeof schema.appEvents | typeof schema.adminAuditLog | typeof schema.broadcastRecipients, where: ReturnType<typeof and>): Promise<number> {
  const [row] = await db!
    .select({ n: sql<number>`count(*)` })
    .from(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(where as any);
  return Number(row?.n ?? 0);
}

/* ───────────────────────────── singoli processi ──────────────────────────── */

/** Messaggi contatti: 180gg dopo `letto_at`, o dopo `created_at` se mai letto. */
async function pruneContactMessages(dryRun: boolean): Promise<RetentionStepReport> {
  const c = cutoff(RETENTION.contactMessagesMs);
  const cond = or(
    and(isNotNull(schema.contactMessages.lettoAt), lt(schema.contactMessages.lettoAt, c)),
    lt(schema.contactMessages.createdAt, c),
  );
  const matched = await countWhere(schema.contactMessages, cond);
  let removed = 0;
  if (!dryRun && matched > 0) {
    const rows = await db!.delete(schema.contactMessages).where(cond).returning({ id: schema.contactMessages.id });
    removed = rows.length;
  }
  return { step: "contact_messages", matched, removed, dryRun };
}

/** Log applicativi: oltre 90gg. */
async function pruneAppEvents(dryRun: boolean): Promise<RetentionStepReport> {
  const c = cutoff(RETENTION.appEventsMs);
  const cond = lt(schema.appEvents.createdAt, c);
  const matched = await countWhere(schema.appEvents, cond);
  let removed = 0;
  if (!dryRun && matched > 0) {
    const rows = await db!.delete(schema.appEvents).where(cond).returning({ id: schema.appEvents.id });
    removed = rows.length;
  }
  return { step: "app_events", matched, removed, dryRun };
}

/** Tetto righe app_events: pota le più vecchie oltre il cap. */
async function pruneAppEventsCap(dryRun: boolean): Promise<RetentionStepReport> {
  const [row] = await db!.select({ n: sql<number>`count(*)` }).from(schema.appEvents);
  const total = Number(row?.n ?? 0);
  const excess = Math.max(0, total - RETENTION.appEventsRowCap);
  let removed = 0;
  if (!dryRun && excess > 0) {
    // Le più vecchie oltre il cap (subquery per id, ordinata per data desc).
    const keep = db!
      .select({ id: schema.appEvents.id })
      .from(schema.appEvents)
      .orderBy(sql`${schema.appEvents.createdAt} desc`)
      .limit(RETENTION.appEventsRowCap);
    const rows = await db!
      .delete(schema.appEvents)
      .where(sql`${schema.appEvents.id} not in (${keep})`)
      .returning({ id: schema.appEvents.id });
    removed = rows.length;
  }
  return { step: "app_events_cap", matched: excess, removed, dryRun };
}

/** Traccia amministrativa: oltre 12 mesi. */
async function pruneAdminAudit(dryRun: boolean): Promise<RetentionStepReport> {
  const c = cutoff(RETENTION.adminAuditMs);
  const cond = lt(schema.adminAuditLog.createdAt, c);
  const matched = await countWhere(schema.adminAuditLog, cond);
  let removed = 0;
  if (!dryRun && matched > 0) {
    const rows = await db!.delete(schema.adminAuditLog).where(cond).returning({ id: schema.adminAuditLog.id });
    removed = rows.length;
  }
  return { step: "admin_audit_log", matched, removed, dryRun };
}

/** Destinatari broadcast: oltre 90gg (l'aggregato broadcasts resta). */
async function pruneBroadcastRecipients(dryRun: boolean): Promise<RetentionStepReport> {
  const c = cutoff(RETENTION.broadcastRecipientsMs);
  const cond = lt(schema.broadcastRecipients.updatedAt, c);
  const matched = await countWhere(schema.broadcastRecipients, cond);
  let removed = 0;
  if (!dryRun && matched > 0) {
    const rows = await db!.delete(schema.broadcastRecipients).where(cond).returning({ id: schema.broadcastRecipients.id });
    removed = rows.length;
  }
  return { step: "broadcast_recipients", matched, removed, dryRun };
}

/** Contatore anonimo dei clic caffè/invito: righe giornaliere oltre 180gg. */
async function pruneSupportClicks(dryRun: boolean): Promise<RetentionStepReport> {
  const cond = supportClicksExpiredCond();
  const [row] = await db!.select({ n: sql<number>`count(*)` }).from(schema.supportClicks).where(cond);
  const matched = Number(row?.n ?? 0);
  let removed = 0;
  if (!dryRun && matched > 0) {
    const rows = await db!.delete(schema.supportClicks).where(cond).returning({ day: schema.supportClicks.day });
    removed = rows.length;
  }
  return { step: "support_clicks", matched, removed, dryRun };
}

/**
 * Dettaglio (hand_scores/game_events/checkpoints) delle partite concluse da oltre 3
 * mesi. Già consolidato nei totali (user_stats_totals): potarlo non perde i totali.
 * Ordine di delete rispettoso delle FK (figli prima). Le righe `matches`/`hands`
 * restano (pota `matches` a 12 mesi, sotto).
 */
async function pruneDetail(dryRun: boolean): Promise<RetentionStepReport> {
  const c = cutoff(RETENTION.detailMs);
  const oldMatchIds = (
    await db!
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(and(isNotNull(schema.matches.endedAt), lt(schema.matches.endedAt, c)))
  ).map((r) => r.id);
  if (oldMatchIds.length === 0) return { step: "detail", matched: 0, removed: 0, dryRun };

  const oldHandIds = (
    await db!.select({ id: schema.hands.id }).from(schema.hands).where(inArray(schema.hands.matchId, oldMatchIds))
  ).map((r) => r.id);

  // Conteggio delle righe di dettaglio coinvolte (indicativo per l'audit).
  const [hs] = oldHandIds.length
    ? await db!.select({ n: sql<number>`count(*)` }).from(schema.handScores).where(inArray(schema.handScores.handId, oldHandIds))
    : [{ n: 0 }];
  const [ge] = await db!.select({ n: sql<number>`count(*)` }).from(schema.gameEvents).where(inArray(schema.gameEvents.matchId, oldMatchIds));
  const [cp] = await db!.select({ n: sql<number>`count(*)` }).from(schema.checkpoints).where(inArray(schema.checkpoints.matchId, oldMatchIds));
  const matched = Number(hs?.n ?? 0) + Number(ge?.n ?? 0) + Number(cp?.n ?? 0);

  let removed = 0;
  if (!dryRun && matched > 0) {
    removed = await db!.transaction(async (tx) => {
      let n = 0;
      if (oldHandIds.length) {
        n += (await tx.delete(schema.handScores).where(inArray(schema.handScores.handId, oldHandIds)).returning({ id: schema.handScores.id })).length;
      }
      n += (await tx.delete(schema.checkpoints).where(inArray(schema.checkpoints.matchId, oldMatchIds)).returning({ id: schema.checkpoints.id })).length;
      n += (await tx.delete(schema.gameEvents).where(inArray(schema.gameEvents.matchId, oldMatchIds)).returning({ id: schema.gameEvents.id })).length;
      return n;
    });
  }
  return { step: "detail", matched, removed, dryRun };
}

/**
 * Audit lancio R06 — REGISTRO DELLE MOSSE (`game_events`) con orizzonte breve:
 *  - partite concluse da oltre `gameEventsMs` (7 giorni);
 *  - partite MAI concluse (riavvio del server: stato in RAM perso) iniziate da oltre
 *    `orphanMatchMs` (2 giorni), altrimenti il loro registro resterebbe per sempre.
 * Tocca SOLO game_events: hand_scores e checkpoint seguono `pruneDetail`.
 */
async function pruneGameEvents(dryRun: boolean): Promise<RetentionStepReport> {
  const ended = and(isNotNull(schema.matches.endedAt), lt(schema.matches.endedAt, cutoff(RETENTION.gameEventsMs)));
  const orphan = and(isNull(schema.matches.endedAt), lt(schema.matches.createdAt, cutoff(RETENTION.orphanMatchMs)));
  const ids = (await db!.select({ id: schema.matches.id }).from(schema.matches).where(or(ended, orphan))).map((r) => r.id);
  if (ids.length === 0) return { step: "game_events", matched: 0, removed: 0, dryRun };
  const [ge] = await db!.select({ n: sql<number>`count(*)` }).from(schema.gameEvents).where(inArray(schema.gameEvents.matchId, ids));
  const matched = Number(ge?.n ?? 0);
  let removed = 0;
  if (!dryRun && matched > 0) {
    removed = (await db!.delete(schema.gameEvents).where(inArray(schema.gameEvents.matchId, ids)).returning({ id: schema.gameEvents.id })).length;
  }
  return { step: "game_events", matched, removed, dryRun };
}

/**
 * Partite (matches/match_players/hands) concluse da oltre 12 mesi. Ordine FK: prima
 * i figli residui (detail già potato a 3 mesi), poi hands/match_players, poi matches.
 * Prima si annullano i riferimenti da `contact_messages.user_id`? No: quelli puntano
 * a users, non a matches. Qui si toccano SOLO le tabelle di partita.
 */
async function pruneOldMatches(dryRun: boolean): Promise<RetentionStepReport> {
  const c = cutoff(RETENTION.matchMs);
  const ids = (
    await db!
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(and(isNotNull(schema.matches.endedAt), lt(schema.matches.endedAt, c)))
  ).map((r) => r.id);
  const matched = ids.length;
  let removed = 0;
  if (!dryRun && matched > 0) {
    removed = await db!.transaction(async (tx) => {
      const handIds = (await tx.select({ id: schema.hands.id }).from(schema.hands).where(inArray(schema.hands.matchId, ids))).map((r) => r.id);
      if (handIds.length) await tx.delete(schema.handScores).where(inArray(schema.handScores.handId, handIds));
      await tx.delete(schema.checkpoints).where(inArray(schema.checkpoints.matchId, ids));
      await tx.delete(schema.gameEvents).where(inArray(schema.gameEvents.matchId, ids));
      await tx.delete(schema.hands).where(inArray(schema.hands.matchId, ids));
      await tx.delete(schema.matchPlayers).where(inArray(schema.matchPlayers.matchId, ids));
      const rows = await tx.delete(schema.matches).where(inArray(schema.matches.id, ids)).returning({ id: schema.matches.id });
      return rows.length;
    });
  }
  return { step: "matches", matched, removed, dryRun };
}

/**
 * Ospiti eleggibili (scaduti o inattivi) ma ANCORA REFERENZIATI da una partita.
 * Il `display_name` è già denormalizzato in `match_players.display_name` (lo storico
 * dell'avversario resta leggibile: "Marco (ospite)"), quindi si annullano i
 * riferimenti FK e poi si cancella l'ospite. Gli account REGISTRATI non sono mai
 * toccati (WHERE is_guest = true).
 */
async function pruneReferencedGuests(dryRun: boolean): Promise<RetentionStepReport> {
  const c = cutoff(RETENTION.guestInactivityMs);
  const eligible = or(
    isNotNull(schema.users.expiredAt),
    lt(sql`coalesce(${schema.users.lastSeenAt}, ${schema.users.createdAt})`, c),
  );
  const referenced = or(
    sql`exists (select 1 from ${schema.matchPlayers} mp where mp.user_id = ${schema.users.id})`,
    sql`exists (select 1 from ${schema.matches} m where m.aborted_by = ${schema.users.id})`,
  );
  const noSession = sql`not exists (select 1 from ${schema.sessions} s where s.user_id = ${schema.users.id})`;
  const cond = and(eq(schema.users.isGuest, true), eligible, referenced, noSession);

  const ids = (await db!.select({ id: schema.users.id }).from(schema.users).where(cond)).map((r) => r.id);
  const matched = ids.length;
  let removed = 0;
  if (!dryRun && matched > 0) {
    removed = await db!.transaction(async (tx) => {
      // Denormalizzazione: annulla i riferimenti (il nome resta in match_players).
      await tx.update(schema.matchPlayers).set({ userId: null }).where(inArray(schema.matchPlayers.userId, ids));
      await tx.update(schema.matches).set({ abortedBy: null }).where(inArray(schema.matches.abortedBy, ids));
      const rows = await tx.delete(schema.users).where(inArray(schema.users.id, ids)).returning({ id: schema.users.id });
      return rows.length;
    });
  }
  return { step: "referenced_guests", matched, removed, dryRun };
}

/**
 * DETECTION di account REGISTRATI inattivi (§4.3). NON esegue né anonimizza mai:
 * il percorso di anonimizzazione di account registrati resta SOLO dry-run in attesa
 * del Gate 4. Ritorna quanti account SAREBBERO candidati (mai un id in chiaro).
 */
async function detectInactiveAccounts(): Promise<RetentionStepReport> {
  const c = cutoff(RETENTION.accountInactivityMs);
  const cond = and(
    eq(schema.users.isGuest, false),
    ne(schema.users.role, "admin"),
    isNotNull(schema.users.email),
    lt(sql`coalesce(${schema.users.lastSeenAt}, ${schema.users.createdAt})`, c),
  );
  const [row] = await db!.select({ n: sql<number>`count(*)` }).from(schema.users).where(cond);
  const matched = Number(row?.n ?? 0);
  // dryRun SEMPRE true: nessuna anonimizzazione live (Gate 4).
  return { step: "inactive_accounts_detected", matched, removed: 0, dryRun: true };
}

/* ─────────────────────────────── orchestrazione ──────────────────────────── */

/**
 * Esegue l'intero giro di retention nella modalità indicata (default: quella dello
 * scheduler → dry-run salvo RETENTION_MODE="live"). L'anonimizzazione di account
 * registrati è SEMPRE solo-detection. Scrive un audit riepilogativo + un app_event.
 * Best-effort: senza DB o su errore non solleva.
 */
export async function runRetentionSweep(
  mode: RetentionMode = scheduledRetentionMode(),
  actorId?: string,
): Promise<RetentionStepReport[]> {
  if (!db) return [];
  const dryRun = mode !== "live";
  const reports: RetentionStepReport[] = [];
  try {
    reports.push(await pruneContactMessages(dryRun));
    reports.push(await pruneBroadcastRecipients(dryRun));
    reports.push(await pruneSupportClicks(dryRun));
    reports.push(await pruneAdminAudit(dryRun));
    reports.push(await pruneGameEvents(dryRun));
    reports.push(await pruneDetail(dryRun));
    reports.push(await pruneOldMatches(dryRun));
    reports.push(await pruneReferencedGuests(dryRun));
    reports.push(await pruneAppEvents(dryRun));
    reports.push(await pruneAppEventsCap(dryRun));
    // Solo detection (mai live): account registrati inattivi (Gate 4).
    reports.push(await detectInactiveAccounts());
  } catch (err) {
    console.error("[retention] sweep interrotto:", (err as Error).message);
    void logAppEvent("error", "cleanup", "retention sweep interrotto", { message: (err as Error).message });
    return reports;
  }

  const summary = Object.fromEntries(reports.map((r) => [r.step, dryRun ? r.matched : r.removed]));
  void logAppEvent(dryRun ? "info" : "warn", "cleanup", `retention sweep (${mode})`, summary);
  // Audit amministrativo dell'esecuzione (attore = sistema, se non fornito).
  if (actorId) {
    void recordAdminAudit({ actorId, action: "retention_sweep", target: summary, outcome: dryRun ? "dry_run" : "ok" });
  }
  return reports;
}
