import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";

/**
 * REMEDIATION di sicurezza (macro-ciclo 1) — verifiche sul rate-limit:
 *
 *  - SEC-A1: lo spoofing di `X-Forwarded-For` NON aggira più il rate-limit.
 *    Con `app.set("trust proxy", 1)` Express calcola `req.ip` come l'entry PIÙ A
 *    DESTRA di XFF (quella appesa dal proxy fidato / Render), NON la prima
 *    controllata dal client. Il limiter ora usa `req.ip`: ruotare la parte
 *    sinistra (falsificabile) dell'header non crea più un bucket nuovo.
 *
 *  - SEC-A3a: i budget di /auth/register e /auth/guest sono INDIPENDENTI
 *    (limiter distinti): esaurire l'uno non consuma l'altro.
 *
 * Nessun DB: AuthService in-memory. Le soglie sono quelle di produzione
 * (register 50, guest 50, login 20 per finestra da 15 min).
 */

const GUEST_MAX = 50;
const REGISTER_MAX = 50;

/** Avvia un server HTTP isolato (limiter freschi) e restituisce base URL + teardown. */
async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const auth = new AuthService(new MemoryAuthStore());
  const app = createHttpApp(auth);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function post(
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<number> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  // Drena il corpo per non lasciare socket appesi.
  await res.text().catch(() => undefined);
  return res.status;
}

test("SEC-A1: X-Forwarded-For DIVERSO a ogni richiesta NON aggira il rate-limit (429 scatta comunque)", async () => {
  const { base, close } = await startServer();
  try {
    // Simuliamo Render: il proxy FIDATO appende l'IP reale come entry più a destra
    // di XFF. L'attaccante può solo PREPORRE valori falsificati a sinistra. Poiché
    // `req.ip` (trust proxy 1) prende l'entry più a destra, l'IP reale resta stabile
    // → stesso bucket → il limite scatta. Col vecchio codice (che leggeva il PRIMO
    // elemento di XFF) ogni richiesta avrebbe avuto un bucket nuovo e il 429 non
    // sarebbe MAI scattato.
    const realIp = "203.0.113.9"; // entry fissa "appesa dal proxy"
    let got429 = false;
    for (let i = 0; i < GUEST_MAX + 10; i++) {
      const spoof = `10.0.0.${i % 250}`; // parte sinistra ruotata a ogni richiesta
      const status = await post(
        base,
        "/auth/guest",
        { displayName: `G${i}` },
        { "X-Forwarded-For": `${spoof}, ${realIp}` },
      );
      if (status === 429) {
        got429 = true;
        break;
      }
    }
    assert.equal(got429, true, "lo spoofing rotante di X-Forwarded-For non aggira più il rate-limit");
  } finally {
    await close();
  }
});

test("SEC-A1 (controllo): flood dallo STESSO IP → 429 (comportamento invariato)", async () => {
  const { base, close } = await startServer();
  try {
    let got429 = false;
    for (let i = 0; i < GUEST_MAX + 10; i++) {
      // Nessun XFF: req.ip = IP del socket (127.0.0.1), costante.
      const status = await post(base, "/auth/guest", { displayName: `G${i}` });
      if (status === 429) {
        got429 = true;
        break;
      }
    }
    assert.equal(got429, true, "il flood dallo stesso IP resta limitato a 429");
  } finally {
    await close();
  }
});

test("SEC-A3a: esaurire /auth/guest NON produce 429 su /auth/register (budget indipendenti)", async () => {
  const { base, close } = await startServer();
  try {
    // Satura il budget guest (max 50) dallo stesso IP fino al 429.
    let guest429 = false;
    for (let i = 0; i < GUEST_MAX + 10; i++) {
      const status = await post(base, "/auth/guest", { displayName: `G${i}` });
      if (status === 429) {
        guest429 = true;
        break;
      }
    }
    assert.equal(guest429, true, "il budget guest si esaurisce (429)");

    // Register dallo STESSO IP: NON deve essere 429 (budget separato). Body valido
    // → 201; comunque qualsiasi status != 429 dimostra l'indipendenza.
    const regStatus = await post(base, "/auth/register", {
      email: "indip-register@example.com",
      password: "password12",
    });
    assert.notEqual(regStatus, 429, "il register mantiene il proprio budget nonostante il flood ospiti");
    assert.equal(regStatus, 201, "register legittimo va a buon fine (201)");
  } finally {
    await close();
  }
});

test("SEC-A3a: esaurire /auth/register NON produce 429 su /auth/guest (budget indipendenti)", async () => {
  const { base, close } = await startServer();
  try {
    // Satura il budget register (max 50) con body NON validi: il limiter conta la
    // richiesta PRIMA della validazione zod, quindi il flood è rapido (niente argon2).
    let reg429 = false;
    for (let i = 0; i < REGISTER_MAX + 10; i++) {
      const status = await post(base, "/auth/register", { email: "not-an-email", password: "x" });
      if (status === 429) {
        reg429 = true;
        break;
      }
    }
    assert.equal(reg429, true, "il budget register si esaurisce (429)");

    // Guest dallo STESSO IP: NON deve essere 429 (budget separato).
    const guestStatus = await post(base, "/auth/guest", { displayName: "OspiteOk" });
    assert.notEqual(guestStatus, 429, "il guest mantiene il proprio budget nonostante il flood register");
    assert.equal(guestStatus, 201, "guest legittimo va a buon fine (201)");
  } finally {
    await close();
  }
});
