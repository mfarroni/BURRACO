/**
 * COPIA ALLINEATA A MANO del contratto del backend (decisione #4 e #8).
 *
 * ⚠️ Questo file NON è importato dal backend e NON importa nulla dal backend.
 * È una COPIA mantenuta manualmente, sincronizzata con
 *   BE_Burraco/src/contract/types.ts
 * Se il backend cambia il contratto, questo file va aggiornato a mano.
 * Nessun package condiviso, nessun submodule: FE e BE restano separabili.
 *
 * Il client è "muto sulle regole": qui NON esiste alcun motore di gioco, solo
 * i tipi dei dati che il server invia/riceve.
 */

export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export type Rank =
  | "A" | "2" | "3" | "4" | "5" | "6" | "7"
  | "8" | "9" | "10" | "J" | "Q" | "K" | "JOKER";

export type Seat = 0 | 1;

/**
 * IDENTITÀ "matta" della carta (non il ruolo che assume in un gioco):
 * "joker" = jolly, "pinella" = un 2, null = carta naturale.
 * Il RUOLO effettivo di matta in un meld è descritto da `Meld.wildIndices`.
 */
export type WildKind = "joker" | "pinella" | null;

export interface Card {
  id: string;
  suit: Suit | null;
  rank: Rank;
  isWild: boolean; // equivale a wildKind !== null
  wildKind: WildKind;
}

export type MeldType = "sequence" | "group";

export interface Meld {
  id: string;
  type: MeldType;
  cards: Card[];
  ownerSeat: Seat;
  isBurraco: boolean;
  clean: boolean;
  /**
   * Indici in `cards[]` delle carte che fungono DAVVERO da matta in questo
   * gioco. Un 2 al posto naturale NON è matta e non compare. Server-authoritative.
   */
  wildIndices?: number[];
}

export interface GameConfig {
  numeroGiocatori: 2;
  modalita: "individuale";
  punteggioObiettivo: number;
  varianteChiusura: "italiana" | "internazionale";
  presaPozzetto: "in_diretta_e_differita" | "solo_differita";
  limiteCalatePrimaDelPozzetto: number;
  turnTimeoutMs: number;
}

export type Phase = "must_draw" | "may_meld";
export type ConnectionStatus = "connected" | "disconnected";

export interface PlayerPublic {
  seat: Seat;
  displayName: string;
  connectionStatus: ConnectionStatus;
}

export interface GameStatePublic {
  yourHand: Card[];
  tableMelds: Meld[];
  opponentHandCount: number;
  discardTop: Card | null;
  discardCount: number;
  drawPileCount: number;
  pozzettiRemaining: number;
  whoseTurn: Seat;
  /**
   * Deadline assoluta del turno (epoch millis) per il countdown VISIVO. Popolata
   * durante un turno attivo (il server enforce il timeout); `null` solo senza
   * turno attivo (mano/partita conclusa) o con timeout disattivato via config.
   */
  turnEndsAt: number | null;
  phase: Phase;
  yourPozzettoTaken: boolean;
  yourSeat: Seat;
  scores: [number, number];
  status: "playing" | "hand_ended" | "game_ended";
}

export interface HandScoreDetail {
  seat: Seat;
  ptsMelds: number;
  ptsBonus: number;
  ptsPenaltyHand: number;
  ptsPozzetto: number;
  totalDelta: number;
}

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

/**
 * CLIENT → SERVER (intenzioni). `clientMoveId` è un correlation id opzionale
 * SOLO sui messaggi di azione (per il pending per-carta); mai su join/heartbeat.
 */
export type ClientMessage =
  // `clientId`: identità di sessione STABILE per-browser (non per-room), per il
  // RECLAIM del posto quando il token di room è perso. Opaca lato server.
  | { type: "join_room"; roomCode: string; playerToken?: string; displayName: string; clientId?: string }
  | { type: "draw"; source: "deck" | "discard"; clientMoveId?: string }
  | { type: "meld_new"; cards: string[]; clientMoveId?: string }
  | { type: "meld_extend"; meldId: string; cards: string[]; clientMoveId?: string }
  | { type: "pinella_substitute"; meldId: string; cardInHand: string; clientMoveId?: string }
  | { type: "discard"; card: string; clientMoveId?: string }
  // Smontaggio esplicito del tavolo (in attesa o con avversario disconnesso).
  | { type: "reset_room" }
  | { type: "heartbeat" };

/** SERVER → CLIENT. */
export type ServerMessage =
  | { type: "room_joined"; yourSeat: Seat; yourToken: string; players: PlayerPublic[]; config: GameConfig; resumed: boolean }
  | { type: "state"; state: GameStatePublic }
  | { type: "move_applied"; clientMoveId: string }
  | { type: "move_rejected"; code: RejectCode; reason: string; clientMoveId?: string }
  | { type: "pozzetto_taken"; seat: Seat }
  | { type: "burraco_made"; seat: Seat; meldId: string; clean: boolean }
  | { type: "turn_changed"; seat: Seat; phase: Phase }
  | { type: "hand_ended"; closerSeat: Seat | null; scores: HandScoreDetail[]; cumulative: [number, number] }
  // `reason?: "forfeit"` = l'avversario ha abbandonato (disconnessione oltre la
  // grazia); assente = fine normale per obiettivo raggiunto.
  | { type: "game_ended"; winnerSeat: Seat | null; finalScores: [number, number]; reason?: "forfeit" }
  // Chiusura TERMINALE del tavolo SENZA vincitore, distinta da `game_ended`.
  // "interrupted" = reset esplicito; "abandoned" = avversario non rientrato.
  | { type: "room_closed"; reason: "interrupted" | "abandoned" }
  | { type: "opponent_disconnected"; seat: Seat }
  | { type: "opponent_reconnected"; seat: Seat }
  | { type: "error"; message: string };
