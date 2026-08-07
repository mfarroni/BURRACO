"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { GameConfig, HandScoreDetail, PlayerPublic, Seat } from "@/lib/contract";
import type { GameEndedInfo, HandEndedInfo, RejectionInfo, RoomClosedInfo } from "@/lib/useGameSocket";
import { REJECT_TITLE, rejectText } from "@/lib/rejectMessages";

/**
 * Overlay e feedback degli stati di gioco, in stile "Circolo Notturno".
 * Il testo dei rifiuti viene dalla mappa `rejectMessages` (proprietà FE): il
 * `reason` grezzo del server NON è mai mostrato.
 */

export function RejectionToast({
  rejection,
  onDismiss,
}: {
  rejection: RejectionInfo | null;
  onDismiss: () => void;
}) {
  if (!rejection) return null;
  return (
    <div className="toast" role="alert">
      <span className="toast-icon" aria-hidden="true">⚠</span>
      <span className="toast-body">
        <strong>{REJECT_TITLE}.</strong> {rejectText(rejection.code)}
      </span>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Chiudi avviso">
        ×
      </button>
    </div>
  );
}

export function PendingBadge({ pending }: { pending: boolean }) {
  if (!pending) return null;
  return (
    <div className="pending-badge" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      Mossa in volo, attendo conferma…
    </div>
  );
}

function seatName(seat: Seat | null, players: PlayerPublic[], yourSeat: Seat | null): string {
  if (seat === null) return "—";
  if (seat === yourSeat) return "Tu";
  const p = players.find((pl) => pl.seat === seat);
  return p?.displayName ?? `Giocatore ${seat + 1}`;
}

function deltaClass(v: number): string {
  return v > 0 ? "delta-pos" : v < 0 ? "delta-neg" : "";
}

