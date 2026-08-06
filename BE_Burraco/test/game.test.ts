import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/engine/game.js";
import { interpretMeld } from "../src/engine/meld.js";
import { redactFor } from "../src/room/redact.js";
import { defaultGameConfig } from "../src/config.js";
import type { Card, Meld, Rank, Suit, Seat } from "../src/contract/types.js";

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
  return new GameEngine(defaultGameConfig(), 0); // dealer 0 -> inizia seat 1
}

/** Costruisce un Meld reale a partire da carte, come farebbe il motore. */
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

/* ─────────────────────────── SETUP INIZIALE ─────────────────────────── */

test("distribuzione iniziale: 11+11 mano, 2 pozzetti x11, mazzo 64, scarti 0", () => {
  const g = fresh();
  assert.equal(g.handOf(0).length, 11);
  assert.equal(g.handOf(1).length, 11);
  assert.equal(g.pozzetti.length, 2);
  assert.equal(g.pozzetti[0]!.length, 11);
  assert.equal(g.pozzetti[1]!.length, 11);
  assert.equal(g.drawPile.length, 64, "108 - 22 mano - 22 pozzetti = 64");
  assert.equal(g.discard.length, 0);
  assert.equal(g.currentSeat, 1, "inizia il non-mazziere");
  assert.equal(g.phase, "must_draw");
  // conteggio totale carte conservato
  const tot = g.handOf(0).length + g.handOf(1).length +
    g.pozzetti.flat().length + g.drawPile.length + g.discard.length;
  assert.equal(tot, 108);
});

/* ─────────────────────────── AUTORITA' / GUARDIE ─────────────────────────── */

test("draw fuori turno -> NOT_YOUR_TURN", () => {
  const g = fresh(); // tocca a seat 1
  const r = g.draw(0, "deck");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOT_YOUR_TURN");
});

test("draw in fase may_meld -> WRONG_PHASE", () => {
  const g = fresh();
  assert.equal(g.draw(1, "deck").ok, true); // ora phase may_meld
  const r = g.draw(1, "deck");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "WRONG_PHASE");
});

test("discard in fase must_draw -> WRONG_PHASE", () => {
  const g = fresh();
  const anyCard = g.handOf(1)[0]!.id;
  const r = g.discardCard(1, anyCard);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "WRONG_PHASE");
});

test("draw da scarto vuoto (mazzo pieno) -> EMPTY_DISCARD", () => {
  const g = fresh();
  const r = g.draw(1, "discard");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "EMPTY_DISCARD");
});

test("mosse su partita non attiva -> GAME_NOT_ACTIVE", () => {
  const g = fresh();
  g.status = "hand_ended";
  const r = g.draw(1, "deck");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "GAME_NOT_ACTIVE");
});

/* ─────────────────────────── PESCA / SCARTO ─────────────────────────── */

test("draw da mazzo: +1 in mano, mazzo -1, fase may_meld", () => {
  const g = fresh();
  const before = g.handOf(1).length;
  const deckBefore = g.drawPile.length;
  const r = g.draw(1, "deck");
  assert.equal(r.ok, true);
  assert.equal(g.handOf(1).length, before + 1);
  assert.equal(g.drawPile.length, deckBefore - 1);
  assert.equal(g.phase, "may_meld");
});

test("draw da scarto: prende l'INTERO monte scarti", () => {
  const g = fresh();
  // prepariamo un monte scarti di 3 carte
  g.discard = [card("3", "clubs"), card("4", "clubs"), card("5", "clubs")];
  const before = g.handOf(1).length;
  const r = g.draw(1, "discard");
  assert.equal(r.ok, true);
  assert.equal(g.handOf(1).length, before + 3);
  assert.equal(g.discard.length, 0);
});

test("scarto ordinario: termina il turno, passa all'avversario", () => {
  const g = fresh();
  g.draw(1, "deck");
  const c = g.handOf(1)[0]!;
  const r = g.discardCard(1, c.id);
  assert.equal(r.ok, true);
  assert.equal(g.currentSeat, 0, "turno passa a seat 0");
  assert.equal(g.phase, "must_draw");
  assert.equal(g.discard[g.discard.length - 1]!.id, c.id);
});

test("scarto di carta non in mano -> CARD_NOT_IN_HAND", () => {
  const g = fresh();
  g.draw(1, "deck");
  const r = g.discardCard(1, "carta-inesistente");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "CARD_NOT_IN_HAND");
});

/* ─────────────────────────── ULTIMO SCARTO / CHIUSURA ─────────────────────────── */

test("ultimo scarto matta (pinella) -> ILLEGAL_LAST_DISCARD", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].hand = [card("2", "hearts")]; // unica carta = pinella
  g.seats[1].pozzettoTaken = true;
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "ILLEGAL_LAST_DISCARD");
});

