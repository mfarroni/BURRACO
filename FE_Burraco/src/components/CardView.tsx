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
  onClick?: (card: Card) => void;
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

  if (clickable) {
    return (
      <button type="button" {...common} aria-pressed={selected ? true : undefined} onClick={() => onClick?.(card)}>
        {content}
      </button>
    );
  }
  return <span {...common} role="img">{content}</span>;
}