export function HandEndedOverlay({
  info,
  players,
  yourSeat,
}: {
  info: HandEndedInfo | null;
  players: PlayerPublic[];
  yourSeat: Seat | null;
}) {
  if (!info) return null;
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>Fine smazzata</h2>
        <p className="verdict">
          Chiusura di{" "}
          <strong>
            {info.closerSeat === null ? "nessuno — mazzo esaurito" : seatName(info.closerSeat, players, yourSeat)}
          </strong>
        </p>
        <table className="score-table">
          <thead>
            <tr>
              <th>Giocatore</th>
              <th>Giochi</th>
              <th>Bonus</th>
              <th>Mano</th>
              <th>Pozzetto</th>
              <th>Δ smazzata</th>
            </tr>
          </thead>
          <tbody>
            {info.scores.map((s: HandScoreDetail) => (
              <tr key={s.seat}>
                <td>{seatName(s.seat, players, yourSeat)}</td>
                <td className="num">{s.ptsMelds}</td>
                <td className="num">{s.ptsBonus}</td>
                <td className={`num ${deltaClass(s.ptsPenaltyHand)}`}>{s.ptsPenaltyHand}</td>
                <td className={`num ${deltaClass(s.ptsPozzetto)}`}>{s.ptsPozzetto}</td>
                <td className={`num ${deltaClass(s.totalDelta)}`}>
                  <strong>{s.totalDelta > 0 ? `+${s.totalDelta}` : s.totalDelta}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cumulative">
          Totale partita — {seatName(0, players, yourSeat)}: <strong className="num">{info.cumulative[0]}</strong> ·{" "}
          {seatName(1, players, yourSeat)}: <strong className="num">{info.cumulative[1]}</strong>
        </p>
        <p className="muted" style={{ textAlign: "center" }}>
          La prossima smazzata inizia automaticamente…
        </p>
      </div>
    </div>
  );
}

/**
 * Esito TERMINALE del tavolo SENZA vincitore, distinto dal game_ended (che ha un
 * vincitore). Due varianti chiaramente riconoscibili e MAI colpevolizzanti:
 *  - interrupted → il tavolo è stato chiuso su richiesta (accento neutro/blu);
 *  - abandoned   → l'avversario non è rientrato entro la grazia (accento ambra).
 * Overlay terminale: gestisce il focus (porta il focus sull'azione di uscita) e
 * ha ruolo di dialog per gli screen reader. `onLeave` riporta alla lobby.
 */
export function RoomClosedOverlay({
  info,
  onLeave,
}: {
  info: RoomClosedInfo | null;
  onLeave: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (info) btnRef.current?.focus();
  }, [info]);

  if (!info) return null;
  const isInterrupted = info.reason === "interrupted";
  return (
    <div className="overlay">
      <div
        className="overlay-card outcome"
        data-outcome={isInterrupted ? "interrupted" : "abandoned"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="outcome-icon" aria-hidden="true">{isInterrupted ? "⊘" : "⌛"}</div>
        <p className="overlay-eyebrow">{isInterrupted ? "Tavolo chiuso" : "Partita interrotta"}</p>
        <h2 id={titleId}>{isInterrupted ? "Partita terminata" : "L'avversario ha abbandonato"}</h2>
        <p className="verdict">
          {isInterrupted
            ? "Il tavolo è stato chiuso su richiesta. La partita non prosegue e non c'è un vincitore."
            : "L'avversario non è rientrato in tempo, quindi la partita è stata annullata. Nessun vincitore e nessuna penalità per te."}
        </p>
        <p className="muted" style={{ textAlign: "center" }}>
          Puoi aprire un nuovo tavolo o unirti a un altro dalla lobby.
        </p>
        <div className="dialog-actions single">
          <button type="button" className="cta btn-primary" onClick={onLeave} ref={btnRef}>
            Torna alla lobby
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Dialog di CONFERMA per un'azione distruttiva. Puramente presentazionale: lo
 * stato "aperto" vive nel chiamante, qui non c'è alcuna regola di gioco. Accessibile:
 * role="alertdialog", focus iniziale sull'azione SICURA, trap del Tab, Esc = annulla,
 * click sullo sfondo = annulla, ripristino del focus alla chiusura.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const nodes = cardRef.current?.querySelectorAll<HTMLElement>("button");
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
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

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="overlay-card confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        ref={cardRef}
      >
        <h2 id={titleId} className="confirm-title">{title}</h2>
        <p id={bodyId} className="confirm-body">{body}</p>
        <div className="dialog-actions">
          <button type="button" className="btn-ghost" onClick={onCancel} ref={cancelRef}>
            {cancelLabel}
          </button>
          <button type="button" className="btn-danger solid" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Copy del pulsante distruttivo e del suo dialog, differenziato per contesto:
 *  - "waiting": tavolo ancora in attesa, nessuna partita avviata → si ANNULLA;
 *  - "opponent-offline": partita avviata, avversario fuori linea → si TERMINA.
 * Tono chiaro e non colpevolizzante; il click finale invia sempre lo stesso
 * `reset_room` tramite `onReset` (contratto invariato).
 */
const RESET_COPY = {
  waiting: {
    button: "Annulla tavolo",
    buttonAria: "Annulla il tavolo e torna alla lobby",
    title: "Annullare il tavolo?",
    body: "Chiuderai questo tavolo e tornerai alla lobby. Se hai già condiviso il codice, l'altro giocatore non potrà più entrare.",
    confirm: "Sì, annulla il tavolo",
    cancel: "No, continua ad aspettare",
  },
  "opponent-offline": {
    button: "Termina tavolo",
    buttonAria: "Termina la partita e torna alla lobby",
    title: "Terminare la partita?",
    body: "La partita verrà chiusa senza vincitore e non potrà essere ripresa. Se preferisci, puoi ancora attendere il rientro dell'avversario.",
    confirm: "Sì, termina la partita",
    cancel: "No, aspetta ancora",
  },
} as const;

/**
 * Pulsante "termina/annulla tavolo" — azione DISTRUTTIVA. Aspetto secondario
 * (ghost rosso) per non competere con le azioni di gioco primarie in oro.
 * Il click apre un dialog di conferma; solo la conferma chiama `onReset`
 * (che invia `reset_room`). Lo stato "confirming" è UI locale, nessuna regola.
 */
export function ResetTableButton({
  onReset,
  context = "waiting",
}: {
  onReset: () => void;
  context?: "waiting" | "opponent-offline";
}) {
  const [confirming, setConfirming] = useState(false);
  const copy = RESET_COPY[context];
  return (
    <>
      <button
        type="button"
        className="btn-danger reset-table"
        onClick={() => setConfirming(true)}
        aria-haspopup="dialog"
        aria-label={copy.buttonAria}
      >
        <span className="btn-danger-icon" aria-hidden="true">⊘</span>
        {copy.button}
      </button>
      {confirming && (
        <ConfirmDialog
          title={copy.title}
          body={copy.body}
          confirmLabel={copy.confirm}
          cancelLabel={copy.cancel}
          onConfirm={() => {
            setConfirming(false);
            onReset();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

export function GameEndedOverlay({
  info,
  players,
  yourSeat,
  config,
}: {
  info: GameEndedInfo | null;
  players: PlayerPublic[];
  yourSeat: Seat | null;
  config: GameConfig | null;
}) {
  if (!info) return null;
  const won = info.winnerSeat === yourSeat;
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>{won ? "Hai vinto la partita" : "Partita conclusa"}</h2>
        <p className="verdict">
          {won ? "♛ " : ""}
          Vincitore: <strong>{seatName(info.winnerSeat, players, yourSeat)}</strong>
        </p>
        <p className="cumulative">
          Punteggio finale (obiettivo {config?.punteggioObiettivo ?? "—"}) — {seatName(0, players, yourSeat)}:{" "}
          <strong className="num">{info.finalScores[0]}</strong> · {seatName(1, players, yourSeat)}:{" "}
          <strong className="num">{info.finalScores[1]}</strong>
        </p>
      </div>
    </div>
  );
}
