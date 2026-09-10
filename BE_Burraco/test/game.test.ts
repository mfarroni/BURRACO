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

test("A5 house-rule ATTIVA (cap=2): 2 calate gia' fatte, pozzetto non preso -> MELD_LIMIT_REACHED", () => {
  // Il cap NON è comportamento base: va abilitato esplicitamente come house-rule.
  const g = new GameEngine({ ...defaultGameConfig(), limiteCalatePrimaDelPozzetto: 2 }, 0);
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

test("A5 DEFAULT (nessun limite): 3+ calate consecutive prima del pozzetto sono tutte accettate", () => {
  // Config di default → limiteCalatePrimaDelPozzetto = null → nessun cap.
  const g = fresh();
  assert.equal(g.config.limiteCalatePrimaDelPozzetto, null, "default: nessun limite");
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].pozzettoTaken = false;
  g.melds = [
    buildMeld([card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")], 1),
    buildMeld([card("4", "clubs"), card("4", "diamonds"), card("4", "hearts")], 1),
  ];
  // Terza calata: col vecchio cap=2 sarebbe stata rifiutata; ora deve passare.
  const a = card("5", "clubs"), b = card("5", "diamonds"), c = card("5", "hearts");
  g.seats[1].hand = [a, b, c, card("K", "spades")];
  const r = g.meldNew(1, [a.id, b.id, c.id]);
  assert.equal(r.ok, true, "nessun MELD_LIMIT_REACHED col default");
  assert.equal(g.melds.filter((m) => m.ownerSeat === 1).length, 3, "terza calata registrata");
});

test("A5 DEFAULT: svuotare la mano calando prima del pozzetto porta a prendere il pozzetto (nessun cap)", () => {
  // Scenario funzionale del bug: molte calate che azzerano la mano → pozzetto in diretta.
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[1].pozzettoTaken = false;
  // Mano di 6 carte = due tris che, calati entrambi, svuotano la mano.
  const t1 = [card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")];
  const t2 = [card("4", "clubs"), card("4", "diamonds"), card("4", "hearts")];
  g.seats[1].hand = [...t1, ...t2];
  const r1 = g.meldNew(1, t1.map((c) => c.id));
  assert.equal(r1.ok, true);
  const r2 = g.meldNew(1, t2.map((c) => c.id)); // svuota la mano
  assert.equal(r2.ok, true, "seconda calata che svuota la mano: accettata");
  assert.equal(g.pozzettoTaken(1), true, "presa del pozzetto in diretta, mai bloccata dal cap");
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

/*
 * NUOVA SEMANTICA DELLA MATTA (skill "SOSTITUZIONE DELLA MATTA", Fase 0).
 * La matta NON torna MAI in mano: nelle sequenze si sposta a cima/fondo (scelta
 * del giocatore quando entrambe legali), nei gruppi resta dentro come carta in
 * più. Il gioco cresce di uno (può scattare un burraco 6→7) e resta SPORCO.
 *
 * FASE 0b — la mossa `wild_substitute` vale per QUALSIASI matta (jolly O pinella):
 * i casi PINELLA sotto restano invariati nella semantica (inclusa l'eccezione
 * "2 al posto naturale → PULITO", riservata alla sola pinella); in coda i nuovi
 * casi JOLLY, che lasciano SEMPRE il gioco SPORCO.
 */

test("wild_substitute SEQUENZA con edge=top: la matta va in CIMA, mai in mano", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // sequenza 4S,5S,pinella(2H come 6S),7S di seat 1 → dopo il 6S la run è 4..7
  const pinella = card("2", "hearts");
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), pinella, card("7", "spades")], 1);
  assert.equal(meld.wildIndices!.length, 1, "la pinella e' matta nel gioco");
  g.melds = [meld];
  const six = card("6", "spades");
  g.seats[1].hand = [six, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, six.id, "top");
  assert.equal(r.ok, true);
  const handIds = g.handOf(1).map((c) => c.id);
  assert.ok(!handIds.includes(pinella.id), "la matta NON torna mai in mano");
  assert.ok(!handIds.includes(six.id), "6S uscito dalla mano");
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 5, "la sequenza è cresciuta di una carta");
  assert.ok(rebuilt.cards.map((c) => c.id).includes(pinella.id), "la matta resta nel gioco");
  assert.ok(rebuilt.cards.map((c) => c.id).includes(six.id), "il 6S è nel gioco");
  assert.equal(rebuilt.clean, false, "resta SPORCO (matta ancora dentro)");
  assert.equal(rebuilt.wildIndices!.length, 1);
  // In cima → la matta è l'ULTIMA carta della run.
  assert.equal(rebuilt.cards[rebuilt.cards.length - 1]!.id, pinella.id, "matta in cima");
});

test("wild_substitute SEQUENZA con edge=bottom: la matta va in FONDO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const pinella = card("2", "hearts");
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), pinella, card("7", "spades")], 1);
  g.melds = [meld];
  const six = card("6", "spades");
  g.seats[1].hand = [six, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, six.id, "bottom");
  assert.equal(r.ok, true);
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 5);
  assert.equal(rebuilt.clean, false);
  // In fondo → la matta è la PRIMA carta della run.
  assert.equal(rebuilt.cards[0]!.id, pinella.id, "matta in fondo");
});

