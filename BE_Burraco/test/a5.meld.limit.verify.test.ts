import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/engine/game.js";
import { interpretMeld } from "../src/engine/meld.js";
import { defaultGameConfig } from "../src/config.js";
import type { Card, Meld, Rank, Suit, Seat } from "../src/contract/types.js";

/**
 * VERIFICA agente_test (ciclo remediation A5): rafforza il criterio 5.
 * Scenario esatto del bug osservato in gioco: un turno con 3+ calate che
 * SVUOTANO la mano deve portare a prendere il pozzetto SENZA mai ricevere
 * MELD_LIMIT_REACHED, con la config di DEFAULT (limite = null). Misura contro
 * skill-burraco righe 46 (nessun_limite di default) e 90-93 (presa pozzetto).
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

test("A5 criterio 5: la TERZA calata che svuota la mano prende il pozzetto, mai MELD_LIMIT_REACHED (default null)", () => {
  const g = new GameEngine(defaultGameConfig(), 0);
  assert.equal(g.config.limiteCalatePrimaDelPozzetto, null, "default: nessun limite");
  g.currentSeat = 1;
  g.phase = "may_meld";
  g.seats[1].pozzettoTaken = false;
  // Due giochi GIA' calati in questo turno + una mano che, con la 3a calata,
  // si svuota completamente → deve prendere il pozzetto in diretta.
  g.melds = [
    buildMeld([card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")], 1),
    buildMeld([card("4", "clubs"), card("4", "diamonds"), card("4", "hearts")], 1),
  ];
  const t3 = [card("5", "clubs"), card("5", "diamonds"), card("5", "hearts")];
  g.seats[1].hand = [...t3]; // esattamente 3 carte: la 3a calata svuota la mano
  const r = g.meldNew(1, t3.map((c) => c.id));
  assert.equal(r.ok, true, "3a calata (che svuota la mano) accettata: nessun cap");
  if (r.ok) {
    // Nessun rifiuto: r.ok true implica nessun code MELD_LIMIT_REACHED.
    assert.ok(
      r.effects.some((e) => e.kind === "pozzetto_taken"),
      "presa del pozzetto in diretta emessa dalla 3a calata",
    );
  }
  assert.equal(g.pozzettoTaken(1), true, "pozzetto preso, mai bloccato dal cap");
  assert.equal(
    g.melds.filter((m) => m.ownerSeat === 1).length,
    3,
    "tre giochi calati prima del pozzetto",
  );
});

test("A5 criterio 6: house-rule cap=2 ancora attiva → la 3a calata pre-pozzetto è rifiutata", () => {
  const g = new GameEngine({ ...defaultGameConfig(), limiteCalatePrimaDelPozzetto: 2 }, 0);
  g.currentSeat = 1;
  g.phase = "may_meld";
  g.seats[1].pozzettoTaken = false;
  g.melds = [
    buildMeld([card("6", "clubs"), card("6", "diamonds"), card("6", "hearts")], 1),
    buildMeld([card("7", "clubs"), card("7", "diamonds"), card("7", "hearts")], 1),
  ];
  const t3 = [card("8", "clubs"), card("8", "diamonds"), card("8", "hearts")];
  g.seats[1].hand = [...t3, card("K", "spades")];
  const r = g.meldNew(1, t3.map((c) => c.id));
  assert.equal(r.ok, false, "col cap attivo la 3a calata è rifiutata");
  if (!r.ok) assert.equal(r.code, "MELD_LIMIT_REACHED", "codice del contratto preservato");
  assert.equal(
    g.melds.filter((m) => m.ownerSeat === 1).length,
    2,
    "stato invariato: la calata rifiutata NON è registrata",
  );
});

test("A5: cap=0 e cap non finito trattati come 'nessun limite' (solo numero finito > 0 attiva)", () => {
  // cap = 0 → non attiva (la guardia richiede cap > 0)
  const g0 = new GameEngine({ ...defaultGameConfig(), limiteCalatePrimaDelPozzetto: 0 }, 0);
  g0.currentSeat = 1; g0.phase = "may_meld"; g0.seats[1].pozzettoTaken = false;
  g0.melds = [
    buildMeld([card("3", "clubs"), card("3", "diamonds"), card("3", "hearts")], 1),
  ];
  const a = [card("9", "clubs"), card("9", "diamonds"), card("9", "hearts")];
  g0.seats[1].hand = [...a, card("K", "hearts")];
  const r0 = g0.meldNew(1, a.map((c) => c.id));
  assert.equal(r0.ok, true, "cap=0 NON deve bloccare (guardia cap>0)");
});
