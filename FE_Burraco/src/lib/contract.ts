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
  // Copia ALLINEATA A MANO al contratto BE (nessun package condiviso). House-rule
  // opzionale: `null` = nessun limite (default); un numero > 0 attiva il cap.
  limiteCalatePrimaDelPozzetto: number | null;
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
  /**
   * Presentazionale: true solo quando sono di mano, in fase may_meld, con almeno
   * una calata annullabile impilata nel turno. Abilita il pulsante "Annulla
   * ultima mossa". Non divulga stato nascosto (solo disponibilità dell'azione).
   */
  canUndo: boolean;
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
  | "NOTHING_TO_UNDO"
  | "GAME_NOT_ACTIVE"
  | "MALFORMED";

/**
 * CLIENT → SERVER (intenzioni). `clientMoveId` è un correlation id opzionale
 * SOLO sui messaggi di azione (per il pending per-carta); mai su join/heartbeat.
 */
export type ClientMessage =
  // `clientId`: identità di sessione STABILE per-browser (non per-room), per il
  // RECLAIM del posto quando il token di room è perso. Opaca lato server.
  //
  // `authToken`: token di sessione opaco rilasciato dagli endpoint HTTP /auth/*.
  // Il server lo valida e ne ricava il PRINCIPALE: usa il suo display_name
  // AUTORITATIVO e IGNORA il `displayName` del client (anti-spoof). Con auth
  // attiva, un join SENZA authToken valido è rifiutato (join_rejected, SEC-08).
  // `playerToken`/`clientId` restano per la riconnessione del POSTO, non sostituiti.
  | {
      type: "join_room";
      roomCode: string;
      playerToken?: string;
      displayName: string;
      clientId?: string;
      authToken?: string;
    }
  | { type: "draw"; source: "deck" | "discard"; clientMoveId?: string }
  | { type: "meld_new"; cards: string[]; clientMoveId?: string }
  | { type: "meld_extend"; meldId: string; cards: string[]; clientMoveId?: string }
  | { type: "pinella_substitute"; meldId: string; cardInHand: string; clientMoveId?: string }
  | { type: "discard"; card: string; clientMoveId?: string }
  // ANNULLA l'ultima calata annullabile del proprio turno (solo correlation id).
  | { type: "undo_last"; clientMoveId?: string }
  // Smontaggio esplicito del tavolo (in attesa o con avversario disconnesso).
  | { type: "reset_room" }
  // ANNULLAMENTO UNILATERALE della partita in corso (nessun payload; room e seat
  // dedotti dal socket lato server). Chiude la partita per entrambi, libera il tavolo.
  | { type: "game_abort" }
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
  // ANNULLAMENTO UNILATERALE della partita (terminale, senza vincitore, distinto da
  // room_closed). `byName` è chi ha annullato, per l'avviso in chiaro. La partita è
  // 'aborted' e NON conta nelle statistiche.
  | { type: "game_aborted"; byName: string }
  | { type: "opponent_disconnected"; seat: Seat }
  | { type: "opponent_reconnected"; seat: Seat }
  // Rifiuto di join_room PRIMA di occupare un posto (SEC-08), distinto da `error`
  // e da `move_rejected`. "AUTH_REQUIRED" = manca l'authToken; "AUTH_INVALID" =
  // token scaduto/revocato/sconosciuto. Il client riporta alla schermata d'ingresso.
  | { type: "join_rejected"; code: "AUTH_REQUIRED" | "AUTH_INVALID"; reason: string }
  | { type: "error"; message: string };

/* ───────────────────────────── CONTRATTO AUTH (HTTP) ─────────────────────────
 * DTO degli endpoint REST /auth/* del backend. COPIA allineata a mano (nessun
 * package condiviso): se il BE cambia il contratto auth, aggiornare qui. Il FE
 * non contiene logica di hashing/token: detiene solo il token opaco ricevuto. */

/** Vista pubblica dell'utente (mai hash/segreti). Specchio di AuthUser (BE). */
export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
  isGuest: boolean;
}

/** Risposta di register/login/guest. */
export interface AuthSuccess {
  token: string;
  user: AuthUser;
}

/** Corpo d'errore standard degli endpoint auth (status via HTTP code). */
export interface AuthErrorBody {
  error: string;
  message: string;
}

/* ─────────────────────── CONTRATTO STATISTICHE & PROFILO (HTTP) ──────────────
 * DTO degli endpoint REST /users/me/* del backend (macro-ciclo 3). COPIA
 * allineata a mano (decisione #4/#8): specchio di BE contract/types.ts. L'utente
 * è SEMPRE derivato dal token lato server (mai un id nel client): nessun IDOR. */

/** Statistiche aggregate CORE di un utente. Specchio di UserStats (BE). */
export interface UserStats {
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  /** won/played in [0,1]; 0 quando played = 0. */
  winRate: number;
  totalPoints: number;
}

/** Sintesi di una partita conclusa nello storico. Specchio di MatchSummary (BE). */
export interface MatchSummary {
  matchId: string;
  /** Epoch millis di fine partita (best-effort); può essere null. */
  endedAt: number | null;
  result: "won" | "lost";
  opponentName: string;
  yourScore: number;
  opponentScore: number;
}

/** Risposta paginata di GET /users/me/matches. */
export interface MatchesPage {
  items: MatchSummary[];
  limit: number;
  offset: number;
}

/* ─────────────────────────── ELENCO TAVOLI APERTI (HTTP) ─────────────────────
 * DTO di GET /rooms/open (endpoint PUBBLICO, read-only). COPIA allineata a mano
 * dello specchio BE. Espone SOLO il minimo: nessun id utente/email, nessuna
 * distinzione ospite-vs-registrato — solo il displayName di chi attende. */
export interface OpenRoomInfo {
  code: string;
  hostName: string;
  seats: number;
  maxSeats: number;
  /** ISO8601 di quando il tavolo ha iniziato ad attendere. */
  waitingSince: string;
}

/** Risposta di GET /rooms/open. */
export interface OpenRoomsResponse {
  rooms: OpenRoomInfo[];
}
