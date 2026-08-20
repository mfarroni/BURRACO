"use client";

import type { AuthSuccess, AuthUser, AuthErrorBody } from "./contract";
import { getAuthToken, saveAuthToken, clearAuthToken } from "./sessionIdentity";

/**
 * CLIENT AUTH del frontend (framework-light: nessuna regola di gioco qui).
 * Parla con gli endpoint HTTP /auth/* del backend via fetch, gestendo il token
 * opaco tramite il modulo resiliente `sessionIdentity` (memoria + sessionStorage).
 *
 * Il backend è l'unica autorità: qui NON si validano credenziali né si deriva
 * alcuna identità: si inviano le intenzioni e si riflette la risposta del server.
 *
 * Separabilità FE/BE (decisione #8): nessun import dal backend, nessun package
 * condiviso. I DTO sono la COPIA allineata a mano in `contract.ts`.
 */

/**
 * Base URL HTTP del backend. In produzione DEVE essere https:// (specchio del
 * vincolo wss:// del WS): se manca o è insicura, le chiamate falliscono in modo
 * leggibile invece di inviare credenziali in chiaro.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const IS_PROD = process.env.NODE_ENV === "production";

/** Errore normalizzato delle chiamate auth (per messaggi UX leggibili). */
export class AuthClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthClientError";
  }
}

function assertSecureBase(): void {
  if (IS_PROD && !API_URL.startsWith("https://")) {
    throw new AuthClientError(
      "INSECURE_CONFIG",
      "Configurazione non sicura: NEXT_PUBLIC_API_URL deve usare https:// in produzione.",
      0,
    );
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  assertSecureBase();
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    // Rete assente / server irraggiungibile: messaggio neutro, nessun dettaglio.
    throw new AuthClientError("NETWORK", "Impossibile contattare il server. Riprova.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<AuthErrorBody> & Record<string, unknown>;
  if (!res.ok) {
    throw new AuthClientError(
      typeof body.error === "string" ? body.error : "ERROR",
      typeof body.message === "string" ? body.message : "Operazione non riuscita.",
      res.status,
    );
  }
  return body as unknown as T;
}

/** Registra un nuovo account, salva il token e ritorna l'utente. */
export async function register(email: string, password: string, displayName?: string): Promise<AuthUser> {
  const res = await call<AuthSuccess>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName }),
  });
  saveAuthToken(res.token);
  return res.user;
}

/** Effettua il login, salva il token e ritorna l'utente. */
export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await call<AuthSuccess>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  saveAuthToken(res.token);
  return res.user;
}

/** Crea una sessione OSPITE (senza credenziali), salva il token e ritorna l'utente. */
export async function guest(displayName?: string): Promise<AuthUser> {
  const res = await call<AuthSuccess>("/auth/guest", {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
  saveAuthToken(res.token);
  return res.user;
}

/**
 * Revoca la sessione lato server e cancella il token locale. Idempotente e
 * tollerante agli errori: il token locale viene comunque rimosso.
 */
export async function logout(): Promise<void> {
  const token = getAuthToken();
  try {
    if (token) {
      await call<{ ok: true }>("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
    }
  } catch {
    /* logout best-effort: si prosegue comunque a pulire il locale */
  } finally {
    clearAuthToken();
  }
}

/**
 * Risolve l'utente corrente dal token salvato (per ripristinare la sessione al
 * caricamento pagina). Ritorna null se non c'è token o se non è più valido
 * (in tal caso pulisce il token stantìo).
 */
export async function me(): Promise<AuthUser | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await call<{ user: AuthUser }>("/auth/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.user;
  } catch (err) {
    // Token non più valido (401): pulizia; altri errori (rete) → non cancellare.
    if (err instanceof AuthClientError && err.status === 401) clearAuthToken();
    return null;
  }
}

/** Espone il token corrente al layer WS (per l'authToken di join_room). */
export { getAuthToken };
