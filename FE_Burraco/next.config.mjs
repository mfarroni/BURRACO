/** @type {import('next').NextConfig} */

/*
 * SEC-A6 — Content-Security-Policy in ENFORCE (non report-only).
 *
 * Il FE è una SPA client-side (tutti i componenti sono "use client"): l'unica
 * comunicazione esterna è verso il backend (Render) per HTTP /auth/* e per il
 * WebSocket di gioco. La policy blocca tutto tranne 'self' e quell'host.
 *
 * connect-src è PARAMETRIZZATO dalle env pubbliche (stesse usate dal client):
 *   NEXT_PUBLIC_API_URL  → origine HTTP(S) del BE
 *   NEXT_PUBLIC_WS_URL   → origine WS(S) del BE
 * Da ciascuna si ricava l'origine (schema://host:porta). In produzione tipicamente
 * https://<svc>.onrender.com e wss://<svc>.onrender.com.
 *
 * Allentamenti motivati (minimo necessario per far girare Next):
 *  - style-src 'unsafe-inline': Next/React iniettano stili inline (attributi style
 *    e styled-jsx). Senza nonce a livello di stile non è evitabile; nessun rischio
 *    di esecuzione codice (è CSS). NON usiamo Google Fonts (solo font di sistema),
 *    quindi font-src resta 'self'.
 *  - script-src 'unsafe-inline': Next inietta lo script di bootstrap/hydration
 *    inline senza nonce nell'App Router statico. 'unsafe-eval' è AMMESSO SOLO in
 *    sviluppo (HMR di Next lo richiede) e MAI in produzione (requisito SEC-A6).
 */

function originsFrom(...urls) {
  const out = new Set();
  for (const u of urls) {
    if (!u) continue;
    try {
      out.add(new URL(u).origin); // schema://host[:porta]
    } catch {
      /* URL malformata in env: ignorata (fail-safe, resta solo 'self') */
    }
  }
  return [...out];
}

const isDev = process.env.NODE_ENV !== "production";

const connectSrc = [
  "'self'",
  ...originsFrom(process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_WS_URL),
];

const scriptSrc = ["'self'", "'unsafe-inline'"];
if (isDev) scriptSrc.push("'unsafe-eval'"); // solo HMR in sviluppo; assente in prod

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src ${connectSrc.join(" ")}`,
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
