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

/**
 * POSTO al tavolo. NUMERICO (non più il letterale `0 | 1`): copia allineata a mano
 * del contratto BE (Fase 1, predisposizione N posti). In 1v1 i valori restano 0 e 1.
 */
export type Seat = number;

/**
 * Identità di SQUADRA (specchio di `TeamId` del BE). In individuale `team === seat`;
 * in coppie (predisposizione, non attiva) posti opposti condividono la squadra.
 * Il FE non calcola le regole: usa `Meld.ownerTeam` così com'è redatto dal server.
 */
export type TeamId = number;

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
  /** Posto che ha calato il gioco (audit/log; NON usato per la proprietà). */
  ownerSeat: Seat;
  /**
   * SQUADRA proprietaria del gioco (specchio del BE, P4). Il FE raggruppa e decide
   * la selezionabilità dei giochi per QUESTO campo, mai per `ownerSeat`. In 1v1
   * `ownerTeam === ownerSeat`, quindi il raggruppamento "Noi/Loro" non cambia.
   */
  ownerTeam: TeamId;
  isBurraco: boolean;
  clean: boolean;
  /**
   * Indici in `cards[]` delle carte che fungono DAVVERO da matta in questo
   * gioco. Un 2 al posto naturale NON è matta e non compare. Server-authoritative.
   */
  wildIndices?: number[];
}

export interface GameConfig {
  /** Posti al tavolo: 2 (1v1) o 4 (coppie 2v2). Copia allineata al BE (widening C1). */
  numeroGiocatori: 2 | 4;
  /** Modalità: "coppie" = 2v2 (posti opposti 0+2 / 1+3). Copia allineata al BE (C2). */
  modalita: "individuale" | "coppie";
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
  /**
   * SQUADRA del posto (C5). La UI raggruppa le coppie (0+2 / 1+3) per QUESTO campo,
   * mai deducendolo. In individuale/1v1 `team === seat` (invariato).
   */
  team: TeamId;
}

/**
 * Vista PUBBLICA di un posto al tavolo (C3, anti-leak P3). Specchio di SeatPublic (BE):
 * ogni posto porta SOLO il CONTEGGIO delle carte, mai le carte (compagno incluso).
 * La sola mano completa nel payload è `GameStatePublic.yourHand` del destinatario.
 */
export interface SeatPublic {
  seat: Seat;
  team: TeamId;
  handCount: number;
  connectionStatus: ConnectionStatus;
  displayName: string;
}

export interface GameStatePublic {
  yourHand: Card[];
  tableMelds: Meld[];
  /**
   * TUTTI i posti del tavolo — VIEWER INCLUSO (D-A) — col solo CONTEGGIO delle carte
   * (mai le carte: anti-leak P3). Sostituisce `opponentHandCount` (C3): a N posti
   * l'avversario non è più unico. Il client filtra per `seat` per il proprio/gli altri.
   */
  seats: SeatPublic[];
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
  /**
   * Punteggi cumulativi INDICIZZATI PER SQUADRA (`TeamId`, C4/D-E): `scores[team]`.
   * In individuale/1v1 team = seat → coincide con la vecchia tupla per-seat.
   */
  scores: number[];
  status: "playing" | "hand_ended" | "game_ended";
}

