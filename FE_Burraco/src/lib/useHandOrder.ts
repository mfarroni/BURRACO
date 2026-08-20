"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card } from "./contract";

/**
 * ORDINE LOCALE della mano (SOLO presentazione). L'utente può riordinare le
 * proprie carte a ventaglio: quest'ordine è una preferenza PURAMENTE VISIVA,
 * persistita in `sessionStorage` per-scheda e per-tavolo, e NON viene MAI inviato
 * al server. Il server resta l'unica autorità sulla composizione della mano; qui
 * si ordinano soltanto per `id` le carte che il server ha già comunicato.
 *
 * Nessuna logica di regole: riordinare non cala, non seleziona, non valida nulla.
 *
 * Riconciliazione a ogni nuovo stato del server:
 *  - si mantengono gli id noti nell'ordine scelto dall'utente;
 *  - le carte NUOVE (pescate/ricevute) si accodano nell'ordine del server;
 *  - gli id non più in mano (scartati/calati) si rimuovono.
 */

function storageKey(room: string): string {
  return `burraco_hand_order_${room.toUpperCase()}`;
}

function readOrder(room: string): string[] {
  try {
    const raw = sessionStorage.getItem(storageKey(room));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeOrder(room: string, order: string[]): void {
  try {
    sessionStorage.setItem(storageKey(room), JSON.stringify(order));
  } catch {
    /* storage indisponibile: l'ordine resta comunque in stato React per la scheda */
  }
}

/**
 * Riconcilia l'ordine memorizzato con gli id realmente in mano dal server.
 * Preserva l'arrangiamento dell'utente e accoda le novità.
 */
function reconcile(stored: string[], serverIds: string[]): string[] {
  const serverSet = new Set(serverIds);
  const kept = stored.filter((id) => serverSet.has(id));
  const keptSet = new Set(kept);
  const appended = serverIds.filter((id) => !keptSet.has(id));
  return [...kept, ...appended];
}

export interface HandOrder {
  /** Le carte del server riordinate secondo la preferenza locale. */
  orderedHand: Card[];
  /** Sposta la carta `id` di `delta` posizioni (−1 sinistra, +1 destra). Clamp ai bordi. */
  moveBy: (id: string, delta: number) => void;
  /** Sposta la carta `id` all'indice assoluto `toIndex` (usato dal drag-and-drop). */
  moveTo: (id: string, toIndex: number) => void;
}

export function useHandOrder(room: string | null, hand: Card[]): HandOrder {
  const [order, setOrder] = useState<string[]>([]);
  // Indice rapido id → carta per ricomporre la mano ordinata.
  const byId = useMemo(() => {
    const m = new Map<string, Card>();
    for (const c of hand) m.set(c.id, c);
    return m;
  }, [hand]);

  const serverIds = useMemo(() => hand.map((c) => c.id), [hand]);
  // Firma stabile per rilevare cambi reali della composizione (non dell'ordine).
  const serverSig = serverIds.join(",");
  const roomRef = useRef(room);
  roomRef.current = room;

  // Riconciliazione quando cambia la composizione della mano o il tavolo.
  useEffect(() => {
    if (!room) {
      setOrder(serverIds);
      return;
    }
    const stored = readOrder(room);
    const next = reconcile(stored.length > 0 ? stored : serverIds, serverIds);
    setOrder(next);
    writeOrder(room, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, serverSig]);

  const moveTo = useCallback(
    (id: string, toIndex: number) => {
      setOrder((prev) => {
        const from = prev.indexOf(id);
        if (from === -1) return prev;
        const clamped = Math.max(0, Math.min(prev.length - 1, toIndex));
        if (from === clamped) return prev;
        const next = [...prev];
        next.splice(from, 1);
        next.splice(clamped, 0, id);
        const r = roomRef.current;
        if (r) writeOrder(r, next);
        return next;
      });
    },
    [],
  );

  const moveBy = useCallback(
    (id: string, delta: number) => {
      setOrder((prev) => {
        const from = prev.indexOf(id);
        if (from === -1) return prev;
        const to = Math.max(0, Math.min(prev.length - 1, from + delta));
        if (from === to) return prev;
        const next = [...prev];
        next.splice(from, 1);
        next.splice(to, 0, id);
        const r = roomRef.current;
        if (r) writeOrder(r, next);
        return next;
      });
    },
    [],
  );

  // Ricompone la mano ordinata; ignora eventuali id non più risolvibili.
  const orderedHand = useMemo(() => {
    const seen = new Set<string>();
    const result: Card[] = [];
    for (const id of order) {
      const c = byId.get(id);
      if (c && !seen.has(id)) {
        result.push(c);
        seen.add(id);
      }
    }
    // Rete di sicurezza: eventuali carte del server non ancora nell'ordine.
    for (const c of hand) if (!seen.has(c.id)) result.push(c);
    return result;
  }, [order, byId, hand]);

  return { orderedHand, moveBy, moveTo };
}
