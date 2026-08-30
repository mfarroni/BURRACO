"use client";

import type { Meld, Seat } from "@/lib/contract";
import { CardView } from "./CardView";

/**
 * Giochi calati sul tavolo, raggruppati PER SQUADRA (owner → team). Un gioco è
 * selezionabile come bersaglio di "amplia" / "sostituisci pinella" solo se è
 * della TUA squadra.
 *
 * Predisposizione 2v2 (SOLO layout, nessuna regola): il raggruppamento non è più
 * per singolo posto (mine/theirs) ma per squadra tramite `teamOf`. In 1v1 la
 * squadra "us" = il tuo posto e "them" = l'avversario, quindi il comportamento
 * visivo attuale è preservato; passando a 4 postazioni basta fornire un `teamOf`
 * che mappi 4 posti su 2 squadre, senza riscrivere questo componente.
 *
 * Tre canali ridondanti di distinzione squadra (mai il solo colore):
 *  - COLORE: Noi = oro/ottone, Loro = acciaio/blu (via data-team nel CSS).
 *  - ETICHETTA + CREST: "Noi ◆" / "Loro ●".
 *  - POSIZIONE: i nostri giochi a Sud, i loro a Nord (assegnata dal contenitore).
 *
 * Distinzioni di dominio (dal server, non calcolate qui): burraco pulito/sporco
 * (Meld.isBurraco + Meld.clean) e carte-matta (Meld.wildIndices).
 */

type Team = "us" | "them";

interface Props {
  melds: Meld[];
  yourSeat: Seat | null;
  selectedMeldId: string | null;
  onSelectMeld: (meldId: string) => void;
  /** Squadra di appartenenza di un posto. Default 1v1: il tuo posto = "us". */
  teamOf?: (seat: Seat) => Team;
  /** Se attivo, il tuo turno: accende la targa "I nostri giochi". */
  isMyTurn?: boolean;
}

export function Melds({ melds, yourSeat, selectedMeldId, onSelectMeld, teamOf, isMyTurn }: Props) {
  const resolveTeam: (seat: Seat) => Team =
    teamOf ?? ((seat) => (seat === yourSeat ? "us" : "them"));

  const ours = melds.filter((m) => resolveTeam(m.ownerSeat) === "us");
  const theirs = melds.filter((m) => resolveTeam(m.ownerSeat) === "them");

  const renderMeld = (m: Meld, ownTeam: boolean) => {
    const wilds = new Set(m.wildIndices ?? []);
    return (
      <div
        key={m.id}
        className="meld"
        data-selected={selectedMeldId === m.id ? "true" : "false"}
        data-selectable={ownTeam ? "true" : "false"}
        onClick={ownTeam ? () => onSelectMeld(m.id) : undefined}
        role={ownTeam ? "button" : undefined}
        tabIndex={ownTeam ? 0 : undefined}
        onKeyDown={
          ownTeam
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectMeld(m.id);
                }
              }
            : undefined
        }
        aria-pressed={ownTeam ? selectedMeldId === m.id : undefined}
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

  const renderGroup = (list: Meld[], team: Team, label: string, crest: string) => {
    const ownTeam = team === "us";
    return (
      <div className="meld-group" data-team={team} data-active={ownTeam && isMyTurn ? "true" : "false"}>
        <h4 className="meld-group-head">
          <span className="crest" aria-hidden="true">{crest}</span>
          <span className="meld-group-label">{label}</span>
          <span className="team-tag">{ownTeam ? "Noi" : "Loro"}</span>
        </h4>
        {list.length === 0 ? (
          <p className="faint">Nessun gioco ancora sul tavolo.</p>
        ) : (
          <div className="meld-list">{list.map((m) => renderMeld(m, ownTeam))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="melds">
      {renderGroup(theirs, "them", "I loro giochi", "●")}
      {renderGroup(ours, "us", "I nostri giochi", "◆")}
    </div>
  );
}
