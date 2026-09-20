"use client";

/**
 * CLIENT del form contatti (FASE 2). Parla con `POST /api/contact` del backend.
 * Separabilità FE/BE (decisione #8): nessun import dal backend; questi tipi sono
 * una COPIA MANUALE locale (file NUOVO, mai `lib/contract.ts`, che è il contratto
 * di GIOCO). Il backend è l'unica autorità: qui non si valida nulla di sostanziale
 * (solo la forma del form) e la risposta è sempre generica.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const IS_PROD = process.env.NODE_ENV === "production";
const REQUEST_TIMEOUT_MS = 15_000;

/** Payload inviato al backend (onore dei campi anti-spam: honeypot + tempo). */
export interface ContactInput {
  nome: string;
  email: string;
  oggetto: string;
  messaggio: string;
  /** Honeypot: sempre vuoto per un umano (campo nascosto). */
  website: string;
  /** Timestamp (ms) di render del form: soglia di tempo minima lato server. */
  renderedAt: number;
}

/** Errore normalizzato del client contatti (per messaggi UX). */
export class ContactError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContactError";
  }
}

/**
 * Invia il messaggio. Risolve su 200 (esito generico: il server non rivela se
 * l'email è partita). Rigetta SOLO su fallimento HTTP del POST o problema di rete,
 * mai per l'esito dell'invio email.
 */
export async function sendContact(input: ContactInput): Promise<void> {
  if (IS_PROD && !API_URL.startsWith("https://")) {
    throw new ContactError("INSECURE_CONFIG", "Configurazione non sicura del server.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_URL + "/api/contact", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ContactError("TIMEOUT", "Tempo scaduto: riprova tra poco.");
    }
    throw new ContactError("NETWORK", "Impossibile inviare ora: controlla la connessione e riprova.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    throw new ContactError("RATE_LIMITED", "Hai inviato troppi messaggi. Riprova tra un po'.");
  }
  if (!res.ok) {
    throw new ContactError("ERROR", "Non è stato possibile inviare il messaggio. Riprova.");
  }
}
