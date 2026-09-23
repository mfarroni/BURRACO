"use client";

import { useEffect, useState } from "react";
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

/** Lotto D — riepilogo del contatore anonimo caffè/invito (copia di metrics/supportClicks.ts). */
export type SupportClickKind = "caffe" | "invito";
export interface SupportClickSummary {
  days: number;
  since: string;
  totals: Record<SupportClickKind, number>;
  byPlacement: { kind: SupportClickKind; placement: string; count: number }[];
  daily: { day: string; caffe: number; invito: number }[];
}

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
  /** Destinatari scelti a mano nella tab Utenti (id registrati). */
  userIds?: string[];
}
export type BroadcastTipo = "servizio" | "promozionale";
export interface BroadcastCreateResponse {
  id: string | null;
  count: number;
  sample?: string[];
  dryRun: boolean;
  // CICLO Pannello Admin — stato quota giornaliera (dry-run e creazione).
  quotaCap: number;
  quotaRemaining: number;
  quotaSufficiente: boolean;
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

/* ── CICLO Pannello Admin — nuovi DTO (copia manuale di admin/types.ts) ────── */

export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string | null;
  createdAt: number;
}
export interface AdminUsersResponse {
  items: AdminUserRow[];
  nextCursor: string | null;
  limit: number;
}

export interface LogLinksResponse {
  renderUrl: string | null;
  neonUrl: string | null;
}

/** Semaforo binario: solo verde o rosso, mai stato intermedio. */
export type Light = "green" | "red";
export interface StatusCheckResponse {
  fe: Light;
  be: Light;
  db: Light;
  checkedAt: number;
  detail: { be: string; db: string };
}

export interface EventRow {
  id: string;
  titolo: string;
  inizioAt: number;
  luogo: string | null;
  pubblicato: boolean;
}
export interface ShopProductRow {
  id: string;
  nome: string;
  descrizione: string | null;
  prezzoCent: number;
  valuta: string;
  /** Foto della scheda: data URL d'immagine (o URL); null = assente. */
  immagineUrl: string | null;
  disponibile: boolean;
}

/* ── CICLO Webmaster — operazioni sul singolo utente ─────────────────────── */

export interface AdminResetPasswordResponse {
  tempPassword: string;
  emailed: boolean;
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
  supportClicks: (days: number) => adminFetch<SupportClickSummary>(`/admin/metrics/clicks?days=${days}`),

  /* ── CICLO Pannello Admin — nuove chiamate ─────────────────────────────── */
  // Probe della voce di menu admin (D2): 200 admin / 404 altrimenti.
  ping: () => adminFetch<{ ok: boolean }>("/admin/ping"),
  users: (limit = 20, cursor?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    return adminFetch<AdminUsersResponse>(`/admin/users?${q.toString()}`);
  },
  logLinks: () => adminFetch<LogLinksResponse>("/admin/logs/links"),
  // Semaforo (§2.2): timeout 60s via AbortController. Se il BE non risponde entro il
  // limite, la fetch viene abortita → il chiamante marca BE/DB rossi.
  statusCheck: () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    return adminFetch<StatusCheckResponse>("/admin/status/check", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  },
  listEvents: () => adminFetch<{ items: EventRow[] }>("/admin/events"),
  createEvent: (payload: {
    titolo: string;
    descrizione?: string;
    luogo?: string;
    inizioAt: number;
    fineAt?: number;
    pubblicato?: boolean;
  }) => adminFetch<EventRow>("/admin/events", { method: "POST", body: JSON.stringify(payload) }),
  listShopProducts: () => adminFetch<{ items: ShopProductRow[] }>("/admin/shop/products"),
  createShopProduct: (payload: {
    nome: string;
    descrizione?: string;
    prezzoCent?: number;
    valuta?: string;
    immagineUrl?: string;
    disponibile?: boolean;
  }) => adminFetch<ShopProductRow>("/admin/shop/products", { method: "POST", body: JSON.stringify(payload) }),

  /* ── CICLO Webmaster — CRUD prodotti e operazioni sugli utenti ─────────── */
  // Solo GET/POST (CORS del BE): modifica e cancellazione sono POST dedicate.
  updateShopProduct: (
    id: string,
    payload: {
      nome?: string;
      descrizione?: string | null;
      prezzoCent?: number;
      valuta?: string;
      immagineUrl?: string | null;
      disponibile?: boolean;
    },
  ) =>
    adminFetch<ShopProductRow>(`/admin/shop/products/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteShopProduct: (id: string) =>
    adminFetch<{ deleted: boolean }>(`/admin/shop/products/${encodeURIComponent(id)}/delete`, {
      method: "POST",
      body: "{}",
    }),
  deleteUser: (id: string) =>
    adminFetch<{ deleted: boolean }>(`/admin/users/${encodeURIComponent(id)}/delete`, { method: "POST", body: "{}" }),
  resetUserPassword: (id: string) =>
    adminFetch<AdminResetPasswordResponse>(`/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: "POST",
      body: "{}",
    }),
};

/**
 * CICLO Pannello Admin — hook di PROBE per la voce di menu admin (D2). Chiama
 * `GET /admin/ping`: 200 → true (admin), 404/errore → false. Puro UX: nasconderla
 * non è sicurezza, l'autorità resta il 404 server-side su ogni endpoint. Non tocca
 * il contratto auth.
 *
 * `authKey` è un valore che CAMBIA a ogni variazione dello stato di autenticazione
 * (es. `auth.user?.id`): serve come dipendenza dell'effetto così il probe si RI-esegue
 * dopo il login. Senza, l'effetto girerebbe una sola volta al mount (quando di norma
 * non c'è ancora un token) e il menu non comparirebbe mai dopo l'accesso.
 */
export function useIsAdmin(authKey?: string | null): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!getAuthToken()) {
      setIsAdmin(false);
      return;
    }
    admin
      .ping()
      .then(() => {
        if (alive) setIsAdmin(true);
      })
      .catch(() => {
        if (alive) setIsAdmin(false);
      });
    return () => {
      alive = false;
    };
  }, [authKey]);
  return isAdmin;
}
