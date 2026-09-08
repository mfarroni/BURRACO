"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { WaitingTableView } from "@/lib/contract";
import type { LobbyStatus } from "@/lib/lobby";
import type { SitRejectedInfo } from "@/lib/useGameSocket";

/**
 * LOBBY (`in_lobby`) — lista dei tavoli pubblici in attesa, contatore giocatori,
 * le due azioni principali ("Gioca subito" / "Apri un tavolo") e l'ingresso con
 * codice. Competenza develop: struttura, stato dei campi, collegamento alle
 * intenzioni WS/HTTP e stati vuoto/caricamento/errore. La presentazione fine
 * (copy definitiva, gerarchia, micro-interazioni) è di agente_ui_ux.
 *
 * Il client è muto sulle regole: NON decide seduta/visibilità/avvio. Emette
 * intenzioni (onQuickMatch/onOpenTable/onSit/onJoinByCode) e riflette la lista
 * ricevuta via polling HTTP; l'avvio partita passa dal WebSocket, mai da qui.
 */

interface LobbyProps {
  tables: WaitingTableView[];
  lobbyPlayers: number;
  status: LobbyStatus;
  /** true mentre una connessione WS è in apertura: disabilita le azioni. */
  connecting: boolean;
  sitRejected: SitRejectedInfo | null;
  onDismissSitRejected: () => void;
  onQuickMatch: () => void;
  onOpenTable: () => void;
  onSit: (code: string) => void;
  onJoinByCode: (code: string) => void;
  /** Annulla una connessione in corso (utile se il server è lento a svegliarsi). */
  onAbort: () => void;
}

