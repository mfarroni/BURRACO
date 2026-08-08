import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/engine/game.js";
import { interpretMeld } from "../src/engine/meld.js";
import { redactFor } from "../src/room/redact.js";
import { defaultGameConfig } from "../src/config.js";
import type { Card, Meld, Rank, Suit, Seat } from "../src/contract/types.js";

/**
 * COPERTURA SUPPLEMENTARE (agente_test) per la feature UNDO: chiude lacune non
 * coperte dai test esistenti richieste esplicitamente dalla DoD:
 *  - l'avversario NON è toccato dal ripristino (verifica via redactFor);
 *  - percorso "redo": undo poi una calata DIVERSA ricostruisce lo stack;
 *  - confine pozzetto DIFFERITA (scarto finale che prende pozzetto e passa turno);
 *  - GAME_NOT_ACTIVE su undo a partita/mano conclusa;
 *  - flag clean/isBurraco ripristinati esattamente su extend che sporca un burraco.
 * NON cambia alcuna regola: usa solo l'API pubblica del motore e il redact.
 */

let uid = 0;
function card(rank: Rank, suit: Suit | null): Card {
  const isWild = rank === "JOKER" || rank === "2";
  return {
    id: `${rank}-${suit ?? "X"}-${uid++}`,
    suit, rank, isWild,
    wildKind: rank === "JOKER" ? "joker" : rank === "2" ? "pinella" : null,
  };
}
function fresh(): GameEngine {
  return new GameEngine(defaultGameConfig(), 0);
}
function buildMeld(cards: Card[], seat: Seat, id = "m" + uid++): Meld {
  const interp = interpretMeld(cards)!;
  const wildIds = new Set(interp.wilds.map((w) => w.cardId));
  const wildIndices = interp.orderedCards.reduce<number[]>((a, c, i) => {
    if (wildIds.has(c.id)) a.push(i);
    return a;
  }, []);
  return {
    id, type: interp.type, cards: interp.orderedCards, ownerSeat: seat,
    isBurraco: interp.isBurraco, clean: interp.clean, wildIndices,
  };
}
const ids = (cs: Card[]) => cs.map((c) => c.id);

/* ── DoD#1: l'avversario NON è toccato dall'undo (vista redatta invariata) ── */

test("undo: la vista redatta dell'avversario è IDENTICA prima della calata e dopo l'undo", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  // Avversario (seat 0) con mano e pozzetto deterministici da NON toccare.
  g.seats[0].hand = [card("A", "spades"), card("A", "hearts"), card("3", "clubs")];
  g.pozzetti = [];
  const t = [card("9", "clubs"), card("9", "hearts"), card("9", "spades")];
  g.seats[1].hand = [...t, card("K", "diamonds")];

  const oppBefore = JSON.stringify(redactFor(g, 0));
  assert.equal(g.meldNew(1, ids(t)).ok, true);
  assert.equal(g.undoLast(1).ok, true);
  const oppAfter = JSON.stringify(redactFor(g, 0));
  assert.equal(oppAfter, oppBefore, "la vista dell'avversario è identica prima/dopo undo");
});

/* ── DoD#1: pozzettoTaken=true ripristinato; hand del giocatore esatta ── */

test("undo: pozzettoTaken conservato e mano ESATTA dopo undo di meldNew parziale", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const t = [card("4", "hearts"), card("5", "hearts"), card("6", "hearts")];
  const keep = [card("K", "spades"), card("Q", "clubs")];
  g.seats[1].hand = [...t, ...keep];
  const before = ids(g.handOf(1));
  assert.equal(g.meldNew(1, ids(t)).ok, true);
  assert.equal(g.undoLast(1).ok, true);
  assert.equal(g.pozzettoTaken(1), true, "flag pozzettoTaken invariato");
  assert.deepEqual(ids(g.handOf(1)), before, "mano ripristinata identica (ordine incluso)");
});

/* ── redo: dopo un undo, una calata DIVERSA riparte e ricostruisce lo stack ── */

