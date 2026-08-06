"use client";

import type { GameConfig, HandScoreDetail, PlayerPublic, Seat } from "@/lib/contract";
import type { GameEndedInfo, HandEndedInfo, RejectionInfo } from "@/lib/useGameSocket";
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
