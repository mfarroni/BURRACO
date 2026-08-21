import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

/**
 * REMEDIATION CORS — Strato (b) PATTERN Vercel della policy origin (SEC-09).
 *
 * In PRODUZIONE, con ALLOWED_ORIGINS assente, gli URL generati da Vercel per il
 * progetto/team (default burraco/groupgames) devono essere ammessi sia per la
 * preflight CORS HTTP sia per l'handshake WS; ogni variante ostile che contiene
 * "vercel.app" come sottostringa deve essere RIFIUTATA (regex ancorata ^…$).
 *
 * Env impostata PRIMA dell'import dinamico del modulo (isolamento di processo del
 * test runner: file dedicato).
 */

process.env.NODE_ENV = "production";
delete process.env.ALLOWED_ORIGINS; // solo lo strato (b) pattern deve ammettere
delete process.env.VERCEL_PROJECT; // usa il default "burraco"
delete process.env.VERCEL_TEAM_SLUG; // usa il default "groupgames"

const BRANCH_ORIGIN = "https://burraco-git-main-groupgames.vercel.app";
const PREVIEW_ORIGIN = "https://burraco-abc123xyz-groupgames.vercel.app";
const PROD_ORIGIN = "https://burraco.vercel.app";

// Origin ostili che contengono "vercel.app" ma NON sono il progetto/team legittimo.
const HOSTILE_ORIGINS = [
  "https://notburraco-git-main-groupgames.vercel.app", // progetto non ancorato all'inizio
  "https://burraco-git-main-groupgames.vercel.app.attacker.com", // suffisso dopo vercel.app
  "https://x-groupgames.vercel.app.attacker.com", // suffisso + progetto errato
  "https://burraco-git-main-evilteam.vercel.app", // team errato
  "http://burraco.vercel.app", // schema non https
  "https://burracox.vercel.app", // progetto come prefisso
];

// ─── HTTP: preflight CORS ──────────────────────────────────────────────────
let httpServer: http.Server;
let httpBase: string;

before(async () => {
  const { createHttpApp } = await import("../src/http/app.js");
  const { AuthService } = await import("../src/auth/service.js");
  const { MemoryAuthStore } = await import("../src/auth/store.memory.js");
  const auth = new AuthService(new MemoryAuthStore());
  httpServer = http.createServer(createHttpApp(auth));
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  httpBase = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function preflight(origin: string, path: string) {
  return fetch(httpBase + path, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,authorization",
    },
  });
}

for (const path of ["/auth/login", "/auth/register"]) {
  test(`preflight ${path}: branch Vercel ammesso -> 2xx + ACAO = origin specifico`, async () => {
    const res = await preflight(BRANCH_ORIGIN, path);
    assert.ok(res.status === 204 || res.status === 200, `status ${res.status}`);
    assert.equal(res.headers.get("access-control-allow-origin"), BRANCH_ORIGIN);
    assert.notEqual(res.headers.get("access-control-allow-origin"), "*");
  });
}

test("preflight /auth/login: produzione e preview Vercel ammessi", async () => {
  for (const origin of [PROD_ORIGIN, PREVIEW_ORIGIN]) {
    const res = await preflight(origin, "/auth/login");
    assert.equal(res.headers.get("access-control-allow-origin"), origin, `atteso ACAO=${origin}`);
  }
});

test("preflight /auth/login: origin ostili con 'vercel.app' -> nessun header CORS", async () => {
  for (const origin of HOSTILE_ORIGINS) {
    const res = await preflight(origin, "/auth/login");
    assert.equal(
      res.headers.get("access-control-allow-origin"),
      null,
      `origin ostile ammessa per errore: ${origin}`,
    );
  }
});

// ─── WS: handshake ─────────────────────────────────────────────────────────
let wsServer: http.Server;
let wsUrl: string;

before(async () => {
  const { createServer } = await import("../src/ws/server.js");
  wsServer = createServer();
  await new Promise<void>((resolve) => wsServer.listen(0, resolve));
  const { port } = wsServer.address() as AddressInfo;
  wsUrl = `ws://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => wsServer.close(() => resolve()));
});

function connect(origin?: string): Promise<{ opened: boolean; code?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, origin ? { origin } : undefined);
    let opened = false;
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      resolve({ opened });
    }, 1500);
    ws.on("open", () => {
      opened = true;
    });
    ws.on("close", (code) => {
      clearTimeout(t);
      resolve({ opened, code });
    });
    ws.on("error", () => {
      /* la chiusura arriva comunque */
    });
  });
}

test("WS handshake: branch Vercel ammesso -> connessione aperta", async () => {
  const r = await connect(BRANCH_ORIGIN);
  assert.equal(r.opened, true, "branch origin: connessione aperta");
});

test("WS handshake: origin ostili con 'vercel.app' -> rifiutati (1008)", async () => {
  for (const origin of HOSTILE_ORIGINS) {
    const r = await connect(origin);
    assert.equal(r.code, 1008, `origin ostile non rifiutata: ${origin}`);
  }
});
