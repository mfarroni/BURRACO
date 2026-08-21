import { env } from "../config.js";

/**
 * POLICY ORIGIN unica del backend (SEC-09), condivisa da WS (`ws/server.ts`) e
 * HTTP/CORS (`http/app.ts`) così che la superficie di rete abbia UN solo
 * comportamento fail-closed. Modulo interno al BE: NON è un package condiviso col
 * FE (decisione #8), è solo riuso all'interno del backend.
 *
 * Allowlist a DUE STRATI (entrambi valutati; basta uno per ammettere):
 *  - strato (a) ESATTO: `env.allowedOrigins` (CSV ALLOWED_ORIGINS). Per
 *    produzione/custom domain/casi speciali. Fail-closed invariato: in prod "*"
 *    o lista assente NON ammette nulla per questo strato.
 *  - strato (b) PATTERN Vercel (SEMPRE attivo): riconosce gli URL che Vercel
 *    genera per il progetto (`VERCEL_PROJECT`) e il team (`VERCEL_TEAM_SLUG`):
 *      - https://<progetto>.vercel.app                         (produzione)
 *      - https://<progetto>-git-<branch>-<team>.vercel.app     (branch, stabile)
 *      - https://<progetto>-<hash>-<team>.vercel.app           (deployment/preview)
 *    Regex ANCORATA `^…$`, schema OBBLIGATORIO https, progetto/team ESCAPATI:
 *    niente echo cieco dell'Origin, niente suffissi/prefissi malevoli ammessi.
 *
 * Comportamento per ambiente:
 *  - prod: ammette SOLO chi passa lo strato (a) o (b); origin mancante = rifiuto;
 *          ogni rifiuto è loggato (console.warn) con l'origin sanitizzato.
 *  - dev : permissivo (consente "*" e client non-browser senza origin) per curl/test,
 *          più lo strato (b) per comodità.
 */

/** Escapa i metacaratteri regex di una stringa interpolata (progetto/team da env). */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Costruisce la regex ANCORATA per gli URL Vercel del progetto/team.
 * - Il segmento branch usa `[a-z0-9-]+` (Vercel normalizza il nome branch), il
 *   segmento hash usa `[a-z0-9]+`: nessuno dei due include il punto, così un
 *   attaccante non può iniettare un sottodominio extra.
 * - Le forme branch/preview DEVONO terminare con `-<team>.vercel.app`; la forma
 *   produzione è `<progetto>.vercel.app` (senza team).
 */
function buildVercelOriginRegex(project: string, team: string): RegExp {
  const p = escapeRegExp(project);
  const t = escapeRegExp(team);
  return new RegExp(
    "^https://" +
      p +
      "(?:" +
      "\\.vercel\\.app" + // produzione: <progetto>.vercel.app
      "|-git-[a-z0-9-]+-" + t + "\\.vercel\\.app" + // branch: <progetto>-git-<branch>-<team>.vercel.app
      "|-[a-z0-9]+-" + t + "\\.vercel\\.app" + // preview: <progetto>-<hash>-<team>.vercel.app
      ")$",
  );
}

/**
 * Regex costruita UNA volta al load del modulo dai valori env (statici). I test
 * che sovrascrivono VERCEL_PROJECT/VERCEL_TEAM_SLUG usano import dinamico, quindi
 * ottengono un modulo fresco con la regex ricalcolata.
 */
const VERCEL_ORIGIN_RE = buildVercelOriginRegex(env.vercelProject, env.vercelTeamSlug);

/** True se `origin` è un URL Vercel legittimo del progetto/team (strato b). */
function matchesVercelPattern(origin: string): boolean {
  return VERCEL_ORIGIN_RE.test(origin);
}

/**
 * Ripulisce l'origin per il log: scarta caratteri di controllo/newline
 * (anti log-injection) e limita la lunghezza. L'origin NON è un segreto; qui non
 * transitano token/hash/password. Nessun carattere di controllo nel sorgente:
 * il filtro è per codepoint (byte < 0x20 e DEL 0x7f rimossi).
 */
function sanitizeForLog(value: string): string {
  let out = "";
  for (const ch of value.slice(0, 256)) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

/** Traccia esplicitamente il rifiuto in produzione (requisito #5). */
function warnRejectedOrigin(origin: string): void {
  if (env.isProd) {
    console.warn(`[origin] rifiutata origin non consentita: "${sanitizeForLog(origin)}"`);
  }
}

export function isOriginAllowed(origin: string | undefined): boolean {
  const list = env.allowedOrigins;

  if (env.isProd) {
    // strato (a) ESATTO: valido solo con lista esplicita e senza "*" (fail-closed).
    if (origin && list.length > 0 && !list.includes("*") && list.includes(origin)) {
      return true;
    }
    // strato (b) PATTERN Vercel: sempre attivo, indipendente dalla presenza della lista.
    if (origin && matchesVercelPattern(origin)) {
      return true;
    }
    // Rifiuto (inclusi origin mancante e misconfig "*"/lista vuota): log + fail-closed.
    if (origin) warnRejectedOrigin(origin);
    return false;
  }

  // Sviluppo locale: comportamento permissivo per test/curl.
  if (list.includes("*")) return true;
  if (!origin) return true;
  if (list.includes(origin)) return true;
  return matchesVercelPattern(origin);
}
