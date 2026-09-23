"use client";

import type { Card, Suit } from "@/lib/contract";
import { jollyColor } from "@/lib/jollyColor";
import "./CardFace.css";

/**
 * CARTA — componente firma del "Circolo Nettuno".
 * Faccia avorio ad alto contrasto con indici classici agli angoli (rank+seme)
 * e pip centrale grande: la LEGGIBILITÀ è il requisito non negoziabile.
 *
 * Il client è muto sulle regole: la carta si limita a DISEGNARE i dati ricevuti.
 * Distinzione visiva jolly vs pinella:
 *  - IDENTITÀ della carta = `card.wildKind` ("joker" | "pinella" | null): campo
 *    reale del contratto, letto direttamente. Non si deduce nulla dal rank.
 *  - RUOLO di matta dentro un gioco = `wildRole` (alimentato da Meld.wildIndices),
 *    passato dal contenitore. Non lo deduce la carta.
 */

const SUIT_SYMBOL: Record<Suit, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const RED_SUITS: Suit[] = ["hearts", "diamonds"];

/**
 * Disposizione dei pip come su un mazzo reale: colonne sinistra / centro /
 * destra, con la metà inferiore dei segni ruotata di 180°. "u" alto, "m" medio,
 * "d" basso (ruotato). Nessuna regola di gioco: sola tipografia della carta.
 */
const PIP_LAYOUT: Record<number, { L: string[]; C: string[]; R: string[] }> = {
  2: { L: [], C: ["u", "d"], R: [] },
  3: { L: [], C: ["u", "m", "d"], R: [] },
  4: { L: ["u", "d"], C: [], R: ["u", "d"] },
  5: { L: ["u", "d"], C: ["m"], R: ["u", "d"] },
  6: { L: ["u", "m", "d"], C: [], R: ["u", "m", "d"] },
  7: { L: ["u", "m", "d"], C: ["u"], R: ["u", "m", "d"] },
  8: { L: ["u", "m", "d"], C: ["u", "d"], R: ["u", "m", "d"] },
  9: { L: ["u", "m", "m", "d"], C: ["m"], R: ["u", "m", "m", "d"] },
  10: { L: ["u", "m", "m", "d"], C: ["u", "d"], R: ["u", "m", "m", "d"] },
};

const COURT_RANKS = ["J", "Q", "K"];

export function cardLabel(card: Card): string {
  if (card.rank === "JOKER") return "Jolly";
  const suitName: Record<Suit, string> = {
    hearts: "cuori",
    diamonds: "quadri",
    clubs: "fiori",
    spades: "picche",
  };
  return card.suit ? `${card.rank} di ${suitName[card.suit]}` : card.rank;
}

interface Props {
  card: Card;
  selected?: boolean;
  /**
   * Attivazione della carta. L'evento è inoltrato così che il chiamante possa
   * distinguere l'attivazione DA TASTIERA (Invio/Spazio → `e.detail === 0`) da
   * quella da PUNTATORE (mouse/touch → `e.detail >= 1`), che nella mano è invece
   * gestita a parte dai Pointer Events per convivere col riordino.
   */
  onClick?: (card: Card, e: React.MouseEvent) => void;
  /** Passthrough tastiera (es. riordino accessibile nella mano). Solo variante button. */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Handler Pointer Events (selezione/riordino unificati), montati sul button. */
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
  /** Press-preview (touch): la carta è evidenziata prima del commit al rilascio. */
  pressed?: boolean;
  small?: boolean;
  /** true tra invio dell'intenzione e ack del server, agganciato a QUESTA carta. */
  pending?: boolean;
  /** carta a faccia coperta (mano avversario / dorso). */
  faceDown?: boolean;
  /** questa carta funge da matta nel gioco (da Meld.wildIndices). */
  wildRole?: boolean;
}