/** "attende da MM:SS" dal timestamp di apertura (timer locale, aggiornato ogni 1s). */
function formatWait(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function Lobby({
  tables,
  lobbyPlayers,
  status,
  connecting,
  sitRejected,
  onDismissSitRejected,
  onQuickMatch,
  onOpenTable,
  onSit,
  onJoinByCode,
  onAbort,
}: LobbyProps) {
  const [codeInput, setCodeInput] = useState("");
  // Un solo tick al secondo per tutti i timer "attende da" delle righe.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // "Qualcuno si è appena seduto": avviso effimero, si auto-chiude (la lista è già
  // stata rinfrescata da page.tsx osservando sitRejected).
  const dismissRef = useRef(onDismissSitRejected);
  dismissRef.current = onDismissSitRejected;
  useEffect(() => {
    if (!sitRejected) return;
    const t = setTimeout(() => dismissRef.current(), 6000);
    return () => clearTimeout(t);
  }, [sitRejected]);

  const isEmpty = tables.length === 0;
  const trimmedCode = codeInput.trim();

  // Decisione lead #1: `lobbyPlayers` INCLUDE l'utente corrente → presentiamo gli
  // ALTRI. A zero, un invito esplicito (non "sei solo": qualcuno può arrivare).
  const others = Math.max(0, lobbyPlayers - 1);

  const submitCode = () => {
    if (!trimmedCode || connecting) return;
    onJoinByCode(trimmedCode);
  };

  return (
    <div className="lobby-body">
      {/* Contatore: presenta gli ALTRI giocatori realmente in lobby (§6.2). */}
      <p className="lobby-counter" data-empty={others === 0 ? "true" : "false"}>
        <span className="lobby-counter-badge" aria-hidden="true">
          <UsersIcon />
        </span>
        {others === 0 ? (
          <span className="lobby-counter-text">
            <strong>Sei il primo in lobby</strong> — apri un tavolo e comparirà agli altri.
          </span>
        ) : (
          <span className="lobby-counter-text">
            <strong className="num">{others}</strong>{" "}
            {others === 1 ? "altro giocatore in lobby" : "altri giocatori in lobby"}
          </span>
        )}
      </p>

      {/* Avviso: tavolo appena riempito (§5.4-C). Tono ambra, non colpevolizzante. */}
      {sitRejected && (
        <div className="banner" data-tone="warn" role="alert">
          <span className="banner-icon" aria-hidden="true">↻</span>
          <span className="banner-body">
            <span className="banner-title">Qualcuno si è appena seduto a quel tavolo</span>
            <span className="banner-sub">Abbiamo aggiornato la lista: scegli un altro tavolo o aprine uno tuo.</span>
          </span>
          <button type="button" className="toast-close" onClick={onDismissSitRejected} aria-label="Chiudi avviso">
            ×
          </button>
        </div>
      )}

      {/* Testo di contorno: cambia tono tra lista vuota (§6.3) e lista piena. */}
      {isEmpty && status === "ok" ? (
        <div className="table-empty" role="status">
          <EmptyTablesMark />
          <p className="table-empty-title">Nessun tavolo aperto in questo momento.</p>
          <p className="table-empty-text">
            Non significa che tu sia solo: altri giocatori potrebbero essere in lobby proprio come te, in
            attesa. Ma finché qualcuno non apre un tavolo, non c&apos;è nessun posto a cui sedersi.
          </p>
          <p className="table-empty-text">
            <strong>Apri tu un tavolo:</strong> comparirà nella lista di tutti gli altri entro pochi secondi.
          </p>
        </div>
      ) : (
        !isEmpty && <p className="lobby-lead">Siediti a un tavolo esistente, oppure aprine uno tuo.</p>
      )}

      {/* Le due azioni: elemento più evidente della schermata (§6.3). "Gioca
          subito" è primaria (oro), "Apri un tavolo" secondaria (feltro). */}
      <div className="lobby-actions" role="group" aria-label="Come vuoi iniziare a giocare">
        <button
          type="button"
          className="cta btn-primary lobby-action lobby-action-primary"
          onClick={onQuickMatch}
          disabled={connecting}
        >
          {connecting ? (
            <>
              <span className="cta-spinner" aria-hidden="true" />
              Connessione…
            </>
          ) : (
            <>
              <span className="lobby-action-icon" aria-hidden="true">
                <BoltIcon />
              </span>
              <span className="lobby-action-text">
                <span className="lobby-action-title">Gioca subito</span>
                <span className="lobby-action-sub">Ti sediamo al primo tavolo in attesa</span>
              </span>
            </>
          )}
        </button>
        <button
          type="button"
          className="cta lobby-action lobby-action-open"
          onClick={onOpenTable}
          disabled={connecting}
        >
          <span className="lobby-action-icon" aria-hidden="true">
            <NewTableIcon />
          </span>
          <span className="lobby-action-text">
            <span className="lobby-action-title">Apri un tavolo</span>
            <span className="lobby-action-sub">Crea il tuo e invita un amico</span>
          </span>
        </button>
      </div>

      {/* Connessione in corso: il primo accesso può essere lento (server che si
          risveglia, cold-start ~30s). Feedback esplicito + possibilità di annullare. */}
      {connecting && (
        <div className="lobby-connecting" role="status" aria-live="polite">
          <span className="spinner-inline" aria-hidden="true" />
          <span className="lobby-connecting-body">
            <span className="lobby-connecting-title">Connessione al server…</span>
            <span className="lobby-connecting-sub">
              Al primo accesso il server si sta svegliando: può richiedere fino a mezzo minuto.
            </span>
          </span>
          <button type="button" className="btn-ghost" onClick={onAbort}>
            Annulla
          </button>
        </div>
      )}

      {/* Lista tavoli: stati caricamento / errore / righe. Lo stato vuoto (sopra)
          è mostrato al posto della lista solo quando il polling è andato a buon fine. */}
      <section className="table-section" aria-label="Tavoli pubblici in attesa" aria-busy={status === "loading"}>
        {status === "loading" && isEmpty && (
          <>
            <div className="table-loading" role="status" aria-live="polite">
              <span className="spinner-inline" aria-hidden="true" />
              Cerco i tavoli aperti…
            </div>
            <ul className="table-skeletons" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="table-skel">
                  <span className="sk-avatar skeleton" />
                  <span className="sk-lines">
                    <span className="sk-line-1 skeleton" />
                    <span className="sk-line-2 skeleton" />
                  </span>
                  <span className="sk-btn skeleton" />
                </li>
              ))}
            </ul>
          </>
        )}

        {status === "error" && (
          <div className="banner" data-tone="warn" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span className="banner-body">
              <span className="banner-title">Lista tavoli non disponibile</span>
              <span className="banner-sub">Riprovo tra pochi secondi… i tavoli già visti restano qui sotto.</span>
            </span>
          </div>
        )}

        {!isEmpty && (
          <ul className="table-list">
            {tables.map((t, i) => {
              const full = t.seatsTaken >= t.seatsTotal;
              const initial = (t.creatorName || "?").trim().charAt(0).toUpperCase() || "?";
              return (
                <li key={t.code} className="table-row" style={{ "--row-index": i } as CSSProperties}>
                  <span className="table-avatar" aria-hidden="true">{initial}</span>
                  <div className="table-row-main">
                    <span className="table-creator">{t.creatorName || "Giocatore"}</span>
                    <div className="table-row-meta">
                      <span className="table-wait">
                        <span className="wait-dot" aria-hidden="true" />
                        attende da <span className="num">{formatWait(now - t.openedAt)}</span>
                      </span>
                      <span className="table-seats">
                        <span className="seat-dots" aria-hidden="true">
                          {Array.from({ length: t.seatsTotal }, (_, s) => (
                            <span key={s} className="seat-dot" data-filled={s < t.seatsTaken ? "true" : "false"} />
                          ))}
                        </span>
                        {t.seatsTaken}/{t.seatsTotal} posti
                      </span>
                      <span className="table-code-inline">
                        codice <code>{t.code}</code>
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary table-sit"
                    onClick={() => onSit(t.code)}
                    disabled={connecting || full}
                    aria-label={`Siediti al tavolo di ${t.creatorName || "un giocatore"}, codice ${t.code}`}
                  >
                    Siediti
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Ingresso con codice (door c): raggiunge anche i tavoli privati. */}
      <div className="join-by-code">
        <label htmlFor="join-code">
          <KeyIcon />
          Entra con codice
        </label>
        <div className="join-by-code-row">
          <input
            id="join-code"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCode();
            }}
            placeholder="es. K7Q2M"
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="join-code-hint"
          />
          <button type="button" className="lobby-action" onClick={submitCode} disabled={!trimmedCode || connecting}>
            Entra
          </button>
        </div>
        <p id="join-code-hint" className="field-hint">
          Hai un codice da un amico? Digitalo per sederti al suo tavolo (anche privato).
        </p>
      </div>
    </div>
  );
}

/* ── Icone inline (monocromatiche, currentColor; nessun asset esterno) ─────── */

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

function NewTableIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M12 9v6M9 12h6" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.3a3 3 0 0 1 0 5.4M17.6 19a5.5 5.5 0 0 0-3-4.9" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="3.6" />
      <path d="M10.6 10.6 19 19M15 15l2-2" />
    </svg>
  );
}

function EmptyTablesMark() {
  return (
    <svg
      className="table-empty-mark"
      viewBox="0 0 64 52"
      width="72"
      height="58"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="14" width="24" height="32" rx="4" transform="rotate(-9 20 30)" opacity="0.45" />
      <rect x="30" y="8" width="24" height="32" rx="4" />
      <path d="M42 18v12M36 24h12" />
    </svg>
  );
}
