import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import { z } from "zod";
import { AuthService, AuthError, type AuthErrorCode } from "../auth/service.js";
import { isOriginAllowed } from "../net/originPolicy.js";
import { rateLimit } from "./rateLimit.js";
import { env } from "../config.js";

/**
 * APP HTTP del backend auth (Express) montata sullo STESSO http.Server del WS
 * (decisione #1: web service persistente, non serverless). Espone:
 *   POST /auth/register  { email, password, displayName? } → { token, user }
 *   POST /auth/login     { email, password }               → { token, user }
 *   POST /auth/guest     { displayName? }                   → { token, user }
 *   POST /auth/logout    (Bearer)                           → { ok: true }
 *   POST /auth/logout-all(Bearer)                           → { ok: true, revoked }
 *   GET  /auth/me        (Bearer)                           → { user }
 *
 * Sicurezza:
 *  - security header HTTP (SEC-A5): nosniff, frame-deny, no-referrer, HSTS in prod.
 *  - CORS allowlist FAIL-CLOSED, specchio dell'origin del WS (net/originPolicy).
 *  - rate-limit in-RAM su login/register/guest (anti brute-force / abuso ospiti).
 *  - body validati con zod; corpi oltre 8kb rifiutati.
 *  - login errato → 401 GENERICO (nessun oracolo email-vs-password).
 *  - email duplicata → 409; password debole → 400.
 *  - NESSUN segreto nei log (token/hash/password non vengono mai loggati).
 */

/* ─────────────────────────────── validazione ─────────────────────────────── */

const emailSchema = z.string().trim().toLowerCase().email().max(254);
// Policy password: min 8 (allineata al servizio, difesa in profondità), max 200
// (evita DoS su argon2 con input enormi). La complessità fine è demandata all'UX.
const passwordSchema = z.string().min(8).max(200);
const displayNameSchema = z.string().trim().min(1).max(40).optional();

const registerBody = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
const loginBody = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(200),
});
const guestBody = z.object({ displayName: displayNameSchema });

/* ─────────────────────────────── helper ──────────────────────────────────── */

/** Mappa i codici d'errore stabili del servizio agli status HTTP. */
const STATUS_BY_CODE: Record<AuthErrorCode, number> = {
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  WEAK_PASSWORD: 400,
  UNAUTHORIZED: 401,
};

function sendAuthError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(STATUS_BY_CODE[err.code]).json({ error: err.code, message: err.message });
    return;
  }
  // Errore inatteso: nessun dettaglio interno verso il client, nessun segreto nei log.
  console.error("[auth] errore interno:", (err as Error).message);
  res.status(500).json({ error: "INTERNAL", message: "Errore interno del server." });
}

/** Estrae il Bearer token dall'header Authorization (o undefined). */
function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return undefined;
  const token = h.slice("Bearer ".length).trim();
  return token || undefined;
}

/** Avvolge un handler async instradando gli errori a sendAuthError (no unhandled). */
function handler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err) => sendAuthError(res, err));
  };
}

/* ─────────────────────────────── app ─────────────────────────────────────── */

