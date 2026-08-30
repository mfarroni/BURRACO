"use client";

import type { Card, Suit } from "@/lib/contract";

/**
 * CARTA — componente firma del "Circolo Notturno".
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

  const index = (
    <span className="index" aria-hidden="true">
      <span className="r">{rankLabel}</span>
      {symbol && <span className="s">{symbol}</span>}
    </span>
  );

  const content = (
    <>
      {index}
      {kind === "joker" ? (
        <span className="jolly" aria-hidden="true">
          ★
        </span>
      ) : (
        <span className="pip" aria-hidden="true">
          {symbol}
        </span>
      )}
      <span className="index br" aria-hidden="true">
        <span className="r">{rankLabel}</span>
        {symbol && <span className="s">{symbol}</span>}
      </span>
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
