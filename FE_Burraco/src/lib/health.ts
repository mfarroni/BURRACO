"use client";

/**
 * PROBE di disponibilità del backend (FASE 3, Livello 2). Un GET a /health
 * (SOLA LETTURA, già in `connect-src` della CSP). Ritorna true se il servizio ha
 * risposto 200, false altrimenti (rete assente, cold start non ancora completato,
 * errore). Nessun dettaglio interno viene interpretato: al FE basta "è su?".
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export async function probeHealth(timeoutMs = 15_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL + "/health", {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