test("chiusura senza burraco -> CANNOT_CLOSE_NO_BURRACO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].hand = [card("K", "hearts")];
  g.seats[1].pozzettoTaken = true;
  g.melds = []; // nessun burraco
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "CANNOT_CLOSE_NO_BURRACO");
});

test("chiusura valida con burraco -> hand_ended con punteggio", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].hand = [card("K", "hearts")];
  g.seats[1].pozzettoTaken = true;
  g.seats[0].pozzettoTaken = true;
  // burraco pulito di seat 1
  const burr = buildMeld([
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ], 1);
  g.melds = [burr];
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, true);
  if (r.ok) {
    const he = r.effects.find((e) => e.kind === "hand_ended");
    assert.ok(he, "emesso hand_ended");
    if (he && he.kind === "hand_ended") {
      assert.equal(he.closerSeat, 1);
      const s1 = he.scores.find((s) => s.seat === 1)!;
      // 50 (carte) + 200 (burraco pulito) + 100 (chiusura) = 350, mano vuota
      assert.equal(s1.ptsBonus, 300);
      assert.equal(s1.totalDelta, 350);
    }
  }
});

/* ─────────────────────────── CALATE / LIMITE ─────────────────────────── */

test("meldNew valido: -3 carte in mano, +1 meld", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const c1 = card("9", "clubs"), c2 = card("9", "diamonds"), c3 = card("9", "hearts");
  g.seats[1].hand = [c1, c2, c3, card("K", "spades"), card("Q", "spades")];
  const r = g.meldNew(1, [c1.id, c2.id, c3.id]);
  assert.equal(r.ok, true);
  assert.equal(g.melds.length, 1);
  assert.equal(g.handOf(1).length, 2);
});

test("meld limit: 2 calate gia' fatte, pozzetto non preso -> MELD_LIMIT_REACHED", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].pozzettoTaken = false;
  g.melds = [
    buildMeld([card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")], 1),
    buildMeld([card("4", "clubs"), card("4", "diamonds"), card("4", "hearts")], 1),
  ];
  const a = card("5", "clubs"), b = card("5", "diamonds"), c = card("5", "hearts");
  g.seats[1].hand = [a, b, c, card("K", "spades")];
  const r = g.meldNew(1, [a.id, b.id, c.id]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MELD_LIMIT_REACHED");
});

test("meldNew che svuota la mano con pozzetto GIA' preso -> MUST_KEEP_CARD_TO_DISCARD", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].pozzettoTaken = true;
  const c1 = card("9", "clubs"), c2 = card("9", "diamonds"), c3 = card("9", "hearts");
  g.seats[1].hand = [c1, c2, c3]; // esattamente 3, svuoterebbe
  const r = g.meldNew(1, [c1.id, c2.id, c3.id]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MUST_KEEP_CARD_TO_DISCARD");
});

test("meldNew burraco pulito -> effetto burraco_made clean=true", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].pozzettoTaken = true;
  const seq = [
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ];
  g.seats[1].hand = [...seq, card("K", "hearts")];
  const r = g.meldNew(1, seq.map((c) => c.id));
  assert.equal(r.ok, true);
  if (r.ok) {
    const bm = r.effects.find((e) => e.kind === "burraco_made");
    assert.ok(bm, "emesso burraco_made");
    if (bm && bm.kind === "burraco_made") assert.equal(bm.clean, true);
  }
});

/* ─────────────────────────── POZZETTO IN DIRETTA / DIFFERITA ─────────────────────────── */

test("pozzetto IN DIRETTA: meld che svuota la mano, pozzetto non preso -> presa immediata", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].pozzettoTaken = false;
  g.pozzetti = [Array.from({ length: 11 }, () => card("K", "hearts")), g.pozzetti[1]!];
  const c1 = card("9", "clubs"), c2 = card("9", "diamonds"), c3 = card("9", "hearts");
  g.seats[1].hand = [c1, c2, c3];
  const r = g.meldNew(1, [c1.id, c2.id, c3.id]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.effects.some((e) => e.kind === "pozzetto_taken"), "pozzetto_taken emesso");
    assert.equal(g.pozzettoTaken(1), true);
    assert.equal(g.handOf(1).length, 11, "mano riempita col pozzetto");
    assert.equal(g.currentSeat, 1, "resta il suo turno (in diretta)");
  }
});

test("pozzetto DIFFERITA: scarto che svuota la mano, pozzetto non preso -> presa + fine turno", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].pozzettoTaken = false;
  g.pozzetti = [Array.from({ length: 11 }, () => card("Q", "clubs")), g.pozzetti[1]!];
  g.seats[1].hand = [card("K", "hearts")]; // unica carta, naturale
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.effects.some((e) => e.kind === "pozzetto_taken"), "pozzetto_taken emesso");
    assert.equal(g.pozzettoTaken(1), true);
    assert.equal(g.handOf(1).length, 11, "pozzetto in mano");
    assert.equal(g.currentSeat, 0, "turno passato all'avversario (differita)");
  }
});

