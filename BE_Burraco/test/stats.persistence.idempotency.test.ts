import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema.js";
import { persistence } from "../src/db/persistence.js";
import type { HandScoreDetail } from "../src/contract/types.js";

/**
 * IDEMPOTENZA della scrittura di fine smazzata/partita (§5 casi 4/4b).
 *
 * La garanzia forte è a livello DB (UNIQUE(hand_id, seat) + INSERT ... ON CONFLICT
 * DO NOTHING, e completeMatch condizionale WHERE status<>'completed'). Qui, senza
 * un Postgres reale (DATABASE_URL assente in test), si verificano i due pilastri
 * verificabili:
 *  1) lo SCHEMA dichiara davvero la chiave d'idempotenza UNIQUE(hand_id, seat);
 *  2) la persistenza è BEST-EFFORT: una doppia endHand/completeMatch non solleva
 *     mai (non blocca il gioco) — con db null è un no-op.
 */

test("schema: hand_scores ha la UNIQUE (hand_id, seat) come chiave d'idempotenza", () => {
  const cfg = getTableConfig(schema.handScores);
  const uq = cfg.indexes.find((i) => i.config.unique === true);
  assert.ok(uq, "manca l'indice UNIQUE su hand_scores");
  const cols = uq!.config.columns.map((c) => (c as { name: string }).name);
  assert.deepEqual(cols, ["hand_id", "seat"]);
});

test("schema: hand_scores ha le colonne di stile (burrachi + pozzetto_in_diretta)", () => {
  const cfg = getTableConfig(schema.handScores);
  const names = cfg.columns.map((c) => c.name);
  for (const col of ["burrachi_puliti", "burrachi_sporchi", "pozzetto_in_diretta"]) {
    assert.ok(names.includes(col), `manca la colonna ${col}`);
  }
});

test("persistenza best-effort: doppia endHand/completeMatch non solleva (no-op senza DB)", async () => {
  const scores: HandScoreDetail[] = [
    {
      seat: 0,
      ptsMelds: 50,
      ptsBonus: 300,
      ptsPenaltyHand: 0,
      ptsPozzetto: 0,
      totalDelta: 350,
      burrachiPuliti: 1,
      burrachiSporchi: 0,
      pozzettoInDiretta: true,
    },
    {
      seat: 1,
      ptsMelds: 0,
      ptsBonus: 0,
      ptsPenaltyHand: -10,
      ptsPozzetto: -100,
      totalDelta: -110,
      burrachiPuliti: 0,
      burrachiSporchi: 0,
      pozzettoInDiretta: false,
    },
  ];
  // Doppia chiamata sullo stesso hand_id: non deve mai lanciare (best-effort).
  await persistence.endHand("match-1", "hand-1", 0, scores, { any: "state" });
  await persistence.endHand("match-1", "hand-1", 0, scores, { any: "state" });
  await persistence.completeMatch("match-1", 0);
  await persistence.completeMatch("match-1", 0);
  assert.ok(true, "nessuna eccezione propagata al chiamante (motore non bloccato)");
});
