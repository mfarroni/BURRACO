import { test } from "node:test";
import assert from "node:assert/strict";
import { startAdminServer, call, makeUser, makeAdmin, makeGuest, RANDOM_UUID } from "./adminTestKit.js";

/**
 * CICLO Pannello Admin — test d'integrazione HTTP degli endpoint /admin/* e del
 * comportamento quota/semaforo/gate. Nessun DB (come le suite esistenti): `db`/`pool`
 * sono null, quindi le funzioni DB-gated ritornano presto (liste vuote, 503, no-op),
 * mentre GATE (404), RATE-LIMIT, SEMAFORO e i campi QUOTA del dry-run restano
 * pienamente verificabili al bordo HTTP. Ogni test avvia un server ISOLATO (limiter
 * freschi) per non contaminare i budget di rate-limit fra test.
 */

// Elenco COMPLETO delle rotte /admin/* protette da requireAdmin (il gate precede la
// validazione del body, quindi per il 404 non servono corpi validi). Include le rotte
// del ciclo precedente (occupancy/retention/broadcasts/logs) e quelle nuove.
const ADMIN_ROUTES: [string, string][] = [
  ["GET", "/admin/occupancy"],
  ["POST", "/admin/retention/preview"],
  ["POST", "/admin/broadcasts"],
  ["POST", `/admin/broadcasts/${RANDOM_UUID}/send`],
  ["GET", "/admin/broadcasts"],
  ["GET", "/admin/logs/app?from=0&to=1"],
  ["GET", "/admin/logs/render?from=0&to=1"],
  ["GET", "/admin/logs/db"],
  ["GET", "/admin/ping"],
  ["GET", "/admin/users"],
  ["GET", "/admin/logs/links"],
  ["POST", "/admin/status/check"],
  ["GET", "/admin/events"],
  ["POST", "/admin/events"],
  ["GET", "/admin/shop/products"],
  ["POST", "/admin/shop/products"],
];

test("gate: ogni rotta /admin/* → 404 SENZA token (mai 403)", async () => {
  const s = await startAdminServer();
  try {
    for (const [method, path] of ADMIN_ROUTES) {
      const r = await call(s.base, method, path, { body: method === "POST" ? {} : undefined });
      assert.equal(r.status, 404, `${method} ${path} senza token deve dare 404 (dato ${r.status})`);
      assert.equal(r.json?.error, "NOT_FOUND");
    }
  } finally {
    await s.close();
  }
});

test("gate: ogni rotta /admin/* → 404 per un OSPITE", async () => {
  const s = await startAdminServer();
  try {
    const guest = await makeGuest(s.base);
    for (const [method, path] of ADMIN_ROUTES) {
      const r = await call(s.base, method, path, { token: guest.token, body: method === "POST" ? {} : undefined });
      assert.equal(r.status, 404, `${method} ${path} ospite deve dare 404 (dato ${r.status})`);
    }
  } finally {
    await s.close();
  }
});

test("gate: ogni rotta /admin/* → 404 per un UTENTE normale (non admin)", async () => {
  const s = await startAdminServer();
  try {
    const u = await makeUser(s.base, "user.normale@example.com");
    for (const [method, path] of ADMIN_ROUTES) {
      const r = await call(s.base, method, path, { token: u.token, body: method === "POST" ? {} : undefined });
      assert.equal(r.status, 404, `${method} ${path} utente deve dare 404 (dato ${r.status})`);
    }
  } finally {
    await s.close();
  }
});

test("admin: GET /admin/ping → 200 { ok: true }", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "capo@example.com");
    const r = await call(s.base, "GET", "/admin/ping", { token: admin.token });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
  } finally {
    await s.close();
  }
});

test("S3: ruolo revocato dal DB → accesso negato anche col token ancora valido", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "revocando@example.com");
    // Con ruolo admin: 200.
    let r = await call(s.base, "GET", "/admin/ping", { token: admin.token });
    assert.equal(r.status, 200);
    // Revoca del ruolo (lo store riflette la lettura per-richiesta): stesso token → 404.
    s.store.adminIds.delete(admin.id);
    r = await call(s.base, "GET", "/admin/ping", { token: admin.token });
    assert.equal(r.status, 404, "dopo la revoca il token valido non deve più accedere");
  } finally {
    await s.close();
  }
});

test("users: elenco vuoto senza DB, forma corretta e nessun campo sensibile", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "lista@example.com");
    const r = await call(s.base, "GET", "/admin/users", { token: admin.token });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.items));
    assert.equal(r.json.nextCursor, null);
    assert.equal(r.json.limit, 20); // default
    // Whitelist: le uniche chiavi ammesse a livello di risposta.
    assert.deepEqual(Object.keys(r.json).sort(), ["items", "limit", "nextCursor"]);
  } finally {
    await s.close();
  }
});

test("users: limit fuori range (101) → 400", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "lista2@example.com");
    const r = await call(s.base, "GET", "/admin/users?limit=101", { token: admin.token });
    assert.equal(r.status, 400);
  } finally {
    await s.close();
  }
});

