import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/engine/game.js";
import { interpretMeld } from "../src/engine/meld.js";
import { scoreHand, type SeatEndState } from "../src/engine/scoring.js";
import { teamOfSeat } from "../src/engine/teams.js";
import { defaultGameConfig } from "../src/config.js";
import type { Card, GameConfig, Meld, Rank, Seat, Suit } from "../src/contract/types.js";

/**
 * MODALITA' A COPPIE (2v2) — TAPPA 2: il MOTORE consapevole delle coppie.
 * Autorità di dominio: skill "MODALITA' A COPPIE" + `docs/specs/fase-2-analisi-2v2.md` §5.
 *
 * Le partite a 4 posti coppie sono costruite QUI, direttamente via config
 * (`numeroGiocatori:4, modalita:"coppie"`), esattamente come la lobby NON le crea
 * ancora (quello è Tappa 3). Coppie: A = posti 0+2 (squadra 0), B = posti 1+3
 * (squadra 1). Turno orario `(seat+1)%4`, mazziere `(dealer+1)%4`.
 *
 * NB: l'1v1 resta invariato — i suoi 327 test sono la rete di non-regressione; qui
 * si AGGIUNGONO solo scenari a 4 posti.
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

function coppieConfig(): GameConfig {
  return { ...defaultGameConfig(), numeroGiocatori: 4, modalita: "coppie" };
}

function coppie(dealer: Seat = 0): GameEngine {
  return new GameEngine(coppieConfig(), dealer);
}

/** Costruisce un Meld reale come il motore, includendo `ownerTeam` (P4). */
function buildMeld(cards: Card[], seat: Seat, config: GameConfig, id = "m" + uid++): Meld {
  const interp = interpretMeld(cards)!;
  const wildIds = new Set(interp.wilds.map((w) => w.cardId));
  const wildIndices = interp.orderedCards.reduce<number[]>((a, c, i) => {
    if (wildIds.has(c.id)) a.push(i);
    return a;
  }, []);
  return {
    id,
    type: interp.type,
    cards: interp.orderedCards,
    ownerSeat: seat,
    ownerTeam: teamOfSeat(seat, config),
    isBurraco: interp.isBurraco,
    clean: interp.clean,
    wildIndices,
  };
}

/** Burraco pulito di picche (4..10): valore carte 5+5+5+5+10+10+10 = 50. */
function burracoPulitoSpades(): Card[] {
  return [
    card("4", "spades"), card("5", "spades"), card("6", "spades"), card("7", "spades"),
    card("8", "spades"), card("9", "spades"), card("10", "spades"),
  ];
}

/* ─────────────────────────── SETUP / POSTI / TURNI ─────────────────────────── */

test("coppie: distribuzione a 4 posti (11x4 mano, 2 pozzetti x11, mazzo 42)", () => {
  const g = coppie(0);
  for (const s of [0, 1, 2, 3] as Seat[]) assert.equal(g.handOf(s).length, 11);
  assert.equal(g.pozzetti.length, 2);
  assert.equal(g.pozzetti[0]!.length, 11);
  assert.equal(g.pozzetti[1]!.length, 11);
  assert.equal(g.drawPile.length, 42, "108 - 44 mano - 22 pozzetti = 42");
  assert.equal(g.currentSeat, 1, "apre (dealer+1)%4 = 1");
  const tot =
    g.handOf(0).length + g.handOf(1).length + g.handOf(2).length + g.handOf(3).length +
    g.pozzetti.flat().length + g.drawPile.length + g.discard.length;
  assert.equal(tot, 108);
});

test("coppie: le squadre sono i posti opposti 0+2 / 1+3", () => {
  const cfg = coppieConfig();
  assert.equal(teamOfSeat(0, cfg), 0);
  assert.equal(teamOfSeat(2, cfg), 0, "il compagno di 0 è 2");
  assert.equal(teamOfSeat(1, cfg), 1);
  assert.equal(teamOfSeat(3, cfg), 1, "il compagno di 1 è 3");
});

