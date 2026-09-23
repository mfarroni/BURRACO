"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AuthUser,
  UserStats,
  MatchSummary,
  MatchDetail,
  MatchDeal,
  StatMetric,
  StatsPeriod,
  StatTrend,
} from "@/lib/contract";
import { fetchStats, fetchMatches, fetchMatchDetail } from "@/lib/profile";
import { AuthClientError } from "@/lib/auth";
import { DonationButton } from "@/components/DonationButton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { SideFlank } from "@/components/SideFlanks";
import { VetrinaBrandHeader } from "@/components/VetrinaBrandHeader";

/**
 * SCHERMATA PROFILO (macro-ciclo storico) — SOLA LETTURA.
 * Competenza develop: struttura, stato client, fetch degli endpoint /users/me/*,
 * stati di attesa/errore/vuoto/sotto-soglia. La PRESENTAZIONE fine (copy, gerarchia
 * visiva, micro-interazioni, rifinitura WCAG AA) è di agente_ui_ux e vive qui +
 * globals.css.
 *
 * Il client è muto sulle regole: nessun calcolo di statistiche qui, solo rendering
 * dei numeri che il server ha aggregato (l'unica trasformazione è la formattazione
 * IT di numeri/percentuali/date). L'utente è derivato dal token lato server (nessun
 * id nel client) → non esiste modo di consultare altri profili.
 *
 * Tre viste: Riepilogo (contatori + "come giochi" + andamento), Lista (storico
 * cliccabile), Dettaglio (smazzata-per-smazzata). Gli ospiti vedono solo l'invito a
 * registrarsi (gate server 403 + ramo dedicato qui).
 */

interface Props {
  user: AuthUser;
  onBack: () => void;
}

type LoadState = "loading" | "ready" | "error";
type View = "summary" | "detail";

const PAGE_SIZE = 10;

/* Formattatori di PRESENTAZIONE (locale IT), creati una sola volta. */
const nfInt = new Intl.NumberFormat("it-IT");
const nfPct = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: "all", label: "Sempre" },
  { key: "30d", label: "30 giorni" },
  { key: "season", label: "Stagione" },
];

/** Aggiunge il suffisso "(ospite)" quando l'avversario era un ospite. */
function opponentLabel(name: string, isGuest: boolean): string {
  return isGuest ? `${name} (ospite)` : name;
}

