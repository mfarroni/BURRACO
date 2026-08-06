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

export interface Card {
  id: string;
  suit: Suit | null;
  rank: Rank;
  isWild: boolean;
}

export type MeldType = "sequence" | "group";

export interface Meld {
  id: string;
  type: MeldType;
  cards: Card[];
  ownerSeat: Seat;
  isBurraco: boolean;
  clean: boolean;
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

/** CLIENT → SERVER (intenzioni). */
export type ClientMessage =
  | { type: "join_room"; roomCode: string; playerToken?: string; displayName: string }
  | { type: "draw"; source: "deck" | "discard" }
  | { type: "meld_new"; cards: string[] }
  | { type: "meld_extend"; meldId: string; cards: string[] }
  | { type: "pinella_substitute"; meldId: string; cardInHand: string }
  | { type: "discard"; card: string }
  | { type: "heartbeat" };

/** SERVER → CLIENT. */
export type ServerMessage =
  | { type: "room_joined"; yourSeat: Seat; yourToken: string; players: PlayerPublic[]; config: GameConfig }
  | { type: "state"; state: GameStatePublic }
  | { type: "move_rejected"; code: RejectCode; reason: string }
  | { type: "turn_changed"; seat: Seat; phase: Phase }
  | { type: "hand_ended"; closerSeat: Seat | null; scores: HandScoreDetail[]; cumulative: [number, number] }
  | { type: "game_ended"; winnerSeat: Seat | null; finalScores: [number, number] }
  | { type: "opponent_disconnected"; seat: Seat }
  | { type: "opponent_reconnected"; seat: Seat }
  | { type: "error"; message: string };
