import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/engine/game.js";
import { interpretMeld } from "../src/engine/meld.js";
import { scoreHand, type SeatEndState } from "../src/engine/scoring.js";
import { defaultGameConfig } from "../src/config.js";
import type { Card, Meld, Rank, Suit } from "../src/contract/types.js";

/**
 * ORIGINE dei fatti di STILE persistiti (macro-ciclo storico). Copre, a livello di
 * motore/scoring (SERVER-ONLY, fonte di verità), i conteggi che alimentano lo
 * storico: burrachi puliti/sporchi separati (§5 caso 8) e pozzetto in diretta vs
 * differita (§5 caso 11). Nessun DB: si verifica il calcolo, non la persistenza.
 */

let uid = 0;
function card(rank: Rank, suit: Suit | null): Card {
  const isWild = rank === "JOKER" || rank === "2";
  return {
    id: `${rank}-${suit ?? "X"}-${uid++}`,
    suit,
    rank,
    isWild,
    wildKind: rank === "JOKER" ? "joker" : rank === "2" ? "pinella" : null,
  };
}
const joker = () => card("JOKER", null);

function meldOf(cards: Card[], seat: 0 | 1): Meld {
  const m = interpretMeld(cards)!;
  return {
    id: "m" + uid++,
    type: m.type,
    cards: m.orderedCards,
    ownerSeat: seat,
    isBurraco: m.isBurraco,
    clean: m.clean,
  };
}

test("scoreHand: burraco PULITO e SPORCO nella stessa smazzata contati separatamente (caso 8)", () => {
  // Seat 0: un burraco pulito (7 carte, nessuna matta) + un burraco sporco (con jolly).
  const pulito = [
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ];
  const sporco = [
    card("4", "hearts"), card("5", "hearts"), joker(), card("7", "hearts"),
    card("8", "hearts"), card("9", "hearts"), card("10", "hearts"),
  ];
  const melds = [meldOf(pulito, 0), meldOf(sporco, 0)];
  const seats: SeatEndState[] = [
    { seat: 0, hand: [], pozzettoTaken: true },
    { seat: 1, hand: [], pozzettoTaken: true },
  ];
  const res = scoreHand(seats, melds, 0);
  const s0 = res.find((r) => r.seat === 0)!;
  assert.equal(s0.burrachiPuliti, 1, "un burraco pulito");
  assert.equal(s0.burrachiSporchi, 1, "un burraco sporco");
  // ptsBonus fonde i due (200 + 100) + chiusura 100: i contatori restano distinti.
  assert.equal(s0.ptsBonus, 200 + 100 + 100);
  const s1 = res.find((r) => r.seat === 1)!;
  assert.equal(s1.burrachiPuliti, 0);
  assert.equal(s1.burrachiSporchi, 0);
});

test("scoreHand: pozzettoInDiretta è vero solo se il pozzetto è stato preso (coerenza)", () => {
  const seats: SeatEndState[] = [
    { seat: 0, hand: [], pozzettoTaken: true, pozzettoInDiretta: true },
    // Incoerente in input (non preso ma inDiretta=true): scoreHand lo normalizza a false.
    { seat: 1, hand: [], pozzettoTaken: false, pozzettoInDiretta: true },
  ];
  const res = scoreHand(seats, [], null);
  assert.equal(res.find((r) => r.seat === 0)!.pozzettoInDiretta, true);
  assert.equal(res.find((r) => r.seat === 1)!.pozzettoInDiretta, false);
});

test("GameEngine: pozzetto IN DIRETTA (mano svuotata con una calata) → pozzettoInDiretta=true (caso 11)", () => {
  const g = new GameEngine(defaultGameConfig(), 0);
  // Stato controllato: seat 0 di mano in may_meld, mano di sole 3 carte che formano
  // un gruppo, pozzetto disponibile, pozzetto non ancora preso.
  g.currentSeat = 0;
  g.phase = "may_meld";
  const trio = [card("9", "clubs"), card("9", "diamonds"), card("9", "hearts")];
  g.seats[0] = { hand: trio, pozzettoTaken: false, pozzettoInDiretta: false };
  g.pozzetti = [[card("K", "spades")]]; // un pozzetto disponibile (contenuto irrilevante)

  const r = g.meldNew(0, trio.map((c) => c.id));
  assert.equal(r.ok, true, "la calata che svuota la mano è lecita col pozzetto disponibile");
  assert.equal(g.seats[0].pozzettoTaken, true, "pozzetto preso");
  assert.equal(g.seats[0].pozzettoInDiretta, true, "presa IN DIRETTA");
});

test("GameEngine: pozzetto DIFFERITA (mano svuotata con lo scarto) → pozzettoInDiretta=false (caso 11)", () => {
  const g = new GameEngine(defaultGameConfig(), 0);
  g.currentSeat = 0;
  g.phase = "may_meld";
  const last = card("K", "clubs"); // non matta: scarto lecito
  g.seats[0] = { hand: [last], pozzettoTaken: false, pozzettoInDiretta: false };
  g.pozzetti = [[card("Q", "spades")]];

  const r = g.discardCard(0, last.id);
  assert.equal(r.ok, true);
  assert.equal(g.seats[0].pozzettoTaken, true, "pozzetto preso in differita");
  assert.equal(g.seats[0].pozzettoInDiretta, false, "NON in diretta");
});
