// Test unitario della regola del colore dei jolly (nessuna dipendenza nuova).
// Esecuzione, da FE_Burraco/:  node --test test/jollyColor.test.mjs
// Richiede Node >= 22.18 (type stripping nativo per importare i sorgenti .ts).
// File .mjs e non .ts: così resta fuori da `tsc --noEmit` (che rifiuterebbe gli
// import con estensione .ts) e da `next lint`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jollyColor } from "../src/lib/jollyColor.ts";
import { createDeck } from "../../BE_Burraco/src/engine/cards.ts";

test("mazzo reale del server (108 carte): esattamente 2 jolly rossi e 2 neri", () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  const jokers = deck.filter((c) => c.wildKind === "joker");
  assert.equal(jokers.length, 4);
  const colors = jokers.map(jollyColor);
  assert.equal(colors.filter((c) => c === "rosso").length, 2);
  assert.equal(colors.filter((c) => c === "nero").length, 2);
});

test("ogni mazzo ha un jolly rosso e uno nero", () => {
  assert.equal(jollyColor({ id: "JOKER-1-1", wildKind: "joker" }), "rosso");
  assert.equal(jollyColor({ id: "JOKER-1-2", wildKind: "joker" }), "nero");
  assert.equal(jollyColor({ id: "JOKER-2-1", wildKind: "joker" }), "rosso");
  assert.equal(jollyColor({ id: "JOKER-2-2", wildKind: "joker" }), "nero");
});

test("stabilità: il colore dipende solo dall'id (mano, giochi, scarti, riconnessione)", () => {
  for (const c of createDeck().filter((x) => x.wildKind === "joker")) {
    const first = jollyColor(c);
    // Stessa carta ricevuta di nuovo (copia via JSON, come dal WebSocket dopo
    // una riconnessione o in un altro contesto del tavolo): stesso colore.
    const again = jollyColor(JSON.parse(JSON.stringify(c)));
    assert.equal(again, first);
    for (let i = 0; i < 5; i++) assert.equal(jollyColor(c), first);
  }
});

test("le altre carte non ricevono mai un colore di jolly", () => {
  for (const c of createDeck().filter((x) => x.wildKind !== "joker")) {
    assert.equal(jollyColor(c), null);
  }
});

test("id non riconosciuto → null (il jolly resta stilizzato)", () => {
  assert.equal(jollyColor({ id: "JOKER-1-3", wildKind: "joker" }), null);
  assert.equal(jollyColor({ id: "x", wildKind: "joker" }), null);
  assert.equal(jollyColor({ id: "JOKER-1-1", wildKind: null }), null);
});
