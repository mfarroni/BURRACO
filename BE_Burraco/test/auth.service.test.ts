import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { AuthService, AuthError } from "../src/auth/service.js";
import { hashToken } from "../src/auth/tokens.js";

/**
 * Test unit del layer AUTH con AuthStore IN-MEMORY (nessun DB, coerente con la
 * testabilità senza DATABASE_URL). Coprono: hashing/verifica password, emissione/
 * risoluzione/scadenza/revoca del token opaco, errore di login GENERICO, ospite.
 * Non toccano rete né motore di gioco.
 */

function newService(opts?: { sessionTtlMs?: number }): { svc: AuthService; store: MemoryAuthStore } {
  const store = new MemoryAuthStore();
  return { svc: new AuthService(store, opts), store };
}

test("register: crea utente non-ospite, emette token e NON persiste segreti in chiaro", async () => {
  const { svc, store } = newService();
  const res = await svc.register("Mario.Rossi@Example.com", "supersegreta", "Mario");

  assert.equal(res.user.isGuest, false);
  assert.equal(res.user.email, "mario.rossi@example.com", "email normalizzata a lowercase");
  assert.equal(res.user.displayName, "Mario");
  assert.ok(res.sessionToken.length >= 20, "token opaco ad alta entropia");

  // Nel record utente c'è l'hash argon2id, MAI la password in chiaro.
  const stored = await store.getUserByEmail("mario.rossi@example.com");
  assert.ok(stored?.passwordHash?.startsWith("$argon2id$"), "hash argon2id presente");
  assert.notEqual(stored?.passwordHash, "supersegreta");

  // Nel record sessione c'è solo l'HASH del token, mai il token in chiaro.
  const session = await store.getSessionByTokenHash(hashToken(res.sessionToken));
  assert.ok(session, "sessione trovata per hash del token");
  assert.notEqual(session!.tokenHash, res.sessionToken, "in sessione solo l'hash");
});

test("register: email duplicata → EMAIL_TAKEN (409)", async () => {
  const { svc } = newService();
  await svc.register("dup@example.com", "password1", "A");
  await assert.rejects(
    () => svc.register("DUP@example.com", "password2", "B"),
    (e) => e instanceof AuthError && e.code === "EMAIL_TAKEN",
  );
});

test("register: password troppo corta → WEAK_PASSWORD (400)", async () => {
  const { svc } = newService();
  await assert.rejects(
    () => svc.register("weak@example.com", "1234", "A"),
    (e) => e instanceof AuthError && e.code === "WEAK_PASSWORD",
  );
});

test("login: credenziali corrette → nuovo token risolvibile al principale", async () => {
  const { svc } = newService();
  await svc.register("login@example.com", "correcthorse", "Anna");
  const res = await svc.login("LOGIN@example.com", "correcthorse");
  const principal = await svc.getPrincipalByToken(res.sessionToken);
  assert.ok(principal, "principale risolto");
  assert.equal(principal!.displayName, "Anna");
  assert.equal(principal!.isGuest, false);
});

test("login: password errata → INVALID_CREDENTIALS generico (nessun oracolo)", async () => {
  const { svc } = newService();
  await svc.register("oracle@example.com", "correcthorse", "Ann");
  // Email inesistente e password errata devono dare lo STESSO errore.
  const errUnknownEmail = await svc
    .login("nope@example.com", "whatever12")
    .then(() => null)
    .catch((e) => e);
  const errWrongPass = await svc
    .login("oracle@example.com", "sbagliata12")
    .then(() => null)
    .catch((e) => e);
  assert.ok(errUnknownEmail instanceof AuthError && errUnknownEmail.code === "INVALID_CREDENTIALS");
  assert.ok(errWrongPass instanceof AuthError && errWrongPass.code === "INVALID_CREDENTIALS");
  assert.equal(errUnknownEmail.message, errWrongPass.message, "messaggio identico: nessun oracolo");
});

test("guest: crea ospite senza email/password, token valido, isGuest=true", async () => {
  const { svc } = newService();
  const res = await svc.createGuest("Ospite Curioso");
  assert.equal(res.user.isGuest, true);
  assert.equal(res.user.email, null);
  const principal = await svc.getPrincipalByToken(res.sessionToken);
  assert.ok(principal && principal.isGuest);
  assert.equal(principal!.displayName, "Ospite Curioso");
});

test("guest: un ospite NON può fare login (nessun passwordHash) → INVALID_CREDENTIALS", async () => {
  const { svc } = newService();
  const g = await svc.createGuest("Tavolo9");
  // Anche fornendo l'id/nome, non esistono credenziali: login impossibile.
  await assert.rejects(
    () => svc.login("tavolo9", "qualsiasi123"),
    (e) => e instanceof AuthError && e.code === "INVALID_CREDENTIALS",
    "il ramo ospite non apre un oracolo di login",
  );
  assert.ok(g.sessionToken.length > 0);
});

test("token: revoca (logout) rende il token non più risolvibile", async () => {
  const { svc } = newService();
  const res = await svc.register("revoke@example.com", "password12", "R");
  assert.ok(await svc.getPrincipalByToken(res.sessionToken), "valido prima del logout");
  await svc.logout(res.sessionToken);
  assert.equal(await svc.getPrincipalByToken(res.sessionToken), null, "revocato dopo il logout");
  // /auth/me deve fallire con UNAUTHORIZED.
  await assert.rejects(
    () => svc.me(res.sessionToken),
    (e) => e instanceof AuthError && e.code === "UNAUTHORIZED",
  );
});

test("token: logout idempotente (doppia revoca non lancia)", async () => {
  const { svc } = newService();
  const res = await svc.register("idemp@example.com", "password12", "I");
  await svc.logout(res.sessionToken);
  await svc.logout(res.sessionToken); // non deve lanciare
  assert.equal(await svc.getPrincipalByToken(res.sessionToken), null);
});

test("token: scadenza rende il token non risolvibile", async () => {
  // TTL negativo → il token nasce già scaduto (deterministico, nessun timer).
  const { svc } = newService({ sessionTtlMs: -1000 });
  const res = await svc.register("expire@example.com", "password12", "E");
  assert.equal(await svc.getPrincipalByToken(res.sessionToken), null, "token scaduto");
});

test("token: assente/sconosciuto → null (nessuna eccezione)", async () => {
  const { svc } = newService();
  assert.equal(await svc.getPrincipalByToken(undefined), null);
  assert.equal(await svc.getPrincipalByToken(""), null);
  assert.equal(await svc.getPrincipalByToken("token-inesistente"), null);
});
