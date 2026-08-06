"use client";

import type { Meld, Seat } from "@/lib/contract";
import { CardView } from "./CardView";

/**
 * Giochi calati sul tavolo, raggruppati per proprietario. Un gioco è
 * selezionabile come bersaglio di "amplia" / "sostituisci pinella".
 */
interface Props {
  melds: Meld[];
  yourSeat: Seat | null;
  selectedMeldId: string | null;
  onSelectMeld: (meldId: string) => void;
}

export function Melds({ melds, yourSeat, selectedMeldId, onSelectMeld }: Props) {
  const mine = melds.filter((m) => m.ownerSeat === yourSeat);
  const theirs = melds.filter((m) => m.ownerSeat !== yourSeat);

  const renderGroup = (list: Meld[], label: string, ownMelds: boolean) => (
    <div className="meld-group">
      <h4>{label}</h4>
      {list.length === 0 && <p className="muted">Nessun gioco.</p>}
      <div className="meld-list">
        {list.map((m) => (
          <div
            key={m.id}
            className="meld"
            data-selected={selectedMeldId === m.id ? "true" : "false"}
            data-selectable={ownMelds ? "true" : "false"}
            onClick={ownMelds ? () => onSelectMeld(m.id) : undefined}
          >
            <div className="meld-cards">
              {m.cards.map((c) => (
                <CardView key={c.id} card={c} small />
              ))}
            </div>
            <div className="meld-tags">
              <span className="tag">{m.type === "sequence" ? "scala" : "gruppo"}</span>
              {m.isBurraco && (
                <span className="tag tag-burraco">{m.clean ? "burraco pulito" : "burraco sporco"}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="melds">
      {renderGroup(mine, "I tuoi giochi", true)}
      {renderGroup(theirs, "Giochi avversario", false)}
    </div>
  );
}
