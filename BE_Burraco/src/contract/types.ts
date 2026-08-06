/**
 * CONTRATTO — proprietà del BACKEND (decisione architetturale #4).
 *
 * Questi tipi definiscono l'interfaccia unica verso il frontend. Il FE NON
 * importa questo file: ne tiene una COPIA allineata a mano (nessun package
 * condiviso, nessuna dipendenza incrociata — decisione #8).
 *
 * Qui vivono solo i tipi "pubblici" del dominio e degli eventi WebSocket.
 * Lo stato interno completo del server (mazzo, pozzetti, mano avversaria) NON
 * è descritto qui e non viene MAI serializzato verso i client (anti-leak).
 */

export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

/** Rank di gioco. "JOKER" è il jolly; "2" è la pinella (matta), ma vale 20 a punti. */
export type Rank =
  | "A" | "2" | "3" | "4" | "5" | "6" | "7"
  | "8" | "9" | "10" | "J" | "Q" | "K" | "JOKER";

/** Un seat identifica un giocatore nel tavolo 1v1. */
export type Seat = 0 | 1;

/** Carta del contratto. `isWild` = true per jolly e per ogni 2 (pinella). */
export interface Card {
  id: string;
  suit: Suit | null; // null solo per il jolly
  rank: Rank;
  isWild: boolean;
}

export type MeldType = "sequence" | "group";

/** Gioco calato sul tavolo (visibile a tutti). */
export interface Meld {
  id: string;
  type: MeldType;
  cards: Card[]; // per la sequenza sono in ordine di run
  ownerSeat: Seat;
  isBurraco: boolean; // >= 7 carte
  clean: boolean; // burraco pulito (nessuna matta, salvo 2 al posto naturale)
}

/** Configurazione di partita (v1: valori bloccati dalla scheda di regole). */
export interface GameConfig {
  numeroGiocatori: 2;
  modalita: "individuale";
  punteggioObiettivo: number; // 2005
  varianteChiusura: "italiana" | "internazionale";
  presaPozzetto: "in_diretta_e_differita" | "solo_differita";
  limiteCalatePrimaDelPozzetto: number; // 2
  turnTimeoutMs: number; // definito, non enforced in v1
}

/** Fase del turno del giocatore di mano. */
export type Phase = "must_draw" | "may_meld";

/** Stato di connessione di un giocatore. */
export type ConnectionStatus = "connected" | "disconnected";

/** Sintesi di un giocatore nella room (senza dati sensibili). */
export interface PlayerPublic {
  seat: Seat;
  displayName: string;
  connectionStatus: ConnectionStatus;
}

/**
 * Stato di gioco REDATTO per uno specifico destinatario.
 * Contiene solo ciò che quel giocatore può legittimamente vedere.
 */
export interface GameStatePublic {
  /** La MIA mano (solo la propria). */
  yourHand: Card[];
  /** Tutti i giochi calati sul tavolo. */
  tableMelds: Meld[];
  /** Quante carte ha in mano l'avversario (solo il conteggio). */
  opponentHandCount: number;
  /** Carta in cima al monte scarti (o null se vuoto). */
  discardTop: Card | null;
  /** Quante carte compongono il monte scarti. */
  discardCount: number;
  /** Quante carte restano nel mazzo di pesca (solo conteggio, mai il contenuto). */
  drawPileCount: number;
  /** Quanti pozzetti restano da prendere. */
  pozzettiRemaining: number;
  /** Di chi è il turno. */
  whoseTurn: Seat;
  /** Fase corrente del turno. */
  phase: Phase;
  /** Ho già preso il mio pozzetto? */
  yourPozzettoTaken: boolean;
  /** Il mio seat (comodità per il client). */
  yourSeat: Seat;
  /** Punteggi cumulativi di partita [seat0, seat1]. */
  scores: [number, number];
  /** Stato macro della partita. */
  status: "playing" | "hand_ended" | "game_ended";
}

/** Dettaglio punteggio di una smazzata, per seat. */
export interface HandScoreDetail {
  seat: Seat;
  ptsMelds: number; // valore carte calate (positivo)
  ptsBonus: number; // burrachi + bonus chiusura
  ptsPenaltyHand: number; // carte rimaste in mano (negativo)
  ptsPozzetto: number; // -100 se pozzetto non preso, altrimenti 0
  totalDelta: number; // somma dei precedenti
}

/* ─────────────────────────── EVENTI WEBSOCKET ─────────────────────────── */

/** Messaggi CLIENT → SERVER (intenzioni; il server è l'unico a validare). */
export type ClientMessage =
  | { type: "join_room"; roomCode: string; playerToken?: string; displayName: string }
  | { type: "draw"; source: "deck" | "discard" }
  | { type: "meld_new"; cards: string[] } // CardId[]
  | { type: "meld_extend"; meldId: string; cards: string[] }
  | { type: "pinella_substitute"; meldId: string; cardInHand: string }
  | { type: "discard"; card: string }
  | { type: "heartbeat" };

/** Codici di rifiuto mossa (stabili, il FE può mapparli a messaggi UX). */
export type RejectCode =
  | "NOT_YOUR_TURN"
  | "WRONG_PHASE"
  | "CARD_NOT_IN_HAND"
  | "EMPTY_DISCARD"
  | "DECK_EMPTY"
  | "INVALID_MELD"
  | "MELD_NOT_FOUND"
  | "NOT_MELD_OWNER"
  | "MELD_LIMIT_REACHED"
  | "MUST_KEEP_CARD_TO_DISCARD"
  | "CANNOT_CLOSE_NO_BURRACO"
  | "ILLEGAL_LAST_DISCARD"
  | "NO_PINELLA_TO_SUBSTITUTE"
  | "GAME_NOT_ACTIVE"
  | "MALFORMED";

/** Messaggi SERVER → CLIENT. */
export type ServerMessage =
  | {
      type: "room_joined";
      yourSeat: Seat;
      yourToken: string; // token effimero per la riconnessione
      players: PlayerPublic[];
      config: GameConfig;
    }
  | { type: "state"; state: GameStatePublic }
  | { type: "move_rejected"; code: RejectCode; reason: string }
  | { type: "turn_changed"; seat: Seat; phase: Phase }
  | {
      type: "hand_ended";
      closerSeat: Seat | null;
      scores: HandScoreDetail[];
      cumulative: [number, number];
    }
  | { type: "game_ended"; winnerSeat: Seat | null; finalScores: [number, number] }
  | { type: "opponent_disconnected"; seat: Seat }
  | { type: "opponent_reconnected"; seat: Seat }
  | { type: "error"; message: string };