export function createHttpApp(auth: AuthService): Express {
  const app = express();

  // Dietro il proxy di Render: fidati del primo hop per un req.ip coerente
  // (usato dal rate-limit). Non abilita spoofing: Render riscrive X-Forwarded-For.
  app.set("trust proxy", 1);
  // Nessun header rivelatore dello stack.
  app.disable("x-powered-by");

  // SEC-A5: security header su OGNI risposta HTTP. Il BE serve solo JSON di
  // servizio/auth (nessuna pagina), quindi una policy restrittiva non rompe nulla:
  //  - X-Content-Type-Options: nosniff → niente MIME sniffing.
  //  - X-Frame-Options: DENY + CSP frame-ancestors 'none' → no clickjacking/embedding.
  //  - Referrer-Policy: no-referrer → non trapela l'URL del BE a terzi.
  //  - HSTS SOLO in produzione (richiede https): forza wss/https, no downgrade.
  // Applicato PRIMA di CORS così vale anche sulle preflight OPTIONS. `x-powered-by`
  // resta disabilitato (sopra). Nessun header qui interferisce con CORS.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (env.isProd) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  // CORS: riflette l'origin SOLO se in allowlist (fail-closed come il WS). Le
  // richieste same-origin/non-browser (senza Origin) sono ammesse in dev; in prod
  // isOriginAllowed rifiuta l'assenza di origin.
  const corsOptions: CorsOptions = {
    origin(origin, cb) {
      if (isOriginAllowed(origin ?? undefined)) cb(null, true);
      else cb(null, false); // niente header CORS → il browser blocca (nessuna eccezione)
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  };
  app.use(cors(corsOptions));

  // Corpo JSON con tetto anti-DoS (i body auth sono piccoli).
  app.use(express.json({ limit: "8kb" }));

  // Health check per Render / warm-up FE (invariato rispetto al server precedente).
  app.get(["/health", "/"], (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "be-burraco" });
  });

  // Rate limiter per gli endpoint sensibili (finestra 15 min).
  // SEC-A3a: register e guest hanno budget INDIPENDENTI (limiter distinti). Prima
  // condividevano lo stesso bucket 'auth', così un flood di ospiti erodeva il
  // budget delle registrazioni legittime dello stesso IP. Ora un abuso su uno dei
  // due non consuma il budget dell'altro. Login resta col suo limiter dedicato.
  const registerLimiter = rateLimit({ name: "register", windowMs: 15 * 60 * 1000, max: 50 });
  const guestLimiter = rateLimit({ name: "guest", windowMs: 15 * 60 * 1000, max: 50 });
  const loginLimiter = rateLimit({ name: "login", windowMs: 15 * 60 * 1000, max: 20 });

  app.post(
    "/auth/register",
    registerLimiter,
    handler(async (req, res) => {
      const parsed = registerBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", message: "Dati di registrazione non validi." });
        return;
      }
      const { email, password, displayName } = parsed.data;
      // SEC-A2 (rischio residuo ACCETTATO per v1, opzione (a) approvata dal lead):
      // register può rispondere 409 EMAIL_TAKEN, quindi un client può dedurre se
      // un'email è già registrata (user-enumeration). Manteniamo il 409 per l'UX di
      // registrazione. Il rischio è mitigato dalla correzione di SEC-A1 (rate-limit
      // per IP reale, non aggirabile via X-Forwarded-For), che rende impraticabile
      // l'enumerazione di MASSA. Da rivalutare in una versione successiva.
      const result = await auth.register(email, password, displayName ?? "");
      res.status(201).json({ token: result.sessionToken, user: result.user });
    }),
  );

  app.post(
    "/auth/login",
    loginLimiter,
    handler(async (req, res) => {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success) {
        // Body malformato: stesso 401 generico per non distinguere i casi.
        res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Credenziali non valide." });
        return;
      }
      const { email, password } = parsed.data;
      const result = await auth.login(email, password);
      res.json({ token: result.sessionToken, user: result.user });
    }),
  );

  app.post(
    "/auth/guest",
    guestLimiter,
    handler(async (req, res) => {
      const parsed = guestBody.safeParse(req.body ?? {});
      const displayName = parsed.success ? parsed.data.displayName : undefined;
      const result = await auth.createGuest(displayName);
      res.status(201).json({ token: result.sessionToken, user: result.user });
    }),
  );

  app.post(
    "/auth/logout",
    handler(async (req, res) => {
      const token = bearer(req);
      // Logout idempotente: anche senza token valido rispondiamo ok (nessun oracolo).
      if (token) await auth.logout(token);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/auth/logout-all",
    handler(async (req, res) => {
      // SEC-A4: revoca TUTTE le sessioni del principale. A differenza di /logout
      // (idempotente), richiede un Bearer VALIDO: token assente/scaduto → 401
      // (auth.logoutAll solleva UNAUTHORIZED).
      const revoked = await auth.logoutAll(bearer(req));
      res.json({ ok: true, revoked });
    }),
  );

  app.get(
    "/auth/me",
    handler(async (req, res) => {
      const user = await auth.me(bearer(req));
      res.json({ user });
    }),
  );

  // 404 JSON per rotte sconosciute (nessuna pagina HTML/stack trace).
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND", message: "Risorsa non trovata." });
  });

  // Error handler finale: cattura anche errori sincroni dei middleware (es. JSON
  // malformato da express.json) senza esporre dettagli interni.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err && typeof err === "object" && "type" in err && (err as { type?: string }).type === "entity.too.large") {
      res.status(413).json({ error: "PAYLOAD_TOO_LARGE", message: "Richiesta troppo grande." });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "INVALID_JSON", message: "Corpo della richiesta non valido." });
      return;
    }
    sendAuthError(res, err);
  });

  return app;
}
