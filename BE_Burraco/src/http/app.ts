import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import { z } from "zod";
import { AuthService, AuthError, type AuthErrorCode } from "../auth/service.js";
import { isOriginAllowed } from "../net/originPolicy.js";
import { rateLimit } from "./rateLimit.js";
import { env } from "../config.js";
import type { StatsStore } from "../stats/types.js";
import type { RoomManager } from "../room/RoomManager.js";
import type { TablesResponse, NewCodeResponse } from "../contract/types.js";

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

// Storico partite paginato: cap ragionevoli anti-abuso. Coercizione da querystring.
// limit ∈ [1,50] (default 10); offset ≥ 0 con tetto anti-DoS (default 0).
const matchesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

// Statistiche: periodo temporale su enum CHIUSO (nessun valore libero → nessun
// errore SQL possibile). Assente/default → "all".
const statsQuery = z.object({
  periodo: z.enum(["all", "30d", "season"]).default("all"),
});

// Dettaglio partita: l'id di rotta deve essere un uuid ben formato (altrimenti 400,
// prima di qualsiasi query). Impedisce input malformati verso il DB.
const matchIdSchema = z.string().uuid();

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

export function createHttpApp(auth: AuthService, stats?: StatsStore, manager?: RoomManager): Express {
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

  /* ───────────────────── STATISTICHE & PROFILO (macro-ciclo 3) ─────────────────
   * GET /users/me/stats            (Bearer) → UserStats del principale.
   * GET /users/me/matches?limit&offset (Bearer) → MatchSummary[] paginato.
   *
   * Sicurezza:
   *  - l'utente è derivato SOLO dal token (getPrincipalByToken), MAI da un id nel
   *    client → nessun IDOR: ogni risposta contiene SOLO i dati del principale.
   *  - decisione B: profilo consultabile SOLO per utenti REGISTRATI. Un OSPITE
   *    autenticato riceve 403 (le sue partite si registrano, ma niente profilo).
   *  - header di sicurezza/CORS/rate-limit del blocco sopra restano invariati.
   * Le rotte sono montate solo quando uno StatsStore è iniettato (in test-solo-auth
   * può mancare: in tal caso non esistono e cadono nel 404).
   */
  if (stats) {
    // Risolve il principale dal Bearer, applicando il gate "solo registrati".
    // Ritorna null e INVIA GIÀ la risposta d'errore (401/403) quando non ammesso.
    const requireRegistered = async (req: Request, res: Response) => {
      const principal = await auth.getPrincipalByToken(bearer(req));
      if (!principal) {
        res.status(401).json({ error: "UNAUTHORIZED", message: "Sessione non valida." });
        return null;
      }
      if (principal.isGuest) {
        res.status(403).json({
          error: "GUEST_NO_PROFILE",
          message: "Registrati per salvare e consultare le statistiche.",
        });
        return null;
      }
      return principal;
    };

    app.get(
      "/users/me/stats",
      handler(async (req, res) => {
        const principal = await requireRegistered(req, res);
        if (!principal) return;
        const parsed = statsQuery.safeParse(req.query);
        if (!parsed.success) {
          // `periodo` fuori dall'enum chiuso → 400 (nessun errore SQL, nessun default silenzioso).
          res.status(400).json({ error: "INVALID_QUERY", message: "Parametro periodo non valido." });
          return;
        }
        const result = await stats.getStats(principal.userId, parsed.data.periodo);
        res.json(result);
      }),
    );

    app.get(
      "/users/me/matches",
      handler(async (req, res) => {
        const principal = await requireRegistered(req, res);
        if (!principal) return;
        const parsed = matchesQuery.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: "INVALID_QUERY", message: "Parametri di paginazione non validi." });
          return;
        }
        const items = await stats.getRecentMatches(principal.userId, parsed.data);
        res.json({ items, limit: parsed.data.limit, offset: parsed.data.offset });
      }),
    );

    /* GET /users/me/matches/:id — dettaglio smazzata-per-smazzata.
     *  - gate solo-registrati (ospite → 403), come le altre rotte /users/me/*;
     *  - utente derivato SOLO dal token (nessun IDOR);
     *  - `:id` deve essere un uuid ben formato → altrimenti 400 (prima di ogni query);
     *  - autorizzazione per PARTECIPAZIONE: se l'utente non ha una riga match_players
     *    in quella partita (o la partita non esiste) → 404, MAI 403. Un 403
     *    confermerebbe l'esistenza di una partita altrui: l'esistenza non è
     *    osservabile. Stesso 404 per uuid ben formato ma inesistente. */
    app.get(
      "/users/me/matches/:id",
      handler(async (req, res) => {
        const principal = await requireRegistered(req, res);
        if (!principal) return;
        const idParsed = matchIdSchema.safeParse(req.params.id);
        if (!idParsed.success) {
          res.status(400).json({ error: "INVALID_ID", message: "Identificativo partita non valido." });
          return;
        }
        const detail = await stats.getMatchDetail(principal.userId, idParsed.data);
        if (!detail) {
          res.status(404).json({ error: "NOT_FOUND", message: "Partita non trovata." });
          return;
        }
        res.json(detail);
      }),
    );
  }

  /* ───────────────────────── LOBBY / LISTA TAVOLI (macro-ciclo lobby) ─────────
   * GET  /tables            (Bearer) → { tables: WaitingTableView[], lobbyPlayers }
   * GET  /tables/new-code   (Bearer) → { code }
   * POST /session/leave     (Bearer o { token } nel body per il beacon) → 204
   *
   * Sicurezza:
   *  - identità SEMPRE dal token (getPrincipalByToken), MAI da un id nel client:
   *    nessun IDOR (una sessione può lasciare/toccare solo il PROPRIO stato).
   *  - la lista NON espone tavoli privati né campi interni (whitelist Room.waitingView):
   *    niente userId/email/token/origin/clientId/visibility.
   *  - l'avvio partita passa dal WebSocket: questa lista è solo informativa.
   *  - rate-limit dedicati per rotta (namespacing indipendente).
   * Montate solo quando un RoomManager è iniettato (in test-solo-auth possono mancare).
   */
  if (manager) {
    const tablesLimiter = rateLimit({ name: "tables", windowMs: 60_000, max: 40 });
    const newCodeLimiter = rateLimit({ name: "newcode", windowMs: 60_000, max: 30 });
    const leaveLimiter = rateLimit({ name: "leave", windowMs: 60_000, max: 60 });

    // Corpo opzionale di /session/leave: consente al beacon (navigator.sendBeacon,
    // che NON può impostare l'header Authorization) di veicolare il PROPRIO token.
    const leaveBody = z.object({ token: z.string().max(512).optional() });

    app.get(
      "/tables",
      tablesLimiter,
      handler(async (req, res) => {
        const principal = await auth.getPrincipalByToken(bearer(req));
        if (!principal) {
          res.status(401).json({ error: "UNAUTHORIZED", message: "Sessione non valida." });
          return;
        }
        // Heartbeat di presenza lobby (§6.2): registra che questa sessione sfoglia.
        manager.touchLobby(principal.userId);
        const body: TablesResponse = {
          tables: manager.listPublicWaitingTables(),
          lobbyPlayers: manager.lobbyPlayerCount(),
        };
        res.json(body);
      }),
    );

    app.get(
      "/tables/new-code",
      newCodeLimiter,
      handler(async (req, res) => {
        const principal = await auth.getPrincipalByToken(bearer(req));
        if (!principal) {
          res.status(401).json({ error: "UNAUTHORIZED", message: "Sessione non valida." });
          return;
        }
        const body: NewCodeResponse = { code: manager.generateFreeCode() };
        res.json(body);
      }),
    );

    app.post(
      "/session/leave",
      leaveLimiter,
      handler(async (req, res) => {
        // Token dal Bearer (fetch) o dal corpo (beacon su pagehide).
        const parsed = leaveBody.safeParse(req.body ?? {});
        const bodyToken = parsed.success ? parsed.data.token : undefined;
        const principal = await auth.getPrincipalByToken(bearer(req) ?? bodyToken);
        if (!principal) {
          res.status(401).json({ error: "UNAUTHORIZED", message: "Sessione non valida." });
          return;
        }
        manager.leaveWaiting(principal.userId);
        res.status(204).end();
      }),
    );
  }

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
