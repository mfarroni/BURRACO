import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { MemoryStatsStore } from "../src/stats/store.memory.js";

/**
 * COPERTURA EXTRA (agente_test, ciclo 3): completa i 14 test nuovi con i gap dei
 * criteri DoD non ancora coperti da evidenza reale:
 *  - IDOR: nessun parametro id dal client (es. ?userId=) può impersonare altri.
 *  - GATING: token GARBAGE/invalido → 401 (non solo assente).
 *  - PAGINAZIONE zod: offset<0 → 400; limit=51 (>cap) → 400; default applicati.
 *  - AGGREGATI: winRate non intero (1/3), matchesLost = played-won con winner null,
 *    storico esclude le partite 'playing'.
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

async function getJson(path: string, token?: string) {
  const res = await fetch(base + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, unknown> };
}

test("IDOR: ?userId=<altrui> è IGNORATO, tornano i dati del principale del token", async () => {
  const alice = await register("idor-alice@example.com");
  const bob = await register("idor-bob@example.com");
  // Partita conclusa: Alice vince (seat0), Bob perde (seat1).
  stats.putMatch({ id: "IDOR-1", status: "completed", winnerSeat: 0, endedAt: new Date() });
  stats.putPlayer({ matchId: "IDOR-1", seat: 0, displayName: "Alice", userId: alice.id });
  stats.putPlayer({ matchId: "IDOR-1", seat: 1, displayName: "Bob", userId: bob.id });
  stats.putHandScore({ matchId: "IDOR-1", seat: 0, totalDelta: 205 });
  stats.putHandScore({ matchId: "IDOR-1", seat: 1, totalDelta: 15 });

  // Alice tenta di leggere i dati di Bob passando ?userId=bob.id.
  const res = await getJson(`/users/me/stats?userId=${encodeURIComponent(bob.id)}`, alice.token);
  assert.equal(res.status, 200);
  // Deve vedere SE STESSA (vinta, 205), non Bob.
  assert.equal(res.json.matchesWon, 1);
  assert.equal(res.json.matchesLost, 0);
  assert.equal(res.json.totalPoints, 205);

  // Stessa cosa sullo storico: ?userId non impersona.
  const m = await getJson(`/users/me/matches?userId=${encodeURIComponent(bob.id)}`, alice.token);
  assert.equal(m.status, 200);
  const items = m.json.items as { opponentName: string; result: string }[];
  assert.equal(items.length, 1);
  assert.equal(items[0]!.opponentName, "Bob");
  assert.equal(items[0]!.result, "won");
});

test("GATING: token GARBAGE → 401 (sessione non valida)", async () => {
  const res = await getJson("/users/me/stats", "token-inventato-non-valido");
  assert.equal(res.status, 401);
  assert.equal(res.json.error, "UNAUTHORIZED");
  const m = await getJson("/users/me/matches", "token-inventato-non-valido");
  assert.equal(m.status, 401);
});

test("GATING: ospite → 403 GUEST_NO_PROFILE anche su /matches", async () => {
  const g = await guestToken();
  const res = await getJson("/users/me/matches", g);
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "GUEST_NO_PROFILE");
});

test("PAGINAZIONE: offset negativo → 400 INVALID_QUERY", async () => {
  const u = await register("pag-neg@example.com");
  const res = await getJson("/users/me/matches?offset=-1", u.token);
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "INVALID_QUERY");
});

test("PAGINAZIONE: limit=51 (oltre il cap 50) → 400 INVALID_QUERY", async () => {
  const u = await register("pag-cap@example.com");
  const res = await getJson("/users/me/matches?limit=51", u.token);
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "INVALID_QUERY");
});

test("PAGINAZIONE: assenza di query → default limit=10 offset=0", async () => {
  const u = await register("pag-def@example.com");
  const res = await getJson("/users/me/matches", u.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.limit, 10);
  assert.equal(res.json.offset, 0);
});

test("AGGREGATI: winRate non intero (1 vinta su 3) via HTTP", async () => {
  const u = await register("wr-third@example.com");
  const opp = await register("wr-opp@example.com");
  // 3 partite concluse: u vince solo la prima.
  for (let i = 0; i < 3; i++) {
    const id = `WR-${i}`;
    stats.putMatch({ id, status: "completed", winnerSeat: i === 0 ? 0 : 1, endedAt: new Date(2026, 0, i + 1) });
    stats.putPlayer({ matchId: id, seat: 0, displayName: "U", userId: u.id });
    stats.putPlayer({ matchId: id, seat: 1, displayName: "Opp", userId: opp.id });
    stats.putHandScore({ matchId: id, seat: 0, totalDelta: 10 });
    stats.putHandScore({ matchId: id, seat: 1, totalDelta: 5 });
  }
  const res = await getJson("/users/me/stats", u.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.matchesPlayed, 3);
  assert.equal(res.json.matchesWon, 1);
  assert.equal(res.json.matchesLost, 2);
  assert.ok(Math.abs((res.json.winRate as number) - 1 / 3) < 1e-9, `winRate=${res.json.winRate}`);
  assert.equal(res.json.totalPoints, 30);
});

test("AGGREGATI: winnerSeat null conta come partita persa (played-won)", async () => {
  const u = await register("draw-user@example.com");
  const opp = await register("draw-opp@example.com");
  stats.putMatch({ id: "DRAW-1", status: "completed", winnerSeat: null, endedAt: new Date() });
  stats.putPlayer({ matchId: "DRAW-1", seat: 0, displayName: "U", userId: u.id });
  stats.putPlayer({ matchId: "DRAW-1", seat: 1, displayName: "Opp", userId: opp.id });
  stats.putHandScore({ matchId: "DRAW-1", seat: 0, totalDelta: 7 });
  const res = await getJson("/users/me/stats", u.token);
  assert.equal(res.json.matchesPlayed, 1);
  assert.equal(res.json.matchesWon, 0);
  assert.equal(res.json.matchesLost, 1);
});

test("AGGREGATI: storico esclude le partite 'playing' (non concluse)", async () => {
  const u = await register("playing-user@example.com");
  const opp = await register("playing-opp@example.com");
  stats.putMatch({ id: "PLAY-1", status: "playing", winnerSeat: null });
  stats.putPlayer({ matchId: "PLAY-1", seat: 0, displayName: "U", userId: u.id });
  stats.putPlayer({ matchId: "PLAY-1", seat: 1, displayName: "Opp", userId: opp.id });
  const stat = await getJson("/users/me/stats", u.token);
  assert.equal(stat.json.matchesPlayed, 0);
  const hist = await getJson("/users/me/matches", u.token);
  assert.deepEqual(hist.json.items, []);
});