export function ProfilePanel({ user, onBack }: Props) {
  const isGuest = user.isGuest;

  const [view, setView] = useState<View>("summary");
  const [periodo, setPeriodo] = useState<StatsPeriod>("all");

  const [stats, setStats] = useState<UserStats | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [state, setState] = useState<LoadState>(isGuest ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Vista Dettaglio.
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [detailState, setDetailState] = useState<LoadState>("loading");
  const [detailError, setDetailError] = useState<string | null>(null);
  // Sintesi della riga selezionata: intestazione immediata mentre il dettaglio carica.
  const [selected, setSelected] = useState<MatchSummary | null>(null);

  const load = useCallback(async (p: StatsPeriod) => {
    setState("loading");
    setError(null);
    try {
      const [s, m] = await Promise.all([fetchStats(p), fetchMatches(PAGE_SIZE, 0)]);
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
    void load(periodo);
  }, [isGuest, load, periodo]);

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

  const openDetail = useCallback(async (m: MatchSummary) => {
    setSelected(m);
    setView("detail");
    setDetail(null);
    setDetailState("loading");
    setDetailError(null);
    try {
      const d = await fetchMatchDetail(m.matchId);
      setDetail(d);
      setDetailState("ready");
    } catch (err) {
      setDetailError(
        err instanceof AuthClientError ? err.message : "Impossibile caricare il dettaglio.",
      );
      setDetailState("error");
    }
  }, []);

  const retryDetail = useCallback(() => {
    if (selected) void openDetail(selected);
  }, [selected, openDetail]);

  const backToSummary = useCallback(() => {
    setView("summary");
    setDetail(null);
    setSelected(null);
  }, []);

  /* ── Vista DETTAGLIO ──────────────────────────────────────────────────── */
  if (!isGuest && view === "detail") {
    return (
      <MatchDetailView
        summary={selected}
        detail={detail}
        state={detailState}
        error={detailError}
        onRetry={retryDetail}
        onBack={backToSummary}
      />
    );
  }

  const displayName = user.displayName?.trim() || user.email?.split("@")[0] || "Utente";

  /* ── Vista RIEPILOGO + LISTA ──────────────────────────────────────────── */
  return (
    <div className="page-3col-wrapper profile-3col-wrapper">
      <SideFlank side="left" />
      <main className="central-column-card profile-panel">
        <VetrinaBrandHeader title="Burraco" subtitle="Profilo Giocatore — Circolo Nettuno" />

        <div className="profile-identity">
          <div className="profile-who">
            <ProfileAvatar name={displayName} editable={!isGuest} />
            <div className="profile-who-text">
              <span className="profile-name">{displayName}</span>
              {/* Account del giocatore: l'email con cui accede (gli ospiti non ne hanno). */}
              {user.email && (
                <span className="profile-account">
                  Account: <strong>{user.email}</strong>
                </span>
              )}
            </div>
          </div>
          <span className="profile-badge" data-guest={isGuest ? "true" : "false"}>
            <span className="profile-badge-icon" aria-hidden="true">{isGuest ? "○" : "✓"}</span>
            {isGuest ? "Ospite" : "Registrato"}
          </span>
        </div>

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
          {/* Selettore periodo: filtra temporalmente le statistiche (non la lista). */}
          <div className="period-filter" role="group" aria-label="Periodo delle statistiche">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="period-chip"
                data-active={periodo === p.key ? "true" : "false"}
                aria-pressed={periodo === p.key}
                onClick={() => setPeriodo(p.key)}
                disabled={state === "loading"}
              >
                {p.label}
              </button>
            ))}
          </div>

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

          {state === "error" && (
            <div className="profile-error" role="alert" aria-live="assertive">
              <p className="auth-error">
                <span className="auth-error-icon" aria-hidden="true">!</span>
                <span>{error}</span>
              </p>
              <button type="button" className="btn-ghost profile-retry" onClick={() => void load(periodo)}>
                Riprova
              </button>
            </div>
          )}

          {state === "ready" && stats && (
            <>
              <div className="stats-grid" aria-label="Le tue statistiche">
                <StatCard label="% Vittorie" value={`${nfPct.format(stats.winRate * 100)}%`} highlight />
                <StatCard label="Punti totali" value={nfInt.format(stats.totalPoints)} highlight />
                <StatCard label="Giocate" value={nfInt.format(stats.matchesPlayed)} />
                <StatCard label="Vinte" value={nfInt.format(stats.matchesWon)} />
                <StatCard label="Perse" value={nfInt.format(stats.matchesLost)} />
                <StatCard
                  label="Abbandonate"
                  value={stats.matchesAbandoned == null ? "—" : nfInt.format(stats.matchesAbandoned)}
                />
                <StatCard
                  label="Punteggio medio"
                  value={stats.avgFinalScore == null ? "—" : nfInt.format(Math.round(stats.avgFinalScore))}
                />
                <StatCard
                  label="Miglior punteggio"
                  value={stats.bestMatchScore == null ? "—" : nfInt.format(stats.bestMatchScore)}
                />
              </div>

              {/* ── In sintesi (contesto): iscrizione, ultime 5, avversari ────── */}
              <ProfileContext stats={stats} />

              {/* Blocco analisi + andamento: presenti SOLO se il backend è aggiornato
                  (campo `analysis`). Con un backend non ancora aggiornato la risposta
                  non li contiene: si nasconde la sezione invece di dereferenziare
                  `undefined` (che manderebbe in crash l'intera app). */}
              {stats.analysis && (
                <>
              {/* ── Blocco "Come giochi" (analisi di stile) ─────────────────── */}
              <h2 className="profile-section-title">Come giochi</h2>
              <div className="style-grid" aria-label="Analisi del tuo stile di gioco">
                <StyleStat
                  label="Rapporto pulito/sporco"
                  hint="Alto = giochi 'pulito' (più punti per burraco); basso = chiudi sporco in fretta."
                  metric={stats.analysis.cleanDirtyRatio}
                  format={(v) => nf2.format(v)}
                />
                <StyleStat
                  label="Burrachi puliti / smazzata"
                  hint="Media di burrachi puliti per smazzata."
                  metric={stats.analysis.burrachiPulitiPerDeal}
                  format={(v) => nf2.format(v)}
                />
                <StyleStat
                  label="Burrachi sporchi / smazzata"
                  hint="Media di burrachi sporchi per smazzata."
                  metric={stats.analysis.burrachiSporchiPerDeal}
                  format={(v) => nf2.format(v)}
                />
                <StyleStat
                  label="% Pozzetto"
                  hint="Con che frequenza arrivi al pozzetto."
                  metric={stats.analysis.pozzettoRate}
                  format={(v) => `${nfPct.format(v * 100)}%`}
                />
                <StyleStat
                  label="Pozzetto in diretta"
                  hint="Fra i pozzetti presi, quanti svuotando la mano prima dello scarto."
                  metric={stats.analysis.pozzettoInDirettaShare}
                  format={(v) => `${nfPct.format(v * 100)}%`}
                />
                <StyleStat
                  label="% Chiusure"
                  hint="Con che frequenza sei tu a chiudere la smazzata."
                  metric={stats.analysis.closureRate}
                  format={(v) => `${nfPct.format(v * 100)}%`}
                />
                <StyleStat
                  label="Punti medi / smazzata"
                  hint="Media punti per smazzata."
                  metric={stats.analysis.avgPointsPerDeal}
                  format={(v) => nfInt.format(Math.round(v))}
                />
                <StyleStat
                  label="Malus medio in mano"
                  hint="Punti medi persi per carte rimaste in mano."
                  metric={stats.analysis.avgHandPenalty}
                  format={(v) => nfInt.format(Math.round(v))}
                />
                {/* Conteggio semplice, senza soglia. */}
                <div className="style-stat" data-insufficient="false">
                  <span className="style-stat-label">Malus pozzetto subiti</span>
                  <span className="style-stat-value">{nfInt.format(stats.analysis.malusPozzettoCount)}</span>
                  <span className="style-stat-hint">Quante volte hai subito il −100 del pozzetto.</span>
                </div>
              </div>

              {/* ── Andamento (sparkline) ───────────────────────────────────── */}
              <h2 className="profile-section-title">Andamento</h2>
              <Sparkline trend={stats.analysis.trend} />
                </>
              )}

              {/* ── Storico partite ─────────────────────────────────────────── */}
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
                          <button
                            type="button"
                            className="match-open"
                            onClick={() => void openDetail(m)}
                            aria-label={`Apri il dettaglio: ${won ? "vittoria" : "sconfitta"} contro ${opponentLabel(m.opponentName, m.opponentIsGuest ?? false)}${m.dealsCount != null ? `, ${m.dealsCount} smazzate` : ""}`}
                          >
                            <span className="match-result" data-result={m.result}>
                              <span className="match-result-icon" aria-hidden="true">{won ? "▲" : "▼"}</span>
                              {won ? "Vittoria" : "Sconfitta"}
                            </span>
                            <span className="match-meta">
                              <span className="match-opponent">
                                <span className="match-vs" aria-hidden="true">vs</span>{" "}
                                {opponentLabel(m.opponentName, m.opponentIsGuest ?? false)}
                              </span>
                              <span className="match-date">
                                {formatDate(m.endedAt)}
                                {m.dealsCount != null && (
                                  <>
                                    {" · "}
                                    {nfInt.format(m.dealsCount)}{" "}
                                    {m.dealsCount === 1 ? "smazzata" : "smazzate"}
                                  </>
                                )}
                              </span>
                            </span>
                            <span className="match-score">
                              <span className="sr-only">Punteggio: </span>
                              <span className="ms-you">{m.yourScore}</span>
                              <span className="ms-sep" aria-hidden="true">–</span>
                              <span className="ms-opp">{m.opponentScore}</span>
                            </span>
                            <span className="match-chevron" aria-hidden="true">›</span>
                          </button>
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

              {/* Disclaimer di CONSERVAZIONE (§4.4): dice COSA si conserva e PER
                  QUANTO. Non parla di cancellazione di avversari. I totali (questa
                  pagina) restano sempre; il dettaglio smazzata-per-smazzata dello
                  storico è conservato per alcuni mesi. */}
              <p className="profile-retention-note" role="note">
                Conserviamo il dettaglio delle tue partite per alcuni mesi; le statistiche
                complessive restano sempre disponibili.
              </p>

              {/* Donazione (Lotto 4 — R6): in fondo al pannello, dopo le sezioni
                  statistiche/andamento/partite. Solo utente REGISTRATO (ramo
                  non-ospite) e solo a dati caricati. Mai fissa/sticky/overlay. */}
              <DonationButton />
            </>
          )}
        </>
      )}

      <div className="profile-actions">
        <button type="button" className="cta btn-primary" onClick={onBack}>
          Torna al tavolo
        </button>
      </div>
      </main>
      <SideFlank side="right" />
    </div>
  );
}

