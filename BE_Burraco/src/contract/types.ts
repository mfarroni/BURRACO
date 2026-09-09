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

/**
 * IDENTITÀ "matta" della carta (non il ruolo che assume in un gioco):
 *  - "joker"   → è un jolly;
 *  - "pinella" → è un 2 (vale 20 a punti, può fungere da matta);
 *  - null      → carta naturale qualsiasi.
 * È una proprietà della CARTA in sé; il RUOLO effettivo di matta dentro un
 * meld è invece descritto da `Meld.wildIndices`.
 */
export type WildKind = "joker" | "pinella" | null;

/**
 * Carta del contratto.
 * - `isWild` = true per jolly e per ogni 2 (pinella) → equivale a `wildKind !== null`.
 * - `wildKind` = identità matta della carta (vedi WildKind).
 */
export interface Card {
  id: string;
  suit: Suit | null; // null solo per il jolly
  rank: Rank;
  isWild: boolean;
  wildKind: WildKind;
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
  /**
   * Indici in `cards[]` delle carte che fungono DAVVERO da matta in questo
   * gioco (jolly, oppure un 2 usato come matta). Un 2 al suo posto naturale
   * NON è matta e NON compare qui. Calcolo server-authoritative, coerente con
   * `clean`/`isBurraco`.
   */
  wildIndices?: number[];
}

/** Configurazione di partita (v1: valori bloccati dalla scheda di regole). */
export interface GameConfig {
  numeroGiocatori: 2;
  modalita: "individuale";
  punteggioObiettivo: number; // 2005
  varianteChiusura: "italiana" | "internazionale";
  presaPozzetto: "in_diretta_e_differita" | "solo_differita";
  /**
   * House-rule OPZIONALE (spenta di default). `null` = NESSUN LIMITE di calate
   * prima di prendere il pozzetto (comportamento base del Burraco). Un numero
   * finito > 0 attiva il cap: il motore rifiuta con MELD_LIMIT_REACHED oltre
   * quel numero di giochi calati prima del pozzetto.
   */
  limiteCalatePrimaDelPozzetto: number | null;
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
  /**
   * Deadline ASSOLUTA del turno in epoch millis, da cui il client deriva un
   * countdown puramente VISIVO. È popolata durante un turno attivo (il server
   * enforce il timeout: allo scadere esegue d'ufficio un turno minimo legale).
   * `null` solo quando non c'è un turno attivo (mano/partita conclusa) o quando
   * il timeout è disattivato via config (turnTimeoutMs <= 0).
   */
  turnEndsAt: number | null;
  /** Fase corrente del turno. */
  phase: Phase;
  /** Ho già preso il mio pozzetto? */
  yourPozzettoTaken: boolean;
  /**
   * Presentazionale: true solo quando questo destinatario è di mano, in fase
   * may_meld, con almeno una calata annullabile impilata nel turno corrente. Il
   * client lo usa per abilitare il pulsante "Annulla ultima mossa". Non divulga
   * stato nascosto (solo disponibilità dell'azione), coerente con l'anti-leak.
   */
  canUndo: boolean;
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
  /**
   * Fatti di STILE per l'analisi di gioco (macro-ciclo storico). Additivi:
   *  - `burrachiPuliti`/`burrachiSporchi`: conteggio dei burrachi PROPRI, separati
   *    per `clean` (non ricavabili da `ptsBonus`, che li fonde col bonus chiusura);
   *  - `pozzettoInDiretta`: true SOLO se il pozzetto è stato preso "in diretta"
   *    (svuotando la mano PRIMA dello scarto). false se non preso o preso in differita.
   * Il client si allinea a questi campi a mano (nessun package condiviso).
   */
  burrachiPuliti: number;
  burrachiSporchi: number;
  pozzettoInDiretta: boolean;
}

/* ───────────────────────── STATISTICHE & PROFILO (HTTP) ─────────────────────
 * Macro-ciclo 3. DTO di RISPOSTA degli endpoint REST /users/me/* (sotto Bearer).
 * Sono di proprietà del BACKEND: il FE ne tiene una COPIA allineata a mano
 * (decisione #4/#8, nessun package condiviso). Le statistiche sono calcolate
 * ON-THE-FLY (decisione A) dallo StatsStore; qui viaggiano solo i numeri finali,
 * mai lo stato di gioco. L'utente è SEMPRE derivato dal token (mai da un id nel
 * client): nessun IDOR possibile.
 */

