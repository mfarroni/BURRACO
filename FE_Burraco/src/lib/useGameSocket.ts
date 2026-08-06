"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  GameConfig,
  GameStatePublic,
  HandScoreDetail,
  PlayerPublic,
  RejectCode,
  Seat,
  ServerMessage,
} from "./contract";

/**
 * Hook che possiede la connessione WebSocket e lo STATO CLIENT (architettura FE
 * di competenza del develop). Il client è muto sulle regole: invia intenzioni e
 * riflette lo stato REDATTO ricevuto dal server, che è l'unica autorità.
 *
 * Copre l'esigenza UX chiave: tra l'invio di una mossa e la risposta del server
 * c'è latenza -> stato `pending` ("attendo conferma").
 */

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
const RECONNECT_DELAY_MS = 1500;
const HEARTBEAT_MS = 25_000;

export type ConnPhase = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export interface RejectionInfo {
  code: RejectCode;
  reason: string;
  at: number;
}
export interface HandEndedInfo {
  closerSeat: Seat | null;
  scores: HandScoreDetail[];
  cumulative: [number, number];
}
export interface GameEndedInfo {
  winnerSeat: Seat | null;
  finalScores: [number, number];
}

export interface GameSocketApi {
  connPhase: ConnPhase;
  joined: boolean;
  yourSeat: Seat | null;
  players: PlayerPublic[];
  config: GameConfig | null;
  state: GameStatePublic | null;
  rejection: RejectionInfo | null;
  handEnded: HandEndedInfo | null;
  gameEnded: GameEndedInfo | null;
  /** true tra l'invio di una mossa e la risposta del server. */
  pending: boolean;
  errorMessage: string | null;

  join: (roomCode: string, displayName: string) => void;
  drawDeck: () => void;
  drawDiscard: () => void;
  meldNew: (cards: string[]) => void;
  meldExtend: (meldId: string, cards: string[]) => void;
  pinellaSubstitute: (meldId: string, cardInHand: string) => void;
  discard: (card: string) => void;
  dismissRejection: () => void;
}

function tokenKey(room: string): string {
  return `burraco_token_${room.toUpperCase()}`;
}

export function useGameSocket(): GameSocketApi {
  const [connPhase, setConnPhase] = useState<ConnPhase>("idle");
  const [joined, setJoined] = useState(false);
  const [yourSeat, setYourSeat] = useState<Seat | null>(null);
  const [players, setPlayers] = useState<PlayerPublic[]>([]);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [state, setState] = useState<GameStatePublic | null>(null);
  const [rejection, setRejection] = useState<RejectionInfo | null>(null);
  const [handEnded, setHandEnded] = useState<HandEndedInfo | null>(null);
  const [gameEnded, setGameEnded] = useState<GameEndedInfo | null>(null);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<string | null>(null);
  const nameRef = useRef<string>("");
  const wantConnectedRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const storedToken = useCallback((room: string): string | undefined => {
    try {
      return localStorage.getItem(tokenKey(room)) ?? undefined;
    } catch {
      return undefined;
    }
  }, []);

  const sendRaw = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  /** Invia un'intenzione di mossa e attiva lo stato "attendo conferma". */
  const sendMove = useCallback(
    (msg: ClientMessage) => {
      setRejection(null);
      const ok = sendRaw(msg);
      if (ok) setPending(true);
    },
    [sendRaw],
  );

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "room_joined": {
        setJoined(true);
        setYourSeat(msg.yourSeat);
        setPlayers(msg.players);
        setConfig(msg.config);
        try {
          if (roomRef.current) localStorage.setItem(tokenKey(roomRef.current), msg.yourToken);
        } catch {
          /* storage non disponibile: la riconnessione userà comunque la sessione viva */
        }
        break;
      }
      case "state": {
        setState(msg.state);
        setPending(false);
        // Un nuovo stato "playing" chiude gli overlay di fine mano.
        if (msg.state.status === "playing") setHandEnded(null);
        break;
      }
      case "move_rejected": {
        setRejection({ code: msg.code, reason: msg.reason, at: Date.now() });
        setPending(false);
        break;
      }
      case "turn_changed":
        // Lo stato redatto arriva subito dopo: nessuna azione necessaria qui.
        break;
      case "hand_ended":
        setHandEnded({ closerSeat: msg.closerSeat, scores: msg.scores, cumulative: msg.cumulative });
        setPending(false);
        break;
      case "game_ended":
        setGameEnded({ winnerSeat: msg.winnerSeat, finalScores: msg.finalScores });
        setPending(false);
        break;
      case "opponent_disconnected":
      case "opponent_reconnected":
        setPlayers((prev) =>
          prev.map((p) =>
            p.seat === msg.seat
              ? { ...p, connectionStatus: msg.type === "opponent_reconnected" ? "connected" : "disconnected" }
              : p,
          ),
        );
        break;
      case "error":
        setErrorMessage(msg.message);
        break;
    }
  }, []);

  const connect = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    setConnPhase((prev) => (prev === "closed" || prev === "reconnecting" ? "reconnecting" : "connecting"));

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnPhase("connected");
      setErrorMessage(null);
      sendRaw({
        type: "join_room",
        roomCode: room,
        displayName: nameRef.current,
        playerToken: storedToken(room),
      });
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = setInterval(() => sendRaw({ type: "heartbeat" }), HEARTBEAT_MS);
    };

    ws.onmessage = (ev) => {
      try {
        handleMessage(JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        /* messaggio non parsabile: ignora */
      }
    };

    ws.onclose = () => {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (!wantConnectedRef.current) {
        setConnPhase("closed");
        return;
      }
      // Riconnessione automatica entro la finestra di grazia lato server.
      setConnPhase("reconnecting");
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [handleMessage, sendRaw, storedToken]);

  const join = useCallback(
    (roomCode: string, displayName: string) => {
      const room = roomCode.trim().toUpperCase();
      if (!room) return;
      roomRef.current = room;
      nameRef.current = displayName.trim() || "Giocatore";
      wantConnectedRef.current = true;
      connect();
    },
    [connect],
  );

  useEffect(() => {
    return () => {
      wantConnectedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      wsRef.current?.close();
    };
  }, []);

  return {
    connPhase,
    joined,
    yourSeat,
    players,
    config,
    state,
    rejection,
    handEnded,
    gameEnded,
    pending,
    errorMessage,
    join,
    drawDeck: () => sendMove({ type: "draw", source: "deck" }),
    drawDiscard: () => sendMove({ type: "draw", source: "discard" }),
    meldNew: (cards) => sendMove({ type: "meld_new", cards }),
    meldExtend: (meldId, cards) => sendMove({ type: "meld_extend", meldId, cards }),
    pinellaSubstitute: (meldId, cardInHand) => sendMove({ type: "pinella_substitute", meldId, cardInHand }),
    discard: (card) => sendMove({ type: "discard", card }),
    dismissRejection: () => setRejection(null),
  };
}
