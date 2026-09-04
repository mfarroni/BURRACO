"use client";

import { useEffect, useState } from "react";
import type { OpenRoomInfo, OpenRoomsResponse } from "@/lib/contract";
import "./OpenTablesList.css";

/**
 * ELENCO TAVOLI APERTI (§4.2). Polling READ-ONLY di GET /rooms/open ogni 5s,
 * SOSPESO quando la scheda è in background (`visibilityState === "hidden"`) e
 * RIPRESO al ritorno in primo piano. È montato SOLO in lobby: al join il componente
 * si smonta e il polling si interrompe. Il click su una riga chiama `onSit(code)`,
 * che percorre lo STESSO identico flusso del join manuale (nessuna scorciatoia).
 *
 * L'elenco è un AUSILIO, mai un prerequisito: se il backend è spento mostra "Elenco
 * non disponibile" con "Riprova", e il box del codice tavolo continua a funzionare.
 * Stile: solo classi/variabili del design system, CSS scopato sotto `.open-tables`.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const POLL_MS = 5000;

type Status = "loading" | "ok" | "error";

/** Tempo di attesa in forma relativa e leggibile ("in attesa da 2 min"). */
function relativeWait(iso: string, now: number): string {
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return "";
  const sec = Math.max(0, Math.floor((now - start) / 1000));
  if (sec < 60) return "in attesa da pochi secondi";
  const min = Math.floor(sec / 60);
  if (min < 60) return `in attesa da ${min} min`;
  const h = Math.floor(min / 60);
  return `in attesa da ${h} h`;
}

export function OpenTablesList({
  onSit,
  reloadKey = 0,
  disabled = false,
}: {
  /** Siediti: valorizza il codice e percorre il join esistente. */
  onSit: (code: string) => void;
  /** Bump per forzare un reload immediato (es. dopo un join fallito per race, §4.3). */
  reloadKey?: number;
  /** Disabilita i pulsanti "Siediti" durante una connessione già in corso. */
  disabled?: boolean;
}) {
  const [rooms, setRooms] = useState<OpenRoomInfo[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [now, setNow] = useState<number>(() => Date.now());
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Sospeso quando la scheda è in background: nessuna richiesta finché nascosta.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`${API_URL}/rooms/open`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as OpenRoomsResponse;
        if (!alive) return;
        setRooms(Array.isArray(body.rooms) ? body.rooms : []);
        setNow(Date.now());
        setStatus("ok");
      } catch {
        if (alive) setStatus("error");
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    // Ripresa immediata al ritorno della scheda in primo piano.
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reloadKey, retry]);

  return (
    <section className="open-tables" aria-live="polite">
      <h2 className="open-tables-title">Tavoli in attesa di un compagno</h2>

      {status === "error" ? (
        <p className="open-tables-msg muted" role="status">
          Elenco non disponibile.{" "}
          <button type="button" className="open-tables-retry" onClick={() => setRetry((r) => r + 1)}>
            Riprova
          </button>
        </p>
      ) : rooms.length === 0 ? (
        <p className="open-tables-msg muted" role="status">
          {status === "loading"
            ? "Cerco tavoli aperti…"
            : "Nessun tavolo in attesa. Inserisci un codice qui sopra per aprirne uno tu."}
        </p>
      ) : (
        <ul className="open-tables-list">
          {rooms.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                className="open-tables-row"
                onClick={() => onSit(r.code)}
                disabled={disabled}
                aria-label={`Siediti al tavolo ${r.code} di ${r.hostName}, ${relativeWait(r.waitingSince, now)}`}
              >
                <span className="ot-main">
                  <span className="ot-code">{r.code}</span>
                  <span className="ot-host">{r.hostName}</span>
                </span>
                <span className="ot-meta">
                  <span className="ot-wait">{relativeWait(r.waitingSince, now)}</span>
                  <span className="ot-sit" aria-hidden="true">Siediti</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