/** Periodo temporale su cui aggregare le statistiche (filtro su matches.ended_at). */
export type StatsPeriod = "all" | "30d" | "season";

/**
 * Metrica del BLOCCO ANALISI ("come giochi"). Il valore è `null` quando il
 * campione è sotto soglia (dati insufficienti): il BE non restituisce mai uno
 * zero fuorviante. `sampleSize` è il denominatore effettivo, `threshold` la
 * soglia minima. La UI mostra "dati insufficienti (sampleSize/threshold)".
 */
export interface StatMetric {
  value: number | null;
  sampleSize: number;
  threshold: number;
}

/** Serie d'andamento (sparkline): punti medi per partita, cronologici. */
export interface StatTrend {
  /** Media dei `total_delta` per smazzata, una voce per partita, in ordine cronologico. */
  points: number[];
  sampleSize: number;
  threshold: number;
}

/**
 * Blocco analisi di STILE (macro-ciclo storico). Tutto derivato da hand_scores
 * arricchito (+ hands) per il solo posto dell'utente, sulle partite completed
 * nel periodo scelto. Le metriche sotto soglia hanno `value: null`.
 */
export interface StyleAnalysis {
  /** Numero di smazzate giocate: base statistica dell'intero blocco. */
  dealsPlayed: number;
  /** Burrachi puliti medi per smazzata. */
  burrachiPulitiPerDeal: StatMetric;
  /** Burrachi sporchi medi per smazzata. */
  burrachiSporchiPerDeal: StatMetric;
  /** Rapporto puliti/sporchi (alto = gioco "pulito"; basso = chiude sporco in fretta). */
  cleanDirtyRatio: StatMetric;
  /** Quota di smazzate in cui ha preso il pozzetto. */
  pozzettoRate: StatMetric;
  /** Fra i pozzetti presi, quota di quelli "in diretta". */
  pozzettoInDirettaShare: StatMetric;
  /** Quota di smazzate chiuse dall'utente. */
  closureRate: StatMetric;
  /** Punti medi persi per carte rimaste in mano (numero ≤ 0). */
  avgHandPenalty: StatMetric;
  /** Punti medi per smazzata. */
  avgPointsPerDeal: StatMetric;
  /** Quante volte ha subito il malus del pozzetto (-100). Conteggio, nessuna soglia. */
  malusPozzettoCount: number;
  /** Andamento punti (ultime 20 partite). */
  trend: StatTrend;
}

/** Statistiche aggregate di un utente (contatori base + blocco analisi). */
export interface UserStats {
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  /** Partite abbandonate (status 'abandoned'): NON pesano su vinte/perse. */
  matchesAbandoned: number;
  /** won/played in [0,1]; 0 quando played = 0. */
  winRate: number;
  /** Somma dei delta di punteggio delle mani per il posto dell'utente. */
  totalPoints: number;
  /** Punteggio finale medio con cui chiude le partite; null se played = 0. */
  avgFinalScore: number | null;
  /** Blocco analisi di stile ("come giochi"). */
  analysis: StyleAnalysis;
  /** Eco del periodo su cui sono calcolate (per l'UI). */
  periodo: StatsPeriod;
}

/** Sintesi di una partita conclusa per lo storico paginato (decisione E). */
export interface MatchSummary {
  matchId: string;
  /** Epoch millis di fine partita (matches.ended_at). Può essere null. */
  endedAt: number | null;
  result: "won" | "lost";
  opponentName: string;
  /** true se l'avversario era un ospite (per il suffisso "(ospite)" nella UI). */
  opponentIsGuest: boolean;
  yourScore: number;
  opponentScore: number;
  /** Numero di smazzate giocate nella partita. */
  dealsCount: number;
}

/** Stato di una partita nello storico (vocabolario DB). */
export type MatchStatus = "playing" | "completed" | "aborted" | "abandoned";

