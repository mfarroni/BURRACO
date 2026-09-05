import type { AuthPrincipal, AuthStore, AuthUser, StoredUser } from "./types.js";
import { hashPassword, verifyPassword, verifyDummy } from "./password.js";
import { generateSessionToken, hashToken } from "./tokens.js";
import { RECONNECT_GRACE_DEFAULT_MS } from "../config.js";

/**
 * SERVIZIO AUTH: orchestrazione di hashing, token e store (server autoritativo).
 * È l'unico punto in cui si combinano password/token con la persistenza; lo
 * store non conosce segreti in chiaro.
 *
 * Sicurezza:
 *  - password → argon2id (password.ts); nel DB solo l'hash.
 *  - token di sessione → opaco 256-bit (tokens.ts); nel DB solo lo sha256.
 *  - login errato → errore GENERICO (nessun oracolo email-vs-password).
 *  - scadenza + revoca verificate a ogni risoluzione del principale.
 */

/** Codici d'errore stabili, mappati a status HTTP dall'handler. */
export type AuthErrorCode =
  | "EMAIL_TAKEN" // 409
  | "INVALID_CREDENTIALS" // 401
  | "WEAK_PASSWORD" // 400 (difesa in profondità: la policy è anche in zod)
  | "UNAUTHORIZED"; // 401 (token assente/non valido)

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Policy minima password (difesa in profondità oltre a zod). */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200; // evita DoS su argon2 con input enormi

/**
 * SEC-A4 — cap di sessioni attive per utente. 10 = margine ampio per più
 * dispositivi/browser dello stesso utente, ma limita la crescita illimitata dei
 * token (login ripetuti). Al superamento, le sessioni più VECCHIE vengono revocate.
 */
const MAX_SESSIONS_PER_USER = 10;

/**
 * SEC-A3b — parametri del pruning periodico.
 *  - PRUNE_REVOKED_GRACE_MS (24h): le sessioni revocate restano un giorno per
 *    audit/diagnosi, poi vengono eliminate. Le scadute si eliminano subito.
 *  - GUEST_INACTIVITY_MS (7g): un ospite inattivo da oltre il TTL di sessione è
 *    comunque irraggiungibile (token già scaduto): si può eliminare senza impatto.
 */
const PRUNE_REVOKED_GRACE_MS = 24 * 60 * 60 * 1000;
const GUEST_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthResult {
  sessionToken: string;
  user: AuthUser;
}

function toAuthUser(u: StoredUser): AuthUser {
  return { id: u.id, email: u.email, displayName: u.displayName, isGuest: u.isGuest };
}

export class AuthService {
  /** TTL di sessione: 7 giorni. Oltre, il token non è più risolvibile. */
  private readonly sessionTtlMs: number;

