import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { hashToken } from "../src/auth/tokens.js";

/**
 * Test del MACRO-CICLO 2 (hardening post-auth), AuthStore IN-MEMORY (no DB):
 *  - SEC-A4: /auth/logout-all revoca TUTTE le sessioni; cap di sessioni per utente.
 *  - SEC-A3b: pruning di sessioni scadute/revocate e ospiti inattivi.
 *  - SEC-A5: security header sulle risposte HTTP.
 * Non toccano il motore di gioco né le protezioni WS/room esistenti.
 */

let server: http.Server;
let base: string;

before(async () => {
  const auth = new AuthService(new MemoryAuthStore());
  const app = createHttpApp(auth);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/* ───────────────────────── SEC-A5: security header ───────────────────────── */

test("SEC-A5: le risposte HTTP portano i security header", async () => {
  const res = await fetch(base + "/health");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  // x-powered-by resta disabilitato.
  assert.equal(res.headers.get("x-powered-by"), null);
  // Fuori da produzione niente HSTS (richiede https).
  assert.equal(res.headers.get("strict-transport-security"), null);
});

/* ───────────────────────── SEC-A4: logout-all ────────────────────────────── */

test("SEC-A4: /auth/logout-all revoca TUTTE le sessioni del principale", async () => {
  // Tre login dello stesso utente → tre token distinti, tutti validi.
  await post("/auth/register", { email: "logoutall@example.com", password: "password12" });
  const a = await post("/auth/login", { email: "logoutall@example.com", password: "password12" });
  const b = await post("/auth/login", { email: "logoutall@example.com", password: "password12" });
  const c = await post("/auth/login", { email: "logoutall@example.com", password: "password12" });
  const tokens = [a.json.token, b.json.token, c.json.token] as string[];

  // Tutte le sessioni risolvono /me prima del logout-all.
  for (const t of tokens) {
    const me = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${t}` } });
    assert.equal(me.status, 200, "sessione valida prima del logout-all");
  }

  // Logout-all usando UNA delle sessioni.
  const out = await post("/auth/logout-all", {}, { Authorization: `Bearer ${tokens[0]}` });
  assert.equal(out.status, 200);
  assert.equal(out.json.ok, true);
  assert.ok((out.json.revoked as number) >= 3, "revocate tutte le sessioni attive");

  // Dopo il logout-all NESSUNA sessione risolve più.
  for (const t of tokens) {
    const me = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${t}` } });
    assert.equal(me.status, 401, "ogni sessione è revocata dopo logout-all");
  }
});

test("SEC-A4: /auth/logout-all senza Bearer valido → 401 (non idempotente)", async () => {
  const noTok = await post("/auth/logout-all", {});
  assert.equal(noTok.status, 401);
  const badTok = await post("/auth/logout-all", {}, { Authorization: "Bearer non-esiste" });
  assert.equal(badTok.status, 401);
});

/* ───────────────────────── SEC-A4: cap di sessioni ───────────────────────── */

test("SEC-A4: il cap di sessioni revoca le sessioni più vecchie oltre il limite", async () => {
  const store = new MemoryAuthStore();
  const svc = new AuthService(store);
  const reg = await svc.register("cap@example.com", "password12", "Cap");
  const userId = reg.user.id;

  // Emette molte sessioni oltre il cap (10). Le più vecchie devono risultare revocate.
  const tokens: string[] = [reg.sessionToken];
  for (let i = 0; i < 14; i++) {
    const res = await svc.login("cap@example.com", "password12");
    tokens.push(res.sessionToken);
  }

  // Le ultime 10 emesse restano valide; quelle prima sono revocate.
  const valid: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const p = await svc.getPrincipalByToken(tokens[i]);
    if (p) {
      valid.push(i);
      assert.equal(p.userId, userId);
    }
  }
  assert.equal(valid.length, 10, "restano esattamente 10 sessioni attive (cap)");
  // Le valide sono le più recenti (indici finali).
  assert.deepEqual(valid, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

/* ───────────────────────── SEC-A3b: pruning ──────────────────────────────── */

test("SEC-A3b: pruning elimina le sessioni SCADUTE dallo store", async () => {
  const store = new MemoryAuthStore();
  // TTL brevissimo così la sessione nasce già quasi scaduta.
  const svc = new AuthService(store, { sessionTtlMs: 1 });
  const reg = await svc.register("prune-exp@example.com", "password12", "Exp");
  const hash = hashToken(reg.sessionToken);
  assert.ok(await store.getSessionByTokenHash(hash), "sessione presente prima del pruning");

  // now nel futuro → sessione scaduta → potata.
  const future = new Date(Date.now() + 10_000);
  const report = await svc.runMaintenance(future);
  assert.ok(report.sessions >= 1, "almeno una sessione scaduta potata");
  assert.equal(await store.getSessionByTokenHash(hash), null, "sessione scaduta rimossa");
});

test("SEC-A3b: pruning elimina le sessioni REVOCATE oltre la grace", async () => {
  const store = new MemoryAuthStore();
  const svc = new AuthService(store);
  const reg = await svc.register("prune-rev@example.com", "password12", "Rev");
  const hash = hashToken(reg.sessionToken);
  await svc.logout(reg.sessionToken); // revoca ora

  // Subito dopo la revoca resta (dentro la grace di 24h).
  const now = new Date();
  await svc.runMaintenance(now);
  assert.ok(await store.getSessionByTokenHash(hash), "revocata ma entro la grace: resta");

  // Oltre 24h dalla revoca → potata.
  const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const report = await svc.runMaintenance(later);
  assert.ok(report.sessions >= 1, "sessione revocata oltre grace potata");
  assert.equal(await store.getSessionByTokenHash(hash), null, "sessione revocata rimossa");
});

test("SEC-A3b: pruning elimina gli OSPITI inattivi oltre la soglia", async () => {
  const store = new MemoryAuthStore();
  const svc = new AuthService(store);
  const guest = await svc.createGuest("Ospite");
  // Prima le sessioni dell'ospite scadono (altrimenti l'ospite è trattenuto).
  // Simuliamo un futuro oltre il TTL sessione (7g) e oltre l'inattività ospite (7g).
  const far = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const report = await svc.runMaintenance(far);
  assert.ok(report.guests >= 1, "ospite inattivo potato");
  assert.equal(await store.getUserById(guest.user.id), null, "utente ospite rimosso");
});

test("SEC-A3b: il pruning NON tocca gli account registrati", async () => {
  const store = new MemoryAuthStore();
  const svc = new AuthService(store);
  const reg = await svc.register("keepme@example.com", "password12", "Keep");
  const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await svc.runMaintenance(far);
  assert.ok(await store.getUserById(reg.user.id), "account registrato preservato");
});
