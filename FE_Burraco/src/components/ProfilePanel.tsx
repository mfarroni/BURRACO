"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthUser, UserStats, MatchSummary } from "@/lib/contract";
import { fetchStats, fetchMatches } from "@/lib/profile";
import { AuthClientError } from "@/lib/auth";

/**
 * SCHERMATA PROFILO (macro-ciclo 3) — SOLA LETTURA (decisione D: niente rinomina).
 * Competenza develop: struttura, stato client, fetch degli endpoint /users/me/*,
 * stati di attesa/errore/vuoto. La PRESENTAZIONE (copy definitiva, gerarchia,
 * markup fine, micro-interazioni, WCAG AA) è di agente_ui_ux e vive qui + globals.css.
 *
 * Il client è muto sulle regole: nessun calcolo di statistiche qui, solo
 * rendering dei numeri che il server ha aggregato. La sola trasformazione qui
 * presente è di PURA PRESENTAZIONE (formattazione locale IT di numeri/percentuali/
 * date): non è logica di dominio né validazione. L'utente è derivato dal token
 * lato server (nessun id nel client) → non esiste modo di consultare altri profili.
 *
 * Decisione B: profilo consultabile SOLO per utenti registrati. Un ospite vede un
 * invito a registrarsi; non vengono nemmeno chiamati gli endpoint (il server li
 * rifiuterebbe comunque con 403).
 */

interface Props {
  user: AuthUser;
  onBack: () => void;
}

type LoadState = "loading" | "ready" | "error";

const PAGE_SIZE = 10;

/* Formattatori di PRESENTAZIONE (locale IT). Creati una sola volta a livello di
 * modulo: separatore migliaia per gli interi, una cifra decimale per le
 * percentuali. Nessun calcolo di dominio: solo resa dei numeri già aggregati. */