test("redo: undo di una calata, poi una calata diversa, poi undo torna al post-pesca", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const tris = [card("7", "clubs"), card("7", "hearts"), card("7", "spades")];
  const scala = [card("4", "diamonds"), card("5", "diamonds"), card("6", "diamonds")];
  const keep = card("K", "hearts");
  g.seats[1].hand = [...tris, ...scala, keep];
  const postDraw = ids(g.handOf(1));

  assert.equal(g.meldNew(1, ids(tris)).ok, true);
  assert.equal(g.undoLast(1).ok, true, "annullo il tris");
  assert.deepEqual(ids(g.handOf(1)), postDraw);
  assert.equal(g.canUndo(1), false, "stack vuoto dopo l'undo");

  // Ora calo la scala (mossa diversa): lo stack si ricostruisce.
  assert.equal(g.meldNew(1, ids(scala)).ok, true);
  assert.equal(g.melds.length, 1);
  assert.equal(g.canUndo(1), true);
  assert.equal(g.undoLast(1).ok, true, "annullo la scala");
  assert.deepEqual(ids(g.handOf(1)), postDraw, "torno esattamente al post-pesca");
  assert.equal(g.melds.length, 0);
});

/* ── confine pozzetto DIFFERITA: lo scarto finale prende pozzetto e passa turno ── */

test("confine pozzetto DIFFERITA: dopo lo scarto finale il turno passa e l'undo è NOT_YOUR_TURN", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = false;
  g.pozzetti = [[card("A", "clubs"), card("A", "diamonds")], []]; // pozzetto del seat 1
  // Una calata annullabile prima dello scarto finale.
  const meld = buildMeld([card("5", "clubs"), card("6", "clubs"), card("7", "clubs")], 1, "M1");
  g.melds = [meld];
  // Mano: 2 carte; scarto una naturale -> resta 0 -> pozzetto DIFFERITA + fine turno.
  const naturale = card("9", "hearts");
  g.seats[1].hand = [naturale];
  const r = g.discardCard(1, naturale.id);
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.effects.some((e) => e.kind === "pozzetto_taken"), "pozzetto differito preso");
  assert.equal(g.pozzettoTaken(1), true);
  assert.equal(g.currentSeat, 0, "turno passato all'avversario");
  // L'undo dopo la differita non è possibile: non è più il turno di seat 1.
  const u = g.undoLast(1);
  assert.equal(u.ok, false);
  if (!u.ok) assert.equal(u.code, "NOT_YOUR_TURN");
});

/* ── GAME_NOT_ACTIVE: undo a mano/partita conclusa ── */

test("undo a mano conclusa (status != playing) -> GAME_NOT_ACTIVE", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.status = "hand_ended";
  const u = g.undoLast(1);
  assert.equal(u.ok, false);
  if (!u.ok) assert.equal(u.code, "GAME_NOT_ACTIVE");
});

/* ── flag clean/isBurraco ripristinati su extend che AGGIUNGE una matta ── */

test("undo: un extend che introduce una matta -> undo ripristina clean/isBurraco esatti", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  // Burraco PULITO di 7 carte (2..8 di picche, nessuna matta).
  const base = [
    card("2", "spades"), card("3", "spades"), card("4", "spades"), card("5", "spades"),
    card("6", "spades"), card("7", "spades"), card("8", "spades"),
  ];
  const meld = buildMeld(base, 1, "B1");
  assert.equal(meld.isBurraco, true);
  assert.equal(meld.clean, true, "burraco pulito di partenza");
  g.melds = [meld];
  // Estendo con un JOLLY come 9 (matta) -> resta burraco ma diventa SPORCO.
  const joker = card("JOKER", null);
  g.seats[1].hand = [joker, card("K", "hearts")];

  const r = g.meldExtend(1, "B1", [joker.id]);
  assert.equal(r.ok, true);
  const grown = g.melds.find((m) => m.id === "B1")!;
  assert.equal(grown.clean, false, "ora è sporco (matta aggiunta)");

  assert.equal(g.undoLast(1).ok, true);
  const restored = g.melds.find((m) => m.id === "B1")!;
  assert.strictEqual(restored, meld, "ripristinato l'oggetto Meld originale");
  assert.equal(restored.clean, true, "clean ripristinato a true");
  assert.equal(restored.isBurraco, true);
  assert.equal(restored.cards.length, 7);
  assert.ok(ids(g.handOf(1)).includes(joker.id), "jolly tornato in mano");
});