/* ─────────────────────────── Vista DETTAGLIO ──────────────────────────── */

function MatchDetailView({
  summary,
  detail,
  state,
  error,
  onRetry,
  onBack,
}: {
  summary: MatchSummary | null;
  detail: MatchDetail | null;
  state: LoadState;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  // Intestazione: preferisce i dati del dettaglio; ripiega sulla sintesi in attesa.
  const oppName = detail
    ? opponentLabel(detail.opponent.name, detail.opponent.isGuest)
    : summary
      ? opponentLabel(summary.opponentName, summary.opponentIsGuest ?? false)
      : "Avversario";
  const result = detail ? detail.result : summary ? summary.result : null;
  const yourSeat = detail?.yourSeat ?? 0;

  return (
    <div className="page-3col-wrapper profile-3col-wrapper">
      <SideFlank side="left" />
      <main className="central-column-card profile-panel">
        <VetrinaBrandHeader title="Burraco" subtitle="Dettaglio Partita — Circolo Nettuno" />

      <button type="button" className="btn-ghost detail-back" onClick={onBack}>
        ‹ Torna allo storico
      </button>

      <div className="detail-head">
        <span className="detail-opponent">
          <span className="match-vs" aria-hidden="true">vs</span> {oppName}
        </span>
        {result && (
          <span className="match-result" data-result={result}>
            <span className="match-result-icon" aria-hidden="true">{result === "won" ? "▲" : "▼"}</span>
            {result === "won" ? "Vittoria" : "Sconfitta"}
          </span>
        )}
        {detail && (
          <span className="detail-score">
            <span className="sr-only">Punteggio finale: </span>
            <span className="ms-you">{detail.finalScore.you}</span>
            <span className="ms-sep" aria-hidden="true">–</span>
            <span className="ms-opp">{detail.finalScore.opponent}</span>
          </span>
        )}
        {detail && <span className="detail-date">{formatDate(detail.endedAt)}</span>}
      </div>

      {state === "loading" && (
        <div className="profile-loading" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Caricamento del dettaglio in corso…</span>
          <div className="match-skeleton" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="profile-error" role="alert" aria-live="assertive">
          <p className="auth-error">
            <span className="auth-error-icon" aria-hidden="true">!</span>
            <span>{error}</span>
          </p>
          <button type="button" className="btn-ghost profile-retry" onClick={onRetry}>
            Riprova
          </button>
        </div>
      )}

      {state === "ready" && detail && (
        detail.deals.length === 0 ? (
          <div className="profile-empty" role="status">
            <span className="profile-empty-icon" aria-hidden="true">♠ ♥ ♦ ♣</span>
            <p className="profile-empty-title">Dettaglio non disponibile</p>
            <p className="profile-empty-text">Per questa partita non ci sono smazzate registrate.</p>
          </div>
        ) : (
          <DealsTable deals={detail.deals} yourSeat={yourSeat} oppName={oppName} />
        )
      )}

      <div className="profile-actions">
        <button type="button" className="cta btn-primary" onClick={onBack}>
          Torna allo storico
        </button>
      </div>
      </main>
      <SideFlank side="right" />
    </div>
  );
}

/**
 * Tabella delle smazzate (prospettiva dell'utente). Un'unica <table> semantica:
 * su desktop resta tabella; a ≤375px il CSS la trasforma in schede (una card per
 * smazzata) usando le etichette `data-label` — più accessibile dello scroll
 * orizzontale. Le celle mostrano i fatti del giocatore + chi ha chiuso.
 */
function DealsTable({ deals, yourSeat, oppName }: { deals: MatchDeal[]; yourSeat: number; oppName: string }) {
  const closerLabel = (d: MatchDeal): string => {
    if (d.closerSeat === null) return "—";
    return d.closerSeat === yourSeat ? "Tu" : oppName;
  };
  const pozzettoLabel = (d: MatchDeal): string => {
    const s = d.you;
    if (!s.pozzettoPreso) return "No";
    return s.pozzettoInDiretta ? "In diretta" : "Differita";
  };

  return (
    <table className="deals-table">
      <caption className="sr-only">Dettaglio smazzata per smazzata dei tuoi punti.</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Chi ha chiuso</th>
          <th scope="col">Punti</th>
          <th scope="col">Burrachi</th>
          <th scope="col">Pozzetto</th>
          <th scope="col">In mano</th>
          <th scope="col">Malus</th>
        </tr>
      </thead>
      <tbody>
        {deals.map((d) => {
          const closedByYou = d.closerSeat === yourSeat;
          const gotPozzetto = d.you.pozzettoPreso;
          return (
            <tr key={d.numeroSmazzata}>
              <td data-label="Smazzata">{d.numeroSmazzata}</td>
              <td data-label="Chi ha chiuso">
                {d.closerSeat === null ? (
                  <span className="deal-none">—</span>
                ) : closedByYou ? (
                  <span className="deal-closer-you">Tu</span>
                ) : (
                  closerLabel(d)
                )}
              </td>
              <td data-label="Punti" className="num">{d.you.puntiSmazzata}</td>
              <td data-label="Burrachi">
                <span className="burr-clean">
                  {d.you.burrachiPuliti} {d.you.burrachiPuliti === 1 ? "pulito" : "puliti"}
                </span>
                {" · "}
                <span className="burr-dirty">
                  {d.you.burrachiSporchi} {d.you.burrachiSporchi === 1 ? "sporco" : "sporchi"}
                </span>
              </td>
              <td data-label="Pozzetto">
                {gotPozzetto ? pozzettoLabel(d) : <span className="deal-none">No</span>}
              </td>
              <td data-label="In mano" className="num">{d.you.puntiCarteInMano}</td>
              <td data-label="Malus">
                {d.you.malusPozzetto ? (
                  <span className="deal-malus">−100</span>
                ) : (
                  <span className="deal-none">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ─────────────────────────── componenti di supporto ──────────────────── */

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
 * Blocco "In sintesi" (Lotto 4 — R7): data d'iscrizione, partite vs registrati/ospiti,
 * esito delle ultime 5 a pallini e avversari più frequenti. Tutti dati che il server
 * ha già aggregato; qui solo formattazione IT e rendering accessibile.
 *
 * Robustezza: i campi sono opzionali (contratto tollerante col backend non aggiornato)
 * → si applicano default gentili. `memberSince` si mostra sempre (esiste per ogni
 * registrato); le altre voci mostrano un placeholder finché non ci sono partite, mai
 * zeri fuorvianti.
 */
function ProfileContext({ stats }: { stats: UserStats }) {
  const lastFive = stats.lastFive ?? [];
  const topOpponents = stats.topOpponents ?? [];
  const vsRegistered = stats.vsRegistered ?? 0;
  const vsGuest = stats.vsGuest ?? 0;
  const noGames = stats.matchesPlayed === 0;

  return (
    <section className="profile-context" aria-label="In sintesi">
      <h2 className="profile-section-title">In sintesi</h2>

      <dl className="context-facts">
        <div className="context-fact">
          <dt className="context-label">Iscritto dal</dt>
          <dd className="context-value">
            {stats.memberSince == null ? "—" : formatDate(stats.memberSince)}
          </dd>
        </div>
        <div className="context-fact">
          <dt className="context-label">Partite vs registrati</dt>
          <dd className="context-value">{noGames ? "—" : nfInt.format(vsRegistered)}</dd>
        </div>
        <div className="context-fact">
          <dt className="context-label">Partite vs ospiti</dt>
          <dd className="context-value">{noGames ? "—" : nfInt.format(vsGuest)}</dd>
        </div>
      </dl>

      {/* Ultime 5 partite a pallini: l'esito NON è affidato al solo colore → ogni
          pallino porta la lettera V/S e un'etichetta per screen reader. Ordine
          cronologico: da sinistra (più vecchia) a destra (più recente). */}
      <div className="context-lastfive">
        <span className="context-label">Ultime 5 partite</span>
        {lastFive.length === 0 ? (
          <p className="context-empty">Ancora nessuna partita conclusa.</p>
        ) : (
          <>
            <ol
              className="last-five"
              aria-label="Esito delle ultime cinque partite, dalla più vecchia alla più recente"
            >
              {lastFive.map((r, i) => (
                <li key={i} className="lf-dot" data-result={r}>
                  <span className="lf-mark" aria-hidden="true">{r === "won" ? "V" : "S"}</span>
                  <span className="sr-only">{r === "won" ? "Vinta" : "Persa"}</span>
                </li>
              ))}
            </ol>
            <span className="context-axis" aria-hidden="true">
              <span>meno recenti</span>
              <span>più recenti</span>
            </span>
          </>
        )}
      </div>

      {/* Avversari più frequenti (max 3). Nome + "(ospite)" se ospite + conteggio. */}
      <div className="context-opponents">
        <span className="context-label">Avversari più frequenti</span>
        {topOpponents.length === 0 ? (
          <p className="context-empty">
            Gioca qualche partita per vedere chi incontri più spesso.
          </p>
        ) : (
          <ul className="top-opponents">
            {topOpponents.map((o, i) => (
              <li key={i} className="top-opponent">
                <span className="top-opponent-name">{opponentLabel(o.name, o.isGuest)}</span>
                <span className="top-opponent-count">
                  {nfInt.format(o.count)} {o.count === 1 ? "partita" : "partite"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Card di una statistica di STILE. Se `metric.value` è null (campione sotto soglia),
 * mostra "dati insufficienti (sampleSize/threshold)" invece di uno zero fuorviante.
 */
function StyleStat({
  label,
  hint,
  metric,
  format,
}: {
  label: string;
  hint: string;
  metric: StatMetric;
  format: (v: number) => string;
}) {
  const insufficient = metric.value === null;
  return (
    <div className="style-stat" data-insufficient={insufficient ? "true" : "false"}>
      <span className="style-stat-label">{label}</span>
      <span className="style-stat-value">
        {insufficient ? (
          <span className="style-stat-nodata">
            dati insufficienti{" "}
            <span className="style-stat-sample">({metric.sampleSize}/{metric.threshold})</span>
          </span>
        ) : (
          format(metric.value as number)
        )}
      </span>
      <span className="style-stat-hint">{hint}</span>
    </div>
  );
}

/**
 * Sparkline dell'andamento: SVG INLINE (nessuna libreria da CDN, coerente con la
 * CSP `default-src 'self'`). Fornisce SEMPRE un'alternativa testuale: `aria-label`
 * sull'immagine + una serie leggibile per screen reader. Sotto soglia mostra un
 * messaggio, non un grafico vuoto.
 */
function Sparkline({ trend }: { trend: StatTrend }) {
  if (trend.sampleSize < trend.threshold) {
    return (
      <p className="muted sparkline-empty" role="status">
        Andamento disponibile dopo almeno {trend.threshold} partite ({trend.sampleSize}/{trend.threshold}).
      </p>
    );
  }
  const pts = trend.points;
  const W = 260;
  const H = 64;
  const PAD = 6;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const stepX = pts.length > 1 ? (W - PAD * 2) / (pts.length - 1) : 0;
  const coords = pts.map((v, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (H - PAD * 2) * (1 - (v - min) / range);
    return { x, y, v };
  });
  const polyPoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  // Poligono di riempimento sotto la linea (profondità discreta, on-brand):
  // dal basso-sinistra, su lungo la linea, giù a basso-destra.
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPoints = `${first.x.toFixed(1)},${H} ${polyPoints} ${last.x.toFixed(1)},${H}`;
  const label = `Andamento dei punti medi per partita, ultime ${pts.length} partite: ${pts.join(", ")}.`;

  return (
    <figure className="sparkline">
      <div className="sparkline-head" aria-hidden="true">
        <span className="sparkline-title">Punti medi per partita</span>
        <span className="sparkline-count">ultime {pts.length}</span>
      </div>
      <svg
        className="sparkline-svg"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        {/* Area di riempimento: distorsione invisibile, dà corpo alla curva. */}
        <polygon className="sparkline-area" points={areaPoints} />
        <polyline
          className="sparkline-line"
          points={polyPoints}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Punti intermedi discreti; l'ultimo (più recente) è enfatizzato. */}
        {coords.slice(0, -1).map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="1.8" fill="currentColor" opacity="0.7" />
        ))}
        <circle className="sparkline-dot-last" cx={last.x} cy={last.y} r="3.2" fill="currentColor" />
      </svg>
      <div className="sparkline-axis" aria-hidden="true">
        <span>Meno recenti</span>
        <span>Più recenti</span>
      </div>
      {/* Alternativa testuale/tabellare per screen reader e no-SVG. */}
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}

/**
 * Formattazione data di PRESENTAZIONE (locale IT): compatta ("5 mar 2026").
 * Placeholder per data assente: "—".
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
