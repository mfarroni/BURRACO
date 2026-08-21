"use client";

import type { UserStats, MatchesPage } from "./contract";
import { AuthClientError } from "./auth";
import { getAuthToken } from "./sessionIdentity";

/**
 * CLIENT PROFILO/STATISTICHE del frontend (macro-ciclo 3, framework-light).
 * Parla con gli endpoint HTTP /users/me/* del backend via fetch, sotto Bearer.
 * Il backend è l'unica autorità: qui NON si calcola nulla, si riflette la
 * risposta. L'utente è derivato lato server dal token (nessun id nel client).
 *
 * Separabilità FE/BE (decisione #8): nessun import dal backend, nessun package
 * condiviso. I DTO sono la COPIA allineata a mano in `contract.ts`.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const IS_PROD = process.env.NODE_ENV === "production";

function assertSecureBase(): void {
  if (IS_PROD && !API_URL.startsWith("https://")) {
    throw new AuthClientError(
      "INSECURE_CONFIG",
      "Configurazione non sicura: NEXT_PUBLIC_API_URL deve usare https:// in produzione.",
      0,
    );
  }
}

/** GET autenticato: allega il Bearer e normalizza gli errori. */
async function authedGet<T>(path: string): Promise<T> {
  assertSecureBase();
  const token = getAuthToken();
  if (!token) {
    throw new AuthClientError("UNAUTHORIZED", "Sessione non valida: accedi di nuovo.", 401);
  }
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AuthClientError("NETWORK", "Impossibile contattare il server. Riprova.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new AuthClientError(
      typeof body.error === "string" ? body.error : "ERROR",
      typeof body.message === "string" ? body.message : "Operazione non riuscita.",
      res.status,
    );
  }
  return body as unknown as T;
}

/** Statistiche aggregate del principale (solo utenti registrati; ospite → 403). */
export async function fetchStats(): Promise<UserStats> {
  return authedGet<UserStats>("/users/me/stats");
}

/** Storico partite paginato del principale. */
export async function fetchMatches(limit = 10, offset = 0): Promise<MatchesPage> {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return authedGet<MatchesPage>(`/users/me/matches?${qs.toString()}`);
}
