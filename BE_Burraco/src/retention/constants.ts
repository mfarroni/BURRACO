/**
 * FASE 4 — Orizzonti di CONSERVAZIONE centralizzati (valori di lavoro approvati al
 * Gate 3, §8). Un solo punto di verità: cambiarli qui li cambia ovunque. I valori
 * "da confermare" (tetti reali) sono annotati: NON sono numeri verificati.
 *
 * ⚠️ Nessun processo cancella in modalità REALE prima di una DRY-RUN mostrata al
 * lead (§4.4): lo scheduler gira in dry-run finché RETENTION_MODE non è "live".
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION = {
  /** Dettaglio (hand_scores/game_events/checkpoints): 3 mesi (il più breve, satura). */
  detailMs: 90 * DAY_MS,
  /** Partita (matches/match_players/hands): 12 mesi. */
  matchMs: 365 * DAY_MS,
  /** Messaggi contatti: 180 gg dopo `letto_at` (o `created_at` se mai letto). */
  contactMessagesMs: 180 * DAY_MS,
  /** Log applicativi: 90 gg (fascia 30–90). Più il tetto righe sotto. */
  appEventsMs: 90 * DAY_MS,
  /**
   * Tetto righe di `app_events`: oltre, si potano le più vecchie. Costante
   * centralizzata; il valore fine è "da confermare col budget reale 10k (Gate 3)".
   */
  appEventsRowCap: 20_000,
  /** Traccia amministrativa: 12 mesi. */
  adminAuditMs: 365 * DAY_MS,
  /** Destinatari broadcast: 90 gg dopo invio (l'aggregato resta in `broadcasts`). */
  broadcastRecipientsMs: 90 * DAY_MS,
  /** Inattività OSPITE eleggibile alla pulizia (allineata al TTL sessione, 7 gg). */
  guestInactivityMs: 7 * DAY_MS,
  /** Inattività ACCOUNT REGISTRATO: 12 mesi (solo DETECTION + dry-run, Gate 4). */
  accountInactivityMs: 365 * DAY_MS,
  /** Budget complessivo righe DB e soglia d'allarme (§4.4). */
  budgetRows: 10_000,
  budgetWarnRatio: 0.8,
} as const;

/** Modalità dei processi di pulizia: dry-run (conta) o live (cancella davvero). */
export type RetentionMode = "dry_run" | "live";

/**
 * Modalità di default dei job schedulati: DRY-RUN salvo `RETENTION_MODE="live"`.
 * L'anonimizzazione di account REGISTRATI resta comunque solo-detection (Gate 4),
 * a prescindere da questo flag.
 */
export function scheduledRetentionMode(): RetentionMode {
  return process.env.RETENTION_MODE === "live" ? "live" : "dry_run";
}
