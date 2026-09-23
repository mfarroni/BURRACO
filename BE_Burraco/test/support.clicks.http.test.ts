import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { AuthService } from "../src/auth/service.js";
import { createHttpApp } from "../src/http/app.js";
import { MemorySupportClickStore, summarize, utcDay } from "../src/metrics/supportClicks.js";
import { AdminTestAuthStore, call, makeAdmin, makeGuest, makeUser, type TestServer } from "./adminTestKit.js";

/**
 * Lotto D (proposta donazione/condivisione) — CONTATORE ANONIMO dei clic caffè/invito.
 * Verifica: aggregazione per (giorno, tipo, punto), body a enum chiusi e `.strict()`
 * (nessun campo in più, quindi nessun dato personale), nessun token richiesto né
 * registrato, rate-limit per IP, vista admin dietro il gate (404 ai non-admin).
 */

async function start(): Promise<TestServer & { clicks: MemorySupportClickStore }> {
  const store = new AdminTestAuthStore();
  const auth = new AuthService(store);
  const clicks = new MemorySupportClickStore();
  const app = createHttpApp(auth, undefined, undefined, { clickStore: clicks });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, store, auth, clicks, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("POST /metrics/click: 204 senza token e conteggio aggregato per giorno/tipo/punto", async () => {
  const s = await start();
  try {
    for (let i = 0; i < 3; i++) {
      const r = await call(s.base, "POST", "/metrics/click", { body: { kind: "caffe", placement: "fine_partita" } });
      assert.equal(r.status, 204);
    }
    await call(s.base, "POST", "/metrics/click", { body: { kind: "invito", placement: "sala_attesa" } });
    const rows = [...s.clicks.rows.values()];
    assert.equal(rows.length, 2, "una riga per combinazione, non una per clic");
    const caffe = rows.find((r) => r.kind === "caffe")!;
    assert.equal(caffe.count, 3);
    assert.equal(caffe.day, utcDay(new Date()));
    // Nessun campo oltre a giorno/tipo/punto/conteggio: niente utente, IP o altro.
    assert.deepEqual(Object.keys(caffe).sort(), ["count", "day", "kind", "placement"]);
  } finally {
    await s.close();
  }
});

test("POST /metrics/click: valori fuori enum o campi in più → 400, nulla registrato", async () => {
  const s = await start();
  try {
    const bad = [
      {},
      { kind: "caffe" },
      { kind: "birra", placement: "lobby" },
      { kind: "caffe", placement: "altrove" },
      { kind: "caffe", placement: "lobby", userId: "abc" },
      { kind: "caffe", placement: "lobby", email: "x@example.com" },
    ];
    for (const body of bad) {
      const r = await call(s.base, "POST", "/metrics/click", { body });
      assert.equal(r.status, 400, `body ${JSON.stringify(body)} deve dare 400`);
    }
    assert.equal(s.clicks.rows.size, 0);
  } finally {
    await s.close();
  }
});

test("POST /metrics/click: con un token valido NON si lega il clic all'utente", async () => {
  const s = await start();
  try {
    const u = await makeUser(s.base, "donatore@example.com");
    const r = await call(s.base, "POST", "/metrics/click", {
      token: u.token,
      body: { kind: "invito", placement: "profilo" },
    });
    assert.equal(r.status, 204);
    const serialized = JSON.stringify([...s.clicks.rows.values()]);
    assert.ok(!serialized.includes(u.id), "l'id utente non deve comparire");
    assert.ok(!serialized.includes("donatore"), "nessun dato dell'utente");
  } finally {
    await s.close();
  }
});

test("POST /metrics/click: rate-limit per IP (20/min) → 429", async () => {
  const s = await start();
  try {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await call(s.base, "POST", "/metrics/click", { body: { kind: "caffe", placement: "lobby" } })).status;
    }
    assert.equal(last, 429);
    assert.equal([...s.clicks.rows.values()][0]?.count, 20, "i clic oltre il limite non contano");
  } finally {
    await s.close();
  }
});

test("GET /admin/metrics/clicks: 404 senza token, a un ospite e a un utente normale", async () => {
  const s = await start();
  try {
    assert.equal((await call(s.base, "GET", "/admin/metrics/clicks")).status, 404);
    const g = await makeGuest(s.base);
    assert.equal((await call(s.base, "GET", "/admin/metrics/clicks", { token: g.token })).status, 404);
    const u = await makeUser(s.base, "normale@example.com");
    assert.equal((await call(s.base, "GET", "/admin/metrics/clicks", { token: u.token })).status, 404);
  } finally {
    await s.close();
  }
});

test("GET /admin/metrics/clicks: riepilogo per l'admin, periodo validato", async () => {
  const s = await start();
  try {
    const admin = await makeAdmin(s, "capo@example.com");
    await call(s.base, "POST", "/metrics/click", { body: { kind: "caffe", placement: "landing" } });
    await call(s.base, "POST", "/metrics/click", { body: { kind: "invito", placement: "fine_partita" } });
    await call(s.base, "POST", "/metrics/click", { body: { kind: "invito", placement: "fine_partita" } });
    // Riga vecchia (fuori da 30 giorni): esclusa dal riepilogo.
    await s.clicks.record("caffe", "lobby", "2000-01-01");

    const r = await call(s.base, "GET", "/admin/metrics/clicks?days=30", { token: admin.token });
    assert.equal(r.status, 200);
    assert.equal(r.json.days, 30);
    assert.deepEqual(r.json.totals, { caffe: 1, invito: 2 });
    assert.deepEqual(r.json.byPlacement[0], { kind: "invito", placement: "fine_partita", count: 2 });
    assert.equal(r.json.daily.length, 1);
    assert.deepEqual(r.json.daily[0], { day: utcDay(new Date()), caffe: 1, invito: 2 });

    for (const q of ["?days=0", "?days=181", "?days=abc"]) {
      const bad = await call(s.base, "GET", `/admin/metrics/clicks${q}`, { token: admin.token });
      assert.equal(bad.status, 400, `${q} deve dare 400`);
    }
  } finally {
    await s.close();
  }
});

test("summarize: totali, per punto (ordinati) e per giorno (dal più recente)", () => {
  const out = summarize(
    [
      { day: "2026-09-20", kind: "caffe", placement: "footer", count: 2 },
      { day: "2026-09-21", kind: "caffe", placement: "fine_partita", count: 5 },
      { day: "2026-09-21", kind: "invito", placement: "fine_partita", count: 1 },
    ],
    7,
    "2026-09-15",
  );
  assert.deepEqual(out.totals, { caffe: 7, invito: 1 });
  assert.equal(out.byPlacement[0]!.placement, "fine_partita");
  assert.equal(out.byPlacement[0]!.count, 5);
  assert.deepEqual(out.daily.map((d) => d.day), ["2026-09-21", "2026-09-20"]);
});
