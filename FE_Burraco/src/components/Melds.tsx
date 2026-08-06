"use client";

import type { Meld, Seat } from "@/lib/contract";
import { CardView } from "./CardView";

/**
 * Giochi calati sul tavolo, raggruppati per proprietario. Un gioco è
 * selezionabile come bersaglio di "amplia" / "sostituisci pinella".
 *
 * Distinzioni visive di dominio (dati dal server, non calcolati qui):
 *  - burraco PULITO vs SPORCO (Meld.isBurraco + Meld.clean): badge d'oro pieno
 *    vs brunito, con icona ✦/✧ e testo — leggibile anche senza colore.
 *  - carte che fungono da MATTA: evidenziate via Meld.wildIndices (campo del
 *    contratto confermato ma non ancora nella copia FE: letto in modo difensivo,
 *    nessuna evidenza se assente).
 */

/** Lettura difensiva di wildIndices finché il contratto FE non lo espone. */
function wildSet(m: Meld): Set<number> {
  const idx = (m as { wildIndices?: number[] }).wildIndices;
  return new Set(idx ?? []);
}

interface Props {
  melds: Meld[];
  yourSeat: Seat | null;
  selectedMeldId: string | null;
  onSelectMeld: (meldId: string) => void;
}

export function Melds({ melds, yourSeat, selectedMeldId, onSelectMeld }: Props) {
  const mine = melds.filter((m) => m.ownerSeat === yourSeat);
  const theirs = melds.filter((m) => m.ownerSeat !== yourSeat);

  const renderMeld = (m: Meld, ownMelds: boolean) => {
    const wilds = wildSet(m);
    return (
      <div
        key={m.id}
        className="meld"
        data-selected={selectedMeldId === m.id ? "true" : "false"}
        data-selectable={ownMelds ? "true" : "false"}
        onClick={ownMelds ? () => onSelectMeld(m.id) : undefined}
        role={ownMelds ? "button" : undefined}
        tabIndex={ownMelds ? 0 : undefined}
        onKeyDown={
          ownMelds
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectMeld(m.id);
                }
              }
            : undefined
        }
        aria-pressed={ownMelds ? selectedMeldId === m.id : undefined}
      >
        <div className="meld-head">
          <span className="tag">{m.type === "sequence" ? "scala" : "gruppo"}</span>
          <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            {m.cards.length} carte
          </span>
        </div>
        <div className="meld-cards">
          {m.cards.map((c, i) => (
            <CardView key={c.id} card={c} small wildRole={wilds.has(i)} />
          ))}
        </div>
        {m.isBurraco && (
          <div className="meld-tags">
            <span className="tag tag-burraco" data-clean={m.clean ? "true" : "false"}>
              {m.clean ? "✦ Burraco pulito" : "✧ Burraco sporco"}
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderGroup = (list: Meld[], label: string, ownMelds: boolean) => (
    <div className="meld-group">
      <h4>{label}</h4>
      {list.length === 0 ? (
        <p className="faint">Nessun gioco ancora sul tavolo.</p>
      ) : (
        <div className="meld-list">{list.map((m) => renderMeld(m, ownMelds))}</div>
      )}
    </div>
  );

  return (
    <div className="melds">
      {renderGroup(mine, "I tuoi giochi", true)}
      {renderGroup(theirs, "Giochi avversario", false)}
    </div>
  );
}
