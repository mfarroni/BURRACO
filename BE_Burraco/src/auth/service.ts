import type { AuthPrincipal, AuthStore, AuthUser, StoredUser } from "./types.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateSessionToken, hashToken } from "./tokens.js";

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

  constructor(
    private readonly store: AuthStore,
    opts?: { sessionTtlMs?: number },
  ) {
    this.sessionTtlMs = opts?.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  /** Emette un token opaco, ne persiste SOLO l'hash e lo restituisce in chiaro. */
  private async issueSession(userId: string): Promise<string> {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
    await this.store.createSession({ userId, tokenHash: hashToken(token), expiresAt });
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

  /** Revoca idempotente della sessione associata al token (logout). */
  async logout(token: string): Promise<void> {
    await this.store.revokeSessionByTokenHash(hashToken(token));
  }

  /**
   * Risolve il principale da un token. Ritorna `null` (mai eccezione) quando il
   * token è assente, sconosciuto, revocato o scaduto: il chiamante decide se è
   * 401 (HTTP) o rifiuto di join (WS). È il gate riusato da /auth/me e dal WS.
   */
  async getPrincipalByToken(token: string | undefined | null): Promise<AuthPrincipal | null> {
    if (!token) return null;
    const session = await this.store.getSessionByTokenHash(hashToken(token));
    if (!session) return null;
    if (session.revokedAt !== null) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    const user = await this.store.getUserById(session.userId);
    if (!user) return null;
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
