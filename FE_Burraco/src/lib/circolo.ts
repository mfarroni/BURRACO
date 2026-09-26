"use client";

import { useEffect, useState } from "react";
import type { CircoloResponse, PublicEvent } from "./contract";

/**
 * Audit lancio R02 (Ciclo 3) — "Chi arriva da solo": client della rotta PUBBLICA
 * `GET /circolo` (nessun token). Riporta le prossime serate pubblicate dall'admin e
 * le presenze AGGREGATE, per dire al visitatore QUANDO trovare qualcuno al tavolo.
 * Best-effort: un errore (server che si sveglia, rete) lascia semplicemente vuoto.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const IS_PROD = process.env.NODE_ENV === "production";
const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchCircolo(): Promise<CircoloResponse | null> {
  if (IS_PROD && !API_URL.startsWith("https://")) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL + "/circolo", { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as CircoloResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stato del circolo, riletto ogni `pollMs` finché `enabled`. `null` finché non c'è
 * una risposta valida (i componenti in quel caso non mostrano nulla).
 */
export function useCircolo(enabled: boolean, pollMs = 60_000): CircoloResponse | null {
  const [data, setData] = useState<CircoloResponse | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const r = await fetchCircolo();
      if (alive && r) setData(r);
    };
    void load();
    const id = setInterval(() => void load(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled, pollMs]);
  return data;
}

const fmtDay = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" });
const fmtTime = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });

/** "giovedì 2 ottobre, ore 21:00" (con "– 23:00" se c'è la fine nello stesso giorno). */
export function formatEventWhen(ev: PublicEvent, now: Date = new Date()): string {
  const start = new Date(ev.inizioAt);
  const started = start.getTime() <= now.getTime();
  const end = ev.fineAt != null ? new Date(ev.fineAt) : null;
  const time = end && end.toDateString() === start.toDateString()
    ? `ore ${fmtTime.format(start)}–${fmtTime.format(end)}`
    : `ore ${fmtTime.format(start)}`;
  return started ? `In corso adesso · ${time}` : `${fmtDay.format(start)}, ${time}`;
}
