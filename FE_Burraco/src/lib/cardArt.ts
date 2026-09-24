import type { Card, Rank, Suit } from "./contract";
import { jollyColor } from "./jollyColor";

/**
 * CARTE ILLUSTRATE (solo resa grafica, solo desktop: vedi globals.css, blocco
 * "CARTE ILLUSTRATE"). Da una carta ricevuta al file in public/images/carte/.
 *
 * Il nome del file NON è mai una concatenazione dei valori ricevuti: rank e suit
 * servono solo come CHIAVI di tabelle fisse. Un valore inatteso, un seme non
 * abilitato o una carta senza asset → null: la carta resta stilizzata e il
 * browser non chiede nulla.
 *
 * Convenzione dei file: `<valore>-<seme>.webp` (es. asso-cuori.webp, 10-cuori.webp,
 * re-cuori.webp); i jolly sono jolly-rosso.webp / jolly-nero.webp.
 */

/**
 * PUNTO UNICO dei semi con gli asset illustrati. Per aggiungere un seme: caricare
 * i 13 file `<valore>-<seme>.webp` e aggiungerlo qui.
 */
export const ENABLED_SUITS: readonly Suit[] = ["hearts", "clubs", "spades", "diamonds"];

/** Valore del contratto → parte del nome file. */
const RANK_FILE: Readonly<Record<Exclude<Rank, "JOKER">, string>> = {
  A: "asso",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "fante",
  Q: "donna",
  K: "re",
};

/** Seme del contratto → parte del nome file. */
const SUIT_FILE: Readonly<Record<Suit, string>> = {
  hearts: "cuori",
  diamonds: "quadri",
  clubs: "fiori",
  spades: "picche",
};

const ART_DIR = "/images/carte/";

/** URL dell'illustrazione della carta scoperta, oppure null (resta stilizzata). */
export function cardArtUrl(card: Pick<Card, "id" | "rank" | "suit" | "wildKind">): string | null {
  if (card.wildKind === "joker") {
    const color = jollyColor(card);
    return color ? `${ART_DIR}jolly-${color}.webp` : null;
  }
  const { rank, suit } = card;
  if (suit === null || !ENABLED_SUITS.includes(suit)) return null;
  if (!Object.hasOwn(RANK_FILE, rank) || !Object.hasOwn(SUIT_FILE, suit)) return null;
  const r = RANK_FILE[rank as keyof typeof RANK_FILE];
  const s = SUIT_FILE[suit];
  return `${ART_DIR}${r}-${s}.webp`;
}