test("wild_substitute SEQUENZA con entrambe le estremità legali e senza edge -> WILD_EDGE_REQUIRED", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const pinella = card("2", "hearts");
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), pinella, card("7", "spades")], 1);
  g.melds = [meld];
  const six = card("6", "spades");
  g.seats[1].hand = [six, card("K", "hearts")];
  const before = g.handOf(1).map((c) => c.id).slice();
  const r = g.wildSubstitute(1, meld.id, six.id); // niente edge
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "WILD_EDGE_REQUIRED");
  // Nulla è cambiato: mano intatta e gioco ancora a 4 carte con la matta.
  assert.deepEqual(g.handOf(1).map((c) => c.id), before, "mano invariata dopo il rifiuto");
  assert.equal(g.melds.find((m) => m.id === meld.id)!.cards.length, 4);
});

test("wild_substitute SEQUENZA all'Asso alto: solo FONDO legale, senza edge la usa", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // Q,K,pinella(come Asso alto) → dopo l'Asso la run è Q,K,A: solo il fondo (J) è legale.
  const pinella = card("2", "hearts");
  const meld = buildMeld([card("Q", "spades"), card("K", "spades"), pinella], 1);
  g.melds = [meld];
  const ace = card("A", "spades");
  g.seats[1].hand = [ace, card("3", "hearts")];
  const r = g.wildSubstitute(1, meld.id, ace.id); // niente edge: unica legale = fondo
  assert.equal(r.ok, true);
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 4);
  assert.equal(rebuilt.cards[0]!.id, pinella.id, "matta in fondo (unica estremità legale)");
});

test("wild_substitute SEQUENZA all'Asso alto con edge=top (illegale) -> WILD_NO_LEGAL_POSITION", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const pinella = card("2", "hearts");
  const meld = buildMeld([card("Q", "spades"), card("K", "spades"), pinella], 1);
  g.melds = [meld];
  const ace = card("A", "spades");
  g.seats[1].hand = [ace, card("3", "hearts")];
  const r = g.wildSubstitute(1, meld.id, ace.id, "top"); // cima oltre l'Asso: illegale
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "WILD_NO_LEGAL_POSITION");
  assert.equal(g.melds.find((m) => m.id === meld.id)!.cards.length, 3, "gioco invariato");
});

test("wild_substitute SEQUENZA satura ad entrambe le estremità -> WILD_NO_LEGAL_POSITION", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // Scala completa di picche A(basso)…K…A(alto) con la matta al posto del 7:
  // dopo la sostituzione la run copre 1..14 → nessuna estremità libera.
  const pinella = card("2", "hearts"); // matta per il 7 di picche
  const full = [
    card("A", "spades"), card("2", "spades"), card("3", "spades"),
    card("4", "spades"), card("5", "spades"), card("6", "spades"),
    pinella, // al posto del 7 di picche
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
    card("J", "spades"), card("Q", "spades"), card("K", "spades"),
    card("A", "spades"),
  ];
  const meld = buildMeld(full, 1);
  assert.equal(meld.wildIndices!.length, 1, "una sola matta nel gioco");
  assert.equal(meld.cards.length, 14);
  g.melds = [meld];
  const seven = card("7", "spades");
  g.seats[1].hand = [seven, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, seven.id, "top");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "WILD_NO_LEGAL_POSITION");
});

