"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { OpenRejectedInfo } from "@/lib/useGameSocket";
import { fetchNewCode } from "@/lib/lobby";

/**
 * MODALE "Apri un tavolo" (door a, §5.3). Precompila un codice suggerito dal
 * server (GET /tables/new-code, HTTP), modificabile, con la casella "Tavolo
 * privato — non mostrarlo in lista". Alla conferma delega l'apertura al chiamante
 * (che invia `open_table` sul WebSocket). Se il server risponde
 * `open_rejected{CODE_IN_USE}`, la modale RESTA aperta con un messaggio inline.
 *
 * Client muto: nessuna validazione di dominio qui. Il codice è normalizzato solo
 * per FORMA (maiuscolo, max 12) come il resto dell'app; la disponibilità reale la
 * decide il server (nessun takeover silenzioso).
 */

interface OpenTableModalProps {
  onConfirm: (code: string, isPrivate: boolean) => void;
  onCancel: () => void;
  openRejected: OpenRejectedInfo | null;
  /** errore di connessione/config (SEC-09): sblocca il pulsante e informa. */
  errorMessage: string | null;
  onDismissRejected: () => void;
}

export function OpenTableModal({
  onConfirm,
  onCancel,
  openRejected,
  errorMessage,
  onDismissRejected,
}: OpenTableModalProps) {
  const [code, setCode] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [loadingCode, setLoadingCode] = useState(true);
  const [codeError, setCodeError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Mostra un errore di connessione SOLO dopo un tentativo d'apertura (evita di
  // riflettere un errorMessage residuo di un'azione precedente).
  const [hasAttempted, setHasAttempted] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();

  // Precompila il codice suggerito dal server all'apertura della modale.
  useEffect(() => {
    let alive = true;
    setLoadingCode(true);
    setCodeError(false);
    fetchNewCode()
      .then((c) => {
        if (!alive) return;
        setCode(c.toUpperCase().slice(0, 12));
      })
      .catch(() => {
        if (alive) setCodeError(true);
      })
      .finally(() => {
        if (alive) setLoadingCode(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Un esito (rifiuto o errore) sblocca sempre il pulsante di conferma.
  useEffect(() => {
    if (openRejected || errorMessage) setSubmitting(false);
  }, [openRejected, errorMessage]);

  // Focus iniziale sul campo codice; trap del Tab; Esc = annulla.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    codeInputRef.current?.focus();
    codeInputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const nodes = cardRef.current?.querySelectorAll<HTMLElement>(
          'button, input, [href], [tabindex]:not([tabindex="-1"])',
        );
        if (!nodes || nodes.length === 0) return;
        const focusable = Array.from(nodes).filter((n) => !(n as HTMLButtonElement).disabled);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [onCancel]);

  const trimmed = code.trim();
  const canConfirm = !!trimmed && !submitting && !loadingCode;

  const confirm = () => {
    if (!canConfirm) return;
    onDismissRejected();
    setHasAttempted(true);
    setSubmitting(true);
    onConfirm(trimmed, isPrivate);
  };

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div
        className="overlay-card open-table"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        ref={cardRef}
      >
        <h2 id={titleId}>Apri un tavolo</h2>
        <p id={descId} className="muted open-table-desc">
          Scegli un codice o usa quello proposto. Chi vuoi far sedere digiterà lo stesso codice.
        </p>

        <label htmlFor="open-code" className="open-code-label">
          Codice tavolo
          {loadingCode && (
            <span className="open-code-generating">
              <span className="spinner-inline" aria-hidden="true" />
              genero un codice…
            </span>
          )}
        </label>
        <input
          id="open-code"
          className="code-input"
          ref={codeInputRef}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().slice(0, 12));
            if (openRejected) onDismissRejected();
          }}
          placeholder={loadingCode ? "…" : "K7Q2M"}
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={submitting}
          aria-describedby="open-code-hint"
        />
        <p id="open-code-hint" className="field-hint">
          {codeError
            ? "Non sono riuscito a proporre un codice: scrivine uno tu (lettere e numeri, senza I/L/O/0/1)."
            : "Dettabile a voce: niente lettere ambigue (I, L, O) né 0/1."}
        </p>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            disabled={submitting}
          />
          <span>
            <span className="checkbox-label">
              <LockIcon />
              Tavolo privato — non mostrarlo in lista
            </span>
            <span className="checkbox-hint">
              Il tavolo non comparirà nella lista pubblica: sarà raggiungibile solo da chi conosce il codice.
            </span>
          </span>
        </label>

        {/* CODE_IN_USE: nota informativa (ambra, non colpevolizzante), la modale
            resta aperta senza takeover. Non è un errore dell'utente. */}
        {openRejected && (
          <p role="alert" className="open-table-notice open-table-error">
            <span className="notice-icon" aria-hidden="true">!</span>
            <span>Questo codice è già occupato: scegline un altro o lascia quello proposto.</span>
          </p>
        )}
        {/* Errore reale (connessione/config): tono rosso, distinto dalla nota sopra. */}
        {errorMessage && !openRejected && hasAttempted && (
          <p role="alert" className="auth-error open-table-error">
            <span className="auth-error-icon" aria-hidden="true">!</span>
            <span>{errorMessage}</span>
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={submitting}>
            Annulla
          </button>
          <button type="button" className="btn-primary open-table-confirm" onClick={confirm} disabled={!canConfirm}>
            {submitting ? (
              <>
                <span className="cta-spinner" aria-hidden="true" />
                Apertura…
              </>
            ) : (
              <>
                <NewTableIcon />
                Apri il tavolo
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Icone inline (monocromatiche, currentColor; nessun asset esterno) ─────── */

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function NewTableIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
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
