import type { Card } from "./contract";

/** Colore GRAFICO del jolly. Nel burraco non ha effetto sulle regole: sola resa. */
export type JollyColor = "rosso" | "nero";

/**
 * Colore stabile di un jolly, ricavato in modo deterministico dal suo `id`.
 *
 * Il server crea i 4 jolly come `JOKER-<mazzo>-<n>` con mazzo ∈ {1,2} e n ∈ {1,2}
 * (BE_Burraco/src/engine/cards.ts). Come in un mazzo francese reale, ogni mazzo ha
 * un jolly rosso (n = 1) e uno nero (n = 2): in partita 2 rossi e 2 neri.
 *
 * Funzione pura sul solo `id`, che arriva dal server e non cambia: stesso colore
 * su entrambi i client, dopo una riconnessione e in mano / giochi / scarti.
 * Carta non jolly o `id` non riconosciuto → null (il jolly resta stilizzato).
 */
export function jollyColor(card: Pick<Card, "id" | "wildKind">): JollyColor | null {
  if (card.wildKind !== "joker") return null;
  const match = /^JOKER-\d+-([12])$/.exec(card.id);
  if (!match) return null;
  return match[1] === "1" ? "rosso" : "nero";
}
