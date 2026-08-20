import { env } from "../config.js";

/**
 * POLICY ORIGIN unica del backend (SEC-09), condivisa da WS (`ws/server.ts`) e
 * HTTP/CORS (`http/app.ts`) così che la superficie di rete abbia UN solo
 * comportamento fail-closed. Modulo interno al BE: NON è un package condiviso col
 * FE (decisione #8), è solo riuso all'interno del backend.
 *
 *  - prod: allowlist ESPLICITA obbligatoria; mai "*"; origin mancante = rifiuto.
 *  - dev : permissivo (consente "*" e client non-browser senza origin) per curl/test.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  const list = env.allowedOrigins;
  if (env.isProd) {
    if (list.length === 0 || list.includes("*")) return false; // misconfig → fail-closed
    if (!origin) return false; // in prod un origin mancante non è "consentito"
    return list.includes(origin);
  }
  // Sviluppo locale: comportamento permissivo per test/curl.
  if (list.includes("*")) return true;
  if (!origin) return true;
  return list.includes(origin);
}