/** Lato (utente/avversario) di una smazzata nel dettaglio partita. */
export interface MatchDealSide {
  /** Punti della smazzata (total_delta). */
  puntiSmazzata: number;
  /** Punti persi per carte rimaste in mano (pts_penalty_hand, ≤ 0). */
  puntiCarteInMano: number;
  burrachiPuliti: number;
  burrachiSporchi: number;
  /** true se ha preso il pozzetto (pts_pozzetto = 0). */
  pozzettoPreso: boolean;
  /** true se il pozzetto è stato preso in diretta. */
  pozzettoInDiretta: boolean;
  /** true se è stato lui a chiudere la smazzata. */
  haChiuso: boolean;
  /** true se ha subito il malus del pozzetto (pts_pozzetto = -100). */
  malusPozzetto: boolean;
}

/** Una smazzata nel dettaglio partita, con i due lati. */
export interface MatchDeal {
  numeroSmazzata: number;
  dealerSeat: Seat;
  closerSeat: Seat | null;
  you: MatchDealSide;
  opponent: MatchDealSide;
}

/**
 * Dettaglio di una partita, smazzata-per-smazzata. Restituito da
 * `GET /users/me/matches/:id` SOLO a chi vi ha PARTECIPATO (altrimenti 404).
 * Nessun campo interno (id utente altrui, token, checkpoint) è mai esposto.
 */
export interface MatchDetail {
  matchId: string;
  endedAt: number | null;
  status: MatchStatus;
  /** won | lost per le partite completed; null per aborted/abandoned/playing. */
  result: "won" | "lost" | null;
  opponent: { name: string; isGuest: boolean };
  targetScore: number;
  yourSeat: Seat;
  finalScore: { you: number; opponent: number };
  deals: MatchDeal[];
}

/* ─────────────────────────── EVENTI WEBSOCKET ─────────────────────────── */

/**
 * Messaggi CLIENT → SERVER (intenzioni; il server è l'unico a validare).
 *
 * `clientMoveId` è un correlation id OPZIONALE presente SOLO sui messaggi di
 * AZIONE (draw/meld/pinella/discard). Serve al client per correlare la propria
 * mossa con l'ack targetizzato `move_applied`/`move_rejected` e marcare la carta
 * esatta "in volo". NON compare su join_room/heartbeat. Il server lo tratta come
 * opaco: NON influenza mai la validazione delle regole.
 */
export type ClientMessage =
  // `clientId` (LIFECYCLE): identità di sessione STABILE per-browser (non
  // per-room), usata per il RECLAIM di un posto disconnesso quando il token di
  // room è perso. Opaca per il server; non concede mai accesso a un posto vivo.
  //
  // `authToken` (Macro-ciclo 1 — Auth): token di sessione OPACO rilasciato dagli
  // endpoint HTTP /auth/*. Il server lo valida (sessione viva, non scaduta/revocata)
  // e ne ricava il PRINCIPALE: usa il suo `display_name` AUTORITATIVO e IGNORA il
  // `displayName` inviato dal client (anti-spoof). Con auth attiva (produzione),
  // un join SENZA authToken valido è RIFIUTATO (SEC-08: niente ingresso col solo
  // codice tavolo). `playerToken`/`clientId` restano per la riconnessione del POSTO
  // (SEC-04/10/11) e NON sono sostituiti: authToken AGGIUNGE identità sopra di essi.
  | {
      type: "join_room";
      roomCode: string;
      playerToken?: string;
      displayName: string;
      clientId?: string;
      authToken?: string;
    }
  | { type: "draw"; source: "deck" | "discard"; clientMoveId?: string }
  | { type: "meld_new"; cards: string[]; clientMoveId?: string } // CardId[]
  | { type: "meld_extend"; meldId: string; cards: string[]; clientMoveId?: string }
  | { type: "pinella_substitute"; meldId: string; cardInHand: string; clientMoveId?: string }
  | { type: "discard"; card: string; clientMoveId?: string }
  // ANNULLA l'ultima calata annullabile del proprio turno (nessun payload oltre
  // al correlation id opzionale). Il server valida turno/fase e stack.
  | { type: "undo_last"; clientMoveId?: string }
  // LIFECYCLE: smontaggio esplicito del tavolo (nessun payload; room dedotta dal
  // socket). Consentito solo in attesa o con avversario disconnesso.
  | { type: "reset_room" }
  // ANNULLAMENTO UNILATERALE della partita in corso (nessun payload; room e seat
  // dedotti dal socket). Chi conferma chiude la partita per ENTRAMBI: la partita è
  // marcata 'aborted' (non conta nelle statistiche), il tavolo è liberato e il
  // codice torna subito riutilizzabile. Solo un giocatore SEDUTO a quel tavolo può
  // annullare (autorizzazione verificata lato server dallo slot del socket, mai dal
  // payload). Idempotente: un secondo abort o un abort su tavolo già chiuso dà
  // esito neutro. Adatta il nome `game:abort` della scheda alla convenzione
  // snake_case del contratto esistente.
  | { type: "game_abort" }
  // LOBBY (door a) — "Apri un tavolo": crea un tavolo in ATTESA con un codice
  // scelto dall'utente (precompilato dal server, modificabile). `private:true` →
  // il tavolo NON compare nella lista pubblica (raggiungibile solo col codice).
  // Origin = apertura_manuale: MAI fuso (§5.4-A). I campi di identità
  // (displayName/clientId/authToken/playerToken) hanno la stessa semantica di
  // join_room: l'identità AUTORITATIVA è derivata dal token, mai dal displayName.
  | {
      type: "open_table";
      code: string;
      private: boolean;
      displayName: string;
      clientId?: string;
      authToken?: string;
      playerToken?: string;
    }
  // LOBBY (door b) — "Gioca subito": il server cerca il tavolo pubblico in attesa
  // di origine quick_match più vecchio e vi fa sedere il giocatore; se non esiste
  // ne crea uno nuovo (poi tenta la fusione §5.4-A). Decisione tutta server-side.
  | {
      type: "quick_match";
      displayName: string;
      clientId?: string;
      authToken?: string;
      playerToken?: string;
    }
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
  | "NOTHING_TO_UNDO"
  | "GAME_NOT_ACTIVE"
  | "MALFORMED";