test("wild_substitute GRUPPO: la matta resta dentro, tris→poker, edge ignorato", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const pinella = card("2", "hearts"); // matta per un 9
  const meld = buildMeld([card("9", "clubs"), card("9", "diamonds"), pinella], 1);
  assert.equal(meld.type, "group");
  assert.equal(meld.wildIndices!.length, 1);
  g.melds = [meld];
  const nine = card("9", "spades");
  g.seats[1].hand = [nine, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, nine.id, "top"); // edge presente ma ignorato
  assert.equal(r.ok, true);
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.type, "group");
  assert.equal(rebuilt.cards.length, 4, "tris → poker di 4");
  assert.equal(rebuilt.clean, false, "resta sporco (matta dentro)");
  assert.equal(rebuilt.wildIndices!.length, 1);
  const handIds = g.handOf(1).map((c) => c.id);
  assert.ok(!handIds.includes(pinella.id), "la matta NON torna in mano");
  assert.ok(rebuilt.cards.map((c) => c.id).includes(pinella.id), "la matta resta nel gruppo");
  assert.ok(rebuilt.cards.map((c) => c.id).includes(nine.id), "il 9S è nel gruppo");
});

test("wild_substitute: transizione 6→7 carte fa scattare un burraco SPORCO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // Sequenza di 6 carte con la matta al posto del 6: dopo la sostituzione e lo
  // spostamento in cima diventa una scala di 7 → burraco.
  const pinella = card("2", "hearts"); // matta per il 6 di picche
  const meld = buildMeld(
    [card("4", "spades"), card("5", "spades"), pinella, card("7", "spades"),
     card("8", "spades"), card("9", "spades")],
    1,
  );
  assert.equal(meld.cards.length, 6);
  assert.equal(meld.isBurraco, false);
  g.melds = [meld];
  const six = card("6", "spades");
  g.seats[1].hand = [six, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, six.id, "top");
  assert.equal(r.ok, true);
  if (r.ok) {
    const bm = r.effects.find((e) => e.kind === "burraco_made");
    assert.ok(bm, "emesso burraco_made sulla transizione 6→7");
    if (bm && bm.kind === "burraco_made") {
      assert.equal(bm.meldId, meld.id);
      assert.equal(bm.clean, false, "burraco SPORCO (matta dentro)");
    }
  }
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 7);
  assert.equal(rebuilt.isBurraco, true);
  assert.equal(rebuilt.clean, false);
});

test("wild_substitute con carta che non è la naturale della matta -> NO_WILD_TO_SUBSTITUTE", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const pinella = card("2", "hearts");
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), pinella, card("7", "spades")], 1);
  g.melds = [meld];
  const eight = card("8", "spades"); // NON è il 6 rappresentato dalla matta
  g.seats[1].hand = [eight, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, eight.id, "top");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NO_WILD_TO_SUBSTITUTE");
  assert.equal(g.melds.find((m) => m.id === meld.id)!.cards.length, 4, "gioco invariato");
});

test("wild_substitute con carta NON in mano -> CARD_NOT_IN_HAND", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const pinella = card("2", "hearts");
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), pinella, card("7", "spades")], 1);
  g.melds = [meld];
  // Il 6S sarebbe la naturale della matta, ma NON è in mano al giocatore.
  const sixNotInHand = card("6", "spades");
  g.seats[1].hand = [card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, sixNotInHand.id, "top");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "CARD_NOT_IN_HAND");
  assert.equal(g.melds.find((m) => m.id === meld.id)!.cards.length, 4, "gioco invariato");
});

test("wild_substitute: matta (2 del seme) che finisce in posizione 2 torna naturale → gioco PULITO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // 3S, pinella(2S come 4S), 5S. Sostituendo il 4S e scegliendo il FONDO, la matta
  // 2S atterra in posizione 2 del proprio seme: torna NATURALE e la scala è pulita.
  const pinella = card("2", "spades"); // pinella dello STESSO seme della scala
  const meld = buildMeld([card("3", "spades"), pinella, card("5", "spades")], 1);
  assert.equal(meld.wildIndices!.length, 1, "il 2S è matta (rappresenta il 4S)");
  g.melds = [meld];
  const four = card("4", "spades");
  g.seats[1].hand = [four, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, four.id, "bottom");
  assert.equal(r.ok, true);
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 4, "2S,3S,4S,5S");
  assert.equal(rebuilt.clean, true, "il 2S al posto naturale rende la scala pulita");
  assert.equal(rebuilt.wildIndices!.length, 0, "nessuna matta residua");
  assert.ok(rebuilt.cards.map((c) => c.id).includes(pinella.id), "il 2S resta nel gioco");
});

