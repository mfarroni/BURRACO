"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnPhase } from "@/lib/useGameSocket";

/**
 * STATI VISIVI di prima classe (competenza ui_ux). Tutti prop-driven, così il
 * develop li aggancia allo stato client senza che qui viva alcuna regola.
 *
 * Copre: turno proprio/altrui + fase, countdown del turno, riconnessione
 * propria (+ "stato ripristinato"), stato dell'avversario, celebrazioni.
 */

/* ─────────────────────────────────────────────────────────────────────
 * COUNTDOWN — derivato lato client da turnEndsAt (epoch millis).
 * È puramente VISIVO: non decide nulla, il server è l'autorità sul timeout.
 * ───────────────────────────────────────────────────────────────────── */
export type CountdownLevel = "calm" | "urgent" | "expired";

export function useCountdown(turnEndsAt: number | null | undefined): {
  seconds: number | null;
  level: CountdownLevel;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (turnEndsAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [turnEndsAt]);

  if (turnEndsAt == null) return { seconds: null, level: "calm" };
  const ms = turnEndsAt - now;
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const level: CountdownLevel = ms <= 0 ? "expired" : seconds <= 10 ? "urgent" : "calm";
  return { seconds, level };
}

export function Countdown({ turnEndsAt }: { turnEndsAt: number | null | undefined }) {
  const { seconds, level } = useCountdown(turnEndsAt);
  if (seconds == null) return null; // turnEndsAt null → nessun countdown
  return (
    <span className="countdown" data-level={level} role="timer" aria-live={level === "urgent" ? "assertive" : "off"}>
      <span className="ring" aria-hidden="true" />
      {level === "expired" ? "Tempo scaduto" : `${seconds}s`}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * TURNO — banner principale (chi gioca + cosa fare adesso).
 * ───────────────────────────────────────────────────────────────────── */
export function TurnBanner({
  isMyTurn,
  phaseHint,
  opponentName,
}: {
  isMyTurn: boolean;
  phaseHint: string; // es. "Pesca per iniziare il turno" / "Cala o scarta"
  opponentName: string;
}) {
  return (
    <div className="banner" data-tone={isMyTurn ? "success" : "info"} aria-live="polite">
      <span className="banner-icon" aria-hidden="true">
        {isMyTurn ? "♠" : "⋯"}
      </span>
      <span className="banner-body">
        <span className="banner-title">{isMyTurn ? "Tocca a te" : `Turno di ${opponentName}`}</span>
        <span className="banner-sub">{isMyTurn ? phaseHint : "L'avversario sta pensando…"}</span>
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * RICONNESSIONE PROPRIA — connecting / reconnecting / closed.
 * "Stato ripristinato" SOLO se resumed === true (da room_joined.resumed).
 * ───────────────────────────────────────────────────────────────────── */
export function ConnectionBanner({
  connPhase,
  resumed,
}: {
  connPhase: ConnPhase;
  /** true solo dopo un rejoin che ha ripristinato lo stato. */
  resumed?: boolean;
}) {
  // "Stato ripristinato": conferma effimera dopo una riconnessione riuscita.
  const [showResumed, setShowResumed] = useState(false);
  const prevPhase = useRef<ConnPhase>(connPhase);
  useEffect(() => {
    const wasReconnecting = prevPhase.current === "reconnecting";
    prevPhase.current = connPhase;
    if (resumed && wasReconnecting && connPhase === "connected") {
      setShowResumed(true);
      const t = setTimeout(() => setShowResumed(false), 3500);
      return () => clearTimeout(t);
    }
  }, [connPhase, resumed]);

  if (showResumed) {
    return (
      <div className="banner" data-tone="success" role="status">
        <span className="banner-icon" aria-hidden="true">✓</span>
        <span className="banner-body">
          <span className="banner-title">Stato ripristinato</span>
          <span className="banner-sub">Sei di nuovo al tavolo, la partita riprende da dove era.</span>
        </span>
      </div>
    );
  }

  if (connPhase === "reconnecting" || connPhase === "connecting") {
    return (
      <div className="banner" data-tone="warn" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span className="banner-body">
          <span className="banner-title">
            {connPhase === "connecting" ? "Connessione al tavolo…" : "Riconnessione in corso…"}
          </span>
          <span className="banner-sub">Non chiudere la pagina: rientri automaticamente nella partita.</span>
        </span>
      </div>
    );
  }

  if (connPhase === "closed") {
    return (
      <div className="banner" data-tone="danger" role="alert">
        <span className="banner-icon" aria-hidden="true">⚠</span>
        <span className="banner-body">
          <span className="banner-title">Connessione persa</span>
          <span className="banner-sub">Ricarica la pagina per rientrare nella partita.</span>
        </span>
      </div>
    );
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────
 * AVVERSARIO — nome, n. carte in mano, stato di connessione.
 * ───────────────────────────────────────────────────────────────────── */
export function OpponentStatus({
  name,
  handCount,
  connected,
}: {
  name: string;
  handCount: number;
  connected: boolean;
}) {
  return (
    <span className="badge" data-conn={connected ? "connected" : "disconnected"} aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {name} · {handCount} carte
      {!connected && <span className="sr-only"> (disconnesso)</span>}
      {!connected && " · offline"}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * CELEBRAZIONI effimere (eventi presentazionali del server).
 * pozzetto_taken → "Pozzetto!" ; burraco_made → pulito vs sporco (distinti).
 * Non bloccano il gioco; rispettano prefers-reduced-motion (via CSS).
 * ───────────────────────────────────────────────────────────────────── */
export type CelebrationKind = "pozzetto" | "burraco-clean" | "burraco-dirty";

export interface CelebrationInfo {
  kind: CelebrationKind;
  /** true se l'ha fatto il giocatore locale (testo in prima persona). */
  byYou: boolean;
  id: number; // chiave univoca per rilanciare l'animazione
}

const CELEBRATION_COPY: Record<CelebrationKind, { title: string; sub: string }> = {
  pozzetto: { title: "Pozzetto!", sub: "Le 11 carte del pozzetto entrano in gioco." },
  "burraco-clean": { title: "Burraco pulito ✦", sub: "Sette carte senza matte: +200." },
  "burraco-dirty": { title: "Burraco sporco ✧", sub: "Sette carte con una matta: +100." },
};

export function Celebration({ info }: { info: CelebrationInfo | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!info) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1300);
    return () => clearTimeout(t);
  }, [info]);

  if (!info || !visible) return null;
  const copy = CELEBRATION_COPY[info.kind];
  return (
    <div className="celebration" data-kind={info.kind} role="status" aria-live="polite">
      <div className="banner-celebrate">
        <div className="title">{info.byYou ? copy.title : `Avversario: ${copy.title}`}</div>
        <div className="sub">{copy.sub}</div>
      </div>
    </div>
  );
}
