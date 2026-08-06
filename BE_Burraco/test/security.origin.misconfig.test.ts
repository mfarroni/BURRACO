import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type http from "node:http";

/**
 * SEC-09 — Prod MISCONFIGURATA: nessuna allowlist (o "*") -> TUTTO rifiutato
 * (fail-closed). "*" non è accettato come default in produzione.
 * File dedicato: env impostata prima dell'import dinamico del modulo.
 */

process.env.NODE_ENV = "production";
delete process.env.ALLOWED_ORIGINS; // allowlist assente in prod

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
    ws.on("error", () => { /* ignora */ });
  });
}

test("SEC-09 prod misconfig: allowlist assente -> qualunque origin rifiutata (1008)", async () => {
  const r = await connect({ origin: "https://ok.example" });
  assert.equal(r.code, 1008, "senza allowlist esplicita, prod rifiuta tutto");
});

test("SEC-09 prod misconfig: nessun origin -> rifiutata (1008)", async () => {
  const r = await connect();
  assert.equal(r.code, 1008, "fail-closed anche senza origin");
});
