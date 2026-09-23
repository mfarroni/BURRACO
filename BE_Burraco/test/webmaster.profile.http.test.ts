import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { MemoryStatsStore } from "../src/stats/store.memory.js";
import { createHttpApp } from "../src/http/app.js";
import { generateTempPassword } from "../src/admin/users.js";
import { startAdminServer, call, makeUser, makeAdmin, makeGuest, RANDOM_UUID } from "./adminTestKit.js";

/**
 * CICLO Webmaster/Profilo — nuove rotte: operazioni sul singolo utente, CRUD prodotti
 * con foto, foto profilo. Senza DB (come le altre suite): le operazioni DB-gated
 * rispondono 503/404, mentre GATE, VALIDAZIONE e TETTI di dimensione restano
 * verificabili al bordo HTTP. La foto profilo usa lo store in RAM.
 */

const NEW_ADMIN_ROUTES: [string, string][] = [
  ["POST", `/admin/users/${RANDOM_UUID}/delete`],
  ["POST", `/admin/users/${RANDOM_UUID}/reset-password`],
  ["POST", `/admin/shop/products/${RANDOM_UUID}`],
  ["POST", `/admin/shop/products/${RANDOM_UUID}/delete`],
];

// 1×1 PNG valido in base64.
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("gate: le nuove rotte /admin/* → 404 senza token, per un ospite e per un utente", async () => {
  const s = await startAdminServer();
  try {
    const guest = await makeGuest(s.base);
    const user = await makeUser(s.base, "u1@example.com");
    for (const [method, path] of NEW_ADMIN_ROUTES) {
      for (const token of [undefined, guest.token, user.token]) {
        const r = await call(s.base, method, path, { token, body: {} });
        assert.equal(r.status, 404, `${method} ${path} deve dare 404 ai non-admin (dato ${r.status})`);
        assert.equal(r.json?.error, "NOT_FOUND");
      }
    }
  } finally {
    await s.close();
  }
});

test("admin: id non-uuid → 400; senza DB le operazioni utente → 503", async () => {
  const s = await startAdminServer();
  try {
    const a = await makeAdmin(s, "admin@example.com");
    for (const [method, path] of NEW_ADMIN_ROUTES) {
      const bad = path.replace(RANDOM_UUID, "non-un-uuid");
      const r = await call(s.base, method, bad, { token: a.token, body: {} });
      assert.equal(r.status, 400, `${method} ${bad} deve dare 400 (dato ${r.status})`);
    }
    const del = await call(s.base, "POST", `/admin/users/${RANDOM_UUID}/delete`, { token: a.token, body: {} });
    assert.equal(del.status, 503);
    const rst = await call(s.base, "POST", `/admin/users/${RANDOM_UUID}/reset-password`, { token: a.token, body: {} });
    assert.equal(rst.status, 503);
  } finally {
    await s.close();
  }
});

