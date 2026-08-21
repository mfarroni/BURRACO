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
 * rendering dei numeri che il server ha aggregato. L'utente è derivato dal token
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

// COPY = placeholder (definitiva a agente_ui_ux).
const PAGE_SIZE = 10;

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
          {isGuest ? "Ospite" : "Registrato"}
        </span>
      </div>

      {/* ── Ospite: invito a registrarsi (nessuna statistica consultabile) ── */}
      {isGuest ? (
        <p className="profile-guest-note" role="status">
          Registrati per salvare le statistiche e rivedere le tue partite.
        </p>
      ) : (
        <>
          {/* ── Stati di attesa/errore ─────────────────────────────────── */}
          {state === "loading" && (
            <p className="muted" role="status">
              Caricamento del profilo…
            </p>
          )}

          {state === "error" && (
            <div className="profile-error" role="alert">
              <p className="auth-error">
                <span className="auth-error-icon" aria-hidden="true">!</span>
                <span>{error}</span>
              </p>
              <button type="button" className="btn-ghost" onClick={() => void load()}>
                Riprova
              </button>
            </div>
          )}

          {/* ── Statistiche ─────────────────────────────────────────────── */}
          {state === "ready" && stats && (
            <>
              <div className="stats-grid">
                <StatCard label="Giocate" value={stats.matchesPlayed} />
                <StatCard label="Vinte" value={stats.matchesWon} />
                <StatCard label="Perse" value={stats.matchesLost} />
                <StatCard label="% Vittorie" value={`${Math.round(stats.winRate * 100)}%`} />
                <StatCard label="Punti totali" value={stats.totalPoints} />
              </div>

              {/* ── Storico partite ───────────────────────────────────────── */}
              <h2 className="profile-section-title">Partite recenti</h2>
              {matches.length === 0 ? (
                <p className="muted" role="status">
                  Nessuna partita ancora. Gioca la tua prima partita per popolare lo storico.
                </p>
              ) : (
                <>
                  <ul className="match-history" aria-label="Storico partite recenti">
                    {matches.map((m) => (
                      <li key={m.matchId} className="match-row" data-result={m.result}>
                        <span className="match-result">{m.result === "won" ? "Vittoria" : "Sconfitta"}</span>
                        <span className="match-opponent">vs {m.opponentName}</span>
                        <span className="match-score">
                          {m.yourScore} – {m.opponentScore}
                        </span>
                        <span className="match-date">{formatDate(m.endedAt)}</span>
                      </li>
                    ))}
                  </ul>
                  {hasMore && (
                    <div className="match-more">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => void loadMore()}
                        disabled={loadingMore}
                      >
                        {loadingMore ? "Caricamento…" : "Carica altre"}
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

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-card">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** Formattazione data leggibile (locale IT). Placeholder: rifinitura a ui_ux. */
function formatDate(epochMs: number | null): string {
  if (epochMs == null) return "—";
  try {
    return new Date(epochMs).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}