/** Messaggi SERVER → CLIENT. */
export type ServerMessage =
  | {
      type: "room_joined";
      yourSeat: Seat;
      yourToken: string; // token effimero per la riconnessione
      /**
       * Codice normalizzato del tavolo. NECESSARIO per il quick_match: il codice
       * è generato dal server e il client lo apprende solo qui (per riconnettersi
       * poi via join_room e per mostrarlo nella schermata d'attesa).
       */
      code: string;
      players: PlayerPublic[];
      config: GameConfig;
      /**
       * true quando il join è una RICONNESSIONE a una sessione esistente
       * (join con playerToken su una room già presente); false al primo ingresso.
       */
      resumed: boolean;
    }
  | { type: "state"; state: GameStatePublic }
  /**
   * ACK per-attore di una mossa ANDATA A BUON FINE. TARGETIZZATO al solo attore
   * (mai broadcast, mai dentro `state`): serve a risolvere il "pending per-carta"
   * correlando via `clientMoveId`. Non trasporta stato di gioco.
   */
  | { type: "move_applied"; clientMoveId: string }
  | { type: "move_rejected"; code: RejectCode; reason: string; clientMoveId?: string }
  /**
   * Eventi CELEBRATIVI presentazionali, broadcast alla room. Effimeri: NON
   * fanno parte di `state` e NON vengono replayati al rejoin.
   */
  | { type: "pozzetto_taken"; seat: Seat }
  | { type: "burraco_made"; seat: Seat; meldId: string; clean: boolean }
  | { type: "turn_changed"; seat: Seat; phase: Phase }
  | {
      type: "hand_ended";
      closerSeat: Seat | null;
      scores: HandScoreDetail[];
      cumulative: [number, number];
    }
  /**
   * Fine partita. `reason` è OPZIONALE: assente = fine normale (obiettivo
   * raggiunto); "forfeit" = l'avversario si è disconnesso oltre la finestra di
   * grazia e ha abbandonato (in 2 giocatori l'altro è dichiarato vincitore).
   */
  | { type: "game_ended"; winnerSeat: Seat | null; finalScores: [number, number]; reason?: "forfeit" }
  /**
   * LIFECYCLE: chiusura TERMINALE del tavolo SENZA vincitore, distinta da
   * `game_ended`. `reason`:
   *  - "interrupted" → un giocatore ha smontato il tavolo (reset_room);
   *  - "abandoned"   → l'avversario non è rientrato entro la finestra di grazia.
   * Alla ricezione il client mostra un esito chiaro e non resta bloccato.
   */
  | { type: "room_closed"; reason: "interrupted" | "abandoned" }
  /**
   * ANNULLAMENTO UNILATERALE della partita (esito TERMINALE senza vincitore,
   * distinto da `game_ended` e da `room_closed`). Inviato a ENTRAMBI i giocatori
   * quando uno dei due conferma "Annulla partita". `byName` è il displayName di chi
   * ha annullato, per l'avviso in chiaro. La partita è marcata 'aborted' e NON conta
   * nelle statistiche; alla ricezione il client torna alla lobby azzerando lo stato
   * locale del tavolo.
   */
  | { type: "game_aborted"; byName: string }
  | { type: "opponent_disconnected"; seat: Seat }
  | { type: "opponent_reconnected"; seat: Seat }
  /**
   * Macro-ciclo 1 — Auth: rifiuto di `join_room` PRIMA di occupare un posto,
   * distinto da `error` (generico) e da `move_rejected` (mossa di gioco). Chiude
   * SEC-08: senza authToken valido non si entra col solo codice tavolo.
   *  - "AUTH_REQUIRED" → authToken assente quando l'auth è obbligatoria;
   *  - "AUTH_INVALID"  → authToken presente ma scaduto/revocato/sconosciuto.
   *  - "ROOM_JUST_TAKEN" (LOBBY, §5.4-C) → si è tentato di sedersi a un tavolo che
   *    nel frattempo si è riempito (2 posti vivi). Il FE mostra "Qualcuno si è
   *    appena seduto a quel tavolo" e fa un refresh immediato della lista.
   */
  | {
      type: "join_rejected";
      code: "AUTH_REQUIRED" | "AUTH_INVALID" | "ROOM_JUST_TAKEN";
      reason: string;
    }
  /**
   * LOBBY (§5.4-A) — FUSIONE: il giocatore è stato spostato in un tavolo pubblico
   * quick_match già in attesa (più vecchio), che ora si completa e avvia la
   * partita. `newCode` è il codice del tavolo di destinazione. Subito dopo
   * arrivano `room_joined`/`state` del tavolo unito. Il FE aggiorna il codice
   * mostrato e spiega la fusione. Tocca SOLO tavoli pubblici quick_match.
   */
  | { type: "room_merged"; newCode: string }
  /**
   * LOBBY (door a) — `open_table` su un codice GIÀ IN USO da un altro tavolo vivo.
   * Nessun takeover: la modale resta aperta e invita a cambiare codice.
   */
  | { type: "open_rejected"; code: "CODE_IN_USE" }
  /**
   * LOBBY (§5.4-D) — SELF-PLAY: i due posti condividono la stessa identità
   * per-browser (o lo stesso utente). Avviso NON bloccante ("Stai giocando contro
   * te stesso"). La partita è comunque esclusa dalle statistiche (userId=null).
   */
  | { type: "self_play_notice" }
  | { type: "error"; message: string };