  /**
   * §6.2/§6.3 — chiusure sessione "morbide" in corso, per hash del token. Il beacon
   * `/session/leave` NON revoca subito: pianifica la chiusura dopo il PERIODO DI
   * GRAZIA (stesso valore della riconnessione, 45s), così un `F5`/ritorno rapido non
   * distrugge la sessione. Qualsiasi ATTIVITÀ autenticata con quel token entro la
   * grazia (risoluzione del principale in /auth/me o al rejoin WS) ANNULLA la chiusura
   * (resume). In-RAM, coerente con l'architettura single-instance: un riavvio del
   * processo perde i timer, ma il TTL resta la garanzia (§6.2.3).
   */
  private readonly pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: AuthStore,
    opts?: { sessionTtlMs?: number },
  ) {
    this.sessionTtlMs = opts?.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * Periodo di grazia della chiusura sessione via beacon: lo stesso della
   * riconnessione (§6.3). Rilettura dinamica dell'env così i test iniettano finestre
   * brevi; default documentato in `RECONNECT_GRACE_DEFAULT_MS` (45s).
   */
  private leaveGraceMs(): number {
    return Number(process.env.RECONNECT_GRACE_MS ?? RECONNECT_GRACE_DEFAULT_MS);
  }

  /** Annulla un'eventuale chiusura sessione pendente per quel token (resume). */
  private cancelPendingLeave(tokenHash: string): void {
    const timer = this.pendingLeaves.get(tokenHash);
    if (timer) {
      clearTimeout(timer);
      this.pendingLeaves.delete(tokenHash);
    }
  }

  /** Emette un token opaco, ne persiste SOLO l'hash e lo restituisce in chiaro. */
  private async issueSession(userId: string): Promise<string> {
    const token = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    await this.store.createSession({ userId, tokenHash: hashToken(token), expiresAt });
    // SEC-A4: subito dopo la creazione, pota le sessioni attive oltre il cap
    // (revoca le più vecchie). La nuova sessione è la più recente: resta valida.
    await this.store.enforceSessionCap(userId, MAX_SESSIONS_PER_USER, now);
    return token;
  }

  private assertPasswordPolicy(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new AuthError("WEAK_PASSWORD", "La password deve avere almeno 8 caratteri.");
    }
  }

  private normalizeName(name: string | undefined, fallback: string): string {
    const trimmed = (name ?? "").trim().slice(0, 40);
    return trimmed || fallback;
  }

  async register(email: string, password: string, displayName: string): Promise<AuthResult> {
    this.assertPasswordPolicy(password);
    const normEmail = email.trim().toLowerCase();
    const existing = await this.store.getUserByEmail(normEmail);
    if (existing) {
      // SEC-A2 (rischio residuo ACCETTATO per v1, opzione (a) approvata dal lead):
      // il 409 EMAIL_TAKEN è distinguibile e consente user-enumeration mirata. Lo
      // manteniamo per l'UX di registrazione; l'enumerazione DI MASSA è impraticabile
      // grazie al rate-limit per IP reale (SEC-A1). Da rivalutare in una v. successiva.
      throw new AuthError("EMAIL_TAKEN", "Email già registrata.");
    }
    const passwordHash = await hashPassword(password);
    const user = await this.store.createUser({
      email: normEmail,
      displayName: this.normalizeName(displayName, "Giocatore"),
      passwordHash,
      isGuest: false,
    });
    const sessionToken = await this.issueSession(user.id);
    return { sessionToken, user: toAuthUser(user) };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const normEmail = email.trim().toLowerCase();
    const user = await this.store.getUserByEmail(normEmail);
    // Errore GENERICO in ogni caso: nessun oracolo su "email inesistente" vs
    // "password errata". Se l'utente non esiste (o è un ospite senza hash),
    // si esegue comunque il ramo di fallimento senza rivelare quale.
    if (!user || user.passwordHash === null) {
      // Difesa timing oracle: esegui comunque una verifica argon2id fittizia, così
      // la durata non rivela se l'email è registrata (risposta già identica).
      await verifyDummy(password);
      throw new AuthError("INVALID_CREDENTIALS", "Credenziali non valide.");
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw new AuthError("INVALID_CREDENTIALS", "Credenziali non valide.");
    }
    void this.store.touchLastSeen(user.id);
    const sessionToken = await this.issueSession(user.id);
    return { sessionToken, user: toAuthUser(user) };
  }

  async createGuest(displayName?: string): Promise<AuthResult> {
    const user = await this.store.createUser({
      email: null,
      displayName: this.normalizeName(displayName, "Ospite"),
      passwordHash: null,
      isGuest: true,
    });
    const sessionToken = await this.issueSession(user.id);
    return { sessionToken, user: toAuthUser(user) };
  }

  /**
   * §6: chiude UNA sessione presentando il proprio token. Revoca idempotente + se il
   * principale è un OSPITE, marca il record come scaduto (§6.4). Chiude SOLO la
   * sessione del token presentato (mai quella di un altro utente): l'identità è
   * derivata dal token, mai da un id nel payload. Sui REGISTRATI rimuove la sola
   * sessione: l'account (credenziali/statistiche) non viene mai toccato. Token
   * assente/ignoto/già chiuso → no-op neutro.
   */
  private async endSessionByToken(token: string | undefined | null): Promise<boolean> {
    if (!token) return false;
    // Risolvi PRIMA (per sapere se ospite), poi revoca. Su token già chiuso,
    // getPrincipalByToken ritorna null → si salta la marcatura e la revoca è no-op.
    const principal = await this.getPrincipalByToken(token);
    if (principal?.isGuest) {
      await this.store.markGuestExpired(principal.userId, new Date());
    }
    await this.store.revokeSessionByTokenHash(hashToken(token));
    return principal !== null;
  }

  /**
   * LOGOUT ESPLICITO (uscita pulita, §6.2 livello 1): revoca IMMEDIATA della sessione
   * + scadenza immediata se ospite (§6.4). Nessuna grazia: è un'uscita volontaria.
   * Annulla anche un'eventuale chiusura morbida pendente per lo stesso token.
   */
  async logout(token: string): Promise<void> {
    this.cancelPendingLeave(hashToken(token));
    await this.endSessionByToken(token);
  }

  /**
   * §6.2/§6.3: endpoint del beacon `POST /session/leave`. Chiusura MORBIDA: pianifica
   * la revoca della sessione dopo il periodo di grazia, invece di revocarla subito,
   * così un `F5`/ritorno rapido (che riemette attività autenticata) la ANNULLA e la
   * partita riprende (§6.3). Alla scadenza della grazia, se non c'è stato resume:
   * revoca la sessione e, se il titolare è un OSPITE, lo marca scaduto (§6.4).
   * Proprietà:
   *  - IDEMPOTENTE: una seconda chiamata sullo stesso token (pagehide +
   *    visibilitychange, o ritardo) non pianifica una seconda chiusura;
   *  - BLINDATO: agisce ESCLUSIVAMENTE sulla sessione il cui token è presentato
   *    (risoluzione per hash del token, mai un id nel payload) → impossibile espellere
   *    un altro utente;
   *  - NEUTRO: token assente/ignoto/già chiuso → nessun effetto, nessuna eccezione.
   * Ritorna true se una chiusura morbida è stata pianificata.
   */
  async leaveSession(token: string | undefined | null): Promise<boolean> {
    if (!token) return false;
    const tokenHash = hashToken(token);
    // Idempotenza: già pianificata → non ripianificare (né annullare).
    if (this.pendingLeaves.has(tokenHash)) return true;
    // Risoluzione a basso livello (NON getPrincipalByToken, che annullerebbe la
    // chiusura trattando la chiamata come "attività"): serve solo a sapere se la
    // sessione è viva e se il titolare è un ospite.
    const session = await this.store.getSessionByTokenHash(tokenHash);
    if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      return false; // niente da chiudere: neutro
    }
    const user = await this.store.getUserById(session.userId);
    const isGuest = user?.isGuest ?? false;
    const userId = session.userId;
    const timer = setTimeout(() => {
      this.pendingLeaves.delete(tokenHash);
      void (async () => {
        // Scaduta la grazia senza resume: chiusura effettiva.
        if (isGuest) await this.store.markGuestExpired(userId, new Date());
        await this.store.revokeSessionByTokenHash(tokenHash);
      })().catch((err) => console.error("[session] chiusura differita fallita:", (err as Error).message));
    }, this.leaveGraceMs());
    timer.unref?.();
    this.pendingLeaves.set(tokenHash, timer);
    return true;
  }

  /**
   * SEC-A4 — "Esci da tutti i dispositivi": revoca TUTTE le sessioni del
   * principale del token corrente (inclusa quella in uso). Richiede un token
   * VALIDO (non idempotente su token ignoto): se non risolve un principale,
   * solleva UNAUTHORIZED, così l'endpoint risponde 401. Ritorna il numero di
   * sessioni revocate.
   */
  async logoutAll(token: string | undefined | null): Promise<number> {
    const principal = await this.getPrincipalByToken(token);
    if (!principal) throw new AuthError("UNAUTHORIZED", "Sessione non valida.");
    return this.store.revokeAllForUser(principal.userId);
  }

  /**
   * SEC-A3b — manutenzione periodica (v1 single-instance): pota sessioni
   * scadute/revocate e ospiti inattivi. Best-effort: un errore viene loggato ma
   * non propagato (nessun impatto sul gioco). Ritorna un piccolo report per i log.
   */
  async runMaintenance(now: Date = new Date()): Promise<{ sessions: number; guests: number }> {
    const sessions = await this.store.pruneSessions(now, PRUNE_REVOKED_GRACE_MS);
    const guests = await this.store.pruneInactiveGuests(new Date(now.getTime() - GUEST_INACTIVITY_MS));
    return { sessions, guests };
  }

  /**
   * Risolve il principale da un token. Ritorna `null` (mai eccezione) quando il
   * token è assente, sconosciuto, revocato o scaduto: il chiamante decide se è
   * 401 (HTTP) o rifiuto di join (WS). È il gate riusato da /auth/me e dal WS.
   */
  async getPrincipalByToken(token: string | undefined | null): Promise<AuthPrincipal | null> {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await this.store.getSessionByTokenHash(tokenHash);
    if (!session) return null;
    if (session.revokedAt !== null) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    const user = await this.store.getUserById(session.userId);
    if (!user) return null;
    // §6.3 RESUME: qualsiasi attività autenticata con questo token (es. /auth/me al
    // reload dopo un F5, o il rejoin WS) ANNULLA una chiusura sessione pendente:
    // l'utente è tornato entro la grazia, la sessione resta viva.
    this.cancelPendingLeave(tokenHash);
    return { userId: user.id, displayName: user.displayName, isGuest: user.isGuest };
  }

  /** Come getPrincipalByToken ma restituisce la vista utente completa per /auth/me. */
  async me(token: string | undefined | null): Promise<AuthUser> {
    const principal = await this.getPrincipalByToken(token);
    if (!principal) throw new AuthError("UNAUTHORIZED", "Sessione non valida.");
    const user = await this.store.getUserById(principal.userId);
    if (!user) throw new AuthError("UNAUTHORIZED", "Sessione non valida.");
    return toAuthUser(user);
  }
}
