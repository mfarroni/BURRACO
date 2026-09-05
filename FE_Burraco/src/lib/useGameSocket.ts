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
import type { CelebrationInfo } from "@/components/StateBanners";
import { getClientId, saveToken, storedToken } from "./sessionIdentity";
import { getAuthToken } from "./auth";

/**
 * Hook che possiede la connessione WebSocket e lo STATO CLIENT (architettura FE
 * di competenza del develop). Il client è muto sulle regole: invia intenzioni e
 * riflette lo stato REDATTO ricevuto dal server, che è l'unica autorità.
 *
 * Copre l'esigenza UX chiave: tra l'invio di una mossa e la risposta del server
 * c'è latenza -> stato `pending` ("attendo conferma"). Il pending è disponibile
 * sia globale (`pending`) sia PER-CARTA (`inFlightCardId`/`pendingCardIds`),
 * correlato all'ack `move_applied` tramite un `clientMoveId` opaco.
 */

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
/** true in build/runtime di produzione (Vercel). */
const IS_PROD = process.env.NODE_ENV === "production";
const RECONNECT_DELAY_MS = 1500;
const HEARTBEAT_MS = 25_000;
/** Durata di vita dello stato effimero di celebrazione (poi si auto-svuota). */
const CELEBRATION_TTL_MS = 1600;

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
  /** "forfeit" se la partita è finita per abbandono dell'avversario. */
  reason?: "forfeit";
}
/**
 * Chiusura TERMINALE del tavolo SENZA vincitore (distinta da game_ended):
 * "interrupted" = tavolo smontato con reset; "abandoned" = avversario non
 * rientrato entro la grazia.
 */
export interface RoomClosedInfo {
  reason: "interrupted" | "abandoned";
}

/**
 * ANNULLAMENTO UNILATERALE della partita: `byName` è chi ha annullato. Alla
 * ricezione il client torna alla lobby azzerando lo stato locale del tavolo e mostra
 * un avviso NON bloccante (distinto dagli overlay terminali di `roomClosed`).
 */
export interface AbortedInfo {
  byName: string;
}

/**
 * Rifiuto di join per motivi di AUTENTICazione (SEC-08): "AUTH_REQUIRED" =
 * manca l'authToken; "AUTH_INVALID" = token scaduto/revocato. Il client interrompe
 * i tentativi di riconnessione e riporta alla schermata d'ingresso/login.
 */
export interface JoinRejectedInfo {
  code: "AUTH_REQUIRED" | "AUTH_INVALID";
  reason: string;
}

export interface GameSocketApi {
  connPhase: ConnPhase;
  joined: boolean;
  /** true SOLO dopo un rejoin che ha ripristinato una sessione esistente. */
  resumed: boolean;
  yourSeat: Seat | null;
  players: PlayerPublic[];
  config: GameConfig | null;
  state: GameStatePublic | null;
  rejection: RejectionInfo | null;
  handEnded: HandEndedInfo | null;
  gameEnded: GameEndedInfo | null;
  /** tavolo chiuso senza vincitore (reset/abbandono); terminale. */
  roomClosed: RoomClosedInfo | null;
  /** partita annullata (unilaterale): avviso non bloccante mostrato in lobby. */
  abortedNotice: AbortedInfo | null;
  /** join rifiutato per autenticazione (SEC-08); riporta alla schermata d'ingresso. */
  joinRejected: JoinRejectedInfo | null;
  /** true tra l'invio di una mossa e la risposta del server (globale). */
  pending: boolean;
  /** cardIds coinvolti nella mossa in volo (per il pending PER-CARTA). */
  pendingCardIds: string[];
  /** la singola carta "in volo" quando la mossa ne coinvolge esattamente una. */
  inFlightCardId: string | null;
  /** celebrazione effimera (pozzetto/burraco), si auto-svuota. */
  celebration: CelebrationInfo | null;
  errorMessage: string | null;

  join: (roomCode: string, displayName: string) => void;
  /** Reset del rifiuto di join (per riprovare dopo un nuovo login). */
  dismissJoinRejected: () => void;
  /** Smonta il tavolo (invia reset_room): valido in attesa o con avversario offline. */
  resetRoom: () => void;
  /** Annulla la partita in corso (invia game_abort): il server chiude per entrambi. */
  abort: () => void;
  /** Scarta l'avviso di annullamento (dopo il rientro in lobby). */
  dismissAbortNotice: () => void;
  drawDeck: () => void;
  drawDiscard: () => void;
  meldNew: (cards: string[]) => void;
  meldExtend: (meldId: string, cards: string[]) => void;
  pinellaSubstitute: (meldId: string, cardInHand: string) => void;
  discard: (card: string) => void;
  /** Annulla l'ultima calata del turno (intenzione `undo_last`); il server decide. */
  undoLast: () => void;
  dismissRejection: () => void;
}

interface InFlight {
  clientMoveId: string;
  cardIds: string[];
}

