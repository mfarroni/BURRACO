"use client";

import type { GameStatePublic, Seat } from "@/lib/contract";

/**
 * Barra delle azioni. L'UNICA logica ammessa qui è banale abilitazione dei
 * pulsanti in base a turno/fase (NON è validazione di regole: quella è del
 * server). Ogni azione invia un'intenzione e attiva lo stato "attendo conferma".
 */
interface Props {
  state: GameStatePublic;
  yourSeat: Seat | null;
  pending: boolean;
  selectedCards: string[];
  selectedMeldId: string | null;
  onDrawDeck: () => void;
  onDrawDiscard: () => void;
  onMeldNew: () => void;
  onMeldExtend: () => void;
  onPinellaSubstitute: () => void;
  onDiscard: () => void;
}

export function ActionBar(p: Props) {
  const isMyTurn = p.state.whoseTurn === p.yourSeat;
  const mustDraw = p.state.phase === "must_draw";
  const mayMeld = p.state.phase === "may_meld";
  const locked = !isMyTurn || p.pending || p.state.status !== "playing";
  const nSel = p.selectedCards.length;

  return (
    <div className="action-bar" data-my-turn={isMyTurn ? "true" : "false"}>
      <button type="button" disabled={locked || !mustDraw} onClick={p.onDrawDeck}>
        Pesca dal mazzo
      </button>
      <button
        type="button"
        disabled={locked || !mustDraw || p.state.discardCount === 0}
        onClick={p.onDrawDiscard}
      >
        Pesca dallo scarto ({p.state.discardCount})
      </button>

      <span className="sep" />

      <button type="button" disabled={locked || !mayMeld || nSel < 3} onClick={p.onMeldNew}>
        Cala nuovo gioco
      </button>
      <button
        type="button"
        disabled={locked || !mayMeld || !p.selectedMeldId || nSel < 1}
        onClick={p.onMeldExtend}
      >
        Amplia gioco
      </button>
      <button
        type="button"
        disabled={locked || !mayMeld || !p.selectedMeldId || nSel !== 1}
        onClick={p.onPinellaSubstitute}
      >
        Sostituisci pinella
      </button>
      <button
        type="button"
        className="btn-discard"
        disabled={locked || !mayMeld || nSel !== 1}
        onClick={p.onDiscard}
      >
        Scarta
      </button>
    </div>
  );
}
