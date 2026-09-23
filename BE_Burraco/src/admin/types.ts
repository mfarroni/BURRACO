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
  id: string | null; // null in dry-run (nessuna persistenza)
  count: number;
  sample?: string[]; // nomi (mai email) di un campione di destinatari
  dryRun: boolean;
  // CICLO Pannello Admin — stato quota giornaliera al momento della creazione/dry-run.
  quotaCap: number; // tetto giornaliero (BREVO_DAILY_CAP)
  quotaRemaining: number; // residuo di oggi (mai negativo)
  quotaSufficiente: boolean; // count ≤ quotaRemaining (con carry-over l'invio non è bloccato)
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

/* ── CICLO Pannello Admin: Utenti registrati (§2.1) ──────────────────────── */

/**
 * Riga utente per la tab Utenti. Whitelist in POSITIVO: SOLO i campi qui elencati.
 * MAI password_hash, token_hash, ip_hash, ruolo o altri campi interni.
 */
export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string | null;
  createdAt: number; // epoch ms
}

export interface AdminUsersResponse {
  items: AdminUserRow[];
  /** Cursore keyset per la pagina successiva (null = ultima pagina). */
  nextCursor: string | null;
  limit: number;
}

/* ── CICLO Pannello Admin: Link log (§2, tab Log) ─────────────────────────── */

/** Solo i link alle dashboard (mai i log): decisione lead "log = link". */
export interface LogLinksResponse {
  renderUrl: string | null;
  neonUrl: string | null;
}

/* ── CICLO Pannello Admin: Semaforo di monitoraggio (§2.2) ────────────────── */

/** Semaforo binario: solo verde o rosso, mai stato intermedio. */
export type Light = "green" | "red";

export interface StatusCheckResponse {
  fe: Light; // 'green' per definizione (il pannello è caricato)
  be: Light; // 'green' se questo endpoint risponde entro il timeout
  db: Light; // 'green' se SELECT 1 torna entro il timeout
  checkedAt: number; // epoch ms dell'ultimo controllo
  detail: { be: string; db: string }; // testo che accompagna SEMPRE il colore
}

/* ── CICLO Pannello Admin: Predisposizione Eventi/Shop (§2.6) ─────────────── */

export interface EventRow {
  id: string;
  titolo: string;
  inizioAt: number; // epoch ms
  luogo: string | null;
  pubblicato: boolean;
}

export interface ShopProductRow {
  id: string;
  nome: string;
  /** CICLO Webmaster: testo della scheda prodotto (null = assente). */
  descrizione: string | null;
  prezzoCent: number;
  valuta: string;
  /** CICLO Webmaster: foto della scheda (data URL d'immagine o URL; null = assente). */
  immagineUrl: string | null;
  disponibile: boolean;
}

/* ── CICLO Webmaster: operazioni sul singolo utente ───────────────────────── */

/** Esito del reset: la password temporanea torna all'admin UNA volta sola. */
export interface AdminResetPasswordResponse {
  tempPassword: string;
  /** true se l'email con la password temporanea è partita verso l'utente. */
  emailed: boolean;
}