test("admin prodotti: foto data URL valida accettata dalla validazione; SVG e dati non validi → 400", async () => {
  const s = await startAdminServer();
  try {
    const a = await makeAdmin(s, "admin@example.com");
    // Validazione superata → senza DB la persistenza manca (503), non 400.
    const ok = await call(s.base, "POST", "/admin/shop/products", {
      token: a.token,
      body: { nome: "Mazzo", prezzoCent: 1250, descrizione: "Carte", immagineUrl: PNG_1PX },
    });
    assert.equal(ok.status, 503);
    const svg = await call(s.base, "POST", "/admin/shop/products", {
      token: a.token,
      body: { nome: "Mazzo", immagineUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    });
    assert.equal(svg.status, 400);
    const js = await call(s.base, "POST", "/admin/shop/products", {
      token: a.token,
      body: { nome: "Mazzo", immagineUrl: "javascript:alert(1)" },
    });
    assert.equal(js.status, 400);
    // Modifica: body valido su prodotto inesistente → 404 (senza DB nessuna riga).
    const upd = await call(s.base, "POST", `/admin/shop/products/${RANDOM_UUID}`, {
      token: a.token,
      body: { nome: "Nuovo nome", immagineUrl: null, descrizione: null },
    });
    assert.equal(upd.status, 404);
    const updBad = await call(s.base, "POST", `/admin/shop/products/${RANDOM_UUID}`, {
      token: a.token,
      body: { nome: "" },
    });
    assert.equal(updBad.status, 400);
    const delP = await call(s.base, "POST", `/admin/shop/products/${RANDOM_UUID}/delete`, { token: a.token, body: {} });
    assert.equal(delP.status, 404);
  } finally {
    await s.close();
  }
});

test("tetti di dimensione: foto prodotto oltre il limite → 400/413; le altre rotte restano a 8kb", async () => {
  const s = await startAdminServer();
  try {
    const a = await makeAdmin(s, "admin@example.com");
    const huge = "data:image/jpeg;base64," + "A".repeat(420_000);
    const r = await call(s.base, "POST", "/admin/shop/products", { token: a.token, body: { nome: "X", immagineUrl: huge } });
    assert.ok(r.status === 400 || r.status === 413, `atteso 400/413, dato ${r.status}`);
    // Un corpo da 20kb su una rotta auth resta rifiutato dal parser globale (8kb).
    const big = await call(s.base, "POST", "/auth/guest", { body: { displayName: "x".repeat(20_000) } });
    assert.equal(big.status, 413);
  } finally {
    await s.close();
  }
});

async function startProfileServer() {
  const auth = new AuthService(new MemoryAuthStore());
  const app = createHttpApp(auth, new MemoryStatsStore());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("foto profilo: solo registrati; imposta, rilegge, rimuove; valida formato e dimensione", async () => {
  const s = await startProfileServer();
  try {
    const anon = await call(s.base, "GET", "/users/me/avatar");
    assert.equal(anon.status, 401);
    const guest = await makeGuest(s.base);
    const g = await call(s.base, "POST", "/users/me/avatar", { token: guest.token, body: { avatar: PNG_1PX } });
    assert.equal(g.status, 403);

    const u = await makeUser(s.base, "foto@example.com");
    const empty = await call(s.base, "GET", "/users/me/avatar", { token: u.token });
    assert.equal(empty.status, 200);
    assert.equal(empty.json.avatar, null);

    const set = await call(s.base, "POST", "/users/me/avatar", { token: u.token, body: { avatar: PNG_1PX } });
    assert.equal(set.status, 200);
    const read = await call(s.base, "GET", "/users/me/avatar", { token: u.token });
    assert.equal(read.json.avatar, PNG_1PX);

    // Isolamento: un altro utente non vede la foto del primo.
    const other = await makeUser(s.base, "altro@example.com");
    const otherRead = await call(s.base, "GET", "/users/me/avatar", { token: other.token });
    assert.equal(otherRead.json.avatar, null);

    const svg = await call(s.base, "POST", "/users/me/avatar", {
      token: u.token,
      body: { avatar: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    });
    assert.equal(svg.status, 400);
    const tooBig = await call(s.base, "POST", "/users/me/avatar", {
      token: u.token,
      body: { avatar: "data:image/jpeg;base64," + "A".repeat(151_000) },
    });
    assert.ok(tooBig.status === 400 || tooBig.status === 413, `atteso 400/413, dato ${tooBig.status}`);

    const del = await call(s.base, "POST", "/users/me/avatar", { token: u.token, body: { avatar: null } });
    assert.equal(del.status, 200);
    const after = await call(s.base, "GET", "/users/me/avatar", { token: u.token });
    assert.equal(after.json.avatar, null);
  } finally {
    await s.close();
  }
});

test("password temporanea: 12 caratteri, alfabeto senza ambigui, valori diversi", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const p = generateTempPassword();
    assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{12}$/);
    seen.add(p);
  }
  assert.equal(seen.size, 50);
});

