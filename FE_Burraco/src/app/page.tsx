"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/lib/contract";
import { useGameSocket } from "@/lib/useGameSocket";
import { CardView } from "@/components/CardView";
import { Melds } from "@/components/Melds";
import { ActionBar } from "@/components/ActionBar";
import {
  GameEndedOverlay,
  HandEndedOverlay,
  PendingBadge,
  RejectionToast,
} from "@/components/Overlays";

export default function Page() {
  const g = useGameSocket();

  // Form della lobby.
  const [roomCode, setRoomCode] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Stato di SELEZIONE locale (nessuna regola: solo UI).
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null);

  // Ogni nuovo stato dal server azzera la selezione (le carte potrebbero non
  // essere più in mano). Su una mossa rifiutata NON arriva stato -> la
  // selezione resta, così l'utente può correggere.
  useEffect(() => {
    setSelectedCards([]);
    setSelectedMeldId(null);
  }, [g.state]);

  const toggleCard = (card: Card) => {
    setSelectedCards((prev) =>
      prev.includes(card.id) ? prev.filter((id) => id !== card.id) : [...prev, card.id],
    );
  };
  const toggleMeld = (meldId: string) => {
    setSelectedMeldId((prev) => (prev === meldId ? null : meldId));
  };

  /* ── Lobby ───────────────────────────────────────────────────────── */
  if (!g.joined) {
    return (
      <div className="lobby">
        <h1>Burraco 1v1</h1>
        <p className="muted">Crea o entra in una partita inserendo lo stesso codice room.</p>
        <label htmlFor="room">Codice room</label>
        <input
          id="room"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          placeholder="es. TAVOLO1"
          maxLength={12}
        />
        <label htmlFor="name">Il tuo nome</label>
        <input
          id="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="es. Marco"
          maxLength={40}
        />
        <button
          type="button"
          disabled={!roomCode.trim()}
          onClick={() => g.join(roomCode, displayName)}
        >
          Entra
        </button>
        {g.connPhase === "reconnecting" && <p className="muted">Connessione in corso…</p>}
        {g.errorMessage && <p style={{ color: "var(--danger)" }}>{g.errorMessage}</p>}
      </div>
    );
  }

  /* ── In attesa dell'avversario ───────────────────────────────────── */
  if (!g.state) {
    return (
      <div className="lobby">
        <h1>In attesa dell'avversario…</h1>
        <p>
          Codice room: <strong>{roomCode.toUpperCase()}</strong>
        </p>
        <p className="muted">Condividilo con l'altro giocatore per iniziare.</p>
        {g.connPhase === "reconnecting" && <p className="badge" data-conn="reconnecting">Riconnessione…</p>}
      </div>
    );
  }

  /* ── Partita ─────────────────────────────────────────────────────── */
  const s = g.state;
  const isMyTurn = s.whoseTurn === g.yourSeat;
  const opponent = g.players.find((p) => p.seat !== g.yourSeat);
  const phaseLabel = s.phase === "must_draw" ? "Devi pescare" : "Cala o scarta";

  return (
    <div className="game">
      <RejectionToast rejection={g.rejection} onDismiss={g.dismissRejection} />
      <PendingBadge pending={g.pending} />
      <HandEndedOverlay info={g.handEnded} players={g.players} yourSeat={g.yourSeat} />
      <GameEndedOverlay info={g.gameEnded} players={g.players} yourSeat={g.yourSeat} config={g.config} />

      <div className="topbar">
        <div className="status-line">
          <span className="badge" data-turn={isMyTurn ? "true" : "false"}>
            {isMyTurn ? `Tocca a te — ${phaseLabel}` : "Turno avversario"}
          </span>
          <span className="badge">
            Avversario: {opponent?.displayName ?? "—"}
          </span>
          <span className="badge" data-conn={opponent?.connectionStatus === "disconnected" ? "disconnected" : undefined}>
            {opponent?.connectionStatus === "disconnected" ? "Avversario disconnesso" : "Avversario connesso"}
          </span>
          {g.connPhase === "reconnecting" && (
            <span className="badge" data-conn="reconnecting">Riconnessione in corso…</span>
          )}
        </div>
        <div className="status-line">
          <span className="badge">Punti — Tu: {s.scores[g.yourSeat ?? 0]}</span>
          <span className="badge">
            Avversario: {s.scores[(1 - (g.yourSeat ?? 0)) as 0 | 1]}
          </span>
          <span className="badge">Obiettivo: {g.config?.punteggioObiettivo}</span>
        </div>
      </div>

      <div className="counts">
        <div className="count-box">
          <div className="num">{s.drawPileCount}</div>
          <div className="lbl">Mazzo</div>
        </div>
        <div className="count-box">
          <div className="num">{s.discardTop ? "" : "—"}</div>
          <div className="lbl">Scarto ({s.discardCount})</div>
          {s.discardTop && (
            <div style={{ marginTop: 4 }}>
              <CardView card={s.discardTop} small />
            </div>
          )}
        </div>
        <div className="count-box">
          <div className="num">{s.opponentHandCount}</div>
          <div className="lbl">Mano avversario</div>
        </div>
        <div className="count-box">
          <div className="num">{s.pozzettiRemaining}</div>
          <div className="lbl">Pozzetti rimasti</div>
        </div>
        <div className="count-box">
          <div className="num">{s.yourPozzettoTaken ? "sì" : "no"}</div>
          <div className="lbl">Pozzetto preso</div>
        </div>
      </div>

      <Melds
        melds={s.tableMelds}
        yourSeat={g.yourSeat}
        selectedMeldId={selectedMeldId}
        onSelectMeld={toggleMeld}
      />

      <h4>La tua mano ({s.yourHand.length})</h4>
      <div className="hand">
        {s.yourHand.map((c) => (
          <CardView
            key={c.id}
            card={c}
            selected={selectedCards.includes(c.id)}
            onClick={toggleCard}
          />
        ))}
      </div>

      <ActionBar
        state={s}
        yourSeat={g.yourSeat}
        pending={g.pending}
        selectedCards={selectedCards}
        selectedMeldId={selectedMeldId}
        onDrawDeck={g.drawDeck}
        onDrawDiscard={g.drawDiscard}
        onMeldNew={() => g.meldNew(selectedCards)}
        onMeldExtend={() => selectedMeldId && g.meldExtend(selectedMeldId, selectedCards)}
        onPinellaSubstitute={() =>
          selectedMeldId && selectedCards[0] && g.pinellaSubstitute(selectedMeldId, selectedCards[0])
        }
        onDiscard={() => selectedCards[0] && g.discard(selectedCards[0])}
      />
    </div>
  );
}
