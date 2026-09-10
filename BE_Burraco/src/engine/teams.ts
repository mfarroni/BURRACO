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

/**
 * Numero di SQUADRE del tavolo (SERVER-ONLY): 2 in coppie, `numeroGiocatori` in
 * individuale. Le squadre sono sempre dense e 0-based (0..k-1), coerenti con
 * `teamOfSeat`. È la lunghezza degli array indicizzati per `TeamId` (`scores`,
 * `finalScores`, `cumulative` del contratto).
 */
export function teamCount(config: GameConfig): number {
  return (config.modalita as string) === "coppie" ? 2 : config.numeroGiocatori;
}

/**
 * PROIEZIONE per SQUADRA dei cumulati per-posto (SERVER-ONLY). Somma i valori dei
 * posti che appartengono alla stessa squadra e restituisce un array indicizzato per
 * `TeamId` (lunghezza = `teamCount`). È solo una proiezione per la REDAZIONE/CONTRATTO
 * (non l'attribuzione canonica del punteggio di coppia, che è un'altra tappa): in
 * individuale/1v1 (team = seat) restituisce esattamente `[perSeat[0], perSeat[1]]`.
 */
export function teamScores(perSeat: readonly number[], config: GameConfig): number[] {
  const out = new Array<number>(teamCount(config)).fill(0);
  for (let seat = 0; seat < config.numeroGiocatori; seat++) {
    const team = teamOfSeat(seat, config);
    out[team] = (out[team] ?? 0) + (perSeat[seat] ?? 0);
  }
  return out;
}