test("coppie: rotazione ORARIA dei turni 1→2→3→0→1", () => {
  const g = coppie(0);
  const playTurn = (seat: Seat) => {
    assert.equal(g.currentSeat, seat, `tocca al posto ${seat}`);
    assert.equal(g.draw(seat, "deck").ok, true);
    const c = g.handOf(seat)[0]!.id;
    assert.equal(g.discardCard(seat, c).ok, true);
  };
  playTurn(1);
  playTurn(2);
  playTurn(3);
  playTurn(0);
  assert.equal(g.currentSeat, 1, "dopo il giro completo torna al posto 1");
});

test("coppie: il mazziere ruota di un posto (dealer+1)%4 alla smazzata successiva", () => {
  const g = coppie(0);
  // Chiusura di coppia controllata per far scattare un hand_ended (non game_ended).
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[0].pozzettoTaken = true; // team 0 ha preso il proprio pozzetto
  g.seats[2].pozzettoTaken = false;
  g.seats[2].hand = [card("K", "hearts")];
  g.melds = [buildMeld(burracoPulitoSpades(), 0, g.config)]; // burraco del compagno (seat 0)
  const r = g.discardCard(2, g.seats[2].hand[0]!.id);
  assert.equal(r.ok, true);
  assert.equal(g.status, "hand_ended");
  g.startNextHand();
  assert.equal(g.status, "playing");
  assert.equal(g.dealerSeat, 1, "mazziere ruota da 0 a 1");
  assert.equal(g.currentSeat, 2, "apre (dealer+1)%4 = 2");
  for (const s of [0, 1, 2, 3] as Seat[]) assert.equal(g.handOf(s).length, 11);
});

/* ─────────────────────────── CHIUSURA DI COPPIA ─────────────────────────── */

test("coppie: il burraco del COMPAGNO abilita la chiusura", () => {
  const g = coppie(0);
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[0].pozzettoTaken = true; // pozzetto preso dal compagno (basta uno per coppia)
  g.seats[2].pozzettoTaken = false;
  g.seats[2].hand = [card("K", "hearts")];
  // Burraco calato dal COMPAGNO (posto 0, squadra 0). Nessun burraco calato da 2.
  g.melds = [buildMeld(burracoPulitoSpades(), 0, g.config)];
  const r = g.discardCard(2, g.seats[2].hand[0]!.id);
  assert.equal(r.ok, true, "il posto 2 chiude grazie al burraco del compagno");
  if (r.ok) {
    const he = r.effects.find((e) => e.kind === "hand_ended");
    assert.ok(he, "hand_ended emesso");
    if (he && he.kind === "hand_ended") assert.equal(he.closerSeat, 2);
  }
});

test("coppie: chiusura NEGATA senza burraco di coppia -> CANNOT_CLOSE_NO_BURRACO", () => {
  const g = coppie(0);
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[0].pozzettoTaken = true;
  g.seats[2].pozzettoTaken = false;
  g.seats[2].hand = [card("K", "hearts")];
  g.melds = []; // la squadra 0 non ha alcun burraco
  const r = g.discardCard(2, g.seats[2].hand[0]!.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "CANNOT_CLOSE_NO_BURRACO");
});

test("coppie: un burraco della COPPIA AVVERSARIA non abilita la chiusura", () => {
  const g = coppie(0);
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[0].pozzettoTaken = true;
  g.seats[2].pozzettoTaken = false;
  g.seats[2].hand = [card("K", "hearts")];
  // Burraco calato dalla squadra 1 (posto 1): NON conta per la squadra 0.
  g.melds = [buildMeld(burracoPulitoSpades(), 1, g.config)];
  const r = g.discardCard(2, g.seats[2].hand[0]!.id);
  assert.equal(r.ok, false, "il burraco avversario non abilita la chiusura della squadra 0");
  if (!r.ok) assert.equal(r.code, "CANNOT_CLOSE_NO_BURRACO");
});