test("cambio password: attuale errata → 400, nuova debole → 400, ospite → 403, successo → nuovo token e vecchie sessioni revocate", async () => {
  const s = await startProfileServer();
  try {
    const noTok = await call(s.base, "POST", "/auth/change-password", {
      body: { currentPassword: "password12", newPassword: "nuovaPassword1" },
    });
    assert.equal(noTok.status, 401);

    const guest = await makeGuest(s.base);
    const g = await call(s.base, "POST", "/auth/change-password", {
      token: guest.token,
      body: { currentPassword: "qualsiasi", newPassword: "nuovaPassword1" },
    });
    assert.equal(g.status, 403);
    assert.equal(g.json?.error, "GUEST_NO_PASSWORD");

    const u = await makeUser(s.base, "cambio@example.com", "password12");
    // Seconda sessione (altro dispositivo) dello stesso utente.
    const other = await call(s.base, "POST", "/auth/login", {
      body: { email: "cambio@example.com", password: "password12" },
    });
    assert.equal(other.status, 200);

    const wrong = await call(s.base, "POST", "/auth/change-password", {
      token: u.token,
      body: { currentPassword: "sbagliata", newPassword: "nuovaPassword1" },
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json?.error, "WRONG_PASSWORD");
    // La sessione resta valida dopo un tentativo errato.
    assert.equal((await call(s.base, "GET", "/auth/me", { token: u.token })).status, 200);

    const weak = await call(s.base, "POST", "/auth/change-password", {
      token: u.token,
      body: { currentPassword: "password12", newPassword: "corta" },
    });
    assert.equal(weak.status, 400);

    const ok = await call(s.base, "POST", "/auth/change-password", {
      token: u.token,
      body: { currentPassword: "password12", newPassword: "nuovaPassword1" },
    });
    assert.equal(ok.status, 200);
    assert.equal(typeof ok.json.token, "string");
    assert.notEqual(ok.json.token, u.token);
    assert.equal(ok.json.user.email, "cambio@example.com");
    assert.equal(ok.headers.get("cache-control"), "no-store");

    // Vecchie sessioni revocate (anche l'altro dispositivo); la nuova funziona.
    assert.equal((await call(s.base, "GET", "/auth/me", { token: u.token })).status, 401);
    assert.equal((await call(s.base, "GET", "/auth/me", { token: other.json.token })).status, 401);
    assert.equal((await call(s.base, "GET", "/auth/me", { token: ok.json.token })).status, 200);

    // Login: la vecchia password non vale più, la nuova sì.
    const oldLogin = await call(s.base, "POST", "/auth/login", {
      body: { email: "cambio@example.com", password: "password12" },
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await call(s.base, "POST", "/auth/login", {
      body: { email: "cambio@example.com", password: "nuovaPassword1" },
    });
    assert.equal(newLogin.status, 200);
  } finally {
    await s.close();
  }
});

test("comunicazioni: criterio userIds valido accettato (anche oltre 8kb); id non-uuid o lista vuota → 400", async () => {
  const s = await startAdminServer();
  try {
    const a = await makeAdmin(s, "admin@example.com");
    const base = { oggetto: "Ciao", corpo: "Testo", tipo: "servizio", dryRun: true };
    const ids = Array.from({ length: 500 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`);
    const ok = await call(s.base, "POST", "/admin/broadcasts", { token: a.token, body: { ...base, criterio: { userIds: ids } } });
    assert.equal(ok.status, 200, `atteso 200, dato ${ok.status}: ${ok.text}`);
    assert.equal(ok.json.dryRun, true);
    const bad = await call(s.base, "POST", "/admin/broadcasts", {
      token: a.token,
      body: { ...base, criterio: { userIds: ["non-un-uuid"] } },
    });
    assert.equal(bad.status, 400);
    const empty = await call(s.base, "POST", "/admin/broadcasts", { token: a.token, body: { ...base, criterio: { userIds: [] } } });
    assert.equal(empty.status, 400);
  } finally {
    await s.close();
  }
});
