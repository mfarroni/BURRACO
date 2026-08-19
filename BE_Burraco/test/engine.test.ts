import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeck, cardValue, isWildRank } from "../src/engine/cards.js";
import { interpretMeld } from "../src/engine/meld.js";
import { scoreHand, type SeatEndState } from "../src/engine/scoring.js";
import type { Card, Meld, Rank, Suit } from "../src/contract/types.js";

/* ───────────────────────── helper costruzione carte ───────────────────────── */

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

/* ─────────────────────────────── CARDS / DECK ─────────────────────────────── */

test("createDeck: 108 carte, 4 jolly, 8 pinelle (2), id univoci", () => {
  const d = createDeck();
  assert.equal(d.length, 108);
  assert.equal(d.filter((c) => c.rank === "JOKER").length, 4);
  assert.equal(d.filter((c) => c.rank === "2").length, 8);
  // wildKind coerente con l'identità
  for (const c of d) {
    if (c.rank === "JOKER") assert.equal(c.wildKind, "joker");
    else if (c.rank === "2") assert.equal(c.wildKind, "pinella");
    else assert.equal(c.wildKind, null);
    assert.equal(c.isWild, c.wildKind !== null, `isWild coerente per ${c.id}`);
  }
  assert.equal(new Set(d.map((c) => c.id)).size, 108, "id univoci");
  // jolly senza seme
  for (const j of d.filter((c) => c.rank === "JOKER")) assert.equal(j.suit, null);
});

test("cardValue: valori a punteggio da skill", () => {
  assert.equal(cardValue("JOKER"), 30);
  assert.equal(cardValue("2"), 20);
  assert.equal(cardValue("A"), 15);
  for (const r of ["K", "Q", "J", "10", "9", "8"] as Rank[]) assert.equal(cardValue(r), 10);
  for (const r of ["7", "6", "5", "4", "3"] as Rank[]) assert.equal(cardValue(r), 5);
});

test("isWildRank: solo JOKER e 2", () => {
  assert.equal(isWildRank("JOKER"), true);
  assert.equal(isWildRank("2"), true);
  assert.equal(isWildRank("A"), false);
  assert.equal(isWildRank("K"), false);
});

/* ──────────────────────────────── GRUPPI ──────────────────────────────── */

test("gruppo: tris naturale (semi diversi) valido e pulito", () => {
  const m = interpretMeld([card("9", "clubs"), card("9", "diamonds"), card("9", "hearts")]);
  assert.ok(m);
  assert.equal(m!.type, "group");
  assert.equal(m!.clean, true);
  assert.equal(m!.wildCount, 0);
  assert.equal(m!.groupRank, "9");
});

test("gruppo: tris con pinella (2 come matta) -> sporco, wildCount 1", () => {
  const m = interpretMeld([card("9", "clubs"), card("9", "diamonds"), card("2", "spades")]);
  assert.ok(m);
  assert.equal(m!.type, "group");
  assert.equal(m!.clean, false);
  assert.equal(m!.wildCount, 1);
  assert.equal(m!.wilds[0]!.isPinella, true);
});

test("gruppo: tris con jolly -> sporco", () => {
  const m = interpretMeld([card("K", "clubs"), card("K", "diamonds"), joker()]);
  assert.ok(m);
  assert.equal(m!.clean, false);
  assert.equal(m!.wildCount, 1);
  assert.equal(m!.wilds[0]!.isPinella, false);
});

test("gruppo: due matte (jolly + 2) -> INVALIDO (max una matta)", () => {
  const m = interpretMeld([card("K", "clubs"), card("K", "diamonds"), joker(), card("2", "spades")]);
  assert.equal(m, null);
});

test("gruppo di sole matte (tris di 2) -> INVALIDO (le sole matte non formano gioco)", () => {
  // Skill riga 81: non sono ammessi giochi di 3+ pinelle né di 3+ jolly.
  const m = interpretMeld([card("2", "clubs"), card("2", "diamonds"), card("2", "hearts")]);
  assert.equal(m, null, "un gruppo di soli 2 (matte) non è un gioco valido");
});

test("gruppo con SEMI DUPLICATI (due 9 di cuori) -> comportamento attuale", () => {
  // Skill riga 49: 'carte dello stesso valore di semi diversi'.
  const m = interpretMeld([card("9", "hearts"), card("9", "hearts"), card("9", "clubs")]);
  // Documentiamo il comportamento reale del motore (vedi anomalia nel report).
  assert.ok(m, "il motore ACCETTA semi duplicati nel gruppo (nessun controllo distinct suit)");
});

/* ─────────────────────────────── SEQUENZE ─────────────────────────────── */

