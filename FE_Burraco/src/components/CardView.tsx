"use client";

import type { Card, Suit } from "@/lib/contract";

/**
 * Rappresentazione ESSENZIALE di una carta. La grafica definitiva è competenza
 * di agente_ui_ux: qui esponiamo solo struttura, dati e stato (selezionata,
 * cliccabile) tramite className/data-attribute facilmente re-stylabili.
 */

const SUIT_SYMBOL: Record<Suit, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const RED_SUITS: Suit[] = ["hearts", "diamonds"];

export function cardLabel(card: Card): string {
  if (card.rank === "JOKER") return "JOLLY";
  return `${card.rank}${card.suit ? SUIT_SYMBOL[card.suit] : ""}`;
}

interface Props {
  card: Card;
  selected?: boolean;
  onClick?: (card: Card) => void;
  small?: boolean;
}

export function CardView({ card, selected, onClick, small }: Props) {
  const isRed = card.suit ? RED_SUITS.includes(card.suit) : false;
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      className="card"
      data-selected={selected ? "true" : "false"}
      data-color={isRed ? "red" : "black"}
      data-wild={card.isWild ? "true" : "false"}
      data-small={small ? "true" : "false"}
      disabled={!clickable}
      onClick={() => onClick?.(card)}
      title={cardLabel(card)}
    >
      {card.rank === "JOKER" ? (
        <span className="card-joker">★</span>
      ) : (
        <>
          <span className="card-rank">{card.rank}</span>
          <span className="card-suit">{card.suit ? SUIT_SYMBOL[card.suit] : ""}</span>
        </>
      )}
    </button>
  );
}
