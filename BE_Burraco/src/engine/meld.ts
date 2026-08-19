import type { Card, MeldType, Rank, Suit } from "../contract/types.js";
import { orderToRank, rankOrder } from "./cards.js";

/**
 * Solver dei giochi (SERVER-ONLY). Verifica se un insieme di carte forma un
 * gioco valido di Burraco e, in caso positivo, ne fornisce l'interpretazione.
 *
 * Regole applicate (dalla skill):
 *  - GRUPPO: stesso valore. Richiede almeno una carta naturale di rango normale
 *    (non-2, non-jolly): le sole matte NON formano gioco. Max UNA matta (jolly o
 *    2 usato come matta).
 *  - SEQUENZA: stesso seme in ordine; asso basso (A-2-3) o alto (Q-K-A), non "gira".
 *    Max UNA matta, TRANNE il 2 al suo posto naturale (che è naturale, non matta).
 *  - BURRACO: >= 7 carte. Pulito = nessuna matta (salvo 2 naturale) -> clean.
 */

export interface WildInfo {
  cardId: string;
  /** Carta naturale rappresentata dalla matta (per la sostituzione pinella). */
  represents: { rank: Rank; suit: Suit | null };
  /** true se la matta è una pinella (un 2): solo queste sono sostituibili. */
  isPinella: boolean;
}

export interface MeldInterpretation {
  type: MeldType;
  orderedCards: Card[]; // sequenza: in ordine di run; gruppo: naturali poi matte
  wilds: WildInfo[];
  wildCount: number;
  clean: boolean; // nessuna matta
  isBurraco: boolean; // >= 7 carte
  groupRank?: Rank; // solo per i gruppi
}

const isJoker = (c: Card) => c.rank === "JOKER";
const isTwo = (c: Card) => c.rank === "2";

/** Prova a interpretare le carte come gruppo O come sequenza. null se invalido. */
export function interpretMeld(cards: Card[]): MeldInterpretation | null {
  if (cards.length < 3) return null;
  return solveGroup(cards) ?? solveSequence(cards);
}

/* ────────────────────────────── GRUPPO ────────────────────────────── */

function solveGroup(cards: Card[]): MeldInterpretation | null {
  const jokers = cards.filter(isJoker);
  const twos = cards.filter(isTwo);
  const others = cards.filter((c) => !isJoker(c) && !isTwo(c));

  // Un gruppo richiede almeno una carta NATURALE di rango normale (non-2,
  // non-jolly): le sole matte (2 e/o jolly) NON formano gioco (skill, riga 81).
  if (others.length === 0) return null;

  // Il rank del gruppo è quello dei naturali non-2; i 2 diventano matte.
  const groupRank: Rank = others[0]!.rank;
  if (others.some((c) => c.rank !== groupRank)) return null;
  const wildCards: Card[] = [...jokers, ...twos];

  if (wildCards.length > 1) return null; // max UNA matta

  const wilds: WildInfo[] = wildCards.map((w) => ({
    cardId: w.id,
    represents: { rank: groupRank, suit: null }, // nel gruppo il seme è irrilevante
    isPinella: isTwo(w),
  }));

  const naturals = cards.filter((c) => !wildCards.some((w) => w.id === c.id));
  return {
    type: "group",
    orderedCards: [...naturals, ...wildCards],
    wilds,
    wildCount: wilds.length,
    clean: wilds.length === 0,
    isBurraco: cards.length >= 7,
    groupRank,
  };
}

/* ───────────────────────────── SEQUENZA ───────────────────────────── */

/**
 * Poiché è ammessa al massimo UNA matta per gioco, la sequenza ha al più un
 * "buco" da riempire. Enumeriamo le interpretazioni ambigue (ogni 2
 * naturale-o-matta, ogni asso basso-o-alto) e cerchiamo una finestra di
 * posizioni consecutive valida.
 */
function solveSequence(cards: Card[]): MeldInterpretation | null {
  const jokers = cards.filter(isJoker);
  const twos = cards.filter(isTwo);
  const aces = cards.filter((c) => c.rank === "A");
  const plain = cards.filter((c) => !isJoker(c) && !isTwo(c) && c.rank !== "A");

  const N = cards.length;

  // Ogni 2 può essere naturale o matta; ogni asso può essere basso o alto.
  // Tra le interpretazioni valide preferiamo quella con MENO matte: così un 2
  // al suo posto naturale resta naturale (e la scala risulta pulita se possibile).
  let best: MeldInterpretation | null = null;
  for (const twoAssign of boolCombos(twos.length)) {
    for (const aceAssign of boolCombos(aces.length)) {
      const attempt = trySequence(
        cards, N, plain, aces, twos, jokers, twoAssign, aceAssign,
      );
      if (attempt && (best === null || attempt.wildCount < best.wildCount)) {
        best = attempt;
        if (best.wildCount === 0) return best; // ottimo: nessuna matta
      }
    }
  }
  return best;
}