// FASE 0b — copertura della clausola `wildCard.suit === seqSuit` (game.ts:406):
// SOLO un 2 dello STESSO seme della scala può tornare naturale in posizione 2. Una
// pinella di seme DIVERSO (qui 2H in una scala di picche) resta matta → SPORCO.
// Nessun test preesistente esercitava questa clausola: il caso 2-naturale usa lo
// stesso seme, il caso jolly ha isPinella=false.
test("wild_substitute: pinella di seme DIVERSO in posizione 2 resta SPORCO (non è il 2 naturale della scala)", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // 3S, pinella(2H come 4S), 5S. Sostituendo il 4S e scegliendo il FONDO, la matta
  // 2H atterra in posizione 2 di PICCHE: ma è un 2 di CUORI, non il 2 naturale della
  // scala di picche → resta matta e il gioco resta SPORCO.
  const pinella = card("2", "hearts"); // pinella di seme DIVERSO dalla scala
  const meld = buildMeld([card("3", "spades"), pinella, card("5", "spades")], 1);
  assert.equal(meld.wildIndices!.length, 1, "il 2H è matta (rappresenta il 4S)");
  g.melds = [meld];
  const four = card("4", "spades");
  g.seats[1].hand = [four, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, four.id, "bottom");
  assert.equal(r.ok, true);
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 4, "2H,3S,4S,5S");
  assert.equal(rebuilt.clean, false, "una pinella di seme diverso NON rende pulito il gioco");
  assert.equal(rebuilt.wildIndices!.length, 1, "il 2H resta matta dentro il gioco");
  assert.equal(rebuilt.cards[0]!.id, pinella.id, "il 2H è in fondo, ancora matta");
});

test("wild_substitute senza matta nel gioco -> NO_WILD_TO_SUBSTITUTE", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), card("6", "spades")], 1);
  g.melds = [meld];
  const c = card("7", "spades");
  g.seats[1].hand = [c];
  const r = g.wildSubstitute(1, meld.id, c.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NO_WILD_TO_SUBSTITUTE");
});

/*
 * FASE 0b — CASI JOLLY. La mossa vale per QUALSIASI matta: un JOLLY è sostituibile
 * come una pinella (sequenza cima/fondo, gruppo che cresce, burraco 6→7), MA a
 * differenza della pinella un jolly NON è mai una carta naturale → lascia SEMPRE
 * il gioco SPORCO, anche quando atterra su un rango che per una pinella sarebbe
 * "naturale".
 */

test("wild_substitute JOLLY in SEQUENZA con edge=top: il jolly va in CIMA e resta SPORCO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // 4S,5S,jolly(come 6S),7S: il jolly è la matta che rappresenta il 6 di picche.
  const joker = card("JOKER", null);
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), joker, card("7", "spades")], 1);
  assert.equal(meld.wildIndices!.length, 1, "il jolly è matta nel gioco");
  g.melds = [meld];
  const six = card("6", "spades");
  g.seats[1].hand = [six, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, six.id, "top");
  assert.equal(r.ok, true);
  const handIds = g.handOf(1).map((c) => c.id);
  assert.ok(!handIds.includes(joker.id), "il jolly NON torna mai in mano");
  assert.ok(!handIds.includes(six.id), "6S uscito dalla mano");
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 5, "la sequenza è cresciuta di una carta");
  assert.ok(rebuilt.cards.map((c) => c.id).includes(joker.id), "il jolly resta nel gioco");
  assert.equal(rebuilt.clean, false, "un jolly lascia SEMPRE il gioco SPORCO");
  assert.equal(rebuilt.wildIndices!.length, 1, "il jolly resta matta dentro il gioco");
  assert.equal(rebuilt.cards[rebuilt.cards.length - 1]!.id, joker.id, "jolly in cima");
});

