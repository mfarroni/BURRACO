"use client";

import { useEffect, useRef, useState } from "react";
import { probeHealth } from "./health";

/**
 * Hook di DISPONIBILITÀ del backend (FASE 3, Livello 2). Sonda /health con backoff
 * crescente (1s→2s→4s→8s, cap 8s) finché non risponde; quando è su, continua con un
 * heartbeat lento per accorgersi di una caduta (es. un deploy = un riavvio) e
 * riprendere subito l'attesa. Espone lo stato utile alla schermata di connessione:
 *  - `ready`: /health ha risposto ed è (ancora) su → l'app può procedere;
 *  - `waiting`: attesa in corso (non ready);
 *  - `elapsedMs`: durata dell'attesa corrente (per il messaggio "ci mette di più");
 *  - `longWait`: attesa oltre la soglia (messaggio diverso, §3.4).
 *
 * Nessun pulsante "riprova" come unica via: la riprova è automatica e l'ingresso
 * scatta da solo appena il servizio risponde.
 */

const BACKOFFS_MS = [1_000, 2_000, 4_000, 8_000];
const HEARTBEAT_MS = 60_000;
const LONG_WAIT_MS = 45_000;

export interface ServiceHealth {
  ready: boolean;
  waiting: boolean;
  elapsedMs: number;
  longWait: boolean;
}

export function useServiceHealth(): ServiceHealth {
  const [ready, setReady] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const readyRef = useRef(false);
  const waitStartRef = useRef<number>(Date.now());

  useEffect(() => {
    let alive = true;
    let attempt = 0;
    let scheduled: ReturnType<typeof setTimeout> | undefined;

    // Ticker leggero: aggiorna elapsedMs per la soglia "attesa lunga".
    const ticker = setInterval(() => {
      if (alive && !readyRef.current) setElapsedMs(Date.now() - waitStartRef.current);
    }, 1_000);

    const run = async () => {
      if (!alive) return;
      const ok = await probeHealth();
      if (!alive) return;
      if (ok) {
        readyRef.current = true;
        setReady(true);
        setElapsedMs(0);
        attempt = 0;
        scheduled = setTimeout(run, HEARTBEAT_MS); // heartbeat lento
        return;
      }
      // Non disponibile: se prima era su, ricomincia il cronometro dell'attesa.
      if (readyRef.current) waitStartRef.current = Date.now();
      readyRef.current = false;
      setReady(false);
      const delay = BACKOFFS_MS[Math.min(attempt, BACKOFFS_MS.length - 1)]!;
      attempt += 1;
      scheduled = setTimeout(run, delay);
    };

    void run();
    return () => {
      alive = false;
      clearInterval(ticker);
      if (scheduled) clearTimeout(scheduled);
    };
  }, []);

  return { ready, waiting: !ready, elapsedMs, longWait: elapsedMs > LONG_WAIT_MS };
}