const nfInt = new Intl.NumberFormat("it-IT");
const nfPct = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function ProfilePanel({ user, onBack }: Props) {
  const isGuest = user.isGuest;

  const [stats, setStats] = useState<UserStats | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [state, setState] = useState<LoadState>(isGuest ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [s, m] = await Promise.all([fetchStats(), fetchMatches(PAGE_SIZE, 0)]);
      setStats(s);
      setMatches(m.items);
      setHasMore(m.items.length === PAGE_SIZE);
      setState("ready");
    } catch (err) {
      setError(err instanceof AuthClientError ? err.message : "Impossibile caricare il profilo.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (isGuest) return;
    void load();
  }, [isGuest, load]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const next = await fetchMatches(PAGE_SIZE, matches.length);
      setMatches((prev) => [...prev, ...next.items]);
      setHasMore(next.items.length === PAGE_SIZE);
    } catch {
      // Il "carica altro" è best-effort: un errore non azzera i dati già mostrati.
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [matches.length]);

  return (
    <div className="lobby profile-panel">
      <div className="brand">
        <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <h1>Profilo</h1>
      </div>

      {/* ── Identità ─────────────────────────────────────────────────────── */}
      <div className="profile-identity">
        <span className="profile-name">{user.displayName}</span>
        <span className="profile-badge" data-guest={isGuest ? "true" : "false"}>
          <span className="profile-badge-icon" aria-hidden="true">{isGuest ? "○" : "✓"}</span>
          {isGuest ? "Ospite" : "Registrato"}
        </span>
      </div>

      {/* ── Ospite: invito a registrarsi (nessuna statistica consultabile) ── */}
      {isGuest ? (
        <div className="profile-guest-note" role="status">
          <span className="profile-guest-icon" aria-hidden="true">♣</span>
          <div className="profile-guest-body">
            <p className="profile-guest-title">Stai giocando come ospite</p>
            <p className="profile-guest-text">
              Crea un account gratuito per conservare le tue statistiche, rivedere le partite
              giocate e ritrovare i tuoi progressi ogni volta che torni al tavolo.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ── Stato di attesa: skeleton coerente + annuncio per screen reader ── */}
          {state === "loading" && (
            <div className="profile-loading" role="status" aria-live="polite" aria-busy="true">
              <span className="sr-only">Caricamento del profilo in corso…</span>
              <p className="muted profile-loading-text" aria-hidden="true">
                <span className="spinner-inline" /> Carico le tue statistiche…
              </p>
              <div className="stats-grid" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="stat-card skeleton-card" data-highlight={i < 2 ? "true" : "false"}>
                    <span className="skeleton skeleton-value" />
                    <span className="skeleton skeleton-label" />
                  </div>
                ))}
              </div>
              <div className="match-skeleton" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton skeleton-row" />
                ))}
              </div>
            </div>
          )}

          {/* ── Errore + Riprova ─────────────────────────────────────────── */}
          {state === "error" && (
            <div className="profile-error" role="alert" aria-live="assertive">
              <p className="auth-error">
                <span className="auth-error-icon" aria-hidden="true">!</span>
                <span>{error}</span>
              </p>
              <button type="button" className="btn-ghost profile-retry" onClick={() => void load()}>
                Riprova
              </button>
            </div>
          )}

          {/* ── Statistiche ─────────────────────────────────────────────── */}
          {state === "ready" && stats && (
            <>
              <div className="stats-grid" aria-label="Le tue statistiche">
                {/* Metriche CHIAVE in evidenza (in alto, accento d'oro). */}
                <StatCard label="% Vittorie" value={`${nfPct.format(stats.winRate * 100)}%`} highlight />
                <StatCard label="Punti totali" value={nfInt.format(stats.totalPoints)} highlight />
                {/* Conteggi di supporto. */}
                <StatCard label="Giocate" value={nfInt.format(stats.matchesPlayed)} />
                <StatCard label="Vinte" value={nfInt.format(stats.matchesWon)} />
                <StatCard label="Perse" value={nfInt.format(stats.matchesLost)} />
              </div>

              {/* ── Storico partite ───────────────────────────────────────── */}
              <h2 className="profile-section-title">Partite recenti</h2>
              {matches.length === 0 ? (
                <div className="profile-empty" role="status">
                  <span className="profile-empty-icon" aria-hidden="true">♠ ♥ ♦ ♣</span>
                  <p className="profile-empty-title">Nessuna partita ancora</p>
                  <p className="profile-empty-text">
                    Gioca la tua prima partita: comparirà qui, con esito, avversario e punteggio.
                  </p>
                </div>
              ) : (
                <>
                  <ul className="match-history" aria-label="Storico delle partite recenti">
                    {matches.map((m) => {
                      const won = m.result === "won";
                      return (
                        <li key={m.matchId} className="match-row" data-result={m.result}>
                          <span className="match-result" data-result={m.result}>
                            <span className="match-result-icon" aria-hidden="true">
                              {won ? "▲" : "▼"}
                            </span>
                            {won ? "Vittoria" : "Sconfitta"}
                          </span>
                          <span className="match-meta">
                            <span className="match-opponent">
                              <span className="match-vs" aria-hidden="true">vs</span> {m.opponentName}
                            </span>
                            <span className="match-date">{formatDate(m.endedAt)}</span>
                          </span>
                          <span className="match-score">
                            <span className="sr-only">Punteggio: </span>
                            <span className="ms-you">{m.yourScore}</span>
                            <span className="ms-sep" aria-hidden="true">–</span>
                            <span className="ms-opp">{m.opponentScore}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {hasMore && (
                    <div className="match-more">
                      <button
                        type="button"
                        className="btn-ghost profile-more"
                        onClick={() => void loadMore()}
                        disabled={loadingMore}
                        aria-busy={loadingMore}
                      >
                        {loadingMore ? (
                          <>
                            <span className="spinner-inline" aria-hidden="true" /> Caricamento…
                          </>
                        ) : (
                          "Carica altre"
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      <div className="profile-actions">
        <button type="button" className="cta btn-primary" onClick={onBack}>
          Torna al tavolo
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div className="stat-card" data-highlight={highlight ? "true" : "false"}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/**
 * Formattazione data di PRESENTAZIONE (locale IT): compatta e leggibile
 * ("5 mar 2026"). Nessuna logica di dominio. Placeholder per data assente: "—".
 */
function formatDate(epochMs: number | null): string {
  if (epochMs == null) return "—";
  try {
    return new Date(epochMs).toLocaleDateString("it-IT", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}
