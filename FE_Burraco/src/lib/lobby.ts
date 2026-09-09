"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TablesResponse, NewCodeResponse, WaitingTableView } from "./contract";
import { getAuthToken } from "./sessionIdentity";

/**
 * CLIENT HTTP della LOBBY (macro-ciclo lobby). Parla con le rotte REST del
 * backend (GET /tables, GET /tables/new-code, POST /session/leave). NON contiene
 * logica di gioco: l'avvio partita passa SEMPRE dal WebSocket (useGameSocket). Il
 * polling di /tables è solo informativo e funge da heartbeat di presenza in lobby.
 *
 * Separabilità FE/BE (decisione #8): nessun import dal backend; i DTO sono la
 * COPIA allineata a mano in contract.ts.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const IS_PROD = process.env.NODE_ENV === "production";
/** Intervallo di polling della lista tavoli (§5.1). */
const LOBBY_POLL_MS = 5000;
/** Timeout massimo di una richiesta lobby. */
const REQUEST_TIMEOUT_MS = 10_000;

function assertSecureBase(): void {
  if (IS_PROD && !API_URL.startsWith("https://")) {
    throw new Error("Configurazione non sicura: NEXT_PUBLIC_API_URL deve usare https:// in produzione.");
  }
}

async function getJson<T>(path: string): Promise<T> {
  assertSecureBase();
  const token = getAuthToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL + path, {
      method: "GET",
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** GET /tables/new-code → codice tavolo precompilato dal server. */
export async function fetchNewCode(): Promise<string> {
  const body = await getJson<NewCodeResponse>("/tables/new-code");
  return body.code;
}

/**
 * Chiusura PULITA del proprio tavolo in attesa via beacon (navigator.sendBeacon,
 * affidabile su pagehide/unload). Il beacon NON può impostare l'header
 * Authorization: il token viaggia nel corpo JSON (è il PROPRIO credential, nessun
 * IDOR). Best-effort: alla scadenza della grace il server ripulisce comunque.
 */
export function leaveSessionBeacon(): void {
  try {
    const token = getAuthToken();
    if (!token) return;
    const blob = new Blob([JSON.stringify({ token })], { type: "application/json" });
    navigator.sendBeacon(API_URL + "/session/leave", blob);
  } catch {
    /* best-effort: nessuna azione se il beacon non è disponibile */
  }
}

export type LobbyStatus = "loading" | "ok" | "error";

export interface LobbyList {
  tables: WaitingTableView[];
  lobbyPlayers: number;
  status: LobbyStatus;
  /** Forza un refresh immediato della lista (es. dopo ROOM_JUST_TAKEN). */
  refresh: () => void;
}

/**
 * Hook che effettua il POLLING di GET /tables ogni 5s mentre `enabled` è true
 * (tipicamente: utente autenticato e non ancora seduto a un tavolo). Espone la
 * lista, il contatore giocatori e lo stato (loading/ok/error). Il polling è anche
 * l'heartbeat di presenza in lobby lato server (§6.2).
 */
export function useLobbyList(enabled: boolean): LobbyList {
  const [tables, setTables] = useState<WaitingTableView[]>([]);
  const [lobbyPlayers, setLobbyPlayers] = useState(0);
  const [status, setStatus] = useState<LobbyStatus>("loading");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const body = await getJson<TablesResponse>("/tables");
      if (!aliveRef.current) return;
      setTables(body.tables);
      setLobbyPlayers(body.lobbyPlayers);
      setStatus("ok");
    } catch {
      if (!aliveRef.current) return;
      // Non azzeriamo la lista: mostriamo l'ultima nota e segnaliamo l'errore
      // (il polling riprova al tick successivo).
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    setStatus("loading");
    void poll();
    timer.current = setInterval(() => void poll(), LOBBY_POLL_MS);
    return () => {
      aliveRef.current = false;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [enabled, poll]);

  return { tables, lobbyPlayers, status, refresh: () => void poll() };
}

/**
 * Registra il beacon di chiusura pulita su `pagehide` mentre `enabled` è true
 * (tipicamente: l'utente ha un tavolo in attesa). Su unload/chiusura scheda invia
 * POST /session/leave così il tavolo sparisce subito dalla lista, senza attendere
 * i 60s di grace. Idempotente lato server.
 */
export function useLeaveOnPageHide(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => leaveSessionBeacon();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [enabled]);
}
