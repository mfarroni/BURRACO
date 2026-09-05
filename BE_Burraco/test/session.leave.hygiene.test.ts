import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { hashToken } from "../src/auth/tokens.js";

/**
 * IGIENE SESSIONI (§6): beacon POST /session/leave (chiusura MORBIDA con grazia) +
 * logout esplicito (immediato) + scadenza ospite + sweep. AuthService + store
 * in-memory, http reale + fetch. Grazia breve iniettata via env per determinismo.
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GRACE = 40; // ms

let server: http.Server;
let base: string;
let store: MemoryAuthStore;
let auth: AuthService;
const ORIG_GRACE = process.env.RECONNECT_GRACE_MS;

before(async () => {
  process.env.RECONNECT_GRACE_MS = String(GRACE);
  store = new MemoryAuthStore();
  auth = new AuthService(store);
  const app = createHttpApp(auth, undefined);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (ORIG_GRACE === undefined) delete process.env.RECONNECT_GRACE_MS;
  else process.env.RECONNECT_GRACE_MS = ORIG_GRACE;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function guest(name: string): Promise<{ token: string; id: string }> {
  const r = await auth.createGuest(name);
  return { token: r.sessionToken, id: r.user.id };
}
async function register(email: string): Promise<{ token: string; id: string }> {
  const r = await auth.register(email, "password12", "Reg");
  return { token: r.sessionToken, id: r.user.id };
}
const revoked = async (token: string): Promise<boolean> => {
  const s = await store.getSessionByTokenHash(hashToken(token));
  return !s || s.revokedAt !== null;
};

/* ─────────────────────── endpoint HTTP /session/leave ─────────────────────── */

test("beacon: risponde 204; ripetuto è neutro; token ignoto è neutro", async () => {
  const g = await guest("Marco");
  const post = (body: string) => fetch(base + "/session/leave", { method: "POST", body });
  assert.equal((await post(g.token)).status, 204);
  assert.equal((await post(g.token)).status, 204, "ripetizione idempotente");
  assert.equal((await post("token-ignoto")).status, 204, "token ignoto: neutro");
});

test("beacon blindato: chiudere col proprio token non tocca la sessione di un altro", async () => {
  const a = await guest("Anna");
  const b = await guest("Bruno");
  await fetch(base + "/session/leave", { method: "POST", body: a.token });
  await delay(GRACE * 3);
  assert.ok(await revoked(a.token), "sessione di Anna chiusa dopo la grazia");
  assert.ok(!(await revoked(b.token)), "sessione di Bruno INTATTA (non espellibile)");
});

/* ─────────────────── chiusura morbida con grazia (§6.3) ────────────────────── */

test("beacon ospite: senza resume, oltre la grazia → sessione chiusa e ospite scaduto (displayName intatto)", async () => {
  const g = await guest("Ospite Pippo");
  await auth.leaveSession(g.token);
  assert.ok(!(await revoked(g.token)), "entro la grazia la sessione è ancora viva");
  await delay(GRACE * 3);
  assert.ok(await revoked(g.token), "oltre la grazia la sessione è chiusa");
  const u = await store.getUserById(g.id);
  assert.ok(u, "record ospite NON cancellato");
  assert.ok(u!.expiredAt instanceof Date, "ospite marcato scaduto");
  assert.equal(u!.displayName, "Ospite Pippo", "displayName leggibile in chiaro");
});

test("F5/resume: un'attività autenticata entro la grazia ANNULLA la chiusura", async () => {
  const g = await guest("Refresh");
  await auth.leaveSession(g.token);
  // Simula il reload che rivaluta /auth/me entro la grazia (attività → resume).
  const principal = await auth.getPrincipalByToken(g.token);
  assert.ok(principal, "sessione ancora valida entro la grazia");
  await delay(GRACE * 3);
  assert.ok(!(await revoked(g.token)), "chiusura annullata dal resume: sessione viva");
  assert.ok(await auth.getPrincipalByToken(g.token), "l'utente resta autenticato dopo l'F5");
});

test("beacon registrato: oltre la grazia rimuove la sola sessione, l'account resta intatto", async () => {
  const r = await register("intatto@example.com");
  await auth.leaveSession(r.token);
  await delay(GRACE * 3);
  assert.ok(await revoked(r.token), "sessione rimossa");
  const u = await store.getUserById(r.id);
  assert.ok(u && u.email === "intatto@example.com" && u.expiredAt === null, "account MAI toccato");
  const relog = await auth.login("intatto@example.com", "password12");
  assert.ok(relog.sessionToken, "rilogin possibile: credenziali/statistiche intatte");
});

/* ─────────────────── uscita esplicita immediata (§6.2/§9.16) ───────────────── */

test("logout ospite (ritorno alla vetrina): scadenza e revoca IMMEDIATE, senza grazia", async () => {
  const g = await guest("Ospite Subito");
  await auth.logout(g.token);
  assert.ok(await revoked(g.token), "sessione revocata subito");
  const u = await store.getUserById(g.id);
  assert.ok(u!.expiredAt instanceof Date, "ospite marcato scaduto subito");
  assert.equal(u!.displayName, "Ospite Subito", "displayName leggibile");
});

test("logout registrato: revoca immediata della sessione, account intatto", async () => {
  const r = await register("logout-reg@example.com");
  await auth.logout(r.token);
  assert.ok(await revoked(r.token));
  const u = await store.getUserById(r.id);
  assert.ok(u && u.expiredAt === null, "registrato mai marcato scaduto");
});

/* ─────────────────────── SWEEP ospiti (§6.4) ─────────────────────── */

test("sweep: ospite SCADUTO e non referenziato eliminato; con sessione resta", async () => {
  const s = new MemoryAuthStore();
  const gExpired = await s.createUser({ email: null, displayName: "Scaduto", passwordHash: null, isGuest: true });
  await s.markGuestExpired(gExpired.id, new Date());
  const gWithSess = await s.createUser({ email: null, displayName: "ConSessione", passwordHash: null, isGuest: true });
  await s.createSession({ userId: gWithSess.id, tokenHash: "hash1", expiresAt: new Date(Date.now() + 1e6) });
  await s.markGuestExpired(gWithSess.id, new Date());

  const removed = await s.pruneInactiveGuests(new Date(0)); // solo la scadenza conta qui
  assert.equal(removed, 1);
  assert.equal(await s.getUserById(gExpired.id), null, "scaduto+libero eliminato");
  assert.ok(await s.getUserById(gWithSess.id), "scaduto ma con sessione: resta");
});

test("sweep: markGuestExpired è no-op sui registrati e non li elimina", async () => {
  const s = new MemoryAuthStore();
  const reg = await s.createUser({ email: "r@x.it", displayName: "Reg", passwordHash: "h", isGuest: false });
  await s.markGuestExpired(reg.id, new Date());
  assert.equal((await s.getUserById(reg.id))!.expiredAt, null, "registrato mai scaduto");
  assert.equal(await s.pruneInactiveGuests(new Date(Date.now() + 1e9)), 0, "nessun registrato eliminato");
});
