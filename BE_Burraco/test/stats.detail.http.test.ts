import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { MemoryStatsStore } from "../src/stats/store.memory.js";

/**
 * Test d'integrazione HTTP della rotta NUOVA `GET /users/me/matches/:id` e del
 * parametro `periodo` di `/users/me/stats` (macro-ciclo storico). Copre §5:
 *  - S1: dettaglio di partita ALTRUI → 404 (mai 403: l'esistenza non è osservabile);
 *  - S2: uuid ben formato ma inesistente → 404 (indistinguibile da S1);
 *  - S3: id non-uuid → 400;
 *  - S4/S7: senza Bearer → 401; ospite → 403;
 *  - S9: la risposta non espone campi interni (user_id, email, hash, token, state);
 *  - S10: `periodo` fuori enum → 400.
 */

let server: http.Server;
let base: string;
let stats: MemoryStatsStore;

before(async () => {
  const auth = new AuthService(new MemoryAuthStore());
  stats = new MemoryStatsStore();
  const app = createHttpApp(auth, stats);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function register(email: string): Promise<{ token: string; id: string }> {
  const res = await fetch(base + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password12", displayName: email.split("@")[0] }),
  });
  const j = (await res.json()) as { token: string; user: { id: string } };
  return { token: j.token, id: j.user.id };
}

async function guestToken(): Promise<string> {
  const res = await fetch(base + "/auth/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Ospite" }),
  });
  return ((await res.json()) as { token: string }).token;
}

async function getRaw(path: string, token?: string) {
  const res = await fetch(base + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, text, json };
}

/** Semina una partita completed (uuid) fra due utenti registrati. */
function seedMatch(id: string, a: { id: string }, b: { id: string; guest?: boolean }): void {
  stats.putMatch({ id, status: "completed", winnerSeat: 0, endedAt: new Date(), targetScore: 2005 });
  stats.putPlayer({ matchId: id, seat: 0, displayName: "Alice", userId: a.id });
  stats.putPlayer({ matchId: id, seat: 1, displayName: "Bob", userId: b.id, isGuest: b.guest ?? false });
  stats.putDeal({
    matchId: id,
    handNumber: 1,
    closerSeat: 0,
    sides: [
      { seat: 0, totalDelta: 220, ptsPenaltyHand: -20, ptsPozzetto: 0, burrachiPuliti: 1, pozzettoInDiretta: true },
      { seat: 1, totalDelta: 60, ptsPozzetto: -100 },
    ],
  });
}

test("dettaglio: senza Bearer → 401", async () => {
  const res = await getRaw(`/users/me/matches/${randomUUID()}`);
  assert.equal(res.status, 401);
});

test("dettaglio: ospite → 403 GUEST_NO_PROFILE", async () => {
  const g = await guestToken();
  const res = await getRaw(`/users/me/matches/${randomUUID()}`, g);
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "GUEST_NO_PROFILE");
});

test("dettaglio: id non-uuid → 400 (prima di ogni query)", async () => {
  const alice = await register("det-alice@example.com");
  const res = await getRaw("/users/me/matches/non-un-uuid", alice.token);
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "INVALID_ID");
});

test("dettaglio: uuid ben formato ma inesistente → 404 (S2)", async () => {
  const alice = await register("det-alice2@example.com");
  const res = await getRaw(`/users/me/matches/${randomUUID()}`, alice.token);
  assert.equal(res.status, 404);
  assert.equal(res.json.error, "NOT_FOUND");
});

test("dettaglio: partita ALTRUI → 404, MAI 403 (S1: esistenza non osservabile)", async () => {
  const alice = await register("det-alice3@example.com");
  const bob = await register("det-bob3@example.com");
  const carol = await register("det-carol3@example.com");
  const otherMatch = randomUUID();
  // Partita fra bob e carol: alice NON partecipa.
  seedMatch(otherMatch, bob, carol);

  const res = await getRaw(`/users/me/matches/${otherMatch}`, alice.token);
  assert.equal(res.status, 404, "non deve mai essere 403");
  assert.equal(res.json.error, "NOT_FOUND");
});

test("dettaglio: partecipante → 200 con dati corretti e NESSUN campo interno (S9)", async () => {
  const alice = await register("det-alice4@example.com");
  const bob = await register("det-bob4@example.com");
  const matchId = randomUUID();
  seedMatch(matchId, alice, { id: bob.id, guest: true });

  const res = await getRaw(`/users/me/matches/${matchId}`, alice.token);
  assert.equal(res.status, 200);
  const d = res.json as unknown as {
    matchId: string;
    yourSeat: number;
    result: string;
    opponent: { name: string; isGuest: boolean };
    finalScore: { you: number; opponent: number };
    deals: { you: { pozzettoInDiretta: boolean; haChiuso: boolean }; opponent: { malusPozzetto: boolean } }[];
  };
  assert.equal(d.matchId, matchId);
  assert.equal(d.yourSeat, 0);
  assert.equal(d.result, "won");
  assert.equal(d.opponent.name, "Bob");
  assert.equal(d.opponent.isGuest, true);
  assert.equal(d.finalScore.you, 220);
  assert.equal(d.deals.length, 1);
  assert.equal(d.deals[0]!.you.pozzettoInDiretta, true);
  assert.equal(d.deals[0]!.you.haChiuso, true);
  assert.equal(d.deals[0]!.opponent.malusPozzetto, true);

  // Non-esposizione di campi interni: mai id utenti, email, hash, token, stato pieno.
  for (const forbidden of [
    bob.id,
    alice.id,
    "user_id",
    "userId",
    "email",
    "password_hash",
    "player_token_hash",
    "token_hash",
    "\"state\"",
    "checkpoint",
  ]) {
    assert.ok(!res.text.includes(forbidden), `la risposta non deve contenere "${forbidden}"`);
  }
});

test("stats: periodo fuori enum → 400 (S10, nessun errore SQL)", async () => {
  const u = await register("periodo-bad@example.com");
  const res = await getRaw("/users/me/stats?periodo=ieri", u.token);
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "INVALID_QUERY");
});

test("stats: periodo valido (30d) → 200 con eco del periodo", async () => {
  const u = await register("periodo-ok@example.com");
  const res = await getRaw("/users/me/stats?periodo=30d", u.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.periodo, "30d");
});