test("sequenza: 4-5-6-7 stesso seme, pulita", () => {
  const m = interpretMeld([card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades")]);
  assert.ok(m);
  assert.equal(m!.type, "sequence");
  assert.equal(m!.clean, true);
  assert.equal(m!.orderedCards.map((c) => c.rank).join(","), "4,5,6,7");
});

test("sequenza: jolly riempie buco interno", () => {
  const m = interpretMeld([card("4", "spades"), card("5", "spades"), joker(), card("7", "spades")]);
  assert.ok(m);
  assert.equal(m!.type, "sequence");
  assert.equal(m!.wildCount, 1);
  assert.equal(m!.clean, false);
  // la matta rappresenta il 6
  assert.equal(m!.wilds[0]!.represents.rank, "6");
});

test("sequenza: 2 al posto naturale + jolly matta (skill riga 52) -> UNA sola matta", () => {
  // 2P,3P,jolly,5P : il 2 e' naturale (pos 2), il jolly e' la matta (pos 4)
  const m = interpretMeld([card("2", "spades"), card("3", "spades"), joker(), card("5", "spades")]);
  assert.ok(m, "sequenza valida");
  assert.equal(m!.wildCount, 1, "solo il jolly conta come matta; il 2 e' naturale");
  assert.equal(m!.clean, false);
});

test("sequenza: asso basso A-2-3 valido", () => {
  const m = interpretMeld([card("A", "hearts"), card("2", "hearts"), card("3", "hearts")]);
  assert.ok(m);
  assert.equal(m!.type, "sequence");
  assert.equal(m!.wildCount, 0, "A basso e 2 naturale: pulita");
});

test("sequenza: asso alto Q-K-A valido", () => {
  const m = interpretMeld([card("Q", "hearts"), card("K", "hearts"), card("A", "hearts")]);
  assert.ok(m);
  assert.equal(m!.type, "sequence");
  assert.equal(m!.clean, true);
});

test("sequenza: K-A-3 INVALIDA (l'asso non gira a meta', nessuna matta)", () => {
  // Senza matte, l'asso non puo' fare da ponte fra K e 3.
  const m = interpretMeld([card("K", "hearts"), card("A", "hearts"), card("3", "hearts")]);
  assert.equal(m, null);
});

test("sequenza: K-A-2 stesso seme -> interpretata come Q-K-A con 2 come matta (pinella)", () => {
  // NB: il 2 e' una matta: K,A,2 di cuori formano una sequenza valida Q(matta)-K-A.
  // Non e' 'asso che gira': e' la pinella usata come Q. Comportamento legittimo.
  const m = interpretMeld([card("K", "hearts"), card("A", "hearts"), card("2", "hearts")]);
  assert.ok(m, "valida grazie alla pinella come matta");
  assert.equal(m!.wildCount, 1);
  assert.equal(m!.wilds[0]!.isPinella, true);
});

test("sequenza: semi misti -> INVALIDA", () => {
  const m = interpretMeld([card("4", "spades"), card("5", "hearts"), card("6", "spades")]);
  assert.equal(m, null);
});

test("meld < 3 carte -> INVALIDO", () => {
  assert.equal(interpretMeld([card("4", "spades"), card("5", "spades")]), null);
});

test("sequenza: due matte -> INVALIDA", () => {
  const m = interpretMeld([card("4", "spades"), joker(), card("6", "spades"), joker()]);
  assert.equal(m, null);
});

/* ──────────────────────────────── BURRACO ─────────────────────────────── */

test("burraco pulito: 7 carte in sequenza senza matte", () => {
  const m = interpretMeld([
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ]);
  assert.ok(m);
  assert.equal(m!.isBurraco, true);
  assert.equal(m!.clean, true);
});

test("burraco sporco: 7 carte con jolly", () => {
  const m = interpretMeld([
    card("4", "spades"), card("5", "spades"), joker(), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ]);
  assert.ok(m);
  assert.equal(m!.isBurraco, true);
  assert.equal(m!.clean, false);
});

test("burraco pulito con 2 al posto naturale (non conta come matta)", () => {
  // A-2-3-4-5-6-7 di picche: il 2 e' naturale -> pulito
  const m = interpretMeld([
    card("A", "spades"), card("2", "spades"), card("3", "spades"), card("4", "spades"),
    card("5", "spades"), card("6", "spades"), card("7", "spades"),
  ]);
  assert.ok(m);
  assert.equal(m!.isBurraco, true);
  assert.equal(m!.clean, true, "il 2 naturale non sporca il burraco");
});

/* ──────────────────────────────── SCORING ─────────────────────────────── */

function meldOf(cards: Card[], seat: 0 | 1, over: Partial<Meld> = {}): Meld {
  const m = interpretMeld(cards)!;
  return {
    id: "m" + uid++, type: m.type, cards: m.orderedCards, ownerSeat: seat,
    isBurraco: m.isBurraco, clean: m.clean, ...over,
  };
}

test("scoring: burraco pulito (200) + bonus chiusura (100) + valore carte", () => {
  const burr = [
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ];
  // valore carte: 5+5+5+5+10+10+10 = 50
  const melds = [meldOf(burr, 0)];
  const seats: SeatEndState[] = [
    { seat: 0, hand: [], pozzettoTaken: true },
    { seat: 1, hand: [card("K", "hearts")], pozzettoTaken: true },
  ];
  const res = scoreHand(seats, melds, 0);
  const s0 = res.find((r) => r.seat === 0)!;
  assert.equal(s0.ptsMelds, 50);
  assert.equal(s0.ptsBonus, 200 + 100, "burraco pulito + chiusura");
  assert.equal(s0.ptsPozzetto, 0);
  assert.equal(s0.totalDelta, 50 + 300);
  const s1 = res.find((r) => r.seat === 1)!;
  assert.equal(s1.ptsPenaltyHand, -10, "K in mano = -10");
  assert.equal(s1.totalDelta, -10);
});

test("scoring: pozzetto NON preso -> -100", () => {
  const seats: SeatEndState[] = [
    { seat: 0, hand: [], pozzettoTaken: false },
    { seat: 1, hand: [], pozzettoTaken: true },
  ];
  const res = scoreHand(seats, [], null);
  assert.equal(res.find((r) => r.seat === 0)!.ptsPozzetto, -100);
  assert.equal(res.find((r) => r.seat === 1)!.ptsPozzetto, 0);
});

test("scoring: burraco sporco vale 100", () => {
  const burr = [
    card("4", "spades"), card("5", "spades"), joker(), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ];
  const melds = [meldOf(burr, 0)];
  const seats: SeatEndState[] = [{ seat: 0, hand: [], pozzettoTaken: true }, { seat: 1, hand: [], pozzettoTaken: true }];
  const res = scoreHand(seats, melds, null);
  assert.equal(res.find((r) => r.seat === 0)!.ptsBonus, 100);
});
