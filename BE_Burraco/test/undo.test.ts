import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/engine/game.js";
import { interpretMeld } from "../src/engine/meld.js";
import { redactFor } from "../src/room/redact.js";
import { defaultGameConfig } from "../src/config.js";
import { parseClientMessage } from "../src/ws/validate.js";
import type { Card, Meld, Rank, Suit, Seat } from "../src/contract/types.js";

/**
 * FEATURE "Annulla ultima mossa del turno" (undo). Verifica il GIORNALE A
 * SNAPSHOT del motore: undo di meldNew/meldExtend/pinellaSubstitute ripristina lo
 * STATO ESATTO, il confine col pozzetto, l'anti-stallo (turnEndsAt), il guard di
 * turno/fase e i reset del giornale. Regole di gioco INVARIATE.
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
  return new GameEngine(defaultGameConfig(), 0); // dealer 0 -> inizia seat 1
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

/* ─────────────────────── undo meldNew: stato esatto ─────────────────────── */

test("undo di meldNew: ripristina mano e melds esatti; poi NOTHING_TO_UNDO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const c1 = card("5", "spades"), c2 = card("6", "spades"), c3 = card("7", "spades");
  const keep1 = card("K", "hearts"), keep2 = card("Q", "hearts");
  g.seats[1].hand = [c1, c2, c3, keep1, keep2];
  const handBefore = ids(g.handOf(1));

  assert.equal(g.canUndo(1), false, "nessuna calata: niente da annullare");
  const r = g.meldNew(1, [c1.id, c2.id, c3.id]);
  assert.equal(r.ok, true);
  assert.equal(g.handOf(1).length, 2);
  assert.equal(g.melds.length, 1);
  assert.equal(g.canUndo(1), true, "una calata annullabile impilata");

  const u = g.undoLast(1);
  assert.equal(u.ok, true);
  if (u.ok) assert.deepEqual(u.effects, [], "nessun turn_changed sull'undo");
  assert.deepEqual(ids(g.handOf(1)), handBefore, "mano ripristinata IDENTICA (ordine incluso)");
  assert.equal(g.melds.length, 0, "meld rimossa");
  assert.equal(g.canUndo(1), false);

  const again = g.undoLast(1);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.code, "NOTHING_TO_UNDO");
});

/* ────────────────── undo meldExtend: ripristina l'oggetto meld ────────────── */

test("undo di meldExtend: meld torna all'oggetto precedente (cards e isBurraco)", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  // Sequenza 2..7 di cuori (6 carte, NON burraco), estesa con l'8 -> 7 carte (burraco).
  const base = [
    card("2", "hearts"), card("3", "hearts"), card("4", "hearts"),
    card("5", "hearts"), card("6", "hearts"), card("7", "hearts"),
  ];
  const meld = buildMeld(base, 1, "M1");
  assert.equal(meld.isBurraco, false, "6 carte: non è ancora burraco");
  g.melds = [meld];
  const ext = card("8", "hearts"), keep = card("K", "spades");
  g.seats[1].hand = [ext, keep];
  const baseIds = ids(meld.cards);

  const r = g.meldExtend(1, "M1", [ext.id]);
  assert.equal(r.ok, true);
  const grown = g.melds.find((m) => m.id === "M1")!;
  assert.equal(grown.cards.length, 7);
  assert.equal(grown.isBurraco, true, "7 carte: ora è burraco");

  const u = g.undoLast(1);
  assert.equal(u.ok, true);
  const restored = g.melds.find((m) => m.id === "M1")!;
  assert.strictEqual(restored, meld, "ripristinato l'oggetto Meld ORIGINALE (per riferimento)");
  assert.equal(restored.cards.length, 6);
  assert.equal(restored.isBurraco, false);
  assert.deepEqual(ids(restored.cards), baseIds);
  assert.equal(g.handOf(1).length, 2, "carta estesa tornata in mano");
  assert.ok(ids(g.handOf(1)).includes(ext.id));
});

/* ───────────── undo pinellaSubstitute: pinella nel gioco, carta in mano ─────── */

test("undo di pinellaSubstitute: torna la pinella nel gioco e la carta in mano", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const pinella = card("2", "hearts");
  const meld = buildMeld(
    [card("4", "spades"), card("5", "spades"), pinella, card("7", "spades")], 1, "P1",
  );
  assert.equal(meld.wildIndices!.length, 1, "la pinella è matta nel gioco");
  g.melds = [meld];
  const six = card("6", "spades"), keep = card("K", "hearts");
  g.seats[1].hand = [six, keep];
  const handBefore = ids(g.handOf(1));

  const r = g.pinellaSubstitute(1, "P1", six.id);
  assert.equal(r.ok, true);
  assert.ok(ids(g.handOf(1)).includes(pinella.id), "pinella recuperata in mano");
  assert.ok(!ids(g.handOf(1)).includes(six.id));

  const u = g.undoLast(1);
  assert.equal(u.ok, true);
  assert.deepEqual(ids(g.handOf(1)), handBefore, "mano ripristinata IDENTICA");
  const restored = g.melds.find((m) => m.id === "P1")!;
  assert.strictEqual(restored, meld, "meld ripristinato per riferimento");
  assert.equal(restored.wildIndices!.length, 1, "pinella di nuovo matta nel gioco");
  assert.ok(ids(restored.cards).includes(pinella.id));
});