test("logs/links: ritorna SOLO gli URL (null se non configurati), nessun segreto", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "loglink@example.com");
    const r = await call(s.base, "GET", "/admin/logs/links", { token: admin.token });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ["neonUrl", "renderUrl"]);
    // Env non impostate nel test → null. Comunque MAI una chiave API nel payload.
    assert.equal(r.json.renderUrl, null);
    assert.equal(r.json.neonUrl, null);
    assert.ok(!/api[-_]?key|secret|bearer/i.test(r.text), "nessun segreto nel payload dei link");
  } finally {
    await s.close();
  }
});

test("status/check: semaforo binario, DB rosso senza pool, testo sempre presente", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "semaforo@example.com");
    const r = await call(s.base, "POST", "/admin/status/check", { token: admin.token, body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.fe, "green"); // il pannello è caricato
    assert.equal(r.json.be, "green"); // l'endpoint ha risposto
    assert.equal(r.json.db, "red"); // nessun pool nei test → rosso
    assert.equal(typeof r.json.checkedAt, "number");
    // Il colore è SEMPRE accompagnato da testo (mai solo colore).
    assert.equal(typeof r.json.detail.be, "string");
    assert.ok(r.json.detail.be.length > 0);
    assert.ok(r.json.detail.db.length > 0);
  } finally {
    await s.close();
  }
});

test("broadcast dry-run: espone lo stato quota (cap/remaining/sufficiente)", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "quota@example.com");
    const r = await call(s.base, "POST", "/admin/broadcasts", {
      token: admin.token,
      body: { oggetto: "Ciao", corpo: "Comunicazione di servizio", tipo: "servizio", criterio: { all: true }, dryRun: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.dryRun, true);
    assert.equal(r.json.count, 0); // nessun destinatario senza DB
    assert.equal(typeof r.json.quotaCap, "number");
    assert.ok(r.json.quotaCap > 0);
    assert.equal(r.json.quotaRemaining, r.json.quotaCap); // niente inviato oggi senza DB
    assert.equal(r.json.quotaSufficiente, true); // 0 destinatari ≤ residuo
  } finally {
    await s.close();
  }
});

test("broadcast create: body non valido → 400", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "bcastbad@example.com");
    const r = await call(s.base, "POST", "/admin/broadcasts", { token: admin.token, body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.json?.error, "INVALID_BODY");
  } finally {
    await s.close();
  }
});

test("broadcast send: rate-limit 10/30s per admin → l'11ª richiesta è 429", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "ratelimit@example.com");
    // Le prime 10 passano il rate-limit (senza DB l'invio dà 404 'non trovata', ma
    // la richiesta CONSUMA comunque il budget del limiter).
    for (let i = 0; i < 10; i++) {
      const r = await call(s.base, "POST", `/admin/broadcasts/${RANDOM_UUID}/send`, { token: admin.token, body: {} });
      assert.notEqual(r.status, 429, `la richiesta ${i + 1} non deve essere 429`);
    }
    const over = await call(s.base, "POST", `/admin/broadcasts/${RANDOM_UUID}/send`, { token: admin.token, body: {} });
    assert.equal(over.status, 429, "l'11ª richiesta in 30s deve essere 429");
    assert.equal(over.json?.error, "RATE_LIMITED");
    assert.ok(over.headers.get("retry-after"), "429 deve includere Retry-After");
  } finally {
    await s.close();
  }
});

test("eventi (predisposizione): list vuota, create senza DB → 503, body invalido → 400", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "eventi@example.com");
    const list = await call(s.base, "GET", "/admin/events", { token: admin.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.items, []);
    const okBody = await call(s.base, "POST", "/admin/events", {
      token: admin.token,
      body: { titolo: "Torneo di primavera", inizioAt: Date.now() },
    });
    assert.equal(okBody.status, 503); // NO_DB: persistenza non disponibile nei test
    assert.equal(okBody.json?.error, "NO_DB");
    const badBody = await call(s.base, "POST", "/admin/events", { token: admin.token, body: {} });
    assert.equal(badBody.status, 400);
  } finally {
    await s.close();
  }
});

test("shop (predisposizione): list vuota, create senza DB → 503, body invalido → 400", async () => {
  const s = await startAdminServer();
  try {
    const admin = await makeAdmin(s, "shop@example.com");
    const list = await call(s.base, "GET", "/admin/shop/products", { token: admin.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.items, []);
    const okBody = await call(s.base, "POST", "/admin/shop/products", {
      token: admin.token,
      body: { nome: "Mazzo da burraco", prezzoCent: 1500 },
    });
    assert.equal(okBody.status, 503);
    assert.equal(okBody.json?.error, "NO_DB");
    const badBody = await call(s.base, "POST", "/admin/shop/products", { token: admin.token, body: {} });
    assert.equal(badBody.status, 400);
  } finally {
    await s.close();
  }
});

test("register: l'email di benvenuto non blocca né fa fallire la registrazione", async () => {
  const s = await startAdminServer();
  try {
    // makeUser richiede 201; l'enqueue welcome è best-effort (no-op senza DB) e non
    // deve mai far fallire la register né ritardarla.
    const u = await makeUser(s.base, "benvenuto@example.com", "password12", "Nuovo Giocatore");
    assert.ok(u.token, "la registrazione deve restituire un token di sessione");
    assert.equal(u.user.email, "benvenuto@example.com");
  } finally {
    await s.close();
  }
});