/** Genera tutte le combinazioni booleane di lunghezza n (2^n, n piccolo). */
function boolCombos(n: number): boolean[][] {
  if (n === 0) return [[]];
  const out: boolean[][] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const row: boolean[] = [];
    for (let i = 0; i < n; i++) row.push((mask & (1 << i)) !== 0);
    out.push(row);
  }
  return out;
}

interface Placed {
  card: Card;
  pos: number; // posizione naturale nella run (1..14)
}

function trySequence(
  cards: Card[],
  N: number,
  plain: Card[],
  aces: Card[],
  twos: Card[],
  jokers: Card[],
  twoNatural: boolean[], // true = il 2 è naturale
  aceHigh: boolean[], // true = asso alto (14)
): MeldInterpretation | null {
  const suited: Placed[] = []; // carte "suited" con posizione fissa
  const wildCards: Card[] = [...jokers];

  // Naturali non-2 non-asso: posizione = rank base, seme fisso.
  for (const c of plain) suited.push({ card: c, pos: rankOrder(c.rank) });

  // Assi: basso (1) o alto (14).
  aces.forEach((c, i) => suited.push({ card: c, pos: aceHigh[i] ? 14 : 1 }));

  // Due: naturale (pos 2, seme fisso) oppure matta.
  twos.forEach((c, i) => {
    if (twoNatural[i]) suited.push({ card: c, pos: 2 });
    else wildCards.push(c);
  });

  if (wildCards.length > 1) return null; // max UNA matta

  // Serve almeno una carta suited per definire il seme della sequenza.
  const suitedNonJoker = suited.filter((p) => p.card.suit !== null);
  if (suitedNonJoker.length === 0) return null;
  const seqSuit = suitedNonJoker[0]!.card.suit!;
  if (suitedNonJoker.some((p) => p.card.suit !== seqSuit)) return null;

  // Posizioni fisse tutte distinte (una sequenza non ripete un rank).
  const positions = suited.map((p) => p.pos);
  if (new Set(positions).size !== positions.length) return null;

  const F = suited.length; // naturali con posizione
  const W = wildCards.length;
  if (F + W !== N) return null; // coerenza

  const pmin = Math.min(...positions);
  const pmax = Math.max(...positions);
  const span = pmax - pmin;
  if (span > N - 1) return null; // non entra in una finestra di lunghezza N

  // Determina la finestra [lo, hi] e la posizione della (eventuale) matta.
  let lo: number;
  let wildPos: number | null = null;

  if (W === 0) {
    // Deve essere perfettamente consecutiva, senza buchi.
    if (span !== N - 1) return null;
    lo = pmin;
  } else {
    // Una sola matta: o riempie un buco interno, o estende un estremo.
    if (span === N - 1) {
      // Buco interno: individua la posizione mancante.
      lo = pmin;
      const present = new Set(positions);
      for (let p = pmin; p <= pmax; p++) {
        if (!present.has(p)) { wildPos = p; break; }
      }
      if (wildPos === null) return null;
    } else if (span === N - 2) {
      // Naturali consecutivi: estende in alto se possibile, altrimenti in basso.
      if (pmax + 1 <= 14) { lo = pmin; wildPos = pmax + 1; }
      else if (pmin - 1 >= 1) { lo = pmin - 1; wildPos = pmin - 1; }
      else return null;
    } else {
      return null;
    }
  }

  const hi = lo + N - 1;
  if (lo < 1 || hi > 14) return null;

  // Costruisce la run ordinata.
  const byPos = new Map<number, Card>();
  for (const p of suited) byPos.set(p.pos, p.card);
  if (wildPos !== null && wildCards[0]) byPos.set(wildPos, wildCards[0]);

  const orderedCards: Card[] = [];
  for (let p = lo; p <= hi; p++) {
    const c = byPos.get(p);
    if (!c) return null; // slot vuoto imprevisto
    orderedCards.push(c);
  }

  const wilds: WildInfo[] =
    W === 1 && wildPos !== null && wildCards[0]
      ? [{
          cardId: wildCards[0].id,
          represents: { rank: orderToRank(wildPos), suit: seqSuit },
          isPinella: wildCards[0].rank === "2",
        }]
      : [];

  return {
    type: "sequence",
    orderedCards,
    wilds,
    wildCount: wilds.length,
    clean: wilds.length === 0,
    isBurraco: N >= 7,
  };
}
