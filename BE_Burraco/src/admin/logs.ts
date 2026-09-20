import { and, gte, lte, eq, sql } from "drizzle-orm";
import { db, pool, schema } from "../db/client.js";
import { env } from "../config.js";
import { redactMeta, redactText } from "./redact.js";
import type { AppLogEntry, DbStatusResponse, RenderLogResponse } from "./types.js";

/**
 * FASE 5.4 — Tre fonti di log, TUTTE in sola lettura:
 *  1) eventi applicativi nostri (app_events) + traccia amministrativa (admin_audit_log);
 *  2) proxy dei log di Render (chiave mai sul FE: il BE fa da proxy);
 *  3) stato del DB (pg_stat_activity, + pg_stat_statements se disponibile, con fallback).
 *
 * Redazione lato server + paginazione/finestra temporale OBBLIGATORIE.
 */

const num = (v: unknown): number => Number(v ?? 0);

interface AppLogQuery {
  from: Date;
  to: Date;
  limit: number;
  level?: string;
}

/** app_events + admin_audit_log nella finestra, redatti, ordinati per data desc. */
export async function getAppLogs(q: AppLogQuery): Promise<AppLogEntry[]> {
  if (!db) return [];
  const conds = [gte(schema.appEvents.createdAt, q.from), lte(schema.appEvents.createdAt, q.to)];
  if (q.level) conds.push(eq(schema.appEvents.livello, q.level));

  const events = await db
    .select({
      id: schema.appEvents.id,
      at: schema.appEvents.createdAt,
      livello: schema.appEvents.livello,
      categoria: schema.appEvents.categoria,
      messaggio: schema.appEvents.messaggio,
      meta: schema.appEvents.meta,
    })
    .from(schema.appEvents)
    .where(and(...conds))
    .orderBy(sql`${schema.appEvents.createdAt} desc`)
    .limit(q.limit);

  // admin_audit_log nella stessa finestra (mappato allo stesso formato).
  const audits = await db
    .select({
      id: schema.adminAuditLog.id,
      at: schema.adminAuditLog.createdAt,
      action: schema.adminAuditLog.action,
      target: schema.adminAuditLog.target,
      outcome: schema.adminAuditLog.outcome,
    })
    .from(schema.adminAuditLog)
    .where(and(gte(schema.adminAuditLog.createdAt, q.from), lte(schema.adminAuditLog.createdAt, q.to)))
    .orderBy(sql`${schema.adminAuditLog.createdAt} desc`)
    .limit(q.limit);

  const eventItems: AppLogEntry[] = events.map((e) => ({
    id: e.id,
    at: e.at ? new Date(e.at).getTime() : null,
    livello: e.livello,
    categoria: e.categoria,
    messaggio: redactText(e.messaggio),
    meta: e.meta == null ? undefined : redactMeta(e.meta),
  }));

  const auditItems: AppLogEntry[] = audits
    .filter(() => !q.level || q.level === "info" || q.level === "warn")
    .map((a) => ({
      id: a.id,
      at: a.at ? new Date(a.at).getTime() : null,
      livello: a.outcome === "error" ? "error" : a.outcome === "rejected" ? "warn" : "info",
      categoria: "admin",
      messaggio: redactText(`azione=${a.action} esito=${a.outcome}`),
      meta: a.target == null ? undefined : redactMeta(a.target),
    }));

  return [...eventItems, ...auditItems]
    .sort((x, y) => (y.at ?? 0) - (x.at ?? 0))
    .slice(0, q.limit);
}

/**
 * Proxy dei log di Render (BE→Render). La chiave non raggiunge mai il FE. Senza
 * configurazione → available:false. L'endpoint/parametri esatti dell'API Render sono
 * un elemento da VERIFICARE al Gate 2: qui la chiamata è difensiva (qualsiasi errore
 * → available:false con motivo redatto), le righe tornano come TESTO redatto.
 */
export async function getRenderLogs(from: Date, to: Date, limit: number): Promise<RenderLogResponse> {
  if (!env.render.apiKey || !env.render.serviceId) {
    return { available: false, reason: "Proxy Render non configurato (RENDER_API_KEY/RENDER_SERVICE_ID).", lines: [] };
  }
  const url = new URL("https://api.render.com/v1/logs");
  url.searchParams.set("resource", env.render.serviceId);
  url.searchParams.set("startTime", from.toISOString());
  url.searchParams.set("endTime", to.toISOString());
  url.searchParams.set("limit", String(Math.min(limit, 100)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${env.render.apiKey}`, accept: "application/json" },
    });
    if (!res.ok) {
      return { available: false, reason: `Render ha risposto status ${res.status} (verificare API/quote, Gate 2).`, lines: [] };
    }
    const data: unknown = await res.json().catch(() => null);
    const lines = extractRenderLines(data).map(redactText).slice(0, limit);
    return { available: true, lines };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { available: false, reason: aborted ? "Timeout verso l'API Render." : "Errore di rete verso l'API Render.", lines: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Estrae righe di testo da forme plausibili della risposta Render (difensivo). */
function extractRenderLines(data: unknown): string[] {
  if (!data) return [];
  const arr = Array.isArray(data) ? data : Array.isArray((data as { logs?: unknown }).logs) ? (data as { logs: unknown[] }).logs : [];
  return arr.map((row) => {
    if (typeof row === "string") return row;
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      const ts = typeof r.timestamp === "string" ? r.timestamp : "";
      const msg = typeof r.message === "string" ? r.message : JSON.stringify(r);
      return `${ts} ${msg}`.trim();
    }
    return String(row);
  });
}

/**
 * Stato del DB: connessioni attive (pg_stat_activity) e, SE disponibile, le query
 * più lente (pg_stat_statements). Se l'estensione non c'è sul piano Neon attivo
 * (Gate 2/3), lo si DICHIARA (slowQueriesAvailable:false) mostrando solo l'attività:
 * non si inventa una fonte inesistente.
 */
export async function getDbStatus(): Promise<DbStatusResponse> {
  if (!pool) {
    return { available: false, activeConnections: null, slowQueries: null, slowQueriesAvailable: false, note: "DATABASE_URL assente." };
  }
  let activeConnections: number | null = null;
  try {
    const r = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_stat_activity WHERE state = 'active'");
    activeConnections = num(r.rows[0]?.n);
  } catch {
    activeConnections = null;
  }

  let slowQueries: DbStatusResponse["slowQueries"] = null;
  let slowQueriesAvailable = false;
  let note: string | undefined;
  try {
    const r = await pool.query<{ query: string; calls: string; mean: string }>(
      "SELECT query, calls::text AS calls, mean_exec_time::text AS mean FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 5",
    );
    slowQueries = r.rows.map((row) => ({
      query: redactText(row.query ?? ""),
      calls: num(row.calls),
      meanMs: Math.round(num(row.mean)),
    }));
    slowQueriesAvailable = true;
  } catch {
    slowQueriesAvailable = false;
    note = "pg_stat_statements non disponibile su questo piano: mostrata solo l'attività.";
  }

  return { available: true, activeConnections, slowQueries, slowQueriesAvailable, note };
}