/* ─────────────────────────── GIOCHI DI COPPIA (proprietà per squadra) ─────────────────────────── */

test("coppie: si può ampliare il gioco del COMPAGNO (proprietà di squadra, P4)", () => {
  const g = coppie(0);
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[2].pozzettoTaken = true;
  // Gioco calato dal COMPAGNO (posto 0, squadra 0).
  const tris = [card("9", "clubs"), card("9", "diamonds"), card("9", "hearts")];
  g.melds = [buildMeld(tris, 0, g.config)];
  const nine = card("9", "spades");
  g.seats[2].hand = [nine, card("K", "hearts")];
  const r = g.meldExtend(2, g.melds[0]!.id, [nine.id]);
  assert.equal(r.ok, true, "il compagno può agganciare carte al gioco della coppia");
  assert.equal(g.melds[0]!.cards.length, 4);
});

test("coppie: NON si può ampliare il gioco della coppia AVVERSARIA -> NOT_MELD_OWNER", () => {
  const g = coppie(0);
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[2].pozzettoTaken = true;
  // Gioco calato dalla squadra 1 (posto 1): la squadra 0 non può toccarlo.
  const tris = [card("9", "clubs"), card("9", "diamonds"), card("9", "hearts")];
  g.melds = [buildMeld(tris, 1, g.config)];
  const nine = card("9", "spades");
  g.seats[2].hand = [nine, card("K", "hearts")];
  const r = g.meldExtend(2, g.melds[0]!.id, [nine.id]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "NOT_MELD_OWNER");
});

/* ─────────────────────────── POZZETTO RISERVATO PER COPPIA ─────────────────────────── */

test("coppie: la coppia avversaria prende il PROPRIO pozzetto (uno per coppia)", () => {
  const g = coppie(0);
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[0].pozzettoTaken = true; // squadra 0 ne ha già preso uno
  g.pozzetti = [Array.from({ length: 11 }, () => card("Q", "clubs"))]; // resta il pozzetto della squadra 1
  g.seats[1].pozzettoTaken = false;
  const t = [card("9", "clubs"), card("9", "diamonds"), card("9", "hearts")];
  g.seats[1].hand = [...t];
  const r = g.meldNew(1, t.map((c) => c.id)); // svuota la mano
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.effects.some((e) => e.kind === "pozzetto_taken"), "la squadra 1 prende il suo pozzetto");
    assert.equal(g.pozzettoTaken(1), true);
    assert.equal(g.pozzetti.length, 0, "consumato l'ultimo pozzetto");
  }
});

test("coppie: SECONDA presa negata alla STESSA coppia (compagno che svuota la mano)", () => {
  const g = coppie(0);
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[0].pozzettoTaken = true; // la squadra 0 (posti 0,2) ha già il suo pozzetto
  g.seats[2].pozzettoTaken = false;
  g.pozzetti = [Array.from({ length: 11 }, () => card("Q", "clubs"))]; // resta il pozzetto RISERVATO alla squadra 1
  const t = [card("9", "clubs"), card("9", "diamonds"), card("9", "hearts")];
  g.seats[2].hand = [...t];
  const r = g.meldNew(2, t.map((c) => c.id)); // svuoterebbe la mano del compagno
  assert.equal(r.ok, false, "il compagno non prende un secondo pozzetto per la stessa coppia");
  if (!r.ok) assert.equal(r.code, "MUST_KEEP_CARD_TO_DISCARD");
  assert.equal(g.pozzetti.length, 1, "il pozzetto riservato alla squadra 1 resta intatto");
});

test("coppie: svuotare la mano senza pozzetto disponibile per la propria coppia -> deve chiudere", () => {
  const g = coppie(0);
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[0].pozzettoTaken = true; // squadra 0 ha già il suo pozzetto
  g.seats[2].pozzettoTaken = false;
  g.seats[2].hand = [card("K", "hearts")]; // ultima carta
  g.melds = []; // nessun burraco di coppia
  // Non c'è pozzetto da prendere per la squadra 0: cade nelle condizioni di chiusura,
  // non soddisfatte -> lo scarto che svuoterebbe la mano è rifiutato.
  const r = g.discardCard(2, g.seats[2].hand[0]!.id);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "CANNOT_CLOSE_NO_BURRACO");
});