/* ─────────────── undo ripetuto a ritroso fino al post-pesca ──────────────── */

test("undo ripetuto: torna a ritroso fino allo stato post-pesca, poi NOTHING_TO_UNDO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const t1 = [card("9", "clubs"), card("9", "hearts"), card("9", "spades")];
  const t2 = [card("J", "clubs"), card("J", "hearts"), card("J", "spades")];
  const keep = card("K", "diamonds");
  g.seats[1].hand = [...t1, ...t2, keep];
  const handPostDraw = ids(g.handOf(1));

  assert.equal(g.meldNew(1, ids(t1)).ok, true);
  assert.equal(g.meldNew(1, ids(t2)).ok, true);
  assert.equal(g.melds.length, 2);
  assert.equal(g.handOf(1).length, 1);

  assert.equal(g.undoLast(1).ok, true); // annulla t2
  assert.equal(g.melds.length, 1);
  assert.equal(g.undoLast(1).ok, true); // annulla t1
  assert.equal(g.melds.length, 0);
  assert.deepEqual(ids(g.handOf(1)), handPostDraw, "tornati esattamente al post-pesca");

  const end = g.undoLast(1);
  assert.equal(end.ok, false);
  if (!end.ok) assert.equal(end.code, "NOTHING_TO_UNDO");
});

/* ─────────────────── NOTHING_TO_UNDO a inizio may_meld ───────────────────── */

test("undo a inizio may_meld (nessuna calata) -> NOTHING_TO_UNDO", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld";
  const r = g.undoLast(1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOTHING_TO_UNDO");
});

test("il giornale riparte VUOTO dopo la pesca (draw ok azzera lo stack)", () => {
  const g = fresh(); // tocca a seat 1, fase must_draw
  assert.equal(g.draw(1, "deck").ok, true);
  assert.equal(g.phase, "may_meld");
  const r = g.undoLast(1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOTHING_TO_UNDO", "subito dopo la pesca non c'è nulla da annullare");
});

/* ───────────── undo impossibile dopo lo scarto / fuori turno ─────────────── */

test("undo dopo lo scarto (fase non più may_meld) -> WRONG_PHASE", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  g.seats[1].hand = [card("K", "hearts"), card("Q", "hearts")];
  // Una calata annullabile, poi scarto ordinario che chiude il turno.
  const meld = buildMeld([card("5", "clubs"), card("6", "clubs"), card("7", "clubs")], 1, "M1");
  g.melds = [meld];
  // estende con niente: usiamo direttamente uno scarto ordinario per chiudere.
  const discardCard = g.handOf(1)[0]!;
  assert.equal(g.discardCard(1, discardCard.id).ok, true);
  assert.equal(g.currentSeat, 0, "turno passato all'avversario");
  // seat 1 non è più di mano -> NOT_YOUR_TURN; e comunque la fase è must_draw.
  const r = g.undoLast(1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.code === "NOT_YOUR_TURN" || r.code === "WRONG_PHASE");
});

test("l'avversario non può annullare (guardTurn) -> NOT_YOUR_TURN", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const t = [card("9", "clubs"), card("9", "hearts"), card("9", "spades")];
  g.seats[1].hand = [...t, card("K", "diamonds")];
  assert.equal(g.meldNew(1, ids(t)).ok, true);
  const r = g.undoLast(0); // seat 0 non è di mano
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOT_YOUR_TURN");
  // la calata del legittimo resta intatta
  assert.equal(g.melds.length, 1);
  assert.equal(g.canUndo(1), true);
});

/* ─────────────── sblocco della "trappola a 1 carta" ──────────────────────── */

test("undo sblocca la trappola a 1 carta: undo dell'aggancio + scarto legale chiude il turno", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const meld = buildMeld(
    [card("10", "hearts"), card("J", "hearts"), card("Q", "hearts")], 1, "M1",
  );
  g.melds = [meld];
  const kh = card("K", "hearts"), pin = card("2", "spades");
  g.seats[1].hand = [kh, pin];

  // Aggancio del K: resta in mano SOLO la pinella (matta) -> scarto finale illegale.
  assert.equal(g.meldExtend(1, "M1", [kh.id]).ok, true);
  assert.equal(g.handOf(1).length, 1);
  const trap = g.discardCard(1, pin.id);
  assert.equal(trap.ok, false);
  if (!trap.ok) assert.equal(trap.code, "ILLEGAL_LAST_DISCARD");

  // Undo dell'aggancio -> 2 carte -> lo scarto del K (naturale) chiude il turno.
  assert.equal(g.undoLast(1).ok, true);
  assert.equal(g.handOf(1).length, 2);
  const ok = g.discardCard(1, kh.id);
  assert.equal(ok.ok, true);
  assert.equal(g.currentSeat, 0, "turno concluso e passato all'avversario");
  assert.equal(g.phase, "must_draw");
});

