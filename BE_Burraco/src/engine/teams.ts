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
 * `TeamId` (lunghezza = `teamCount`). È la proiezione usata dalla REDAZIONE/CONTRATTO
 * e dalla condizione di VITTORIA (confronto sui cumulati di squadra): in
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

/**
 * POSTO CANONICO di una squadra (SERVER-ONLY, decisione D-C): il posto di indice
 * MINORE fra quelli della squadra. È il posto a cui il punteggio attribuisce, UNA
 * VOLTA SOLA, i fatti di COPPIA (giochi calati, burrachi, bonus chiusura, malus
 * pozzetto), così la SUM delle due righe della coppia non li duplica.
 *
 *  - individuale (team = seat): la squadra ha un solo posto → il canonico è sé stesso.
 *  - coppie (0+2 / 1+3): squadra 0 → posto 0, squadra 1 → posto 1.
 *
 * Il fallback `team` copre un input incoerente (nessun posto per la squadra): non
 * accade con `teamOfSeat` denso, ma evita un ritorno indefinito.
 */
export function canonicalSeatForTeam(team: TeamId, config: GameConfig): Seat {
  for (let seat = 0; seat < config.numeroGiocatori; seat++) {
    if (teamOfSeat(seat, config) === team) return seat;
  }
  return team;
}
