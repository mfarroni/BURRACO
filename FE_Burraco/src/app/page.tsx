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
  ResetTableButton,
  RoomClosedOverlay,
} from "@/components/Overlays";
import {
  Celebration,
  ConnectionBanner,
  Countdown,
  OpponentStatus,
  TurnBanner,
} from "@/components/StateBanners";

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

  /* ── Celebrazioni effimere ──────────────────────────────────────────
   * Alimentate dagli eventi reali del server `pozzetto_taken` / `burraco_made`,
   * esposti dall'hook come `g.celebration` (già nella forma CelebrationInfo). */

  const toggleCard = (card: Card) => {
    setSelectedCards((prev) =>
      prev.includes(card.id) ? prev.filter((id) => id !== card.id) : [...prev, card.id],
    );
  };
  const toggleMeld = (meldId: string) => {
    setSelectedMeldId((prev) => (prev === meldId ? null : meldId));
  };

  /* ── Lobby / schermata d'ingresso ──────────────────────────────────── */
  if (!g.joined) {
    return (
      <div className="lobby">
        <div className="brand">
          <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
          <h1>Burraco</h1>
          <p className="tagline">Il tavolo del circolo, uno contro uno.</p>
        </div>
        <label htmlFor="room">Codice tavolo</label>
        <input
          id="room"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          placeholder="es. TAVOLO1"
          maxLength={12}
          autoComplete="off"
        />
        <label htmlFor="name">Il tuo nome</label>
        <input
          id="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="es. Marco"
          maxLength={40}
          autoComplete="off"
        />
        <button
          type="button"
          className="cta btn-primary"
          disabled={!roomCode.trim() || g.connPhase === "connecting" || g.connPhase === "reconnecting"}
          onClick={() => g.join(roomCode, displayName)}
        >
          {g.connPhase === "connecting" || g.connPhase === "reconnecting" ? "Connessione…" : "Siediti al tavolo"}
        </button>
        {(g.connPhase === "connecting" || g.connPhase === "reconnecting") && (
          <p className="muted" role="status" style={{ marginTop: "var(--sp-3)" }}>
            Apertura del tavolo in corso…
          </p>
        )}
        {g.errorMessage && (
          <p role="alert" style={{ color: "var(--danger-300)", marginTop: "var(--sp-3)" }}>
            {g.errorMessage}
          </p>
        )}
      </div>
    );
  }

  /* ── Tavolo chiuso (terminale, senza vincitore): reset o abbandono ──── */
  if (g.roomClosed) {
    return (
      <div className="game">
        <RoomClosedOverlay info={g.roomClosed} onLeave={() => window.location.reload()} />
      </div>
    );
  }

  /* ── In attesa dell'avversario (nessuno stato di gioco ancora) ─────── */
  if (!g.state) {
    return (
      <div className="lobby">
        <div className="brand">
          <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
          <h1>In attesa dell'avversario</h1>
          <p className="tagline">
            Codice tavolo: <strong>{roomCode.toUpperCase() || "—"}</strong>
          </p>
        </div>
        <p className="muted" style={{ textAlign: "center" }}>
          Condividi il codice con l'altro giocatore: la partita inizia appena si siede al tavolo.
        </p>
        <ConnectionBanner connPhase={g.connPhase} resumed={g.resumed} />
        {/* Reset consentito in attesa: nessun avversario da penalizzare. */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--sp-4)" }}>
          <ResetTableButton onReset={g.resetRoom} context="waiting" />
        </div>
      </div>
    );
  }

  /* ── Partita ───────────────────────────────────────────────────────── */
  const s = g.state;
  const you = g.yourSeat ?? 0;
  const oppSeat = (1 - you) as 0 | 1;
  const isMyTurn = s.whoseTurn === g.yourSeat;
  const opponent = g.players.find((p) => p.seat !== g.yourSeat);
  const opponentName = opponent?.displayName ?? "Avversario";
  const opponentConnected = opponent?.connectionStatus !== "disconnected";
  const phaseHint =
    s.phase === "must_draw" ? "Pesca dal mazzo o dallo scarto." : "Cala i tuoi giochi, poi scarta per concludere.";

  // Deadline del turno per il countdown VISIVO (v1: sempre null → nessun countdown).
  const turnEndsAt = s.turnEndsAt;

  return (
    <div className="game">
      <Celebration info={g.celebration} />
      <RejectionToast rejection={g.rejection} onDismiss={g.dismissRejection} />
      {/* Fallback globale quando il pending non è agganciato a una carta. */}
      {g.pending && !g.inFlightCardId && <PendingBadge pending />}
      <HandEndedOverlay info={g.handEnded} players={g.players} yourSeat={g.yourSeat} />
      <GameEndedOverlay info={g.gameEnded} players={g.players} yourSeat={g.yourSeat} config={g.config} />
      <RoomClosedOverlay info={g.roomClosed} onLeave={() => window.location.reload()} />

      {/* Avversario offline: rientro in corso entro la finestra di grazia; nel
          frattempo è possibile terminare il tavolo (annulla la partita). */}
      {!opponentConnected && (
        <div className="banner" data-tone="warn" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="banner-body">
            <span className="banner-title">{opponentName} ha perso la connessione</span>
            <span className="banner-sub">
              Rientro in corso: ha qualche minuto per riconnettersi e riprendere la partita. Puoi
              aspettarlo oppure terminare il tavolo.
            </span>
          </span>
          <ResetTableButton onReset={g.resetRoom} context="opponent-offline" />
        </div>
      )}

      {/* ── Header / Scoreboard ───────────────────────────────────────── */}
      <div className="topbar">
        <div className="status-line">
          <span className="badge" data-turn={isMyTurn ? "mine" : "theirs"}>
            <span className="dot" aria-hidden="true" />
            {isMyTurn ? "Tocca a te" : `Turno di ${opponentName}`}
          </span>
          {isMyTurn && turnEndsAt !== null && <Countdown turnEndsAt={turnEndsAt} />}
          <OpponentStatus name={opponentName} handCount={s.opponentHandCount} connected={opponentConnected} />
        </div>
        <div className="scoreboard">
          <div className="chip you">
            <span className="lbl">Tu</span>
            <span className="val">{s.scores[you]}</span>
          </div>
          <span className="vs" aria-hidden="true">/</span>
          <div className="chip">
            <span className="lbl">{opponentName}</span>
            <span className="val">{s.scores[oppSeat]}</span>
          </div>
          <div className="chip">
            <span className="lbl">Obiettivo</span>
            <span className="val">{g.config?.punteggioObiettivo ?? "—"}</span>
          </div>
        </div>
      </div>

      {/* Riconnessione propria + "stato ripristinato". */}
      <ConnectionBanner connPhase={g.connPhase} resumed={g.resumed} />

      {/* Turno + fase, in evidenza. */}
      <TurnBanner isMyTurn={isMyTurn} phaseHint={phaseHint} opponentName={opponentName} />

      {/* ── Tavolo centrale ───────────────────────────────────────────── */}
      <div className="tableau">
        <div className="pile" data-actionable={isMyTurn && s.phase === "must_draw" ? "true" : "false"}>
          <div className="slot deck" aria-hidden="true">♣</div>
          <div className="num">{s.drawPileCount}</div>
          <div className="lbl">Mazzo</div>
        </div>

        <div className="pile" data-actionable={isMyTurn && s.phase === "must_draw" && s.discardCount > 0 ? "true" : "false"}>
          <div className="slot" style={{ background: "transparent", padding: 0 }}>
            {s.discardTop ? (
              <CardView card={s.discardTop} small />
            ) : (
              <span className="slot empty">vuoto</span>
            )}
          </div>
          <div className="num">{s.discardCount}</div>
          <div className="lbl">Monte scarti</div>
        </div>

        <div className="pile">
          <div className="slot facedown" aria-hidden="true" />
          <div className="num">{s.opponentHandCount}</div>
          <div className="lbl">Mano avversario</div>
        </div>

        <div className="pile">
          <div className="pozzetti" aria-hidden="true">
            {[0, 1].map((i) => (
              <span key={i} className="pozzetto-mini" data-taken={i >= s.pozzettiRemaining ? "true" : "false"} />
            ))}
          </div>
          <div className="num">{s.pozzettiRemaining}</div>
          <div className="lbl">Pozzetti</div>
        </div>

        <div className="pile">
          <div className="num" style={{ fontSize: "1rem" }}>{s.yourPozzettoTaken ? "Preso ✓" : "Non ancora"}</div>
          <div className="lbl">Il tuo pozzetto</div>
        </div>
      </div>

      {/* ── Giochi calati ─────────────────────────────────────────────── */}
      <Melds
        melds={s.tableMelds}
        yourSeat={g.yourSeat}
        selectedMeldId={selectedMeldId}
        onSelectMeld={toggleMeld}
      />

      {/* ── La tua mano ───────────────────────────────────────────────── */}
      <div className="hand-zone">
        <h4>La tua mano · {s.yourHand.length} carte</h4>
        <div className="hand">
          {s.yourHand.length === 0 ? (
            <p className="faint">Mano vuota — sei andato a pozzetto!</p>
          ) : (
            s.yourHand.map((c) => (
              <CardView
                key={c.id}
                card={c}
                selected={selectedCards.includes(c.id)}
                pending={g.inFlightCardId === c.id}
                onClick={isMyTurn && !g.pending ? toggleCard : undefined}
              />
            ))
          )}
        </div>
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
