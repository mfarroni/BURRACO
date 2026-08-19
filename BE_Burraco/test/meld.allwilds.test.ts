import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretMeld } from "../src/engine/meld.js";
import { GameEngine } from "../src/engine/game.js";
import { defaultGameConfig } from "../src/config.js";
import type { Card, Rank, Suit } from "../src/contract/types.js";

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
const fresh = () => new GameEngine(defaultGameConfig(), 0);

/* ─────────── BUG (report §7): gruppo di sole matte NON forma gioco ─────────── */
/* Skill riga 81: non sono ammessi giochi di 3+ pinelle né di 3+ jolly.          */

test("(a) interpretMeld([2,2,2]) -> null (tris di sole pinelle)", () => {
  const m = interpretMeld([card("2", "clubs"), card("2", "diamonds"), card("2", "spades")]);
  assert.equal(m, null, "le sole matte non formano gioco");
});

test("(a) end-to-end: meldNew con [2,2,2] -> INVALID_MELD", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const c1 = card("2", "clubs"), c2 = card("2", "diamonds"), c3 = card("2", "spades");
  g.seats[1].hand = [c1, c2, c3, card("K", "spades"), card("Q", "spades")];
  const r = g.meldNew(1, [c1.id, c2.id, c3.id]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "INVALID_MELD");
  assert.equal(g.melds.length, 0, "nessun gioco calato");
  assert.equal(g.handOf(1).length, 5, "la mano resta invariata");
});

test("(b) interpretMeld di sette 2 -> null (niente burraco, niente 200 pt)", () => {
  const seven2 = [
    card("2", "clubs"), card("2", "diamonds"), card("2", "spades"), card("2", "hearts"),
    card("2", "clubs"), card("2", "diamonds"), card("2", "spades"),
  ];
  assert.equal(interpretMeld(seven2), null, "sette matte non formano un burraco");
});

test("(b) end-to-end: meldNew con sette 2 -> INVALID_MELD (nessun burraco/punteggio)", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const seven2 = [
    card("2", "clubs"), card("2", "diamonds"), card("2", "spades"), card("2", "hearts"),
    card("2", "clubs"), card("2", "diamonds"), card("2", "spades"),
  ];
  g.seats[1].hand = [...seven2, card("K", "spades")];
  const r = g.meldNew(1, seven2.map((c) => c.id));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "INVALID_MELD");
  assert.equal(g.melds.length, 0, "nessun burraco creato");
});

test("(c) interpretMeld di soli jolly -> null", () => {
  assert.equal(interpretMeld([joker(), joker(), joker()]), null, "i soli jolly non formano gioco");
});

test("(c) interpretMeld di 2 + jolly misti (sole matte) -> null", () => {
  const m = interpretMeld([card("2", "clubs"), joker(), card("2", "spades")]);
  assert.equal(m, null, "2 e jolly insieme, senza naturali, non formano gioco");
});

test("(d) gruppo di rango normale con UNA pinella -> valido (clean=false, wildCount=1)", () => {
  const m = interpretMeld([card("5", "clubs"), card("5", "diamonds"), card("2", "spades")]);
  assert.ok(m, "gruppo con una pinella è valido");
  assert.equal(m!.type, "group");
  assert.equal(m!.clean, false);
  assert.equal(m!.wildCount, 1);
  assert.equal(m!.groupRank, "5");
  assert.equal(m!.wilds[0]!.isPinella, true);
});

test("(d bis) gruppo di rango normale con UN jolly -> valido (clean=false, wildCount=1)", () => {
  const m = interpretMeld([card("5", "clubs"), card("5", "diamonds"), joker()]);
  assert.ok(m);
  assert.equal(m!.clean, false);
  assert.equal(m!.wildCount, 1);
  assert.equal(m!.wilds[0]!.isPinella, false);
});

test("(e) gruppo di rango normale senza matte -> invariato (valido, clean, wildCount=0)", () => {
  const m = interpretMeld([card("5", "clubs"), card("5", "diamonds"), card("5", "hearts")]);
  assert.ok(m);
  assert.equal(m!.type, "group");
  assert.equal(m!.clean, true);
  assert.equal(m!.wildCount, 0);
  assert.equal(m!.groupRank, "5");
});

test("(f) NON-REGRESSIONE solveSequence: A-2-3 stesso seme -> ancora valida (2 naturale)", () => {
  const m = interpretMeld([card("A", "hearts"), card("2", "hearts"), card("3", "hearts")]);
  assert.ok(m, "la scala A-2-3 resta valida");
  assert.equal(m!.type, "sequence");
  assert.equal(m!.clean, true, "il 2 al suo posto naturale non è una matta");
  assert.equal(m!.wildCount, 0);
});
