import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import { z } from "zod";
import { AuthService, AuthError, type AuthErrorCode } from "../auth/service.js";
import { isOriginAllowed } from "../net/originPolicy.js";
import { rateLimit, createKeyedRateLimiter } from "./rateLimit.js";
import { env } from "../config.js";
import type { StatsStore } from "../stats/types.js";
import type { RoomManager } from "../room/RoomManager.js";
import type { TablesResponse, NewCodeResponse } from "../contract/types.js";
import { pool } from "../db/client.js";
import { createContactStore } from "../contact/store.js";
import type { ContactStore } from "../contact/types.js";
import { hashIp, stripHeaderInjection } from "../contact/util.js";
import { sendEmail } from "../mail/index.js";
import { enqueueWelcome } from "../mail/queue.js";
import { logAppEvent } from "../events/log.js";
import { createRequireAdmin } from "../admin/requireAdmin.js";
import { recordAdminAudit } from "../admin/audit.js";
import { getOccupancy } from "../admin/occupancy.js";
import { runRetentionSweep } from "../retention/service.js";
import { createBroadcast, enqueueSend, listBroadcasts, unsubscribeByToken } from "../broadcast/service.js";
import { getAppLogs, getDbStatus, getRenderLogs } from "../admin/logs.js";
import { deleteUser, listUsers, resetUserPassword, type AdminUserOpError } from "../admin/users.js";
import { runStatusCheck } from "../admin/status.js";
import {
  createEvent,
  listEvents,
  createShopProduct,
  listShopProducts,
  updateShopProduct,
  deleteShopProduct,
} from "../admin/catalog.js";
import type { AdminResetPasswordResponse, LogLinksResponse } from "../admin/types.js";
import { AVATAR_MAX_CHARS, IMAGE_DATA_URL_RE, getAvatar, setAvatar } from "../profile/avatar.js";

/**
 * APP HTTP del backend auth (Express) montata sullo STESSO http.Server del WS
 * (decisione #1: web service persistente, non serverless). Espone:
 *   POST /auth/register  { email, password, displayName? } → { token, user }
 *   POST /auth/login     { email, password }               → { token, user }
 *   POST /auth/guest     { displayName? }                   → { token, user }
 *   POST /auth/logout    (Bearer)                           → { ok: true }
 *   POST /auth/logout-all(Bearer)                           → { ok: true, revoked }
 *   GET  /auth/me        (Bearer)                           → { user }
 *   POST /auth/change-password (Bearer) { currentPassword, newPassword } → { token, user }
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
  // R8 — HONEYPOT: campo dal nome neutro/plausibile che gli umani non vedono e non
  // compilano (input nascosto lato FE) ma i bot sì. Opzionale e ignorato se vuoto; se
  // valorizzato → 401 immediato senza verifica password. `max` come tetto anti-abuso.
  website: z.string().max(200).optional(),
});
const guestBody = z.object({ displayName: displayNameSchema });
// CICLO Profilo — cambio password: l'attuale ha solo il tetto anti-DoS, la nuova la policy.
const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

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

// FASE 2 — Form contatti pubblico. Limiti di lunghezza (anti-abuso) + honeypot
// (`website`, riuso del nome già usato dal login) + soglia di tempo (`renderedAt`,
// timestamp di render del form). `renderedAt` dal client è manipolabile: vale come
// filtro statistico, non come prova.
const contactBody = z.object({
  nome: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  oggetto: z.string().trim().min(1).max(120),
  messaggio: z.string().trim().min(1).max(2000),
  website: z.string().max(200).optional(),
  renderedAt: z.coerce.number().int().nonnegative().optional(),
});

/** Tempo minimo di compilazione plausibile: sotto → trattato come bot (§2.3). */
const CONTACT_MIN_FILL_MS = 3_000;

// FASE 5.3 — Comunicazioni broadcast. Corpo in TESTO semplice (nessun HTML). Il
// criterio è un enum chiuso di filtri; un criterio vuoto (non `all`, nessun filtro)
// risolve a ZERO destinatari (nessun invio accidentale a tutti).
const broadcastCriterioSchema = z.object({
  all: z.boolean().optional(),
  registratiDopo: z.coerce.number().int().nonnegative().optional(),
  minPartite: z.coerce.number().int().min(0).max(100000).optional(),
  inattiviDaGiorni: z.coerce.number().int().min(0).max(3650).optional(),
  // CICLO Webmaster — destinatari selezionati a mano (tab Utenti): uuid, tetto 1000.
  userIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
});
const broadcastCreateBody = z.object({
  oggetto: z.string().trim().min(1).max(150),
  corpo: z.string().trim().min(1).max(5000),
  tipo: z.enum(["servizio", "promozionale"]),
  criterio: broadcastCriterioSchema,
  dryRun: z.boolean().optional(),
});
const unsubscribeQuery = z.object({ token: z.string().min(1).max(200) });

