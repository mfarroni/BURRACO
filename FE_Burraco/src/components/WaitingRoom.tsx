"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnPhase, MergedInfo } from "@/lib/useGameSocket";
import { ConnectionBanner } from "@/components/StateBanners";

/**
 * SCHERMATA TAVOLO IN ATTESA (`waiting`, §6.4). Codice in grande evidenza con
 * "copia", messaggio d'attesa + contatore del tempo, nota per i tavoli privati e
 * gestione della fusione (`room_merged`). Il pulsante "Annulla e torna alla
 * lobby" invia `reset_room` (via `onCancel`) e riporta alla lista.
 *
 * Nessuna regola qui: l'avvio della partita arriva dal server (state) e sostituisce
 * questa schermata; qui si copre solo la latenza dell'attesa con stati visivi chiari.
 */

interface WaitingRoomProps {
  code: string;
  isPrivate: boolean;
  connPhase: ConnPhase;
  resumed: boolean;
  merged: MergedInfo | null;
  onCancel: () => void;
}

type CopyState = "idle" | "copied" | "error";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function WaitingRoom({ code, isPrivate, connPhase, resumed, merged, onCancel }: WaitingRoomProps) {
  // Inizio attesa: al primo montaggio della schermata (persiste tra i re-render).
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      // Copia automatica non disponibile (permessi/clipboard assente): lo diciamo
      // e invitiamo alla selezione manuale, senza lasciare l'utente senza feedback.
      setCopyState("error");
    }
  };
  useEffect(() => {
    if (copyState === "idle") return;
    const t = setTimeout(() => setCopyState("idle"), copyState === "copied" ? 2000 : 4000);
    return () => clearTimeout(t);
  }, [copyState]);

  // Etichetta dettata per screen reader (una lettera/cifra alla volta).
  const spelled = code ? code.split("").join(" ") : "";

  return (
    <div className="lobby waiting-room">
      <div className="brand">
        <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <h1>
          In attesa di un avversario
          <span className="waiting-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </h1>
        <p className="tagline">La partita inizia appena qualcuno si siede al tavolo.</p>
      </div>

      {/* Fusione (§5.4-A): spostati in un tavolo già in attesa; la partita parte. */}
      {merged && (
        <div className="banner" data-tone="success" role="status" aria-live="polite">
          <span className="banner-icon" aria-hidden="true">✓</span>
          <span className="banner-body">
            <span className="banner-title">Ti abbiamo unito a un tavolo già in attesa</span>
            <span className="banner-sub">La partita sta per iniziare: il codice è stato aggiornato qui sotto.</span>
          </span>
        </div>
      )}

      {/* Codice in grande evidenza (tessere dettabili) + copia. */}
      <div className="waiting-code" role="group" aria-label="Codice del tavolo">
        <span className="waiting-code-label">Codice tavolo</span>
        <div className="waiting-code-value">
          <span className="waiting-code-text" aria-label={code ? `Codice: ${spelled}` : "Codice non disponibile"} aria-live="polite">
            {code
              ? code.split("").map((ch, i) => (
                  <span key={i} className="code-char" aria-hidden="true">
                    {ch}
                  </span>
                ))
              : "—"}
          </span>
          <button
            type="button"
            className="btn-ghost waiting-copy"
            onClick={copy}
            aria-label={`Copia il codice tavolo ${code}`}
            disabled={!code}
          >
            {copyState === "copied" ? (
              <>
                <CheckIcon /> Copiato
              </>
            ) : copyState === "error" ? (
              "Copia a mano"
            ) : (
              <>
                <CopyIcon /> Copia
              </>
            )}
          </button>
        </div>
        {copyState === "error" && (
          <span className="waiting-copy-error">Copia automatica non disponibile: seleziona il codice e copialo a mano.</span>
        )}
        <span className="sr-only" role="status">
          {copyState === "copied"
            ? "Codice copiato negli appunti"
            : copyState === "error"
              ? "Copia automatica non disponibile: seleziona il codice e copialo a mano"
              : ""}
        </span>
      </div>

      {/* Contatore del tempo d'attesa. */}
      <p className="waiting-elapsed" role="status" aria-live="off">
        <span className="spinner-inline" aria-hidden="true" />
        In attesa da <strong className="num">{formatElapsed(now - startedAt.current)}</strong>
      </p>

      {/* Nota per i tavoli privati: non compaiono in lista, va comunicato il codice.
          Per i pubblici, un promemoria che sono già visibili nella lista. */}
      {isPrivate ? (
        <div className="banner" data-tone="info" role="note">
          <span className="banner-icon" aria-hidden="true">
            <LockIcon />
          </span>
          <span className="banner-body">
            <span className="banner-title">Questo tavolo è privato</span>
            <span className="banner-sub">
              Non compare nella lista pubblica: comunica tu il codice a chi vuoi far sedere.
            </span>
          </span>
        </div>
      ) : (
        <p className="waiting-hint">
          Il tuo tavolo è nella lista: qualcuno può sedersi da un momento all&apos;altro. Puoi anche dettare il
          codice per invitare una persona.
        </p>
      )}

      {/* Riconnessione propria (connecting/reconnecting) riusando il banner esistente. */}
      <ConnectionBanner connPhase={connPhase} resumed={resumed} />

      <div className="waiting-actions">
        <button type="button" className="btn-danger reset-table" onClick={onCancel}>
          <span className="btn-danger-icon" aria-hidden="true">⊘</span>
          Annulla e torna alla lobby
        </button>
      </div>
    </div>
  );
}

/* ── Icone inline (monocromatiche, currentColor; nessun asset esterno) ─────── */

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
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

function CopyIcon() {
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
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 12.5 9 17.5 20 6.5" />
    </svg>
  );
}
