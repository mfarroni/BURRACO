// Test unitario dell'associazione carta → file illustrato (nessuna dipendenza nuova).
// Esecuzione, da FE_Burraco/:  node --test test/cardArt.test.mjs
// Richiede Node >= 22.18 (type stripping nativo per importare i sorgenti .ts).
// src/lib/cardArt.ts importa "./jollyColor" senza estensione (stile del bundler):
// un piccolo hook di risoluzione, solo per questo test, prova il suffisso ".ts".
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(spec, ctx, next) {
        try { return await next(spec, ctx); }
        catch (e) {
          if (spec.startsWith(".") && !/\\.[a-z]+$/.test(spec)) return next(spec + ".ts", ctx);
          throw e;
        }
      }`),
);

const { cardArtUrl, ENABLED_SUITS } = await import("../src/lib/cardArt.ts");
const { createDeck } = await import("../../BE_Burraco/src/engine/cards.ts");

const publicFile = (url) => fileURLToPath(new URL(`../public${url}`, import.meta.url));

test("le 26 carte di cuori del mazzo reale hanno un file, e il file esiste", () => {
  const hearts = createDeck().filter((c) => c.suit === "hearts");
  assert.equal(hearts.length, 26);
  for (const c of hearts) {
    const url = cardArtUrl(c);
    assert.match(url, /^\/images\/carte\/(asso|[2-9]|10|fante|donna|re)-cuori\.webp$/);
    assert.ok(existsSync(publicFile(url)), `manca ${url}`);
  }
});

test("tabella esplicita dei valori", () => {
  const h = (rank) => cardArtUrl({ id: "x", rank, suit: "hearts", wildKind: null });
  assert.equal(h("A"), "/images/carte/asso-cuori.webp");
  assert.equal(h("2"), "/images/carte/2-cuori.webp");
  assert.equal(h("10"), "/images/carte/10-cuori.webp");
  assert.equal(h("J"), "/images/carte/fante-cuori.webp");
  assert.equal(h("Q"), "/images/carte/donna-cuori.webp");
  assert.equal(h("K"), "/images/carte/re-cuori.webp");
});

test("le due copie della stessa carta usano lo stesso file", () => {
  const byRank = new Map();
  for (const c of createDeck().filter((x) => x.suit === "hearts")) {
    const url = cardArtUrl(c);
    if (byRank.has(c.rank)) assert.equal(url, byRank.get(c.rank));
    else byRank.set(c.rank, url);
  }
  assert.equal(byRank.size, 13);
});

test("jolly invariati: stesso file di prima (jolly-rosso / jolly-nero)", () => {
  const jokers = createDeck().filter((c) => c.wildKind === "joker");
  const urls = jokers.map(cardArtUrl).sort();
  assert.deepEqual(urls, [
    "/images/carte/jolly-nero.webp",
    "/images/carte/jolly-nero.webp",
    "/images/carte/jolly-rosso.webp",
    "/images/carte/jolly-rosso.webp",
  ]);
});

test("le 26 carte di fiori del mazzo reale hanno un file, e il file esiste", () => {
  const clubs = createDeck().filter((c) => c.suit === "clubs");
  assert.equal(clubs.length, 26);
  const byRank = new Map();
  for (const c of clubs) {
    const url = cardArtUrl(c);
    assert.match(url, /^\/images\/carte\/(asso|[2-9]|10|fante|donna|re)-fiori\.webp$/);
    assert.ok(existsSync(publicFile(url)), `manca ${url}`);
    // le due copie della stessa carta usano lo stesso file
    if (byRank.has(c.rank)) assert.equal(url, byRank.get(c.rank));
    else byRank.set(c.rank, url);
  }
  assert.equal(byRank.size, 13);
  assert.equal(cardArtUrl({ id: "x", rank: "K", suit: "clubs", wildKind: null }), "/images/carte/re-fiori.webp");
});

test("le 26 carte di picche del mazzo reale hanno un file, e il file esiste", () => {
  const spades = createDeck().filter((c) => c.suit === "spades");
  assert.equal(spades.length, 26);
  const byRank = new Map();
  for (const c of spades) {
    const url = cardArtUrl(c);
    assert.match(url, /^\/images\/carte\/(asso|[2-9]|10|fante|donna|re)-picche\.webp$/);
    assert.ok(existsSync(publicFile(url)), `manca ${url}`);
    // le due copie della stessa carta usano lo stesso file
    if (byRank.has(c.rank)) assert.equal(url, byRank.get(c.rank));
    else byRank.set(c.rank, url);
  }
  assert.equal(byRank.size, 13);
  assert.equal(cardArtUrl({ id: "x", rank: "Q", suit: "spades", wildKind: null }), "/images/carte/donna-picche.webp");
});

test("le 26 carte di quadri del mazzo reale hanno un file, e il file esiste", () => {
  const diamonds = createDeck().filter((c) => c.suit === "diamonds");
  assert.equal(diamonds.length, 26);
  const byRank = new Map();
  for (const c of diamonds) {
    const url = cardArtUrl(c);
    assert.match(url, /^\/images\/carte\/(asso|[2-9]|10|fante|donna|re)-quadri\.webp$/);
    assert.ok(existsSync(publicFile(url)), `manca ${url}`);
    // le due copie della stessa carta usano lo stesso file
    if (byRank.has(c.rank)) assert.equal(url, byRank.get(c.rank));
    else byRank.set(c.rank, url);
  }
  assert.equal(byRank.size, 13);
  assert.equal(cardArtUrl({ id: "x", rank: "J", suit: "diamonds", wildKind: null }), "/images/carte/fante-quadri.webp");
});

test("tutti e quattro i semi sono abilitati", () => {
  assert.deepEqual([...ENABLED_SUITS], ["hearts", "clubs", "spades", "diamonds"]);
});

test("mazzo completo: le 108 carte portano a 54 file, tutti esistenti", () => {
  const urls = new Set();
  for (const c of createDeck()) {
    const url = cardArtUrl(c);
    assert.ok(url, `nessun file per ${c.id}`);
    urls.add(url);
  }
  assert.equal(urls.size, 54);
  for (const url of urls) assert.ok(existsSync(publicFile(url)), `manca ${url}`);
});

test("valori inattesi → null, mai un percorso arbitrario", () => {
  const bad = [
    { id: "x", rank: "../../etc", suit: "hearts", wildKind: null },
    { id: "x", rank: "__proto__", suit: "hearts", wildKind: null },
    { id: "x", rank: "constructor", suit: "hearts", wildKind: null },
    { id: "x", rank: "JOKER", suit: "hearts", wildKind: null },
    { id: "x", rank: "A", suit: "../hearts", wildKind: null },
    { id: "x", rank: "A", suit: null, wildKind: null },
    { id: "JOKER-1-9", rank: "JOKER", suit: null, wildKind: "joker" },
  ];
  for (const c of bad) assert.equal(cardArtUrl(c), null, JSON.stringify(c));
});
