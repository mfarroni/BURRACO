import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { MemoryStatsStore } from "../src/stats/store.memory.js";

/**
 * Test d'integrazione degli endpoint HTTP /users/me/* (macro-ciclo 3) con
 * AuthService + StatsStore in-memory. Verifica: derivazione dell'utente SOLO dal
 * token (nessun IDOR), gate "solo registrati" per gli ospiti (403), gating Bearer
 * (401), forma delle risposte e paginazione dello storico. Nessun DB, nessun WS.
 */

let server: http.Server;
let base: string;
let stats: MemoryStatsStore;
let auth: AuthService;

before(async () => {
  auth = new AuthService(new MemoryAuthStore());
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
  const j = (await res.json()) as { token: string };
  return j.token;
}

async function getJson(path: string, token?: string) {
  const res = await fetch(base + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, unknown> };
}

test("GET /users/me/stats: senza Bearer → 401", async () => {
  const res = await getJson("/users/me/stats");
  assert.equal(res.status, 401);
});

test("GET /users/me/stats: token ospite → 403 (solo registrati, decisione B)", async () => {
  const token = await guestToken();
  const res = await getJson("/users/me/stats", token);
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "GUEST_NO_PROFILE");
});

test("GET /users/me/stats: ritorna SOLO i dati del principale (nessun IDOR)", async () => {
  const alice = await register("alice-stats@example.com");
  const bob = await register("bob-stats@example.com");

  // Partita conclusa: Alice (seat0) vince contro Bob (seat1).
  stats.putMatch({ id: "MATCH-1", status: "completed", winnerSeat: 0, endedAt: new Date() });
  stats.putPlayer({ matchId: "MATCH-1", seat: 0, displayName: "Alice", userId: alice.id });
  stats.putPlayer({ matchId: "MATCH-1", seat: 1, displayName: "Bob", userId: bob.id });
  stats.putHandScore({ matchId: "MATCH-1", seat: 0, totalDelta: 150 });
  stats.putHandScore({ matchId: "MATCH-1", seat: 1, totalDelta: 30 });

  const aRes = await getJson("/users/me/stats", alice.token);
  assert.equal(aRes.status, 200);
  assert.equal(aRes.json.matchesPlayed, 1);
  assert.equal(aRes.json.matchesWon, 1);
  assert.equal(aRes.json.matchesLost, 0);
  assert.equal(aRes.json.totalPoints, 150);

  // Con il token di Bob la stessa rotta ritorna i dati di Bob, non di Alice
  // (l'utente è derivato dal token, non da un id nel client).
  const bRes = await getJson("/users/me/stats", bob.token);
  assert.equal(bRes.status, 200);
  assert.equal(bRes.json.matchesWon, 0);
  assert.equal(bRes.json.matchesLost, 1);
  assert.equal(bRes.json.totalPoints, 30);
});

test("GET /users/me/matches: storico paginato del solo principale", async () => {
  const carol = await register("carol-stats@example.com");
  const opp = await register("opp-stats@example.com");
  for (let i = 0; i < 3; i++) {
    const id = `CAROL-${i}`;
    stats.putMatch({ id, status: "completed", winnerSeat: 0, endedAt: new Date(2026, 7, i + 1) });
    stats.putPlayer({ matchId: id, seat: 0, displayName: "Carol", userId: carol.id });
    stats.putPlayer({ matchId: id, seat: 1, displayName: "Avv", userId: opp.id });
    stats.putHandScore({ matchId: id, seat: 0, totalDelta: 100 + i });
    stats.putHandScore({ matchId: id, seat: 1, totalDelta: 10 });
  }

  const res = await getJson("/users/me/matches?limit=2&offset=0", carol.token);
  assert.equal(res.status, 200);
  const items = res.json.items as unknown[];
  assert.equal(items.length, 2);
  assert.equal(res.json.limit, 2);
  assert.equal(res.json.offset, 0);
  const first = items[0] as { matchId: string; result: string; opponentName: string };
  assert.equal(first.matchId, "CAROL-2"); // più recente
  assert.equal(first.result, "won");
  assert.equal(first.opponentName, "Avv");
});

test("GET /users/me/matches: limit oltre il cap → 400 (validazione zod)", async () => {
  const dave = await register("dave-stats@example.com");
  const res = await getJson("/users/me/matches?limit=999", dave.token);
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "INVALID_QUERY");
});

test("GET /users/me/matches: senza Bearer → 401", async () => {
  const res = await getJson("/users/me/matches");
  assert.equal(res.status, 401);
});
