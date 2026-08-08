"use client";

import type { GameStatePublic, Seat } from "@/lib/contract";

/**
 * Barra delle azioni. L'UNICA logica ammessa qui è la banale abilitazione dei
 * pulsanti in base a turno/fase (NON è validazione di regole: quella è del
 * server). Ogni azione invia un'intenzione e attiva lo stato "attendo conferma".
 *
 * Gerarchia visiva: l'azione più probabile del momento è in ORO (.btn-primary)
 * — pescare in must_draw, scartare in may_meld — per guidare l'occhio.
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
  onUndo: () => void;
}

export function ActionBar(p: Props) {
  const isMyTurn = p.state.whoseTurn === p.yourSeat;
  const mustDraw = p.state.phase === "must_draw";
  const mayMeld = p.state.phase === "may_meld";
  const locked = !isMyTurn || p.pending || p.state.status !== "playing";
  const nSel = p.selectedCards.length;

  const hint = !isMyTurn
    ? "In attesa dell'avversario"
    : p.pending
      ? "Attendo la conferma del server…"
      : mustDraw
        ? "Pesca per iniziare il turno"
        : "Cala i tuoi giochi, poi scarta per concludere";

  return (
    <div className="action-bar" data-my-turn={isMyTurn ? "true" : "false"}>
      <button
        type="button"
        className={mustDraw ? "btn-primary" : ""}
        disabled={locked || !mustDraw}
        onClick={p.onDrawDeck}
      >
        Pesca dal mazzo
      </button>
      <button
        type="button"
        disabled={locked || !mustDraw || p.state.discardCount === 0}
        onClick={p.onDrawDiscard}
      >
        Pesca dallo scarto ({p.state.discardCount})
      </button>

      <span className="sep" aria-hidden="true" />

      <button type="button" disabled={locked || !mayMeld || nSel < 3} onClick={p.onMeldNew}>
        Cala gioco
      </button>
      {/* Abilitazione BANALE (non è validazione di regole): il server è l'unico
          a decidere. `canUndo` è un flag PRESENTAZIONALE del server (true solo
          con almeno una calata annullabile). Stile PLACEHOLDER: rifinitura in
          co-design con ui_ux. */}
      <button
        type="button"
        disabled={locked || !mayMeld || !p.state.canUndo}
        onClick={p.onUndo}
      >
        Annulla ultima mossa
      </button>
      <button
        type="button"
        disabled={locked || !mayMeld || !p.selectedMeldId || nSel < 1}
        onClick={p.onMeldExtend}
      >
        Amplia
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
        className={mayMeld ? "btn-discard" : ""}
        disabled={locked || !mayMeld || nSel !== 1}
        onClick={p.onDiscard}
      >
        Scarta
      </button>

      <span className="hint" aria-live="polite">
        {hint}
      </span>
    </div>
  );
}
