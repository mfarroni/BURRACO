import type { GameConfig, Seat, TeamId } from "../contract/types.js";

/**
 * Mappa un POSTO alla sua SQUADRA (SERVER-ONLY). Unica autorità sul mapping
 * posto→squadra: motore, punteggio e redazione ne dipendono, così la proprietà
 * dei giochi calati resta coerentemente di SQUADRA (P4), mai di posto.
 *
 *  - individuale: `team === seat` (ogni giocatore è squadra a sé). In 1v1 nulla cambia.
 *  - coppie (predisposizione Fase 1, NON ancora attiva): posti opposti nella stessa
 *    squadra → 0+2 = squadra 0, 1+3 = squadra 1, cioè `seat % 2`.
 *
 * `config.modalita` è oggi il letterale "individuale" (la Fase 1 non allarga
 * `GameConfig`): il cast a `string` riconosce che il ramo coppie entrerà col
 * contratto della Fase 2. Finché la modalità resta individuale il ramo non è
 * esercitato e `teamOfSeat` restituisce sempre il posto stesso.
 */
export function teamOfSeat(seat: Seat, config: GameConfig): TeamId {
  return (config.modalita as string) === "coppie" ? seat % 2 : seat;
}
