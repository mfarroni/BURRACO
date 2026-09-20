/**
 * CONTRATTO INTERNO degli endpoint amministrativi (BE-only, §D2). I DTO admin
 * vivono qui (modulo NUOVO), MAI in `contract/types.ts`. La copia FE è un file
 * nuovo (`lib/admin.ts`), mai `lib/contract.ts`.
 *
 * Whitelist in POSITIVO: si espone solo il necessario, mai hash/token/segreti.
 */

/* ── Contatore di occupazione (§4.4) ─────────────────────────────────────── */

export interface OccupancyTable {
  table: string;
  rows: number;
}

export interface AdminOccupancy {
  tables: OccupancyTable[];
  total: number;
  budget: number;
  /** total / budget (0..1+). */
  usedRatio: number;
  /** Soglia d'allarme (0.8). */
  warnRatio: number;
  /** true quando usedRatio ≥ warnRatio. */
  alert: boolean;
}

/* ── Comunicazioni (§5.3) ────────────────────────────────────────────────── */

export interface BroadcastCriterio {
  all?: boolean;
  registratiDopo?: number; // epoch ms
  minPartite?: number;
  inattiviDaGiorni?: number;
}

export type BroadcastTipo = "servizio" | "promozionale";

export interface BroadcastCreateResponse {
  id: string;
  count: number;
  sample?: string[]; // nomi (mai email) di un campione di destinatari
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

/* ── Log di sistema (§5.4) ───────────────────────────────────────────────── */

export interface AppLogEntry {
  id: string;
  at: number | null;
  livello: string;
  categoria: string;
  messaggio: string;
  meta?: unknown;
}

export interface AppLogResponse {
  items: AppLogEntry[];
  limit: number;
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