test("wild_substitute JOLLY in SEQUENZA con edge=bottom: il jolly va in FONDO e resta SPORCO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const joker = card("JOKER", null);
  const meld = buildMeld([card("4", "spades"), card("5", "spades"), joker, card("7", "spades")], 1);
  g.melds = [meld];
  const six = card("6", "spades");
  g.seats[1].hand = [six, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, six.id, "bottom");
  assert.equal(r.ok, true);
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 5);
  assert.equal(rebuilt.clean, false, "resta sporco (jolly dentro)");
  assert.equal(rebuilt.cards[0]!.id, joker.id, "jolly in fondo");
});

test("wild_substitute JOLLY in GRUPPO: il jolly resta dentro, tris→poker, resta SPORCO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const joker = card("JOKER", null); // matta per un 9
  const meld = buildMeld([card("9", "clubs"), card("9", "diamonds"), joker], 1);
  assert.equal(meld.type, "group");
  assert.equal(meld.wildIndices!.length, 1);
  g.melds = [meld];
  const nine = card("9", "spades");
  g.seats[1].hand = [nine, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, nine.id, "top"); // edge ignorato nei gruppi
  assert.equal(r.ok, true);
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.type, "group");
  assert.equal(rebuilt.cards.length, 4, "tris → poker di 4");
  assert.equal(rebuilt.clean, false, "resta sporco (jolly dentro)");
  assert.equal(rebuilt.wildIndices!.length, 1);
  const handIds = g.handOf(1).map((c) => c.id);
  assert.ok(!handIds.includes(joker.id), "il jolly NON torna in mano");
  assert.ok(rebuilt.cards.map((c) => c.id).includes(joker.id), "il jolly resta nel gruppo");
  assert.ok(rebuilt.cards.map((c) => c.id).includes(nine.id), "il 9S è nel gruppo");
});

test("wild_substitute JOLLY che atterra in posizione 2 del seme resta SPORCO (mai naturale)", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  // 3S, jolly(come 4S), 5S. Sostituendo il 4S e scegliendo il FONDO, il jolly
  // atterra in posizione 2 di picche: dove una PINELLA (2S) diventerebbe naturale
  // (gioco PULITO), il JOLLY resta matta e il gioco resta SPORCO. Asserzione chiave.
  const joker = card("JOKER", null);
  const meld = buildMeld([card("3", "spades"), joker, card("5", "spades")], 1);
  assert.equal(meld.wildIndices!.length, 1, "il jolly è matta (rappresenta il 4S)");
  g.melds = [meld];
  const four = card("4", "spades");
  g.seats[1].hand = [four, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, four.id, "bottom");
  assert.equal(r.ok, true);
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 4, "jolly,3S,4S,5S");
  assert.equal(rebuilt.clean, false, "un JOLLY in posizione 2 NON rende pulito il gioco");
  assert.equal(rebuilt.wildIndices!.length, 1, "il jolly resta matta dentro il gioco");
  assert.equal(rebuilt.cards[0]!.id, joker.id, "il jolly è in fondo, matta");
});

test("wild_substitute JOLLY: transizione 6→7 carte fa scattare un burraco SPORCO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const joker = card("JOKER", null); // matta per il 6 di picche
  const meld = buildMeld(
    [card("4", "spades"), card("5", "spades"), joker, card("7", "spades"),
     card("8", "spades"), card("9", "spades")],
    1,
  );
  assert.equal(meld.cards.length, 6);
  assert.equal(meld.isBurraco, false);
  g.melds = [meld];
  const six = card("6", "spades");
  g.seats[1].hand = [six, card("K", "hearts")];
  const r = g.wildSubstitute(1, meld.id, six.id, "top");
  assert.equal(r.ok, true);
  if (r.ok) {
    const bm = r.effects.find((e) => e.kind === "burraco_made");
    assert.ok(bm, "emesso burraco_made sulla transizione 6→7");
    if (bm && bm.kind === "burraco_made") assert.equal(bm.clean, false, "burraco SPORCO (jolly dentro)");
  }
  const rebuilt = g.melds.find((m) => m.id === meld.id)!;
  assert.equal(rebuilt.cards.length, 7);
  assert.equal(rebuilt.isBurraco, true);
  assert.equal(rebuilt.clean, false);
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
    "yourPozzettoTaken", "canUndo", "yourSeat", "scores", "status",
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
