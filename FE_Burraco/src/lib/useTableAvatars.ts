"use client";

import { useEffect, useState } from "react";
import { fetchTableAvatars } from "./profile";

/**
 * Foto dei giocatori ai POSTI del tavolo corrente. Le foto NON viaggiano nello stato
 * di gioco WebSocket (inviato a ogni mossa): si chiedono via HTTP una volta, e di
 * nuovo solo quando cambia la composizione del tavolo (`rosterKey`: chi siede dove).
 * In errore o senza tavolo → nessuna foto: i posti mostrano l'iniziale.
 */
export function useTableAvatars(roomCode: string | null, rosterKey: string): Record<number, string | null> {
  const [avatars, setAvatars] = useState<Record<number, string | null>>({});

  useEffect(() => {
    if (!roomCode || !rosterKey) {
      setAvatars({});
      return;
    }
    let alive = true;
    fetchTableAvatars(roomCode)
      .then((a) => {
        if (alive) setAvatars(a);
      })
      .catch(() => {
        /* foto facoltative: in errore restano le iniziali */
      });
    return () => {
      alive = false;
    };
  }, [roomCode, rosterKey]);

  return avatars;
}
