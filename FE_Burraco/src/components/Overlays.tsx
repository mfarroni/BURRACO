"use client";

import type { GameConfig, HandScoreDetail, PlayerPublic, Seat } from "@/lib/contract";
import type { GameEndedInfo, HandEndedInfo, RejectionInfo } from "@/lib/useGameSocket";

/**
 * Overlay e banner degli stati di gioco. Sono volutamente essenziali: gli stati
 * visivi definitivi (turno, attesa, riconnessione, timeout, fine mano/partita)
 * sono un PUNTO DI CO-DESIGN con agente_ui_ux.
 */

/** Testi UX associati ai codici di rifiuto (mappatura lato client, non regole). */
const REJECT_TEXT: Record<string, string> = {
  NOT_YOUR_TURN: "Non è il tuo turno.",
  WRONG_PHASE: "Azione non consentita in questa fase.",
  CARD_NOT_IN_HAND: "Carta non presente in mano.",
  EMPTY_DISCARD: "Il monte scarti è vuoto.",
  INVALID_MELD: "Le carte non formano un gioco valido.",
  MELD_NOT_FOUND: "Gioco inesistente.",
  NOT_MELD_OWNER: "Puoi agire solo sui tuoi giochi.",
  MELD_LIMIT_REACHED: "Hai raggiunto il limite di calate prima del pozzetto.",
  MUST_KEEP_CARD_TO_DISCARD: "Devi tenere una carta per lo scarto finale.",
  CANNOT_CLOSE_NO_BURRACO: "Non puoi chiudere senza un burraco.",
  ILLEGAL_LAST_DISCARD: "L'ultima carta non può essere una matta.",
  NO_PINELLA_TO_SUBSTITUTE: "Nessuna pinella da sostituire con quella carta.",
  GAME_NOT_ACTIVE: "La partita non è attiva.",
  MALFORMED: "Messaggio non valido.",
};

export function RejectionToast({ rejection, onDismiss }: { rejection: RejectionInfo | null; onDismiss: () => void }) {
  if (!rejection) return null;
  return (
    <div className="toast toast-error" role="alert">
      <strong>Mossa rifiutata:</strong> {REJECT_TEXT[rejection.code] ?? rejection.reason}
      <button type="button" className="toast-close" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

export function PendingBadge({ pending }: { pending: boolean }) {
  if (!pending) return null;
  return (
    <div className="pending-badge" aria-live="polite">
      Attendo conferma dal server…
    </div>
  );
}

function seatName(seat: Seat | null, players: PlayerPublic[], yourSeat: Seat | null): string {
  if (seat === null) return "—";
  if (seat === yourSeat) return "Tu";
  const p = players.find((pl) => pl.seat === seat);
  return p?.displayName ?? `Giocatore ${seat + 1}`;
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
        <p>
          Chiusura:{" "}
          <strong>{info.closerSeat === null ? "nessuno (mazzo esaurito)" : seatName(info.closerSeat, players, yourSeat)}</strong>
        </p>
        <table className="score-table">
          <thead>
            <tr>
              <th>Giocatore</th>
              <th>Giochi</th>
              <th>Bonus</th>
              <th>Mano</th>
              <th>Pozzetto</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {info.scores.map((s: HandScoreDetail) => (
              <tr key={s.seat}>
                <td>{seatName(s.seat, players, yourSeat)}</td>
                <td>{s.ptsMelds}</td>
                <td>{s.ptsBonus}</td>
                <td>{s.ptsPenaltyHand}</td>
                <td>{s.ptsPozzetto}</td>
                <td>
                  <strong>{s.totalDelta}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cumulative">
          Totale: {seatName(0, players, yourSeat)} <strong>{info.cumulative[0]}</strong> —{" "}
          {seatName(1, players, yourSeat)} <strong>{info.cumulative[1]}</strong>
        </p>
        <p className="muted">La prossima smazzata inizia automaticamente…</p>
      </div>
    </div>
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
        <h2>{won ? "Hai vinto! 🎉" : "Partita conclusa"}</h2>
        <p>
          Vincitore: <strong>{seatName(info.winnerSeat, players, yourSeat)}</strong>
        </p>
        <p>
          Punteggio finale (obiettivo {config?.punteggioObiettivo ?? "—"}):{" "}
          {seatName(0, players, yourSeat)} <strong>{info.finalScores[0]}</strong> —{" "}
          {seatName(1, players, yourSeat)} <strong>{info.finalScores[1]}</strong>
        </p>
      </div>
    </div>
  );
}
