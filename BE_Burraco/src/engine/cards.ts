import type { Card, Rank, Suit } from "../contract/types.js";

/**
 * Modello carte e mazzo. SERVER-ONLY (decisione #3): il client non contiene
 * nulla di questo. Funzioni pure e deterministe (a parte lo shuffle).
 */

export const SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];

/** Rank naturali presenti in un mazzo (senza il jolly, aggiunto a parte). */
export const NATURAL_RANKS: Rank[] = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
];

const SUIT_CODE: Record<Suit, string> = {
  hearts: "H",
  diamonds: "D",
  clubs: "C",
  spades: "S",
};

/** Valore a punteggio di una carta (A7: il 2 vale SEMPRE 20). */
export function cardValue(rank: Rank): number {
  switch (rank) {
    case "JOKER":
      return 30;
    case "2":
      return 20;
    case "A":
      return 15;
    case "K":
    case "Q":
    case "J":
    case "10":
    case "9":
    case "8":
      return 10;
    default:
      // 7, 6, 5, 4, 3
      return 5;
  }
}

/**
 * Ordine base di un rank per le sequenze: A=1 … K=13.
 * L'asso alto (14) è gestito dal solver delle sequenze, non qui.
 */
export function rankOrder(rank: Rank): number {
  const map: Record<string, number> = {
    A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
    "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13,
  };
  return map[rank] ?? 0;
}

/** Converte una posizione di sequenza (1..14) nel rank corrispondente. */
export function orderToRank(pos: number): Rank {
  if (pos === 14 || pos === 1) return "A";
  const arr: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  // pos 2 -> "2" (indice 0), … pos 13 -> "K" (indice 11)
  return arr[pos - 2] ?? "A";
}

/** true per jolly e per ogni 2 (pinella). */
export function isWildRank(rank: Rank): boolean {
  return rank === "JOKER" || rank === "2";
}

/**
 * Crea il mazzo completo del Burraco: 2 × 54 = 108 carte
 * (2 × 52 naturali + 4 jolly). Ogni copia ha un id univoco.
 */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (let copy = 1; copy <= 2; copy++) {
    for (const suit of SUITS) {
      for (const rank of NATURAL_RANKS) {
        cards.push({
          id: `${SUIT_CODE[suit]}-${rank}-${copy}`,
          suit,
          rank,
          isWild: rank === "2",
        });
      }
    }
    for (let j = 1; j <= 2; j++) {
      cards.push({ id: `JOKER-${copy}-${j}`, suit: null, rank: "JOKER", isWild: true });
    }
  }
  return cards; // 108
}

/** Fisher-Yates in-place. RNG non crittografico: sufficiente per il gioco. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
