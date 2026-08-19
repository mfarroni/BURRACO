import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/engine/game.js";
import { interpretMeld } from "../src/engine/meld.js";
import { defaultGameConfig } from "../src/config.js";
import type { Card, Meld, Rank, Suit, Seat } from "../src/contract/types.js";

let uid = 0;
function card(rank: Rank, suit: Suit | null): Card {
  const isWild = rank === "JOKER" || rank === "2";
  return { id: `${rank}-${suit ?? "X"}-${uid++}`, suit, rank, isWild,
    wildKind: rank === "JOKER" ? "joker" : rank === "2" ? "pinella" : null };
}
function buildMeld(cards: Card[], seat: Seat, id = "m" + uid++): Meld {
  const interp = interpretMeld(cards)!;
  const wildIds = new Set(interp.wilds.map((w) => w.cardId));
  const wildIndices = interp.orderedCards.reduce<number[]>((a, c, i) => { if (wildIds.has(c.id)) a.push(i); return a; }, []);
  return { id, type: interp.type, cards: interp.orderedCards, ownerSeat: seat,
    isBurraco: interp.isBurraco, clean: interp.clean, wildIndices };
}
function fresh(): GameEngine { return new GameEngine(defaultGameConfig(), 0); }

/* ─────────────────────────── ESAURIMENTO MAZZO ─────────────────────────── */

test("mazzo vuoto ma scarto pieno -> DECK_EMPTY (deve pescare dallo scarto)", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "must_draw";
  g.drawPile = [];
  g.discard = [card("3", "clubs")];
  const r = g.draw(1, "deck");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "DECK_EMPTY");
});

test("mazzo E scarto vuoti -> fine smazzata (hand_ended, closer null)", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "must_draw";
  g.drawPile = []; g.discard = [];
  g.seats[0].pozzettoTaken = true; g.seats[1].pozzettoTaken = true;
  g.seats[0].hand = []; g.seats[1].hand = [];
  const r = g.draw(1, "deck");
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.effects.some((e) => e.kind === "hand_ended" && e.closerSeat === null));
});

/* ─────────────────────────── FINE PARTITA / VINCITORE ─────────────────────────── */

test("game_ended: chiusura che supera l'obiettivo -> vince il closer", () => {
  const g = fresh();
  g.cumulative = [0, 1900];
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].hand = [card("K", "hearts")];
  g.seats[1].pozzettoTaken = true; g.seats[0].pozzettoTaken = true;
  g.seats[0].hand = [];
  g.melds = [buildMeld([
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ], 1)];
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, true);
  if (r.ok) {
    const ge = r.effects.find((e) => e.kind === "game_ended");
    assert.ok(ge, "game_ended emesso");
    if (ge && ge.kind === "game_ended") assert.equal(ge.winnerSeat, 1);
    assert.equal(g.status, "game_ended");
  }
});

test("parita' esatta all'obiettivo con closer -> vince chi ha chiuso (Q4)", () => {
  const g = fresh();
  // seat0 arriva gia' a 2005 con delta 0 questa mano; seat1 chiude e arriva a 2005
  g.cumulative = [2005, 1655];
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[0].hand = []; g.seats[0].pozzettoTaken = true;
  g.seats[1].hand = [card("K", "hearts")]; g.seats[1].pozzettoTaken = true;
  g.melds = [buildMeld([
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ], 1)]; // +350 -> seat1 = 2005
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, true);
  if (r.ok) {
    const ge = r.effects.find((e) => e.kind === "game_ended");
    assert.ok(ge, "game_ended con parita' risolta dal closer");
    if (ge && ge.kind === "game_ended") assert.equal(ge.winnerSeat, 1);
  }
});

test("parita' all'obiettivo SENZA closer (esaurimento) -> nessun vincitore, si continua", () => {
  const g = fresh();
  g.cumulative = [2005, 2005];
  g.currentSeat = 1; g.phase = "must_draw";
  g.drawPile = []; g.discard = [];
  g.seats[0].hand = []; g.seats[1].hand = [];
  g.seats[0].pozzettoTaken = true; g.seats[1].pozzettoTaken = true;
  const r = g.draw(1, "deck");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(!r.effects.some((e) => e.kind === "game_ended"), "nessun game_ended su parita' senza closer");
    assert.equal(g.status, "hand_ended", "si gioca un'altra smazzata");
  }
});

/* ─────────────────────────── CUMULATIVO MULTI-SMAZZATA ─────────────────────────── */