test("coppie: presa IN DIFFERITA — scarto finale prende il pozzetto RISERVATO alla coppia (non è chiusura)", () => {
  // Ramo `discardCard` willEmpty con la coppia SENZA pozzetto e un pozzetto ancora
  // disponibile: si prende il pozzetto DI COPPIA in DIFFERITA (skill "POZZETTO" +
  // "Pozzetto: uno per coppia") — la mano NON si chiude, il turno passa. In coppie
  // era testata solo la presa IN DIRETTA (via meldNew); questo copre la DIFFERITA
  // via scarto nel contesto 2v2. Nessun burraco richiesto: non è una chiusura.
  const g = coppie(0);
  g.currentSeat = 1; g.phase = "may_meld";
  g.seats[0].pozzettoTaken = true;  // la squadra 0 ha già preso il PROPRIO pozzetto
  g.seats[1].pozzettoTaken = false; // la squadra 1 non ne ha ancora preso alcuno
  g.seats[3].pozzettoTaken = false;
  g.pozzetti = [Array.from({ length: 11 }, () => card("Q", "clubs"))]; // resta il pozzetto della squadra 1
  g.seats[1].hand = [card("K", "hearts")]; // ultima carta, non è una matta
  g.melds = []; // nessun burraco: la DIFFERITA non lo richiede (non è chiusura)
  const r = g.discardCard(1, g.seats[1].hand[0]!.id);
  assert.equal(r.ok, true, "svuotando la mano prende il pozzetto di coppia in differita");
  if (r.ok) {
    assert.ok(r.effects.some((e) => e.kind === "pozzetto_taken"), "pozzetto_taken emesso");
    assert.ok(!r.effects.some((e) => e.kind === "hand_ended"), "NON è una chiusura: la mano continua");
    const tc = r.effects.find((e) => e.kind === "turn_changed");
    if (tc && tc.kind === "turn_changed") assert.equal(tc.seat, 2, "il turno passa in senso orario a 2");
  }
  assert.equal(g.status, "playing", "la smazzata prosegue");
  assert.equal(g.pozzettoTaken(1), true, "la squadra 1 ha ora il proprio pozzetto");
  assert.equal(g.handOf(1).length, 11, "la mano è quella del pozzetto (11 carte)");
  assert.equal(g.pozzetti.length, 0, "consumato l'ultimo pozzetto");
});

/* ─────────────────────────── PUNTEGGIO DI COPPIA (una volta sola) ─────────────────────────── */