// FASE 5.4 — Viste log: finestra temporale OBBLIGATORIA (from/to epoch ms) e limit
// cappato (nessuna query che scarichi tutto). `level` su enum chiuso.
const logsQuery = z.object({
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  level: z.enum(["info", "warn", "error"]).optional(),
});

// CICLO Pannello Admin — elenco utenti: limit ∈ [1,100] (default 20, coerente con lo
// storico), cursore keyset opaco (stringa base64url) cappato per lunghezza.
const adminUsersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

// CICLO Pannello Admin — predisposizione Eventi: create minimale. `inizioAt`/`fineAt`
// sono epoch ms; i testi hanno tetti anti-abuso; `pubblicato` opzionale (default false).
const eventCreateBody = z.object({
  titolo: z.string().trim().min(1).max(150),
  descrizione: z.string().trim().max(2000).optional(),
  luogo: z.string().trim().max(150).optional(),
  inizioAt: z.coerce.number().int().nonnegative(),
  fineAt: z.coerce.number().int().nonnegative().optional(),
  pubblicato: z.boolean().optional(),
});

// CICLO Webmaster — foto della scheda prodotto: data URL d'immagine (jpeg/png/webp,
// mai SVG) già ridimensionato dal client, con tetto; oppure un URL http(s) (compat.).
const PRODUCT_IMAGE_MAX_CHARS = 400_000;
const productImageSchema = z.union([
  z.string().max(PRODUCT_IMAGE_MAX_CHARS).regex(IMAGE_DATA_URL_RE),
  z.string().trim().url().max(500).regex(/^https?:\/\//i),
]);

// CICLO Pannello Admin — predisposizione Shop. `prezzoCent` è un intero in CENTESIMI
// (mai float sul denaro); `immagineUrl` è una foto (data URL) o un URL opzionale.
const shopProductCreateBody = z.object({
  nome: z.string().trim().min(1).max(150),
  descrizione: z.string().trim().max(2000).optional(),
  prezzoCent: z.coerce.number().int().min(0).max(100_000_000).optional(),
  valuta: z.string().trim().min(1).max(8).optional(),
  immagineUrl: productImageSchema.optional(),
  disponibile: z.boolean().optional(),
});
// CICLO Webmaster — modifica PARZIALE: campi assenti invariati; `null` svuota
// descrizione/foto. Stessi tetti della creazione.
const shopProductUpdateBody = z.object({
  nome: z.string().trim().min(1).max(150).optional(),
  descrizione: z.string().trim().max(2000).nullable().optional(),
  prezzoCent: z.coerce.number().int().min(0).max(100_000_000).optional(),
  valuta: z.string().trim().min(1).max(8).optional(),
  immagineUrl: productImageSchema.nullable().optional(),
  disponibile: z.boolean().optional(),
});

// CICLO Profilo — foto profilo: data URL d'immagine con tetto, oppure null (rimozione).
const avatarBody = z.object({
  avatar: z.string().max(AVATAR_MAX_CHARS).regex(IMAGE_DATA_URL_RE).nullable(),
});

/* ─────────────────────────────── helper ──────────────────────────────────── */

/** Mappa i codici d'errore stabili del servizio agli status HTTP. */
const STATUS_BY_CODE: Record<AuthErrorCode, number> = {
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  WEAK_PASSWORD: 400,
  UNAUTHORIZED: 401,
  WRONG_PASSWORD: 400,
  GUEST_NO_PASSWORD: 403,
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

export function createHttpApp(
  auth: AuthService,
  stats?: StatsStore,
  manager?: RoomManager,
  deps?: { contactStore?: ContactStore },
): Express {
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

  // CICLO Webmaster/Profilo — tetti DEDICATI alle sole rotte che trasportano una foto
  // (data URL già ridimensionato dal client). Montati PRIMA del parser globale: il
  // body-parser salta un corpo già letto, quindi le altre rotte restano a 8kb.
  app.use("/admin/shop/products", express.json({ limit: "450kb" }));
  app.use("/users/me/avatar", express.json({ limit: "160kb" }));
  // Comunicazioni con destinatari selezionati: fino a 1000 uuid (~40kb).
  app.use("/admin/broadcasts", express.json({ limit: "64kb" }));

  // Corpo JSON con tetto anti-DoS (i body auth sono piccoli).
  app.use(express.json({ limit: "8kb" }));

  // FASE 3 — Health check STRUMENTATO (§3.2). Oltre a status/service, esegue un
  // `SELECT 1` (SOLA LETTURA) e riporta i tempi, così sul deploy di branch il lead
  // può MISURARE il fenomeno del cold start senza ambiente locale:
  //  - tProcessMs: ms dal boot del processo (risveglio del processo Render);
  //  - tQueryMs: durata del SELECT 1 (risveglio del compute Neon), null se no DB.
  //  - db: "ok"|"down" (down anche senza DATABASE_URL, senza errore).
  // Usato anche dal keep-alive CI e dalla schermata di connessione del FE. `status`
  // resta "ok" (retro-compatibile con i test e i probe esistenti).
  app.get(
    ["/health", "/"],
    handler(async (_req: Request, res: Response) => {
      const tProcessMs = Math.round(process.uptime() * 1000);
      let db: "ok" | "down" = "down";
      let tQueryMs: number | null = null;
      if (pool) {
        const t0 = Date.now();
        try {
          await pool.query("SELECT 1");
          db = "ok";
        } catch {
          db = "down";
        }
        tQueryMs = Date.now() - t0;
      }
      res.json({ status: "ok", service: "be-burraco", db, tProcessMs, tQueryMs });
    }),
  );

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
      // CICLO Pannello Admin — WELCOME EMAIL: SOLO accodamento (INSERT in email_queue),
      // fuori dal path critico e DOPO la risposta. La registrazione non attende né
      // fallisce mai per l'email (§2.4). L'invio è differito nel dispatcher quota-aware
      // (mail/dispatcher.ts); con BREVO_ENABLED=false la riga resta in coda, nessun errore.
      void enqueueWelcome({ toEmail: email, displayName: result.user.displayName }).catch(() => {});
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
      const { email, password, website } = parsed.data;
      // R8 — HONEYPOT: se il campo nascosto è valorizzato è quasi certamente un bot →
      // 401 IDENTICO immediato, SENZA verifica password né consumo argon2 (costo nullo).
      if (website && website.trim().length > 0) {
        res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Credenziali non valide." });
        return;
      }
      // R8 — lockout progressivo keyed su hash(email + IP). `req.ip` è affidabile
      // (trust proxy impostato, SEC-A1). Il loginLimiter per-IP resta DAVANTI, invariato.
      const result = await auth.login(email, password, req.ip ?? "");
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

  // CICLO Profilo — cambio password. Rate-limit dedicato (tentativi sulla password
  // attuale con una sessione valida). Risponde con un token NUOVO: tutte le sessioni
  // precedenti, anche su altri dispositivi, sono revocate.
  const changePasswordLimiter = rateLimit({ name: "change-password", windowMs: 15 * 60_000, max: 10 });
  app.post(
    "/auth/change-password",
    changePasswordLimiter,
    handler(async (req, res) => {
      const parsed = changePasswordBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "WEAK_PASSWORD",
          message: "La nuova password deve avere almeno 8 caratteri.",
        });
        return;
      }
      const result = await auth.changePassword(bearer(req), parsed.data.currentPassword, parsed.data.newPassword);
      res.setHeader("Cache-Control", "no-store");
      res.json({ token: result.sessionToken, user: result.user });
    }),
  );

  app.get(
    "/auth/me",
    handler(async (req, res) => {
      const user = await auth.me(bearer(req));
      res.json({ user });
    }),
  );

  /* ─────────────────────────── FASE 2 — FORM CONTATTI (PUBBLICO) ───────────────
   * POST /api/contact — l'endpoint più esposto: nessun Bearer richiesto.
   * Principio (§2.1): il messaggio si salva SEMPRE; l'email è un di più. La risposta
   * è SEMPRE generica (200 { ok:true }), non rivela mai l'esito dell'invio email.
   * Difese server-authoritative (nascondere un pulsante non è sicurezza):
   *  - rate-limit per IP più severo degli altri (5/60min);
   *  - honeypot (`website`) → 200 silenzioso senza salvare né inviare;
   *  - soglia di tempo minima → 200 silenzioso (filtro statistico anti-bot);
   *  - anti-injection di header (newline/CTL) su nome/oggetto/reply-to;
   *  - `ip_hash` = sha256(ip + salt): mai l'IP in chiaro.
   */
  const contactLimiter = rateLimit({ name: "contact", windowMs: 60 * 60 * 1000, max: 5 });
  const contactStore = deps?.contactStore ?? createContactStore();

  /** Invio email best-effort del messaggio (fuori dal path critico, §2.4). */
  async function deliverContactEmail(
    id: string | null,
    data: { nome: string; email: string; oggetto: string; messaggio: string },
  ): Promise<void> {
    try {
      // Senza destinatario configurato non si tenta: la riga resta 'skippato'.
      if (!env.mail.contactTo) {
        if (id) await contactStore.markSendStatus(id, "skippato");
        return;
      }
      // Oggetto GENERATO dal server; i campi utente sono sanificati (anti-injection).
      const subject = `[Contatti] ${stripHeaderInjection(data.oggetto)}`;
      const text = `Da: ${stripHeaderInjection(data.nome)} <${data.email}>\n\n${data.messaggio}`;
      const result = await sendEmail({
        to: { email: env.mail.contactTo },
        subject,
        text,
        // L'email utente in reply-to SOLO dopo validazione formato (zod) + strip CTL.
        replyTo: { email: data.email, name: stripHeaderInjection(data.nome) },
        tags: ["contact"],
      });
      const status =
        result.status === "sent" ? "inviato" : result.status === "skipped" ? "skippato" : "errore_invio";
      if (id) await contactStore.markSendStatus(id, status);
      void logAppEvent("info", "contact", `messaggio contatti esito=${result.status}`);
    } catch (err) {
      console.error("[contact] invio email fallito:", (err as Error).message);
      if (id) await contactStore.markSendStatus(id, "errore_invio").catch(() => {});
    }
  }

  app.post(
    "/api/contact",
    contactLimiter,
    handler(async (req, res) => {
      const parsed = contactBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", message: "Dati del messaggio non validi." });
        return;
      }
      const { nome, email, oggetto, messaggio, website, renderedAt } = parsed.data;

      // Honeypot: campo nascosto valorizzato → bot → 200 generico, nessun salvataggio.
      if (website && website.trim().length > 0) {
        res.status(200).json({ ok: true });
        return;
      }
      // Soglia di tempo: submit troppo rapido → bot → 200 generico, silenzioso.
      if (typeof renderedAt === "number") {
        const elapsed = Date.now() - renderedAt;
        if (elapsed >= 0 && elapsed < CONTACT_MIN_FILL_MS) {
          res.status(200).json({ ok: true });
          return;
        }
      }

      // Utente autenticato (best-effort): se c'è un Bearer valido, associa la riga.
      const principal = await auth.getPrincipalByToken(bearer(req));

      // INSERT SEMPRE (non deve fallire silenziosamente): su errore DB si logga e si
      // prosegue col fallback email, ma la risposta all'utente resta generica.
      let id: string | null = null;
      try {
        id = await contactStore.save({
          nome: stripHeaderInjection(nome),
          email,
          oggetto: stripHeaderInjection(oggetto),
          messaggio, // corpo testuale: nessun rischio di header injection
          userId: principal?.userId ?? null,
          ipHash: hashIp(req.ip ?? ""),
        });
      } catch (err) {
        console.error("[contact] salvataggio fallito:", (err as Error).message);
        void logAppEvent("error", "contact", "salvataggio messaggio contatti fallito");
      }

      // Risposta generica SUBITO; l'email parte dopo, fuori dal path critico.
      res.status(200).json({ ok: true });
      void deliverContactEmail(id, { nome, email, oggetto, messaggio });
    }),
  );

  /* FASE 5.3 — Disiscrizione PUBBLICA dalle comunicazioni promozionali (link email).
   * Azzera `promo_opt_in` per il token. Risposta di conferma in TESTO semplice
   * (nessun HTML → nessuna superficie XSS) e sempre rassicurante (nessun oracolo). */
  const unsubscribeLimiter = rateLimit({ name: "unsubscribe", windowMs: 60_000, max: 30 });
  app.get(
    "/unsubscribe",
    unsubscribeLimiter,
    handler(async (req, res) => {
      const parsed = unsubscribeQuery.safeParse(req.query);
      if (parsed.success) {
        await unsubscribeByToken(parsed.data.token);
      }
      res
        .status(200)
        .type("text/plain; charset=utf-8")
        .send("Disiscrizione registrata: non riceverai più comunicazioni promozionali. Puoi chiudere questa pagina.");
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

    /* CICLO Profilo — FOTO PROFILO del principale (solo registrati, come il resto di
     * /users/me/*). L'utente è derivato SOLO dal token: nessun id nel percorso, nessun
     * IDOR. POST con `{ avatar: dataUrl }` imposta, `{ avatar: null }` rimuove. */
    const avatarLimiter = rateLimit({ name: "avatar", windowMs: 60_000, max: 20 });
    app.get(
      "/users/me/avatar",
      avatarLimiter,
      handler(async (req, res) => {
        const principal = await requireRegistered(req, res);
        if (!principal) return;
        res.json({ avatar: await getAvatar(principal.userId) });
      }),
    );
    app.post(
      "/users/me/avatar",
      avatarLimiter,
      handler(async (req, res) => {
        const principal = await requireRegistered(req, res);
        if (!principal) return;
        const parsed = avatarBody.safeParse(req.body ?? {});
        if (!parsed.success) {
          res.status(400).json({
            error: "INVALID_AVATAR",
            message: "Immagine non valida: usa una foto JPG, PNG o WebP.",
          });
          return;
        }
        await setAvatar(principal.userId, parsed.data.avatar);
        res.json({ avatar: parsed.data.avatar });
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

  /* ─────────────────────────── AREA WEBMASTER (/admin/*) ───────────────────────
   * Tutte dietro `requireAdmin`: un NON-admin (o non autenticato) riceve 404, mai
   * 403 — l'esistenza dell'area non è osservabile. Il ruolo è letto dal DB a ogni
   * richiesta (token opachi → revoca istantanea). Rate-limit dedicato.
   */
  const requireAdmin = createRequireAdmin(auth);
  const adminLimiter = rateLimit({ name: "admin", windowMs: 60_000, max: 60 });
  // CICLO Pannello Admin — rate-limit DEDICATO all'invio broadcast: 10/30s keyed
  // sull'admin autenticato (non l'IP), verificato DENTRO l'handler dopo requireAdmin
  // (l'id è noto solo allora). Azione irreversibile e ad ampio impatto (§2.3).
  const broadcastSendLimiter = createKeyedRateLimiter({ windowMs: 30_000, max: 10 });

  // Contatore di occupazione del DB (§4.4): righe per tabella, totale, % sul budget.
  app.get(
    "/admin/occupancy",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      res.json(await getOccupancy());
    }),
  );

  // Anteprima RETENTION in DRY-RUN (§4.4): mostra al lead quante righe sarebbero
  // rimosse, senza cancellare nulla. È la "simulazione mostrata" prima di ogni
  // esecuzione reale. L'anonimizzazione di account registrati resta solo-detection.
  app.post(
    "/admin/retention/preview",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const reports = await runRetentionSweep("dry_run", principal.userId);
      res.json({ dryRun: true, reports });
    }),
  );

  /* ── FASE 5.3 — Comunicazioni broadcast (dietro requireAdmin) ────────────────
   * Crea (con dry-run per la conta), avvia l'invio ASINCRONO (ritorna subito) ed
   * elenca lo stato. L'invio vero è del worker (ws/server.ts): mai in linea con la
   * risposta HTTP. Idempotenza dell'invio via UNIQUE(broadcast_id, user_id). */
  app.post(
    "/admin/broadcasts",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const parsed = broadcastCreateBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", message: "Dati della comunicazione non validi." });
        return;
      }
      const result = await createBroadcast(principal.userId, {
        oggetto: parsed.data.oggetto,
        corpo: parsed.data.corpo,
        tipo: parsed.data.tipo,
        criterio: parsed.data.criterio,
        dryRun: parsed.data.dryRun ?? false,
      });
      res.json(result);
    }),
  );

  app.post(
    "/admin/broadcasts/:id/send",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      // Rate-limit per ADMIN (10/30s): chiave = id autenticato, non l'IP (§2.3).
      const rl = broadcastSendLimiter.hit(principal.userId);
      if (rl.limited) {
        res.setHeader("Retry-After", String(rl.retryAfterSec));
        res.status(429).json({ error: "RATE_LIMITED", message: "Troppi invii ravvicinati, riprova tra qualche secondo." });
        return;
      }
      const idParsed = matchIdSchema.safeParse(req.params.id);
      if (!idParsed.success) {
        res.status(400).json({ error: "INVALID_ID", message: "Identificativo non valido." });
        return;
      }
      const result = await enqueueSend(idParsed.data);
      if (!result.accepted) {
        res.status(404).json({ error: "NOT_FOUND", message: "Comunicazione non trovata." });
        return;
      }
      // Audit best-effort dell'invio. L'IP è INDICATIVO e nullable (§4): mai base di
      // decisioni di sicurezza, solo tracciabilità. Non blocca la risposta.
      void recordAdminAudit({
        actorId: principal.userId,
        action: "broadcast.send",
        target: { broadcastId: idParsed.data, queued: result.queued, ip: req.ip ?? null },
        outcome: "ok",
      });
      res.json({ accepted: true, queued: result.queued });
    }),
  );

  app.get(
    "/admin/broadcasts",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      res.json({ items: await listBroadcasts() });
    }),
  );

  /* ── FASE 5.4 — Viste log (dietro requireAdmin) ──────────────────────────────
   * app_events + admin_audit_log (finestra obbligatoria), proxy Render (chiave mai
   * sul FE), stato DB (pg_stat_* con fallback). Redazione lato server; il FE renderà
   * come TESTO. from/to obbligatori, limit cappato. */
  app.get(
    "/admin/logs/app",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const parsed = logsQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_QUERY", message: "Finestra temporale (from/to) obbligatoria." });
        return;
      }
      const { from, to, limit, level } = parsed.data;
      const items = await getAppLogs({ from: new Date(from), to: new Date(to), limit, level });
      res.json({ items, limit });
    }),
  );

  app.get(
    "/admin/logs/render",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const parsed = logsQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_QUERY", message: "Finestra temporale (from/to) obbligatoria." });
        return;
      }
      const { from, to, limit } = parsed.data;
      res.json(await getRenderLogs(new Date(from), new Date(to), limit));
    }),
  );

  app.get(
    "/admin/logs/db",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      res.json(await getDbStatus());
    }),
  );

  /* ─────────────── CICLO Pannello Admin — nuovi endpoint (/admin/*) ────────────
   * Tutti dietro requireAdmin (404 ai non-admin). Rate-limit condiviso adminLimiter. */

  // D2 — PROBE della voce di menu admin: 200 all'admin, 404 a tutti gli altri (via
  // requireAdmin). Il FE mostra la voce SOLO su 200. Non tocca il contratto auth.
  app.get(
    "/admin/ping",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      res.json({ ok: true });
    }),
  );

  // Utenti registrati (§2.1): elenco keyset paginato (createdAt desc, id). Whitelist
  // POSITIVA: SOLO nome/email/iscrizione, mai hash/token/ip/ruolo.
  app.get(
    "/admin/users",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const parsed = adminUsersQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_QUERY", message: "Parametri di paginazione non validi." });
        return;
      }
      res.json(await listUsers({ limit: parsed.data.limit, cursor: parsed.data.cursor }));
    }),
  );

  // CICLO Webmaster — operazioni sul SINGOLO utente registrato. Mai su se stessi né su
  // un altro admin (409); ospite o inesistente → 404; senza DB → 503. Audit nella
  // stessa transazione dell'operazione (users.ts).
  const sendUserOpError = (res: Response, error: AdminUserOpError): void => {
    if (error === "not_found") {
      res.status(404).json({ error: "NOT_FOUND", message: "Utente non trovato." });
    } else if (error === "forbidden") {
      res.status(409).json({
        error: "FORBIDDEN_TARGET",
        message: "Operazione non consentita sul tuo account o su un altro amministratore.",
      });
    } else {
      res.status(503).json({ error: "NO_DB", message: "Persistenza non disponibile." });
    }
  };

  app.post(
    "/admin/users/:id/delete",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const idParsed = matchIdSchema.safeParse(req.params.id);
      if (!idParsed.success) {
        res.status(400).json({ error: "INVALID_ID", message: "Identificativo non valido." });
        return;
      }
      const result = await deleteUser(principal.userId, idParsed.data);
      if (!result.ok) {
        sendUserOpError(res, result.error);
        return;
      }
      res.json({ deleted: true });
    }),
  );

  app.post(
    "/admin/users/:id/reset-password",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const idParsed = matchIdSchema.safeParse(req.params.id);
      if (!idParsed.success) {
        res.status(400).json({ error: "INVALID_ID", message: "Identificativo non valido." });
        return;
      }
      const result = await resetUserPassword(principal.userId, idParsed.data);
      if (!result.ok) {
        sendUserOpError(res, result.error);
        return;
      }
      // La password temporanea non deve restare in cache intermedie.
      res.setHeader("Cache-Control", "no-store");
      const body: AdminResetPasswordResponse = { tempPassword: result.tempPassword, emailed: result.emailed };
      res.json(body);
    }),
  );

  // Link dashboard (§2, tab Log): SOLO i link (mai i log). Gli URL restano dietro
  // requireAdmin: non finiscono nel bundle FE (nessuna NEXT_PUBLIC_).
  app.get(
    "/admin/logs/links",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const body: LogLinksResponse = {
        renderUrl: env.dashboards.renderUrl || null,
        neonUrl: env.dashboards.neonUrl || null,
      };
      res.json(body);
    }),
  );

  // Semaforo di monitoraggio ON-DEMAND (§2.2): SELECT 1 leggero, timeout 60s. Binario
  // verde/rosso, sempre con testo. Nessun polling: parte solo al click "Aggiorna adesso".
  app.post(
    "/admin/status/check",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      res.json(await runStatusCheck());
    }),
  );

  /* ── Predisposizione Eventi (Tornei) e Shop (§2.6) ──────────────────────────
   * Eventi: create/list. Prodotti: CRUD completo con foto (CICLO Webmaster).
   * Niente vetrina pubblica, niente carrello/pagamento. */
  app.get(
    "/admin/events",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      res.json({ items: await listEvents() });
    }),
  );

  app.post(
    "/admin/events",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const parsed = eventCreateBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", message: "Dati dell'evento non validi." });
        return;
      }
      const row = await createEvent(principal.userId, parsed.data);
      if (!row) {
        res.status(503).json({ error: "NO_DB", message: "Persistenza non disponibile." });
        return;
      }
      res.status(201).json(row);
    }),
  );

  app.get(
    "/admin/shop/products",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      res.json({ items: await listShopProducts() });
    }),
  );

  app.post(
    "/admin/shop/products",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const parsed = shopProductCreateBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", message: "Dati del prodotto non validi." });
        return;
      }
      const row = await createShopProduct(principal.userId, parsed.data);
      if (!row) {
        res.status(503).json({ error: "NO_DB", message: "Persistenza non disponibile." });
        return;
      }
      res.status(201).json(row);
    }),
  );

  // CICLO Webmaster — MODIFICA di un prodotto (aggiornamento parziale).
  app.post(
    "/admin/shop/products/:id",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const idParsed = matchIdSchema.safeParse(req.params.id);
      if (!idParsed.success) {
        res.status(400).json({ error: "INVALID_ID", message: "Identificativo non valido." });
        return;
      }
      const parsed = shopProductUpdateBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_BODY", message: "Dati del prodotto non validi." });
        return;
      }
      const row = await updateShopProduct(idParsed.data, parsed.data);
      if (!row) {
        res.status(404).json({ error: "NOT_FOUND", message: "Prodotto non trovato." });
        return;
      }
      res.json(row);
    }),
  );

  // CICLO Webmaster — CANCELLAZIONE di un prodotto.
  app.post(
    "/admin/shop/products/:id/delete",
    adminLimiter,
    handler(async (req, res) => {
      const principal = await requireAdmin(req, res);
      if (!principal) return;
      const idParsed = matchIdSchema.safeParse(req.params.id);
      if (!idParsed.success) {
        res.status(400).json({ error: "INVALID_ID", message: "Identificativo non valido." });
        return;
      }
      if (!(await deleteShopProduct(idParsed.data))) {
        res.status(404).json({ error: "NOT_FOUND", message: "Prodotto non trovato." });
        return;
      }
      void recordAdminAudit({
        actorId: principal.userId,
        action: "shop.product.delete",
        target: { productId: idParsed.data },
        outcome: "ok",
      });
      res.json({ deleted: true });
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