test("il cumulativo somma i delta e startNextHand ridistribuisce", () => {
  const g = fresh();
  g.cumulative = [100, 50];
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].hand = [card("K", "hearts")]; g.seats[1].pozzettoTaken = true;
  g.seats[0].hand = [card("A", "clubs")]; g.seats[0].pozzettoTaken = true; // -15
  g.melds = [buildMeld([
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ], 1)];
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, true);
  // seat1: 50(carte)+200(burraco pulito)+100(chiusura)=+350 -> 400 ; seat0: -15 -> 85
  assert.equal(g.cumulative[1], 400);
  assert.equal(g.cumulative[0], 85);
  assert.equal(g.status, "hand_ended");
  const dealerPrev = g.dealerSeat;
  g.startNextHand();
  assert.equal(g.status, "playing");
  assert.equal(g.dealerSeat, (1 - dealerPrev) as Seat, "il mazziere alterna");
  assert.equal(g.handOf(0).length, 11);
  assert.equal(g.handOf(1).length, 11);
});

/* ─────────────────────────── wildIndices ─────────────────────────── */

test("wildIndices: gruppo con pinella marca solo la matta", () => {
  const m = buildMeld([card("9", "clubs"), card("9", "diamonds"), card("2", "spades")], 0);
  assert.equal(m.wildIndices!.length, 1);
  const wi = m.wildIndices![0]!;
  assert.equal(m.cards[wi]!.rank, "2", "l'indice punta alla pinella");
  assert.equal(m.clean, false);
});

test("gruppo di sole matte (tris di 2) -> INVALIDO (le sole matte non formano gioco)", () => {
  // Skill riga 81: non sono ammessi giochi di 3+ pinelle. interpretMeld -> null.
  assert.equal(interpretMeld([card("2", "clubs"), card("2", "diamonds"), card("2", "hearts")]), null);
});

test("wildIndices: sequenza 2 naturale + jolly marca solo il jolly", () => {
  const m = buildMeld([card("2", "spades"), card("3", "spades"), card("JOKER" as Rank, null), card("5", "spades")], 0);
  assert.equal(m.wildIndices!.length, 1);
  const wi = m.wildIndices![0]!;
  assert.equal(m.cards[wi]!.rank, "JOKER", "solo il jolly e' matta, non il 2 naturale");
});

/* ─────────────────────────── VARIANTE CHIUSURA INTERNAZIONALE ─────────────────────────── */

function internazionale(): GameEngine {
  return new GameEngine({ ...defaultGameConfig(), varianteChiusura: "internazionale" }, 0);
}

test("internazionale: chiusura con solo burraco SPORCO -> rifiutata", () => {
  const g = internazionale();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].hand = [card("K", "hearts")]; g.seats[1].pozzettoTaken = true;
  g.seats[0].pozzettoTaken = true; g.seats[0].hand = [];
  // burraco SPORCO (con jolly)
  g.melds = [buildMeld([
    card("4", "spades"), card("5", "spades"), card("JOKER" as Rank, null), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ], 1)];
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "CANNOT_CLOSE_NO_BURRACO");
});

test("internazionale: chiusura con burraco PULITO -> consentita", () => {
  const g = internazionale();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].hand = [card("K", "hearts")]; g.seats[1].pozzettoTaken = true;
  g.seats[0].pozzettoTaken = true; g.seats[0].hand = [];
  g.melds = [buildMeld([
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ], 1)];
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, true);
});

/* ─────────────────────────── meld_extend -> burraco ─────────────────────────── */

test("meld_extend che porta a >=7 emette burraco_made una sola volta", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].pozzettoTaken = true;
  const base = [card("4", "spades"), card("5", "spades"), card("6", "spades"),
    card("7", "spades"), card("8", "spades"), card("9", "spades")]; // 6 carte, non burraco
  const meld = buildMeld(base, 1);
  assert.equal(meld.isBurraco, false);
  g.melds = [meld];
  const ten = card("10", "spades");
  g.seats[1].hand = [ten, card("K", "hearts")];
  const r = g.meldExtend(1, meld.id, [ten.id]);
  assert.equal(r.ok, true);
  if (r.ok) {
    const bm = r.effects.filter((e) => e.kind === "burraco_made");
    assert.equal(bm.length, 1, "un solo burraco_made alla transizione <7 -> >=7");
    if (bm[0] && bm[0].kind === "burraco_made") assert.equal(bm[0].clean, true);
  }
  // ri-ampliare NON deve riemettere burraco_made
  const jack = card("J", "spades");
  g.seats[1].hand.push(jack);
  const r2 = g.meldExtend(1, meld.id, [jack.id]);
  assert.equal(r2.ok, true);
  if (r2.ok) assert.ok(!r2.effects.some((e) => e.kind === "burraco_made"), "nessun nuovo burraco_made");
});