test("coppie/scoring: fatti di coppia UNA VOLTA SOLA + carte di ENTRAMBI i compagni sottratte", () => {
  const cfg = coppieConfig();
  // Squadra 0 (posti 0,2): un burraco pulito calato dal posto 0 (valore carte 50).
  const melds = [buildMeld(burracoPulitoSpades(), 0, cfg)];
  const seats: SeatEndState[] = [
    { seat: 0, hand: [], pozzettoTaken: true }, // canonico squadra 0
    { seat: 1, hand: [card("K", "hearts")], pozzettoTaken: true }, // canonico squadra 1, -10
    { seat: 2, hand: [], pozzettoTaken: false }, // NON canonico squadra 0
    { seat: 3, hand: [card("A", "clubs")], pozzettoTaken: false }, // NON canonico squadra 1, -15
  ];
  const res = scoreHand(seats, melds, 2, cfg); // ha chiuso il posto 2 (squadra 0)
  const s0 = res.find((r) => r.seat === 0)!;
  const s1 = res.find((r) => r.seat === 1)!;
  const s2 = res.find((r) => r.seat === 2)!;
  const s3 = res.find((r) => r.seat === 3)!;

  // Riga CANONICA squadra 0: giochi (50) + burraco pulito (200) + chiusura (100).
  assert.equal(s0.ptsMelds, 50);
  assert.equal(s0.ptsBonus, 200 + 100, "burraco pulito + bonus chiusura, una volta sola");
  assert.equal(s0.burrachiPuliti, 1);
  assert.equal(s0.ptsPozzetto, 0, "la squadra 0 ha preso il pozzetto");
  assert.equal(s0.totalDelta, 350);
  // Riga NON canonica squadra 0: NESSUN fatto di coppia (mai duplicato).
  assert.equal(s2.ptsMelds, 0, "i giochi della squadra non sono duplicati sul compagno");
  assert.equal(s2.ptsBonus, 0);
  assert.equal(s2.burrachiPuliti, 0);
  assert.equal(s2.ptsPozzetto, 0);
  assert.equal(s2.totalDelta, 0);
  // Squadra 1: solo penalità di mano di ENTRAMBI i compagni (nessun malus: pozzetto preso).
  assert.equal(s1.ptsPenaltyHand, -10);
  assert.equal(s1.ptsPozzetto, 0);
  assert.equal(s3.ptsPenaltyHand, -15);
  assert.equal(s3.ptsPozzetto, 0, "malus pozzetto solo sul posto canonico");
  // Totali di COPPIA = SUM delle due righe.
  assert.equal(s0.totalDelta + s2.totalDelta, 350, "squadra 0: 350 una volta sola");
  assert.equal(s1.totalDelta + s3.totalDelta, -25, "squadra 1: -10 e -15, entrambe le mani");
});

test("coppie/scoring: malus pozzetto -100 UNA VOLTA SOLA per coppia (nessun membro l'ha preso)", () => {
  const cfg = coppieConfig();
  const seats: SeatEndState[] = [
    { seat: 0, hand: [], pozzettoTaken: true }, // squadra 0 ha preso
    { seat: 1, hand: [card("K", "hearts")], pozzettoTaken: false }, // squadra 1: nessuno ha preso
    { seat: 2, hand: [], pozzettoTaken: false },
    { seat: 3, hand: [card("A", "clubs")], pozzettoTaken: false },
  ];
  const res = scoreHand(seats, [], null, cfg);
  const s0 = res.find((r) => r.seat === 0)!;
  const s1 = res.find((r) => r.seat === 1)!;
  const s2 = res.find((r) => r.seat === 2)!;
  const s3 = res.find((r) => r.seat === 3)!;
  // Squadra 0: pozzetto preso -> nessun malus.
  assert.equal(s0.ptsPozzetto, 0);
  assert.equal(s2.ptsPozzetto, 0);
  assert.equal(s0.totalDelta + s2.totalDelta, 0);
  // Squadra 1: malus -100 solo sul canonico (posto 1), NON anche sul posto 3.
  assert.equal(s1.ptsPozzetto, -100, "malus una volta sola sul posto canonico");
  assert.equal(s3.ptsPozzetto, 0, "il compagno non raddoppia il malus");
  // Totale squadra 1 = -100 (malus, una volta) - 10 - 15 (mani di entrambi).
  assert.equal(s1.totalDelta + s3.totalDelta, -125);
});

