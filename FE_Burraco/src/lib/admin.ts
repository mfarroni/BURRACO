"use client";

import { getAuthToken } from "./auth";

/**
 * CLIENT dell'area webmaster (FASE 5). Parla con gli endpoint /admin/* del backend.
 * Separabilità FE/BE (decisione #8): questi tipi sono una COPIA MANUALE locale in un
 * file NUOVO, MAI `lib/contract.ts` (che è il contratto di GIOCO).
 *
 * Sicurezza: il ruolo NON è nel client; l'accesso è deciso dal backend, che risponde
 * 404 (non 403) ai non-admin. Qui un 404 significa "non autorizzato o inesistente":
 * la pagina lo tratta come "non disponibile" (nessun contenuto riservato mostrato).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(API_URL + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 404) throw new AdminError(404, "Risorsa non trovata.");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new AdminError(res.status, body.message ?? "Operazione non riuscita.");
  }
  return (await res.json()) as T;
}

/* ── Tipi (copia manuale dei DTO di admin/types.ts) ──────────────────────── */

export interface OccupancyTable {
  table: string;
  rows: number;
}
export interface AdminOccupancy {
  tables: OccupancyTable[];
  total: number;
  budget: number;
  usedRatio: number;
  warnRatio: number;
  alert: boolean;
}

export interface RetentionStepReport {
  step: string;
  matched: number;
  removed: number;
  dryRun: boolean;
}

export interface BroadcastCriterio {
  all?: boolean;
  registratiDopo?: number;
  minPartite?: number;
  inattiviDaGiorni?: number;
}
export type BroadcastTipo = "servizio" | "promozionale";
export interface BroadcastCreateResponse {
  id: string | null;
  count: number;
  sample?: string[];
  dryRun: boolean;
}
export interface BroadcastRow {
  id: string;
  oggetto: string;
  tipo: BroadcastTipo;
  stato: string;
  createdAt: number | null;
  recipients: { inCoda: number; inviato: number; errore: number; saltato: number };
}

export interface AppLogEntry {
  id: string;
  at: number | null;
  livello: string;
  categoria: string;
  messaggio: string;
  meta?: unknown;
}
export interface RenderLogResponse {
  available: boolean;
  reason?: string;
  lines: string[];
}
export interface DbStatusResponse {
  available: boolean;
  activeConnections: number | null;
  slowQueries: { query: string; calls: number; meanMs: number }[] | null;
  slowQueriesAvailable: boolean;
  note?: string;
}

/* ── Chiamate ────────────────────────────────────────────────────────────── */

export const admin = {
  occupancy: () => adminFetch<AdminOccupancy>("/admin/occupancy"),
  retentionPreview: () =>
    adminFetch<{ dryRun: boolean; reports: RetentionStepReport[] }>("/admin/retention/preview", {
      method: "POST",
      body: "{}",
    }),
  createBroadcast: (payload: {
    oggetto: string;
    corpo: string;
    tipo: BroadcastTipo;
    criterio: BroadcastCriterio;
    dryRun: boolean;
  }) => adminFetch<BroadcastCreateResponse>("/admin/broadcasts", { method: "POST", body: JSON.stringify(payload) }),
  sendBroadcast: (id: string) =>
    adminFetch<{ accepted: boolean; queued: number }>(`/admin/broadcasts/${id}/send`, { method: "POST", body: "{}" }),
  listBroadcasts: () => adminFetch<{ items: BroadcastRow[] }>("/admin/broadcasts"),
  appLogs: (from: number, to: number, limit: number, level?: string) => {
    const q = new URLSearchParams({ from: String(from), to: String(to), limit: String(limit) });
    if (level) q.set("level", level);
    return adminFetch<{ items: AppLogEntry[]; limit: number }>(`/admin/logs/app?${q.toString()}`);
  },
  renderLogs: (from: number, to: number, limit: number) => {
    const q = new URLSearchParams({ from: String(from), to: String(to), limit: String(limit) });
    return adminFetch<RenderLogResponse>(`/admin/logs/render?${q.toString()}`);
  },
  dbStatus: () => adminFetch<DbStatusResponse>("/admin/logs/db"),
};
