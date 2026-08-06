import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type http from "node:http";

/**
 * SEC-09 — Policy origin FAIL-CLOSED in produzione (allowlist PRESENTE).
 *
 * L'env deve essere impostata PRIMA che il modulo config venga valutato: qui
 * usiamo import DINAMICO dopo aver settato le variabili, in un file dedicato
 * (isolamento di processo del test runner). Verifica:
 *  - origin nell'allowlist -> connessione accettata;
 *  - origin NON in allowlist -> rifiutata (1008);
 *  - origin ASSENTE in prod -> rifiutata (1008).
 */

process.env.NODE_ENV = "production";
process.env.ALLOWED_ORIGINS = "https://ok.example";

let server: http.Server;
let url: string;

before(async () => {
  const { createServer } = await import("../src/ws/server.js");
  server = createServer();
  await new Promise<void>((res) => server.listen(0, res));
  const port = (server.address() as AddressInfo).port;
  url = `ws://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

function connect(opts?: { origin?: string }): Promise<{ opened: boolean; code?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, opts?.origin ? { origin: opts.origin } : undefined);
    let opened = false;
    const t = setTimeout(() => { try { ws.close(); } catch { /* noop */ } resolve({ opened }); }, 1500);
    ws.on("open", () => { opened = true; });
    ws.on("close", (code) => { clearTimeout(t); resolve({ opened, code }); });
    ws.on("error", () => { /* ignora: la chiusura arriva comunque */ });
  });
}

test("SEC-09 prod: origin in allowlist -> connessione accettata", async () => {
  const r = await connect({ origin: "https://ok.example" });
  assert.equal(r.opened, true, "origin consentita: connessione aperta");
});

test("SEC-09 prod: origin NON in allowlist -> rifiutata con 1008", async () => {
  const r = await connect({ origin: "https://evil.example" });
  // Il rifiuto origin avviene nel handler 'connection' (post-handshake): il
  // client può vedere un 'open' seguito subito dalla chiusura applicativa 1008.
  assert.equal(r.code, 1008, "origin non consentita: close 1008");
});

test("SEC-09 prod: origin ASSENTE -> rifiutata con 1008 (fail-closed)", async () => {
  const r = await connect(); // nessun header Origin
  assert.equal(r.code, 1008, "origin mancante in prod: close 1008");
});