export interface HandScoreDetail {
  seat: Seat;
  ptsMelds: number;
  ptsBonus: number;
  ptsPenaltyHand: number;
  ptsPozzetto: number;
  totalDelta: number;
  /**
   * Fatti di STILE (macro-ciclo storico). Additivi: conteggio dei burrachi propri
   * separati per pulito/sporco e modalità di presa del pozzetto (true = "in diretta").
   */
  burrachiPuliti: number;
  burrachiSporchi: number;
  pozzettoInDiretta: boolean;
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
  | "NO_WILD_TO_SUBSTITUTE"
  // Sostituzione della matta in una SEQUENZA: nessuna estremità (cima/fondo) è
  // legale per la matta spostata (es. sequenza satura A-basso…A-alto) → rifiuto.
  | "WILD_NO_LEGAL_POSITION"
  // Sostituzione della matta in una SEQUENZA con ENTRAMBE le estremità legali ma
  // senza `edge`: il server chiede al client di scegliere cima o fondo e ripetere.
  | "WILD_EDGE_REQUIRED"
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
  // SOSTITUZIONE DELLA MATTA: la carta naturale (`cardInHand`) prende il posto
  // della matta calata (jolly O pinella, l'unica presente nel gioco); la matta NON
  // torna mai in mano. In una SEQUENZA la matta si sposta a cima ("top") o fondo
  // ("bottom") estendendo la scala di una posizione: `edge` è la scelta del
  // giocatore, necessaria SOLO quando entrambe le estremità sono legali (altrimenti
  // il server usa l'unica legale, o rifiuta se nessuna lo è). Nei GRUPPI la matta
  // resta dentro e `edge` è ignorato.
  | {
      type: "wild_substitute";
      meldId: string;
      cardInHand: string;
      edge?: "top" | "bottom";
      clientMoveId?: string;
    }
  | { type: "discard"; card: string; clientMoveId?: string }
  // ANNULLA l'ultima calata annullabile del proprio turno (solo correlation id).
  | { type: "undo_last"; clientMoveId?: string }
  // Smontaggio esplicito del tavolo (in attesa o con avversario disconnesso).
  | { type: "reset_room" }
  // ANNULLAMENTO UNILATERALE della partita in corso (nessun payload; room e seat
  // dedotti dal socket lato server). Chiude la partita per entrambi, libera il tavolo.
  | { type: "game_abort" }
  // LOBBY (door a) — "Apri un tavolo". `private:true` → non compare in lista.
  // I campi identità hanno la stessa semantica di join_room (nome autoritativo dal token).
  | {
      type: "open_table";
      code: string;
      private: boolean;
      displayName: string;
      clientId?: string;
      authToken?: string;
      playerToken?: string;
    }
  // LOBBY (door b) — "Gioca subito". Decisione tutta server-side.
  | {
      type: "quick_match";
      displayName: string;
      clientId?: string;
      authToken?: string;
      playerToken?: string;
    }
  | { type: "heartbeat" };

/** SERVER → CLIENT. */
export type ServerMessage =
  // `code`: codice normalizzato del tavolo (necessario per quick_match, dove il
  // codice è generato dal server e appreso dal client solo qui).
  | { type: "room_joined"; yourSeat: Seat; yourToken: string; code: string; players: PlayerPublic[]; config: GameConfig; resumed: boolean }
  | { type: "state"; state: GameStatePublic }
  | { type: "move_applied"; clientMoveId: string }
  | { type: "move_rejected"; code: RejectCode; reason: string; clientMoveId?: string }
  | { type: "pozzetto_taken"; seat: Seat }
  | { type: "burraco_made"; seat: Seat; meldId: string; clean: boolean }
  | { type: "turn_changed"; seat: Seat; phase: Phase }
  // C6: `cumulative` è PER SQUADRA (`TeamId`); `scores` resta per-seat (C7, il FE
  // aggrega per squadra). In 1v1 team = seat → valori invariati.
  | { type: "hand_ended"; closerSeat: Seat | null; scores: HandScoreDetail[]; cumulative: number[] }
  // C8: `winnerTeam` = SQUADRA vincitrice (in 1v1 = posto); `finalScores` per squadra.
  // `reason?: "forfeit"` = l'avversario ha abbandonato (disconnessione oltre la
  // grazia); assente = fine normale per obiettivo raggiunto.
  | { type: "game_ended"; winnerTeam: TeamId | null; finalScores: number[]; reason?: "forfeit" }
  // Chiusura TERMINALE del tavolo SENZA vincitore, distinta da `game_ended`.
  // "interrupted" = reset esplicito; "abandoned" = avversario non rientrato.
  | { type: "room_closed"; reason: "interrupted" | "abandoned" }
  // ANNULLAMENTO UNILATERALE della partita (terminale, senza vincitore, distinto da
  // room_closed). `byName` è chi ha annullato, per l'avviso in chiaro. La partita è
  // 'aborted' e NON conta nelle statistiche.
  | { type: "game_aborted"; byName: string }
  // C9/D-B: un POSTO ha perso/ripreso la connessione (ex opponent_*; a N posti
  // "opponent" è ambiguo — può essere il compagno). Broadcast a tutti gli altri posti.
  | { type: "player_disconnected"; seat: Seat }
  | { type: "player_reconnected"; seat: Seat }
  // Rifiuto di join_room PRIMA di occupare un posto. "AUTH_REQUIRED" = manca
  // l'authToken; "AUTH_INVALID" = token scaduto/revocato; "ROOM_JUST_TAKEN"
  // (LOBBY §5.4-C) = ci si è seduti a un tavolo appena riempito → messaggio + refresh lista.
  | { type: "join_rejected"; code: "AUTH_REQUIRED" | "AUTH_INVALID" | "ROOM_JUST_TAKEN"; reason: string }
  // LOBBY (§5.4-A) — FUSIONE: spostato in un tavolo pubblico quick_match già in
  // attesa; `newCode` è il codice di destinazione. Seguono room_joined/state.
  | { type: "room_merged"; newCode: string }
  // LOBBY (door a) — open_table su codice già in uso: la modale resta aperta.
  | { type: "open_rejected"; code: "CODE_IN_USE" }
  // LOBBY (§5.4-D) — self-play: avviso NON bloccante "giochi contro te stesso".
  | { type: "self_play_notice" }
  | { type: "error"; message: string };

/* ─────────────────────────── LOBBY / LISTA TAVOLI (HTTP) ─────────────────────
 * DTO di RISPOSTA delle rotte REST della lobby. COPIA allineata a mano (nessun
 * package condiviso): specchio di BE contract/types.ts. La lista è una whitelist
 * anti-leak (mai tavoli privati né campi interni). L'avvio partita è via WebSocket. */

/** Riga della lista tavoli pubblici in attesa. Specchio di WaitingTableView (BE). */
export interface WaitingTableView {
  code: string;
  creatorName: string;
  openedAt: number;
  /** Posti totali del tavolo (= config.numeroGiocatori; 2 in 1v1, 4 in coppie). */
  seatsTotal: number;
  /** Posti occupati da un socket vivo in attesa (1..seatsTotal-1). */
  seatsTaken: number;
}

/** Risposta di GET /tables. Specchio di TablesResponse (BE). */
export interface TablesResponse {
  tables: WaitingTableView[];
  lobbyPlayers: number;
}

/** Risposta di GET /tables/new-code. Specchio di NewCodeResponse (BE). */
export interface NewCodeResponse {
  code: string;
}

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

/** Periodo temporale delle statistiche. Specchio di StatsPeriod (BE). */
export type StatsPeriod = "all" | "30d" | "season";

/**
 * Metrica del blocco analisi. `value` è null quando il campione è sotto soglia
 * (dati insufficienti): la UI mostra "dati insufficienti (sampleSize/threshold)".
 * Specchio di StatMetric (BE).
 */
export interface StatMetric {
  value: number | null;
  sampleSize: number;
  threshold: number;
}

/** Serie d'andamento (sparkline): media punti per partita, cronologica. Specchio di StatTrend (BE). */
export interface StatTrend {
  points: number[];
  sampleSize: number;
  threshold: number;
}

/** Blocco analisi di stile ("come giochi"). Specchio di StyleAnalysis (BE). */
export interface StyleAnalysis {
  dealsPlayed: number;
  burrachiPulitiPerDeal: StatMetric;
  burrachiSporchiPerDeal: StatMetric;
  cleanDirtyRatio: StatMetric;
  pozzettoRate: StatMetric;
  pozzettoInDirettaShare: StatMetric;
  closureRate: StatMetric;
  avgHandPenalty: StatMetric;
  avgPointsPerDeal: StatMetric;
  malusPozzettoCount: number;
  trend: StatTrend;
}

/**
 * Statistiche aggregate di un utente (base + analisi). Specchio di UserStats (BE).
 *
 * ROBUSTEZZA (contratto tollerante): i campi introdotti da questa feature sono
 * OPZIONALI perché il FE può parlare con un backend non ancora aggiornato (es.
 * preview Vercel del branch verso il Render di produzione ancora vecchio). In quel
 * caso la risposta contiene solo i campi base: la UI deve degradare (nascondere il
 * blocco analisi), MAI andare in crash dereferenziando `analysis` inesistente.
 */
export interface UserStats {
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  /** won/played in [0,1]; 0 quando played = 0. */
  winRate: number;
  totalPoints: number;
  /** Partite abbandonate: non pesano su vinte/perse. Assente su backend non aggiornato. */
  matchesAbandoned?: number;
  /** Punteggio finale medio; null se played = 0. Assente su backend non aggiornato. */
  avgFinalScore?: number | null;
  /** Blocco analisi di stile. Assente su backend non aggiornato → sezione nascosta. */
  analysis?: StyleAnalysis;
  periodo?: StatsPeriod;
}

/** Sintesi di una partita conclusa nello storico. Specchio di MatchSummary (BE). */
export interface MatchSummary {
  matchId: string;
  /** Epoch millis di fine partita (matches.ended_at); può essere null. */
  endedAt: number | null;
  result: "won" | "lost";
  opponentName: string;
  /** true se l'avversario era un ospite (suffisso "(ospite)" nella UI). Assente su backend non aggiornato. */
  opponentIsGuest?: boolean;
  yourScore: number;
  opponentScore: number;
  /** Numero di smazzate giocate nella partita. Assente su backend non aggiornato. */
  dealsCount?: number;
}

/** Risposta paginata di GET /users/me/matches. */
export interface MatchesPage {
  items: MatchSummary[];
  limit: number;
  offset: number;
}

/** Stato di una partita nello storico (vocabolario DB). Specchio di MatchStatus (BE). */
export type MatchStatus = "playing" | "completed" | "aborted" | "abandoned";

/** Lato (utente/avversario) di una smazzata nel dettaglio. Specchio di MatchDealSide (BE). */
export interface MatchDealSide {
  puntiSmazzata: number;
  puntiCarteInMano: number;
  burrachiPuliti: number;
  burrachiSporchi: number;
  pozzettoPreso: boolean;
  pozzettoInDiretta: boolean;
  haChiuso: boolean;
  malusPozzetto: boolean;
}

/** Una smazzata nel dettaglio partita. Specchio di MatchDeal (BE). */
export interface MatchDeal {
  numeroSmazzata: number;
  dealerSeat: Seat;
  closerSeat: Seat | null;
  you: MatchDealSide;
  opponent: MatchDealSide;
}

/** Dettaglio di una partita, smazzata-per-smazzata. Specchio di MatchDetail (BE). */
export interface MatchDetail {
  matchId: string;
  endedAt: number | null;
  status: MatchStatus;
  /** won | lost per le partite completed; null altrimenti. */
  result: "won" | "lost" | null;
  opponent: { name: string; isGuest: boolean };
  targetScore: number;
  yourSeat: Seat;
  finalScore: { you: number; opponent: number };
  deals: MatchDeal[];
}
