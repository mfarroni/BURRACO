import type { Card, GameConfig, HandScoreDetail, Meld, Seat, TeamId } from "../contract/types.js";
import { cardValue } from "./cards.js";
import { teamOfSeat } from "./teams.js";

/**
 * Punteggio di fine smazzata (SERVER-ONLY). Vedi skill "PUNTEGGIO" e "MODALITA' A
 * COPPIE":
 *  - valore carte calate (positivo);
 *  - burraco pulito 200 / sporco 100; bonus chiusura 100;
 *  - carte rimaste in mano: stesso valore ma NEGATIVO;
 *  - pozzetto NON preso: -100.
 *
 * NB: "pozzetto preso ma non giocato -> sottrae il valore delle carte del
 * pozzetto" è già coperto: quelle carte restano in mano e finiscono nella
 * penalità di mano. Non si applica quindi un doppio conteggio.
 *
 * ATTRIBUZIONE PER SQUADRA (skill "Punteggio: tutto a livello di COPPIA", D-C).
 * `hand_scores` è per-posto, ma i fatti di COPPIA vanno contati UNA VOLTA SOLA. Si
 * attribuiscono al POSTO CANONICO della squadra (indice minore); l'altro posto
 * della coppia porta solo la penalità della PROPRIA mano. Il totale di coppia della
 * smazzata è la SUM delle due righe → nessun doppio conteggio di giochi, burrachi,
 * bonus chiusura o malus pozzetto. In individuale (team = seat) ogni posto è
 * canonico della propria squadra → ogni riga resta IDENTICA all'1v1.
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
  config?: GameConfig,
): HandScoreDetail[] {
  // P4: i punti dei giochi calati vanno alla SQUADRA, non al posto che li ha calati.
  // `teamOf` mappa posto→squadra tramite config; senza config (chiamate dirette,
  // es. test unit) ricade sul posto stesso — identico all'1v1. `ownerTeam` è la
  // fonte autoritativa del gioco; il fallback a `ownerSeat` copre i meld costruiti
  // fuori dal motore (fixture) e restituisce comunque la squadra corretta.
  const teamOf = (seat: Seat): TeamId => (config ? teamOfSeat(seat, config) : seat);
  const teamOfMeld = (m: Meld): TeamId => m.ownerTeam ?? teamOf(m.ownerSeat);

  // Posto CANONICO di ciascuna squadra = indice minore fra i posti della squadra.
  // I fatti di coppia sono attribuiti SOLO a questo posto (una volta sola).
  const canonicalSeat = new Map<TeamId, Seat>();
  for (const s of seats) {
    const t = teamOf(s.seat);
    const cur = canonicalSeat.get(t);
    if (cur === undefined || s.seat < cur) canonicalSeat.set(t, s.seat);
  }

  // Squadra che ha CHIUSO (bonus chiusura +100 alla coppia, una volta sola).
  const closerTeam = closerSeat === null ? null : teamOf(closerSeat);
  // Una squadra ha preso il pozzetto se ALMENO uno dei suoi posti l'ha preso: il
  // malus (-100) scatta una sola volta e solo se NESSUN membro l'ha preso.
  const teamTookPozzetto = (team: TeamId): boolean =>
    seats.some((o) => o.pozzettoTaken && teamOf(o.seat) === team);

  return seats.map((s) => {
    const seatTeam = teamOf(s.seat);
    const isCanonical = canonicalSeat.get(seatTeam) === s.seat;

    // ── Fatti di COPPIA: solo sul posto canonico, una volta sola ─────────────
    let ptsMelds = 0;
    let ptsBonus = 0;
    // Conteggio dei burrachi della SQUADRA, separati per `clean`. `ptsBonus` fonde
    // burrachi + bonus chiusura: questi contatori tengono i due fatti distinti,
    // necessari all'analisi di stile (non ricavabili a posteriori dai punti).
    let burrachiPuliti = 0;
    let burrachiSporchi = 0;
    let ptsPozzetto = 0;
    if (isCanonical) {
      for (const m of melds) {
        if (teamOfMeld(m) !== seatTeam) continue;
        for (const c of m.cards) ptsMelds += cardValue(c.rank);
        if (m.isBurraco) {
          ptsBonus += m.clean ? 200 : 100;
          if (m.clean) burrachiPuliti += 1;
          else burrachiSporchi += 1;
        }
      }
      if (closerTeam === seatTeam) ptsBonus += 100;
      ptsPozzetto = teamTookPozzetto(seatTeam) ? 0 : -100;
    }

    // ── Fatto di POSTO: penalità della PROPRIA mano (entrambi i compagni) ─────
    let handValue = 0;
    for (const c of s.hand) handValue += cardValue(c.rank);
    const ptsPenaltyHand = -handValue;

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