test("coppie/scoring: pozzetto preso dal compagno NON canonico -> nessun malus per la squadra", () => {
  const cfg = coppieConfig();
  // Squadra 0: il pozzetto lo ha preso il posto 2 (NON canonico); il posto 0
  // (canonico) non l'ha preso. Il malus NON deve scattare: basta un membro.
  const seats: SeatEndState[] = [
    { seat: 0, hand: [], pozzettoTaken: false }, // canonico, non ha preso
    { seat: 1, hand: [], pozzettoTaken: true },
    { seat: 2, hand: [], pozzettoTaken: true, pozzettoInDiretta: true }, // ha preso lui
    { seat: 3, hand: [], pozzettoTaken: true },
  ];
  const res = scoreHand(seats, [], null, cfg);
  const s0 = res.find((r) => r.seat === 0)!;
  const s2 = res.find((r) => r.seat === 2)!;
  assert.equal(s0.ptsPozzetto, 0, "nessun malus: la coppia ha il pozzetto (via il compagno)");
  assert.equal(s2.ptsPozzetto, 0, "il posto non canonico non porta il malus");
  assert.equal(s0.totalDelta + s2.totalDelta, 0, "squadra 0 senza malus");
  // Il fatto di stile "in diretta" resta sul posto che ha effettivamente preso.
  assert.equal(s2.pozzettoInDiretta, true);
  assert.equal(s0.pozzettoInDiretta, false);
});

/* ─────────────────────────── VITTORIA DI SQUADRA ─────────────────────────── */

test("coppie: vince la SQUADRA che raggiunge l'obiettivo sui cumulati di coppia", () => {
  const g = coppie(0);
  // Squadra 0 = cum[0]+cum[2] = 1900+100 = 2000; squadra 1 = 0. Con la chiusura la
  // squadra 0 supera 2005 pur essendo il punteggio spartito fra i due posti.
  g.cumulative = [1900, 0, 100, 0];
  g.currentSeat = 2; g.phase = "may_meld";
  g.seats[0].hand = []; g.seats[0].pozzettoTaken = true; // pozzetto della squadra 0 (dal compagno)
  g.seats[2].pozzettoTaken = false;
  g.seats[2].hand = [card("K", "hearts")];
  // Squadra 1 senza carte e con pozzetto preso: nessun punto/penalità che la porti in testa.
  g.seats[1].hand = []; g.seats[1].pozzettoTaken = true;
  g.seats[3].hand = []; g.seats[3].pozzettoTaken = false;
  g.melds = [buildMeld(burracoPulitoSpades(), 0, g.config)]; // burraco del compagno
  const r = g.discardCard(2, g.seats[2].hand[0]!.id);
  assert.equal(r.ok, true);
  if (r.ok) {
    const ge = r.effects.find((e) => e.kind === "game_ended");
    assert.ok(ge, "game_ended emesso");
    if (ge && ge.kind === "game_ended") {
      assert.equal(ge.winnerTeam, 0, "vince la squadra 0");
      assert.equal(ge.winnerSeat, 0, "posto canonico della squadra vincitrice (audit)");
    }
    assert.equal(g.status, "game_ended");
    assert.equal(g.winnerTeam, 0);
  }
  // Squadra 0: 2000 + 350 (chiusura) = 2350; squadra 1 resta a 0.
  assert.equal(g.cumulative[0] + g.cumulative[2], 2350);
  assert.equal(g.cumulative[1] + g.cumulative[3], 0);
});

test("coppie: NON si vince se solo un POSTO supererebbe l'obiettivo ma la squadra no", () => {
  const g = coppie(0);
  // Il posto 0 è a 2100 (>= 2005 da solo) ma il compagno (posto 2) è molto negativo:
  // la squadra 0 nel complesso resta sotto obiettivo -> nessuna vittoria di squadra.
  // Con la vecchia logica per-POSTO il posto 0 avrebbe erroneamente vinto.
  g.cumulative = [2100, 0, -2000, 0]; // squadra 0 = 100, squadra 1 = 0
  g.currentSeat = 2; g.phase = "must_draw";
  g.drawPile = []; g.discard = [];
  for (const s of [0, 1, 2, 3] as Seat[]) { g.seats[s].hand = []; g.seats[s].pozzettoTaken = true; }
  const r = g.draw(2, "deck"); // mazzo e scarti vuoti -> fine smazzata senza closer
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(!r.effects.some((e) => e.kind === "game_ended"), "nessuna vittoria: la squadra è sotto obiettivo");
    assert.equal(g.status, "hand_ended", "si gioca un'altra smazzata");
  }
});