export function CardView({
  card,
  selected,
  onClick,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  pressed,
  small,
  pending,
  faceDown,
  wildRole,
}: Props) {
  if (faceDown) {
    return <span className="card back" data-small={small ? "true" : "false"} aria-label="Carta coperta" />;
  }

  const isRed = card.suit ? RED_SUITS.includes(card.suit) : false;
  const kind = card.wildKind;
  const clickable = Boolean(onClick);
  const symbol = card.suit ? SUIT_SYMBOL[card.suit] : "";
  const rankLabel = card.rank === "JOKER" ? "JLY" : card.rank;
  // Colore grafico stabile del jolly SCOPERTO (mai sui dorsi: return sopra).
  const jolly = jollyColor(card);

  const index = (
    <span className="index" aria-hidden="true">
      <span className="r">{rankLabel}</span>
      {symbol && <span className="s">{symbol}</span>}
    </span>
  );

  // Corpo della carta: pip disposti per i numeri, pannello per le figure,
  // un solo segno grande per asso e jolly.
  const pipSpec = PIP_LAYOUT[Number(card.rank)];
  const isCourt = COURT_RANKS.includes(card.rank);

  const body =
    kind === "joker" ? (
      <span className="jolly" aria-hidden="true">
        ★
      </span>
    ) : pipSpec && symbol && !small ? (
      <span className="pips" aria-hidden="true">
        {(["L", "C", "R"] as const).map((col) => (
          <span key={col} className="pip-col" data-col={col}>
            {pipSpec[col].map((slot, i) => (
              <span key={i} data-flip={slot === "d" ? "true" : "false"}>
                {symbol}
              </span>
            ))}
          </span>
        ))}
      </span>
    ) : isCourt && symbol ? (
      // Figure: nessuna illustrazione. Seme grande al centro + lettera del rango
      // sovrapposta, leggibili a colpo d'occhio (niente pannello a taglio diagonale).
      <span className="court" aria-hidden="true">
        <span className="court-suit">{symbol}</span>
        <span className="court-letter">{rankLabel}</span>
      </span>
    ) : (
      // Asso, e carte numeriche in formato piccolo (giochi calati / scarti): un
      // solo seme grande al centro, sempre riconoscibile.
      <span className="pip" aria-hidden="true">
        {symbol}
      </span>
    );

  const content = (
    <>
      {index}
      {body}
      <span className="index br" aria-hidden="true">
        <span className="r">{rankLabel}</span>
        {symbol && <span className="s">{symbol}</span>}
      </span>
      {/* Jolly illustrato: strato SOPRA la faccia stilizzata (che resta nel DOM).
          Visibile solo su desktop e con carta ≥ 72 px: vedi globals.css. */}
      {jolly && (
        <span className="jolly-art" aria-hidden="true">
          <span className="jolly-art-img" />
        </span>
      )}
    </>
  );

  const common = {
    className: `card${clickable ? " clickable" : ""}`,
    "data-selected": selected ? "true" : "false",
    "data-pressed": pressed ? "true" : "false",
    "data-color": isRed ? "red" : "black",
    "data-small": small ? "true" : "false",
    "data-pending": pending ? "true" : "false",
    "data-wildkind": kind ?? undefined,
    "data-jolly": jolly ?? undefined,
    "data-wildrole": wildRole ? "true" : undefined,
    title: cardLabel(card),
    "aria-label": `${cardLabel(card)}${kind ? ` (${kind === "joker" ? "jolly" : "pinella"})` : ""}${
      wildRole ? ", usata come matta" : ""
    }${pending ? ", in attesa di conferma" : ""}`,
  } as const;

  // Con onKeyDown/Pointer la carta è interattiva (riordino/selezione) anche quando
  // il toggle da click è disabilitato (non è il tuo turno): resta focalizzabile e
  // operabile da tastiera. `aria-pressed` riflette la selezione quando è una
  // carta selezionabile (in mano), a prescindere dal canale d'attivazione.
  const selectable = clickable || Boolean(onPointerDown);
  const interactive = selectable || Boolean(onKeyDown);
  if (interactive) {
    return (
      <button
        type="button"
        {...common}
        aria-pressed={selectable ? (selected ? true : undefined) : undefined}
        onClick={clickable ? (e) => onClick?.(card, e) : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {content}
      </button>
    );
  }
  return <span {...common} role="img">{content}</span>;
}
