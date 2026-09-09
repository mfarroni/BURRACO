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

/**
 * LOBBY (§5.4-C) — tentativo di sedersi a un tavolo appena riempito: il FE mostra
 * "Qualcuno si è appena seduto a quel tavolo" e fa un refresh della lista.
 */
export interface SitRejectedInfo {
  reason: string;
}

/** LOBBY (door a) — open_table su codice già in uso (la modale resta aperta). */
export interface OpenRejectedInfo {
  code: "CODE_IN_USE";
}

/** LOBBY (§5.4-A) — fusione: spostato in un altro tavolo, con spiegazione. */
export interface MergedInfo {
  newCode: string;
}

/**
 * Intento del PRIMO frame da inviare all'apertura del socket. Alla riconnessione
 * si usa sempre join_room col codice noto (reclaim del posto).
 */
type FirstFrame =
  | { kind: "join_room"; code: string }
  | { kind: "open_table"; code: string; private: boolean }
  | { kind: "quick_match" };

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

  /**
   * LOBBY: codice AUTORITATIVO del tavolo corrente. Appreso da `room_joined.code`
   * (indispensabile per quick_match, dove il codice è generato dal server) e
   * aggiornato dalla fusione (`room_merged.newCode`). `null` finché non si è a un tavolo.
   */
  roomCode: string | null;
  /**
   * LOBBY: true se il tavolo in ATTESA è stato aperto come PRIVATO (o creato via
   * "Entra con codice"). Alimenta la nota UX "non compare in lista, comunica il codice".
   * È un dato d'intenzione locale (il server non serializza mai la visibilità).
   */
  waitingIsPrivate: boolean;
  /** LOBBY (§5.4-A): fusione quick_match — spostato in un altro tavolo (con spiegazione). */
  merged: MergedInfo | null;
  /** LOBBY (§5.4-D): self-play — avviso NON bloccante "giochi contro te stesso". */
  selfPlay: boolean;
  /** LOBBY (door a): open_table su codice già in uso (la modale resta aperta). */
  openRejected: OpenRejectedInfo | null;
  /** LOBBY (§5.4-C): seduta a un tavolo appena riempito (ROOM_JUST_TAKEN) → refresh lista. */
  sitRejected: SitRejectedInfo | null;

  join: (roomCode: string, displayName: string) => void;
  /** LOBBY door (b) — "Gioca subito": il server decide seduta/creazione/fusione. */
  quickMatch: (displayName?: string) => void;
  /** LOBBY door (a) — "Apri un tavolo" (origin apertura_manuale; private = non in lista). */
  openTable: (code: string, isPrivate: boolean, displayName?: string) => void;
  /** LOBBY — "Siediti" a un tavolo pubblico esistente della lista (= join_room). */
  sit: (code: string, displayName?: string) => void;
  /** LOBBY — "Annulla e torna alla lobby": invia reset_room e torna alla lista. */
  leaveToLobby: () => void;
  /**
   * LOBBY — chiude la connessione SENZA reset_room (nessun tavolo occupato):
   * usato per annullare l'apertura non andata a buon fine (es. CODE_IN_USE) o la
   * chiusura della modale prima della conferma.
   */
  abortConnection: () => void;
  dismissMerged: () => void;
  dismissSelfPlay: () => void;
  dismissOpenRejected: () => void;
  dismissSitRejected: () => void;
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
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [waitingIsPrivate, setWaitingIsPrivate] = useState(false);
  const [merged, setMerged] = useState<MergedInfo | null>(null);
  const [selfPlay, setSelfPlay] = useState(false);
  const [openRejected, setOpenRejected] = useState<OpenRejectedInfo | null>(null);
  const [sitRejected, setSitRejected] = useState<SitRejectedInfo | null>(null);

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
  /**
   * LOBBY: intento del PRIMO frame all'apertura del socket. Dopo il primo
   * `room_joined` diventa sempre `join_room{code}` così ogni riconnessione reclama
   * il posto sul codice appreso (funziona anche per quick_match e dopo la fusione).
   */
  const firstFrameRef = useRef<FirstFrame | null>(null);
  /**
   * LOBBY: intenzione di visibilità del tavolo (privato) catturata al momento
   * dell'azione. NON viene mai riscritta dalla riconnessione (che usa join_room),
   * così la nota "tavolo privato" resta coerente lungo tutta l'attesa.
   */
  const isPrivateRef = useRef(false);
  /**
   * LOBBY: true quando stiamo smontando volontariamente il socket (ritorno alla
   * lobby / annullamento): un eventuale `room_closed` in arrivo va ignorato per non
   * mostrare l'overlay terminale al posto della lista.
   */
  const intentionalLeaveRef = useRef(false);

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
          // LOBBY: il server è la sola autorità sul codice. Lo apprendiamo qui
          // (necessario per quick_match, dove il codice è generato dal server) e
          // lo usiamo d'ora in poi per ogni riconnessione (reclaim del posto).
          roomRef.current = msg.code;
          setRoomCode(msg.code);
          firstFrameRef.current = { kind: "join_room", code: msg.code };
          // Token per-scheda (sessionStorage) + fallback in-memory: la scrittura
          // è best-effort e non lancia mai (gestita dentro saveToken).
          saveToken(msg.code, msg.yourToken);
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
          // Se stiamo già tornando in lobby di nostra volontà (reset_room), non
          // mostriamo l'overlay terminale: la lista è la destinazione corretta.
          if (intentionalLeaveRef.current) break;
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
          intentionalLeaveRef.current = true;
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
          firstFrameRef.current = null;
          roomRef.current = null;
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
          // LOBBY: torna a una lista pulita (nessun codice/attesa/esito transitorio).
          setRoomCode(null);
          setWaitingIsPrivate(false);
          setMerged(null);
          setSelfPlay(false);
          setOpenRejected(null);
          setSitRejected(null);
          clearInFlight();
          break;
        case "join_rejected":
          if (msg.code === "ROOM_JUST_TAKEN") {
            // LOBBY (§5.4-C): il tavolo si è riempito nel frattempo. Nessun posto
            // occupato: smontiamo il socket e torniamo alla lobby, dove la lista
            // va rinfrescata (lo fa page.tsx osservando `sitRejected`).
            setSitRejected({ reason: msg.reason });
            wantConnectedRef.current = false;
            intentionalLeaveRef.current = true;
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
            firstFrameRef.current = null;
            roomRef.current = null;
            setRoomCode(null);
            wsRef.current?.close();
            break;
          }
          // SEC-08: il server ha negato l'ingresso per autenticazione. Interrompe
          // la riconnessione automatica e segnala all'UI di riportare al login.
          setJoinRejected({ code: msg.code, reason: msg.reason });
          wantConnectedRef.current = false;
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          wsRef.current?.close();
          break;
        case "room_merged":
          // LOBBY (§5.4-A): siamo stati spostati in un tavolo pubblico quick_match
          // già in attesa (più vecchio). Aggiorniamo il codice mostrato e la
          // strategia di riconnessione; il room_joined/state del tavolo unito segue.
          setMerged({ newCode: msg.newCode });
          roomRef.current = msg.newCode;
          setRoomCode(msg.newCode);
          firstFrameRef.current = { kind: "join_room", code: msg.newCode };
          break;
        case "open_rejected":
          // LOBBY (door a): codice già in uso. Il socket resta aperto: la modale
          // resta aperta e invita a cambiare codice (nessun takeover).
          setOpenRejected({ code: msg.code });
          break;
        case "self_play_notice":
          // LOBBY (§5.4-D): avviso NON bloccante (i due posti sono lo stesso browser/utente).
          setSelfPlay(true);
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

  /**
   * Invia il PRIMO frame all'apertura del socket, scegliendo l'intenzione in base
   * alla porta d'ingresso (§5.3). Le tre porte condividono i campi di identità;
   * l'identità AUTORITATIVA la deriva il server dal token (il displayName è solo
   * un fallback dev, ignorato con auth attiva).
   */
  const sendFirstFrame = useCallback(
    (frame: FirstFrame) => {
      const clientId = getClientId();
      const authToken = getAuthToken() ?? undefined;
      const displayName = nameRef.current;
      if (frame.kind === "quick_match") {
        sendRaw({ type: "quick_match", displayName, clientId, authToken });
      } else if (frame.kind === "open_table") {
        sendRaw({ type: "open_table", code: frame.code, private: frame.private, displayName, clientId, authToken });
      } else {
        sendRaw({
          type: "join_room",
          roomCode: frame.code,
          displayName,
          playerToken: storedToken(frame.code),
          clientId,
          authToken,
        });
      }
    },
    [sendRaw],
  );

  const connect = useCallback(() => {
    // Serve un intento del primo frame (impostato da join/sit/openTable/quickMatch).
    if (!firstFrameRef.current) return;

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
      // La riconnessione usa sempre join_room col codice appreso (firstFrameRef
      // aggiornato in room_joined): reclama il posto invece di ri-aprire un tavolo.
      if (firstFrameRef.current) sendFirstFrame(firstFrameRef.current);
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
      // Ignora la chiusura di un socket ORMAI SOSTITUITO o già smontato (dopo un
      // teardown `wsRef.current` è null): non deve alterare lo stato corrente.
      if (wsRef.current !== ws) return;
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
  }, [handleMessage, sendRaw, sendFirstFrame]);

  /**
   * Avvia (o reindirizza) la connessione con un primo frame. Se il socket è GIÀ
   * aperto (es. nuovo tentativo dopo CODE_IN_USE), invia il frame sul socket vivo;
   * altrimenti apre la connessione e lo invia in `onopen`. Azzera gli esiti lobby
   * transitori del tentativo precedente.
   */
  const startConnection = useCallback(
    (frame: FirstFrame, opts: { isPrivate: boolean; code: string | null; name?: string }) => {
      setSitRejected(null);
      setOpenRejected(null);
      setMerged(null);
      setJoinRejected(null);
      setRoomClosed(null);
      // Nuovo ingresso: scarta un eventuale avviso di annullamento precedente.
      setAbortedNotice(null);
      setErrorMessage(null);
      if (opts.name !== undefined) nameRef.current = opts.name.trim() || "Giocatore";
      isPrivateRef.current = opts.isPrivate;
      setWaitingIsPrivate(opts.isPrivate);
      firstFrameRef.current = frame;
      roomRef.current = opts.code;
      setRoomCode(opts.code);
      wantConnectedRef.current = true;
      intentionalLeaveRef.current = false;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendFirstFrame(frame);
      } else {
        connect();
      }
    },
    [connect, sendFirstFrame],
  );

  // Door (c) / "Entra con codice": se l'ingresso sfocia in attesa, il codice
  // sconosciuto crea un tavolo PRIVATO (semantica join_room), quindi marchiamo
  // l'attesa come privata per la nota UX.
  const join = useCallback(
    (roomCode2: string, displayName: string) => {
      const code = roomCode2.trim().toUpperCase().slice(0, 12);
      if (!code) return;
      startConnection({ kind: "join_room", code }, { isPrivate: true, code, name: displayName });
    },
    [startConnection],
  );

  // "Siediti" dalla lista: join_room su un tavolo PUBBLICO esistente (→ playing).
  const sit = useCallback(
    (code: string, displayName?: string) => {
      const c = code.trim().toUpperCase().slice(0, 12);
      if (!c) return;
      startConnection({ kind: "join_room", code: c }, { isPrivate: false, code: c, name: displayName });
    },
    [startConnection],
  );

  const quickMatch = useCallback(
    (displayName?: string) => {
      // Il codice è generato dal server: `code:null` finché non arriva room_joined.
      startConnection({ kind: "quick_match" }, { isPrivate: false, code: null, name: displayName });
    },
    [startConnection],
  );

  const openTable = useCallback(
    (code: string, isPrivate: boolean, displayName?: string) => {
      const c = code.trim().toUpperCase().slice(0, 12);
      startConnection(
        { kind: "open_table", code: c, private: isPrivate },
        { isPrivate, code: c || null, name: displayName },
      );
    },
    [startConnection],
  );

  /** Smonta il socket resettando lo stato client alla LOBBY pulita. */
  const teardown = useCallback((sendReset: boolean) => {
    intentionalLeaveRef.current = true;
    wantConnectedRef.current = false;
    if (sendReset) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "reset_room" }));
    }
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    try {
      wsRef.current?.close();
    } catch {
      /* socket già in chiusura */
    }
    wsRef.current = null;
    firstFrameRef.current = null;
    roomRef.current = null;
    inFlightRef.current = null;
    setJoined(false);
    setResumed(false);
    setState(null);
    setPlayers([]);
    setConfig(null);
    setYourSeat(null);
    yourSeatRef.current = null;
    setRoomClosed(null);
    setJoinRejected(null);
    setMerged(null);
    setSelfPlay(false);
    setOpenRejected(null);
    setSitRejected(null);
    setRoomCode(null);
    setWaitingIsPrivate(false);
    setPending(false);
    setPendingCardIds([]);
    setInFlightCardId(null);
    setRejection(null);
    setHandEnded(null);
    setGameEnded(null);
    setErrorMessage(null);
    setConnPhase("idle");
  }, []);

  // "Annulla e torna alla lobby": invia reset_room (dispose del tavolo in attesa) e
  // torna alla lista pulita, senza passare dall'overlay terminale room_closed.
  const leaveToLobby = useCallback(() => teardown(true), [teardown]);
  // Annulla un'apertura non riuscita / chiusura modale: nessun tavolo occupato,
  // quindi nessun reset_room da inviare.
  const abortConnection = useCallback(() => teardown(false), [teardown]);

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
    roomCode,
    waitingIsPrivate,
    merged,
    selfPlay,
    openRejected,
    sitRejected,
    join,
    quickMatch,
    openTable,
    sit,
    leaveToLobby,
    abortConnection,
    dismissMerged: () => setMerged(null),
    dismissSelfPlay: () => setSelfPlay(false),
    dismissOpenRejected: () => setOpenRejected(null),
    dismissSitRejected: () => setSitRejected(null),
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