/**
 * L'identità di sessione (clientId per-browser stabile in-memory + token di
 * room per-scheda con fallback in-memory) vive nel modulo FRAMEWORK-FREE
 * `sessionIdentity`. È RESILIENTE agli errori di storage tipici di Safari
 * mobile in Navigazione privata / con ITP: il clientId non viene mai
 * rigenerato per un errore di storage, così la riconnessione dopo la sospensione
 * della scheda in background presenta un'identità stabile e il server la
 * riconosce (reclaim del posto) invece di aprire slot fantasma.
 */

/** correlation id opaco per correlare mossa ↔ ack `move_applied`. */
function genMoveId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useGameSocket(): GameSocketApi {
  const [connPhase, setConnPhase] = useState<ConnPhase>("idle");
  const [joined, setJoined] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [yourSeat, setYourSeat] = useState<Seat | null>(null);
  const [players, setPlayers] = useState<PlayerPublic[]>([]);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [state, setState] = useState<GameStatePublic | null>(null);
  const [rejection, setRejection] = useState<RejectionInfo | null>(null);
  const [handEnded, setHandEnded] = useState<HandEndedInfo | null>(null);
  const [gameEnded, setGameEnded] = useState<GameEndedInfo | null>(null);
  const [roomClosed, setRoomClosed] = useState<RoomClosedInfo | null>(null);
  const [abortedNotice, setAbortedNotice] = useState<AbortedInfo | null>(null);
  const [joinRejected, setJoinRejected] = useState<JoinRejectedInfo | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingCardIds, setPendingCardIds] = useState<string[]>([]);
  const [inFlightCardId, setInFlightCardId] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<CelebrationInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<string | null>(null);
  const nameRef = useRef<string>("");
  const wantConnectedRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** seat corrente per correlare gli eventi celebrativi (byYou). */
  const yourSeatRef = useRef<Seat | null>(null);
  /** mossa attualmente in volo (correlata via clientMoveId). */
  const inFlightRef = useRef<InFlight | null>(null);
  /** contatore per la chiave univoca delle celebrazioni. */
  const celebIdRef = useRef(0);

  const sendRaw = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  /** Azzera lo stato "in volo" (globale + per-carta). */
  const clearInFlight = useCallback(() => {
    inFlightRef.current = null;
    setPending(false);
    setPendingCardIds([]);
    setInFlightCardId(null);
  }, []);

  /**
   * Invia un'intenzione di mossa, genera il correlation id e attiva lo stato
   * "attendo conferma", marcando le carte coinvolte come pending (per-carta).
   */
  const sendMove = useCallback(
    (msg: ClientMessage, cardIds: string[] = []) => {
      setRejection(null);
      const clientMoveId = genMoveId();
      const ok = sendRaw({ ...msg, clientMoveId } as ClientMessage);
      if (ok) {
        inFlightRef.current = { clientMoveId, cardIds };
        setPending(true);
        setPendingCardIds(cardIds);
        setInFlightCardId(cardIds.length === 1 ? cardIds[0]! : null);
      }
    },
    [sendRaw],
  );

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case "room_joined": {
          setJoined(true);
          setResumed(msg.resumed);
          setYourSeat(msg.yourSeat);
          yourSeatRef.current = msg.yourSeat;
          setPlayers(msg.players);
          setConfig(msg.config);
          // Token per-scheda (sessionStorage) + fallback in-memory: la scrittura
          // è best-effort e non lancia mai (gestita dentro saveToken).
          if (roomRef.current) saveToken(roomRef.current, msg.yourToken);
          break;
        }
        case "state": {
          setState(msg.state);
          // Lo stato broadcast conferma l'atterraggio della mossa: chiude ogni
          // pending (globale e per-carta) come rete di sicurezza.
          clearInFlight();
          if (msg.state.status === "playing") setHandEnded(null);
          break;
        }
        case "move_applied": {
          // ACK per-attore: risolve il pending SOLO se correla con la mossa in volo.
          if (inFlightRef.current && inFlightRef.current.clientMoveId === msg.clientMoveId) {
            clearInFlight();
          }
          break;
        }
        case "move_rejected": {
          setRejection({ code: msg.code, reason: msg.reason, at: Date.now() });
          clearInFlight();
          break;
        }
        case "pozzetto_taken": {
          setCelebration({
            kind: "pozzetto",
            byYou: msg.seat === yourSeatRef.current,
            id: ++celebIdRef.current,
          });
          break;
        }
        case "burraco_made": {
          setCelebration({
            kind: msg.clean ? "burraco-clean" : "burraco-dirty",
            byYou: msg.seat === yourSeatRef.current,
            id: ++celebIdRef.current,
          });
          break;
        }
        case "turn_changed":
          // Lo stato redatto arriva subito dopo: nessuna azione necessaria qui.
          break;
        case "hand_ended":
          setHandEnded({ closerSeat: msg.closerSeat, scores: msg.scores, cumulative: msg.cumulative });
          clearInFlight();
          break;
        case "game_ended":
          setGameEnded({ winnerSeat: msg.winnerSeat, finalScores: msg.finalScores, reason: msg.reason });
          clearInFlight();
          break;
        case "room_closed":
          // Esito TERMINALE senza vincitore: non si tenta più di riconnettere.
          setRoomClosed({ reason: msg.reason });
          wantConnectedRef.current = false;
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          clearInFlight();
          break;
        case "game_aborted":
          // ANNULLAMENTO unilaterale: torna alla lobby AZZERANDO tutto lo stato locale
          // del tavolo (§5.4), senza tentare riconnessioni. L'avviso non bloccante
          // resta visibile in lobby finché non viene scartato.
          setAbortedNotice({ byName: msg.byName });
          wantConnectedRef.current = false;
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          wsRef.current?.close();
          setJoined(false);
          setResumed(false);
          setYourSeat(null);
          yourSeatRef.current = null;
          setPlayers([]);
          setConfig(null);
          setState(null);
          setHandEnded(null);
          setGameEnded(null);
          setRoomClosed(null);
          setRejection(null);
          clearInFlight();
          break;
        case "join_rejected":
          // SEC-08: il server ha negato l'ingresso per autenticazione. Interrompe
          // la riconnessione automatica e segnala all'UI di riportare al login.
          setJoinRejected({ code: msg.code, reason: msg.reason });
          wantConnectedRef.current = false;
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          wsRef.current?.close();
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
    },
    [clearInFlight],
  );

  const connect = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    // SEC-09: in produzione è ammesso SOLO wss:// (niente fallback ws:// fuori da
    // localhost). Se la configurazione è insicura, non si tenta la connessione.
    if (IS_PROD && !WS_URL.startsWith("wss://")) {
      wantConnectedRef.current = false;
      setErrorMessage(
        "Configurazione non sicura: NEXT_PUBLIC_WS_URL deve usare wss:// in produzione.",
      );
      setConnPhase("closed");
      return;
    }

    setConnPhase((prev) => (prev === "closed" || prev === "reconnecting" ? "reconnecting" : "connecting"));

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnPhase("connected");
      setErrorMessage(null);
      sendRaw({
        type: "join_room",
        roomCode: room,
        // Il server usa il display_name AUTORITATIVO dell'account: questo è solo
        // un fallback per la modalità dev senza auth (server lo ignora se auth ON).
        displayName: nameRef.current,
        playerToken: storedToken(room),
        clientId: getClientId(),
        // authToken dell'account/ospite: identità + gating SEC-08 lato server.
        authToken: getAuthToken() ?? undefined,
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
  }, [handleMessage, sendRaw]);

  const join = useCallback(
    (roomCode: string, displayName: string) => {
      const room = roomCode.trim().toUpperCase();
      if (!room) return;
      // Nuovo ingresso: scarta un eventuale avviso di annullamento precedente.
      setAbortedNotice(null);
      roomRef.current = room;
      nameRef.current = displayName.trim() || "Giocatore";
      wantConnectedRef.current = true;
      connect();
    },
    [connect],
  );

  // La celebrazione è effimera: si auto-svuota dopo un breve intervallo.
  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(null), CELEBRATION_TTL_MS);
    return () => clearTimeout(t);
  }, [celebration]);

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
    resumed,
    yourSeat,
    players,
    config,
    state,
    rejection,
    handEnded,
    gameEnded,
    roomClosed,
    abortedNotice,
    joinRejected,
    pending,
    pendingCardIds,
    inFlightCardId,
    celebration,
    errorMessage,
    join,
    dismissJoinRejected: () => setJoinRejected(null),
    resetRoom: () => sendRaw({ type: "reset_room" }),
    // Il server valida che il mittente sia SEDUTO al tavolo e chiude per entrambi.
    abort: () => sendRaw({ type: "game_abort" }),
    dismissAbortNotice: () => setAbortedNotice(null),
    drawDeck: () => sendMove({ type: "draw", source: "deck" }),
    drawDiscard: () => sendMove({ type: "draw", source: "discard" }),
    meldNew: (cards) => sendMove({ type: "meld_new", cards }, cards),
    meldExtend: (meldId, cards) => sendMove({ type: "meld_extend", meldId, cards }, cards),
    pinellaSubstitute: (meldId, cardInHand) =>
      sendMove({ type: "pinella_substitute", meldId, cardInHand }, [cardInHand]),
    discard: (card) => sendMove({ type: "discard", card }, [card]),
    // Client muto: invia solo l'intenzione. Il server valida turno/fase/stack e,
    // se non c'è nulla da annullare, risponde NOTHING_TO_UNDO (→ RejectionToast).
    undoLast: () => sendMove({ type: "undo_last" }),
    dismissRejection: () => setRejection(null),
  };
}