/* ─────────────────── confine col pozzetto (presa in diretta) ──────────────── */

test("confine pozzetto: dopo la presa in diretta l'undo NON attraversa (NOTHING_TO_UNDO); poi ricostruisce", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = false;
  // Pozzetto deterministico: 3 carte in scala + 1 tenuta.
  const p1 = card("4", "clubs"), p2 = card("5", "clubs"), p3 = card("6", "clubs"), p4 = card("K", "diamonds");
  g.pozzetti = [[p1, p2, p3, p4], []];
  // Mano che si svuota con una calata -> pozzetto IN DIRETTA.
  const t = [card("9", "clubs"), card("9", "hearts"), card("9", "spades")];
  g.seats[1].hand = [...t];

  const r1 = g.meldNew(1, ids(t));
  assert.equal(r1.ok, true);
  if (r1.ok) assert.ok(r1.effects.some((e) => e.kind === "pozzetto_taken"), "pozzetto preso in diretta");
  assert.equal(g.canUndo(1), false, "il confine ha azzerato il giornale");
  const across = g.undoLast(1);
  assert.equal(across.ok, false);
  if (!across.ok) assert.equal(across.code, "NOTHING_TO_UNDO", "l'undo non attraversa la presa");

  // La mano è ora il pozzetto (4 carte). Una nuova calata ricostruisce lo stack.
  assert.deepEqual(ids(g.handOf(1)).sort(), ids([p1, p2, p3, p4]).sort());
  const r2 = g.meldNew(1, [p1.id, p2.id, p3.id]);
  assert.equal(r2.ok, true);
  assert.equal(g.canUndo(1), true, "nuova calata post-pozzetto è annullabile");
  assert.equal(g.melds.length, 2);

  // Undo torna al post-pozzetto, non oltre.
  assert.equal(g.undoLast(1).ok, true);
  assert.equal(g.melds.length, 1, "resta solo la calata che ha preso il pozzetto");
  assert.deepEqual(ids(g.handOf(1)).sort(), ids([p1, p2, p3, p4]).sort());
  const end = g.undoLast(1);
  assert.equal(end.ok, false);
  if (!end.ok) assert.equal(end.code, "NOTHING_TO_UNDO");
});

/* ─────────────────── anti-stallo: turnEndsAt invariato ────────────────────── */

test("anti-stallo: l'undo NON riarma il turn clock (turnEndsAt invariato)", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const t = [card("9", "clubs"), card("9", "hearts"), card("9", "spades")];
  g.seats[1].hand = [...t, card("K", "diamonds")];
  assert.equal(g.meldNew(1, ids(t)).ok, true);
  const deadlineBefore = g.turnEndsAt;
  assert.equal(g.undoLast(1).ok, true);
  assert.equal(g.turnEndsAt, deadlineBefore, "deadline del turno immutata");
});

/* ─────────────────── canUndo nello stato redatto (anti-leak) ──────────────── */

test("redact: canUndo true solo per il seat di mano con calata annullabile; nessun leak", () => {
  const g = fresh();
  g.currentSeat = 1; g.phase = "may_meld"; g.seats[1].pozzettoTaken = true;
  const t = [card("9", "clubs"), card("9", "hearts"), card("9", "spades")];
  g.seats[1].hand = [...t, card("K", "diamonds")];
  assert.equal(g.meldNew(1, ids(t)).ok, true);

  const view1 = redactFor(g, 1);
  const view0 = redactFor(g, 0);
  assert.equal(view1.canUndo, true, "il seat di mano con calata annullabile");
  assert.equal(view0.canUndo, false, "l'avversario non annulla mai");

  // anti-leak invariato: nel JSON di view0 nessuna carta della mano di seat 1.
  const json0 = JSON.stringify(view0);
  for (const c of g.handOf(1)) assert.ok(!json0.includes(c.id), `leak carta avversaria ${c.id}`);
  for (const c of g.pozzetti.flat()) assert.ok(!json0.includes(c.id), `leak carta pozzetto ${c.id}`);
});

/* ─────────────────── contratto: validazione zod di undo_last ──────────────── */

test("validate: undo_last accettato con/ senza clientMoveId; scarto chiavi estranee", () => {
  const a = parseClientMessage({ type: "undo_last" });
  assert.equal(a.ok, true);
  const b = parseClientMessage({ type: "undo_last", clientMoveId: "mv-1" });
  assert.equal(b.ok, true);
  if (b.ok) assert.equal(b.msg.type, "undo_last");
  // clientMoveId troppo lungo -> malformato
  const c = parseClientMessage({ type: "undo_last", clientMoveId: "x".repeat(65) });
  assert.equal(c.ok, false);
});