/* ───────────────────────── LOBBY / LISTA TAVOLI (HTTP) ──────────────────────
 * DTO di RISPOSTA delle rotte REST della lobby (sotto Bearer). Proprietà del
 * BACKEND; il FE ne tiene una COPIA allineata a mano (decisione #4/#8). La lista
 * è una WHITELIST rigorosa: NON espone mai tavoli privati né campi interni
 * (userId/email/token/origin/clientId/visibility). L'avvio partita passa SEMPRE
 * dal WebSocket, mai dal polling di questa lista.
 */

/** Riga della lista tavoli pubblici in attesa (whitelist anti-leak). */
export interface WaitingTableView {
  /** Codice normalizzato (`.trim().toUpperCase().slice(0,12)`). */
  code: string;
  /** display_name AUTORITATIVO del creatore (mai un valore arbitrario del client). */
  creatorName: string;
  /** epoch ms di apertura → il FE deriva "attende da MM:SS". */
  openedAt: number;
  /** Posti totali del tavolo (= config.numeroGiocatori; oggi sempre 2). */
  seatsTotal: number;
  /** Posti occupati da un socket VIVO (oggi 1 in attesa). */
  seatsTaken: number;
}

/** Risposta di GET /tables: lista + contatore giocatori realmente in lobby. */
export interface TablesResponse {
  tables: WaitingTableView[];
  /** Sessioni realmente in lobby (poll recente, non sedute). Vedi §6.2. */
  lobbyPlayers: number;
}

/** Risposta di GET /tables/new-code: codice tavolo precompilato dal server. */
export interface NewCodeResponse {
  code: string;
}
