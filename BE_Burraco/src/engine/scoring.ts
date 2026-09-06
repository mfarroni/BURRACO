import type { Card, HandScoreDetail, Meld, Seat } from "../contract/types.js";
import { cardValue } from "./cards.js";

/**
 * Punteggio di fine smazzata (SERVER-ONLY). Vedi skill "PUNTEGGIO":
 *  - valore carte calate (positivo);
 *  - burraco pulito 200 / sporco 100; bonus chiusura 100;
 *  - carte rimaste in mano: stesso valore ma NEGATIVO;
 *  - pozzetto NON preso: -100.
 *
 * NB: "pozzetto preso ma non giocato -> sottrae il valore delle carte del
 * pozzetto" è già coperto: quelle carte restano in mano e finiscono nella
 * penalità di mano. Non si applica quindi un doppio conteggio.
 */

export interface SeatEndState {
  seat: Seat;
  hand: Card[];
  pozzettoTaken: boolean;
  /**
   * true se il pozzetto è stato preso "in diretta" (svuotando la mano PRIMA dello
   * scarto). Opzionale/default false per retro-compatibilità: i chiamanti storici
   * (es. test unit) non lo passano; il motore lo valorizza da SeatState.
   */
  pozzettoInDiretta?: boolean;
}

export function scoreHand(
  seats: SeatEndState[],
  melds: Meld[],
  closerSeat: Seat | null,
): HandScoreDetail[] {
  return seats.map((s) => {
    const ownMelds = melds.filter((m) => m.ownerSeat === s.seat);

    let ptsMelds = 0;
    let ptsBonus = 0;
    // Conteggio dei burrachi PROPRI, separati per `clean`. `ptsBonus` fonde
    // burrachi + bonus chiusura: questi contatori tengono i due fatti distinti,
    // necessari all'analisi di stile (non ricavabili a posteriori dai punti).
    let burrachiPuliti = 0;
    let burrachiSporchi = 0;
    for (const m of ownMelds) {
      for (const c of m.cards) ptsMelds += cardValue(c.rank);
      if (m.isBurraco) {
        ptsBonus += m.clean ? 200 : 100;
        if (m.clean) burrachiPuliti += 1;
        else burrachiSporchi += 1;
      }
    }
    if (closerSeat === s.seat) ptsBonus += 100;

    let handValue = 0;
    for (const c of s.hand) handValue += cardValue(c.rank);
    const ptsPenaltyHand = -handValue;

    const ptsPozzetto = s.pozzettoTaken ? 0 : -100;

    const totalDelta = ptsMelds + ptsBonus + ptsPenaltyHand + ptsPozzetto;
    return {
      seat: s.seat,
      ptsMelds,
      ptsBonus,
      ptsPenaltyHand,
      ptsPozzetto,
      totalDelta,
      burrachiPuliti,
      burrachiSporchi,
      // Coerenza: "in diretta" ha senso solo se il pozzetto è stato preso.
      pozzettoInDiretta: s.pozzettoTaken ? s.pozzettoInDiretta === true : false,
    };
  });
}