/* ─────────────────────────── AMPLIAMENTO / PINELLA ─────────────────────────── */

test("meld_extend su gioco inesistente -> MELD_NOT_FOUND", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const c = card("9", "clubs");
  g.seats[1].hand = [c];
  const r = g.meldExtend(1, "inesistente", [c.id]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MELD_NOT_FOUND");
});

test("meld_extend su gioco altrui -> NOT_MELD_OWNER", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const meld = buildMeld([card("9", "clubs"), card("9", "diamonds"), card("9", "hearts")], 0);
  g.melds = [meld];
  const c = card("9", "spades");
  g.seats[1].hand = [c, card("K", "hearts")];
  const r = g.meldExtend(1, meld.id, [c.id]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOT_MELD_OWNER");
});

test("pinella_substitute: recupera la pinella, la carta naturale entra nel gioco", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // sequenza 4S,5S,pinella(2H come 6S),7S di seat 1
  const pinella = card("2", "hearts");
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), pinella, card("7", "spades")], 1);
  assert.equal(meld.wildIndices!.length, 1, "la pinella e' matta nel gioco");
  g.melds = [meld];
  const six = card("6", "spades");
  g.seats[1].hand = [six, card("K", "hearts")];
  const r = g.pinellaSubstitute(1, meld.id, six.id);
  assert.equal(r.ok, true);
  // il 6S ora e' nel gioco, la pinella e' tornata in mano
  const handIds = g.handOf(1).map((c) => c.id);
  assert.ok(handIds.includes(pinella.id), "pinella recuperata in mano");
  assert.ok(!handIds.includes(six.id), "6S uscito dalla mano");
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.clean, true, "gioco ora pulito");
  assert.equal(rebuilt.wildIndices!.length, 0);
});

test("pinella_substitute senza pinella nel gioco -> NO_PINELLA_TO_SUBSTITUTE", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), card("6", "spades")], 1);
  g.melds = [meld];
  const c = card("7", "spades");
  g.seats[1].hand = [c];
  const r = g.pinellaSubstitute(1, meld.id, c.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NO_PINELLA_TO_SUBSTITUTE");
});

/* ─────────────────────────── REDACT / ANTI-LEAK ─────────────────────────── */

test("redactFor: nessun leak della mano avversaria, pozzetti o mazzo", () => {
  const g = fresh();
  g.discard = [card("3", "clubs")];
  const view0 = redactFor(g, 0);
  // vede la propria mano
  assert.equal(view0.yourHand.length, g.handOf(0).length);
  assert.deepEqual(view0.yourHand.map((c) => c.id).sort(), g.handOf(0).map((c) => c.id).sort());
  // dell'avversario solo il conteggio
  assert.equal(view0.opponentHandCount, g.handOf(1).length);
  // niente contenuto mazzo/pozzetti: solo conteggi
  assert.equal(view0.drawPileCount, g.drawPile.length);
  assert.equal(view0.pozzettiRemaining, g.pozzetti.length);
  // lo scarto espone solo la cima
  assert.equal(view0.discardTop!.id, g.discard[g.discard.length - 1]!.id);
  assert.equal(view0.discardCount, 1);
  // SEC-05: il timeout turno è ora enforced → durante un turno attivo la
  // deadline reale (epoch millis) è esposta, non più null.
  assert.equal(typeof view0.turnEndsAt, "number");
  assert.ok(view0.turnEndsAt! > Date.now());
  // whitelist: nessuna chiave inattesa che possa trasportare stato nascosto
  const allowed = new Set([
    "yourHand", "tableMelds", "opponentHandCount", "discardTop", "discardCount",
    "drawPileCount", "pozzettiRemaining", "whoseTurn", "turnEndsAt", "phase",
    "yourPozzettoTaken", "yourSeat", "scores", "status",
  ]);
  for (const k of Object.keys(view0)) assert.ok(allowed.has(k), `chiave inattesa: ${k}`);
  // serializzazione JSON completa: nessun riferimento all'oggetto interno
  const json = JSON.stringify(view0);
  for (const c of g.handOf(1)) assert.ok(!json.includes(c.id), `leak carta avversaria ${c.id}`);
  for (const c of g.pozzetti.flat()) assert.ok(!json.includes(c.id), `leak carta pozzetto ${c.id}`);
});

test("redactFor: la vista dei due seat e' coerente e speculare", () => {
  const g = fresh();
  const v0 = redactFor(g, 0);
  const v1 = redactFor(g, 1);
  assert.equal(v0.opponentHandCount, v1.yourHand.length);
  assert.equal(v1.opponentHandCount, v0.yourHand.length);
  assert.equal(v0.whoseTurn, v1.whoseTurn);
  assert.equal(v0.drawPileCount, v1.drawPileCount);
  assert.equal(v0.yourSeat, 0);
  assert.equal(v1.yourSeat, 1);
});
