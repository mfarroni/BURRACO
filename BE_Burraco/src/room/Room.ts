import { randomUUID, createHash } from "node:crypto";
import { WebSocket } from "ws";
import type {
  ClientMessage,
  ConnectionStatus,
  GameConfig,
  PlayerPublic,
  Seat,
  ServerMessage,
  TeamId,
  WaitingTableView,
} from "../contract/types.js";
import { GameEngine, type GameEffect, type MoveResult } from "../engine/game.js";
import { canonicalSeatForTeam, teamCount, teamOfSeat, teamScores } from "../engine/teams.js";
import { redactFor, type SeatMeta } from "./redact.js";
import { persistence } from "../db/persistence.js";

/** LOBBY: visibilità di un tavolo in attesa (i privati non compaiono in lista). */
export type RoomVisibility = "pubblico" | "privato";
/** LOBBY: origine del tavolo. Solo `quick_match` è candidabile alla fusione. */
export type RoomOrigin = "quick_match" | "apertura_manuale";

/** LOBBY: opzioni di creazione di una Room (default = tavolo privato manuale). */
export interface RoomOptions {
  visibility?: RoomVisibility;
  origin?: RoomOrigin;
}

/**
 * Una Room è una partita 1v1. Possiede il GameEngine autoritativo (stato in
 * RAM, decisione #5/#7 single-instance) e le connessioni WebSocket dei due
 * giocatori. Traduce le mosse valide in broadcast di stato REDATTO e persiste
 * i checkpoint di fine mano/partita su Neon (best-effort).
 */

interface PlayerSlot {
  seat: Seat;
  displayName: string;
  token: string; // token corrente (in chiaro solo in RAM)
  tokenHash: string;
  /**
   * LIFECYCLE: identità di sessione STABILE per-browser (non per-room), fornita
   * dal client in `join_room` (localStorage). Consente il RECLAIM di un posto
   * DISCONNESSO quando il token di room è andato perso/ruotato+scaduto. È SOLO
   * un aggancio di riconnessione: non concede MAI l'accesso a un posto VIVO
   * (SEC-04), il reclaim via clientId vale esclusivamente per posti disconnessi.
   */
  clientId?: string;
  /**
   * Macro-ciclo 3 (WIRING statistiche): identità (account o ospite) che occupa il
   * posto, risolta dall'authToken in `join_room` (mai dal displayName del client).
   * Serve SOLO a collegare la partita all'utente in `match_players.user_id` per le
   * statistiche. È ORTOGONALE al meccanismo del posto (playerToken/clientId,
   * SEC-04/10/11), che resta l'unica autorità sull'accesso allo slot. `null` per i
   * join senza principale risolto (dev/test o gating disattivato).
   */
  userId: string | null;
  /**
   * NEW-1: token PRECEDENTE ancora accettato durante la transizione di
   * riconnessione. Alla riconnessione ruotiamo il token, ma teniamo valido
   * ANCHE quello appena presentato dal client finché il client non conferma il
   * nuovo token (prima azione valida sul socket) o finché non scade il TTL.
   * Questo evita il lockout se il frame `room_joined{yourToken}` va perso.
   */
  prevToken: string | null;
  /** NEW-1: scadenza assoluta (epoch ms) del `prevToken`; oltre, non è più accettato. */
  prevTokenExpiry: number | null;
  ws: WebSocket | null;
  status: ConnectionStatus;
  /** Hook riconnessione: timer della finestra di grazia (v1 tiene viva la room). */
  graceTimer: NodeJS.Timeout | null;
}

function send(ws: WebSocket | null, msg: ServerMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class Room {
  /** Ritardo prima di distribuire la smazzata successiva (mostra i punteggi). */
  static readonly NEXT_HAND_DELAY_MS = 5000;

  readonly code: string;
  readonly config: GameConfig;
  readonly matchId: string;

  /**
   * LOBBY: attributi del tavolo in attesa. `visibility` decide se compare nella
   * lista pubblica; `origin` decide la candidabilità alla FUSIONE (§5.4-A: solo
   * `pubblico` + `quick_match`); `openedAt` alimenta "attende da MM:SS". Sono
   * INTERNI: non vengono mai serializzati ai client (solo `waitingView()` espone
   * una whitelist). Default = tavolo privato di apertura manuale (semantica
   * legacy di join_room: reperibile solo col codice, mai in lista, mai fuso).
   */
  readonly visibility: RoomVisibility;
  readonly origin: RoomOrigin;
  readonly openedAt: number;
  /** clientId del creatore (seat0), per diagnosi/estensioni. Interno, mai esposto. */
  private creatorClientId: string | undefined;

  private players: PlayerSlot[] = [];
  private engine: GameEngine | null = null;
  /**
   * true una volta avviata la partita (createMatch persistito). Distingue i
   * terminali che vanno scritti su DB (abbandono/annullamento/completamento di una
   * partita realmente iniziata) dai teardown pre-partita (nessuna riga match).
   */
  private matchStarted = false;
  private handId: string | null = null;
  private eventSeq = 0;
  /** Timer di enforcement del timeout turno (SEC-05). Uno per volta. */
  private turnTimer: NodeJS.Timeout | null = null;
  /** true dopo la conclusione/abbandono: la room è pronta per la GC. */
  private disposed = false;
  /**
   * Hook di garbage-collection (SEC-05): impostato dal RoomManager alla
   * creazione. Invocato quando la room si conclude (partita finita / forfeit /
   * abbandono totale) per rimuoverla dalla mappa in-RAM. Evita accumulo illimitato.
   */
  onDispose: (() => void) | null = null;

  constructor(code: string, config: GameConfig, opts?: RoomOptions) {
    this.code = code;
    this.config = config;
    this.matchId = randomUUID();
    this.visibility = opts?.visibility ?? "privato";
    this.origin = opts?.origin ?? "apertura_manuale";
    this.openedAt = Date.now();
  }

  isFull(): boolean {
    // A N posti: pieno = tanti slot quanti i posti del tavolo (`seatsTotal`).
    // In 1v1 `seatsTotal()` vale 2 → comportamento identico a prima.
    return this.players.length >= this.seatsTotal();
  }

  hasEngine(): boolean {
    return this.engine !== null;
  }

  /* ─────────────────────────── LOBBY: getter per la lista ─────────────────── */

  /** Un tavolo è "in attesa" se la partita non è iniziata e non è smaltito. */
  isWaiting(): boolean {
    return !this.engine && !this.disposed;
  }

  /** Numero di posti occupati da un socket VIVO (in attesa: 0 o 1). */
  seatsTakenLive(): number {
    return this.players.reduce((n, p) => n + (this.isSeatLive(p) ? 1 : 0), 0);
  }

  /** Posti totali del tavolo (= `config.numeroGiocatori`: 2 in 1v1, 4 in coppie). */
  seatsTotal(): number {
    return this.config.numeroGiocatori;
  }

  /** Nome AUTORITATIVO del creatore (seat0), o stringa vuota se non ancora seduto. */
  creatorName(): string {
    const first = this.players.find((p) => p.seat === 0) ?? this.players[0];
    return first?.displayName ?? "";
  }

  /** clientId del creatore (interno; per la rilevazione self-play a monte). */
  getCreatorClientId(): string | undefined {
    return this.creatorClientId;
  }

  /**
   * LOBBY (§5.4-A/B): candidabile alla seduta/fusione quick_match SE è un tavolo
   * pubblico quick_match, ancora in attesa, con ALMENO un posto vivo e ANCORA
   * capienza (`seatsTakenLive < seatsTotal`). Generalizzato a N posti: in 1v1
   * (`seatsTotal` = 2) equivale a "esattamente un posto vivo" (comportamento
   * invariato). La FIRMA modalità/dimensione è confrontata a monte
   * (RoomManager.findQuickMatchCandidate / mergeQuickMatchTables): un quick_match
   * 2v2 non si siede né si fonde con un tavolo 1v1.
   */
  isMergeableQuickMatch(): boolean {
    const taken = this.seatsTakenLive();
    return (
      this.isWaiting() &&
      this.visibility === "pubblico" &&
      this.origin === "quick_match" &&
      taken >= 1 &&
      taken < this.seatsTotal()
    );
  }

  /**
   * Vista WHITELIST per la lista pubblica, o `null` se il tavolo non va listato
   * (privato, non in attesa, oppure senza alcun posto vivo → niente fantasmi
   * §5.4-B). NON espone MAI campi interni (userId/token/origin/clientId/visibility).
   */
  waitingView(): WaitingTableView | null {
    if (this.visibility !== "pubblico") return null;
    if (!this.isWaiting()) return null;
    const taken = this.seatsTakenLive();
    if (taken < 1) return null; // solo con ≥1 socket vivo (anti-fantasma)
    const view: WaitingTableView = {
      code: this.code,
      creatorName: this.creatorName(),
      openedAt: this.openedAt,
      seatsTotal: this.seatsTotal(),
      seatsTaken: taken,
    };
    // MODALITÀ (Tappa 3a): campo additivo esposto SOLO per i tavoli 2v2, così la
    // vista serializzata dell'1v1 resta byte-identica a prima (whitelist a 5 chiavi).
    if (this.config.modalita === "coppie") view.modalita = "coppie";
    return view;
  }

  /**
   * LOBBY (§5.4-A): identità del solo posto VIVO di un tavolo in attesa, usata
   * dalla FUSIONE per spostarlo in un altro tavolo. Ritorna il socket e i dati di
   * identità (nome autoritativo, clientId, userId); `null` se non c'è un posto vivo.
   */
  liveSeatIdentity(): { ws: WebSocket; name: string; clientId?: string; userId: string | null } | null {
    const live = this.players.find((p) => this.isSeatLive(p));
    if (!live || !live.ws) return null;
    return { ws: live.ws, name: live.displayName, clientId: live.clientId, userId: live.userId };
  }

  /**
   * LOBBY (§5.4-A, N posti): identità di TUTTI i posti vivi del tavolo, usata dalla
   * FUSIONE per spostarli in blocco in un altro tavolo della stessa firma. A N posti
   * un quick_match può avere più di un occupante, quindi la fusione non può muovere
   * un solo posto: li elenca tutti e li sposta finché il tavolo di destinazione ha
   * capienza. In 1v1 l'array ha al più un elemento (comportamento invariato).
   */
  liveSeatIdentities(): { ws: WebSocket; name: string; clientId?: string; userId: string | null }[] {
    const out: { ws: WebSocket; name: string; clientId?: string; userId: string | null }[] = [];
    for (const p of this.players) {
      if (this.isSeatLive(p) && p.ws) {
        out.push({ ws: p.ws, name: p.displayName, clientId: p.clientId, userId: p.userId });
      }
    }
    return out;
  }

  /** Trova lo slot associato a un socket (o undefined). */
  private slotByWs(ws: WebSocket): PlayerSlot | undefined {
    return this.players.find((p) => p.ws === ws);
  }

  /**
   * NEW-1: TTL entro cui il token PRECEDENTE resta accettato dopo una rotazione,
   * per coprire la perdita del frame `room_joined{yourToken}` durante una
   * riconnessione. Breve per non riaprire SEC-10.
   */
  private rotationTtlMs(): number {
    return Number(process.env.TOKEN_ROTATION_TTL_MS ?? 15_000);
  }

  /**
   * NEW-1: un token è valido per uno slot se coincide con quello CORRENTE oppure
   * con il PRECEDENTE ancora entro il TTL. Il controllo SEC-04 (rifiuto se il
   * legittimo è connesso) è applicato a valle in `join`, quindi vale per
   * entrambi i token.
   */
  private tokenMatches(p: PlayerSlot, token: string): boolean {
    if (p.token === token) return true;
    return p.prevToken === token && p.prevTokenExpiry !== null && p.prevTokenExpiry > Date.now();
  }

  /**
   * NEW-1: "commit" del token corrente. Alla PRIMA azione valida sul socket già
   * associato allo slot, il client ha necessariamente ricevuto il nuovo token
   * (era sullo stesso socket del `room_joined`): scartiamo il precedente,
   * chiudendo la finestra di replay (SEC-10). Idempotente.
   */
  private commitToken(slot: PlayerSlot): void {
    if (slot.prevToken !== null || slot.prevTokenExpiry !== null) {
      slot.prevToken = null;
      slot.prevTokenExpiry = null;
    }
  }

  private publicPlayers(): PlayerPublic[] {
    return this.players.map((p) => ({
      seat: p.seat,
      displayName: p.displayName,
      connectionStatus: p.status,
      // C5: SQUADRA del posto per il raggruppamento delle coppie lato UI. In 1v1
      // team = seat → il roster "Tu / Avversario" non cambia.
      team: teamOfSeat(p.seat, this.config),
    }));
  }

  /**
   * Metadati per-posto (nome autoritativo + stato connessione) per la REDAZIONE.
   * Il motore non li conosce: li fornisce il Room a `redactFor`, indicizzati per
   * `seat`. Nessun dato sensibile (mai token/carte): solo ciò che è già pubblico.
   */
  private seatMeta(): SeatMeta[] {
    const meta: SeatMeta[] = [];
    for (const p of this.players) {
      meta[p.seat] = { displayName: p.displayName, connectionStatus: p.status };
    }
    return meta;
  }

  /** Un posto è "vivo" se ha uno stato connesso E un socket effettivamente aperto. */
  private isSeatLive(p: PlayerSlot): boolean {
    return p.status === "connected" && p.ws !== null && p.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Ingresso, riconnessione o RECLAIM del posto. Ordine di risoluzione:
   *  (1) token valido (corrente o precedente entro TTL) → riconnessione;
   *  (2) clientId che combacia con un posto DISCONNESSO → reclaim (token perso);
   *  (3) posto libero → nuovo seat;
   *  (4) room piena ma con un posto DISCONNESSO non associabile a un posto vivo
   *      → reclaim del posto disconnesso (fallback open-table). CONSENTITO SOLO
   *      PRE-PARTITA (`!this.engine`): serve unicamente a completare la coppia
   *      quando il match non è ancora avviato (senza engine non c'è mano da
   *      divulgare, `sendStateTo` è no-op). A PARTITA IN CORSO è DISATTIVATO
   *      (SEC-11): impedisce che un terzo, conoscendo solo il codice tavolo,
   *      subentri al posto di un disconnesso e ne riceva la mano esatta. Mid-game
   *      il rientro è ammesso SOLO col reclaim autenticato via clientId (branch 2).
   *  (5) room realmente al completo (o partita avviata senza reclaim valido) → rifiuto.
   * Il reclaim (2)/(4) vale SOLO per posti disconnessi: un posto VIVO non è mai
   * reclamabile né via token né via clientId (SEC-04). Mai più di 2 slot.
   */
  join(
    ws: WebSocket,
    token: string | undefined,
    displayName: string,
    clientId?: string,
    userId?: string | null,
  ): void {
    if (this.disposed) {
      this.logJoin("disposed", clientId);
      send(ws, { type: "error", message: "La partita è conclusa." });
      return;
    }

    // (1) Riconnessione per token (corrente o precedente entro TTL, NEW-1).
    if (token) {
      const existing = this.players.find((p) => this.tokenMatches(p, token));
      if (existing) {
        // SEC-04: takeover di sessione ATTIVA vietato. Vale anche per il token
        // PRECEDENTE: finché il legittimo è connesso, nessun token dà accesso.
        if (this.isSeatLive(existing)) {
          this.logJoin("sec04-live-reject", clientId);
          send(ws, { type: "error", message: "Sessione già attiva su un'altra connessione." });
          try {
            ws.close(1008, "Sessione già attiva.");
          } catch {
            /* socket già in chiusura */
          }
          return;
        }
        // Riconnessione legittima (slot disconnesso): rebind + rotazione token,
        // mantenendo valido il token presentato entro il TTL (NEW-1/SEC-10).
        this.logJoin("reconnect-token", clientId);
        this.reconnectInto(existing, ws, token, displayName, clientId, userId);
        return;
      }
      // Token non riconosciuto: si prova il reclaim per clientId, poi nuovo ingresso.
    }

    // (2) RECLAIM di un posto DISCONNESSO tramite clientId (token perso/scaduto).
    //     Mai su un posto VIVO (SEC-04): il filtro `!isSeatLive` lo garantisce.
    if (clientId) {
      const byClient = this.players.find(
        (p) => p.clientId !== undefined && p.clientId === clientId && !this.isSeatLive(p),
      );
      if (byClient) {
        this.logJoin("reclaim-clientId", clientId);
        this.reconnectInto(byClient, ws, null, displayName, clientId, userId);
        return;
      }
    }

    // (3) Nuovo posto, se la room non è piena.
    if (!this.isFull()) {
      this.logJoin("new-slot", clientId);
      this.createSlot(ws, displayName, clientId, userId);
      return;
    }

    // (4) Fallback open-table: room piena ma con un posto DISCONNESSO e join non
    //     associabile ad alcun posto vivo → reclaim del posto disconnesso (mai di
    //     uno vivo). SEC-11: consentito SOLO PRE-PARTITA. A partita avviata
    //     (`this.engine` presente) NON si reclama un posto disconnesso senza
    //     autenticazione via clientId (branch 2): eviterebbe l'hijack del posto e
    //     il leak della mano esatta del disconnesso verso chi conosce solo il codice.
    if (!this.engine) {
      const disconnected = this.players.find((p) => !this.isSeatLive(p));
      if (disconnected) {
        this.logJoin("fallback-opentable", clientId);
        this.reconnectInto(disconnected, ws, null, displayName, clientId, userId);
        return;
      }
    }

    // (5) Room al completo o partita in corso senza reclaim valido.
    //  - Se i posti sono ENTRAMBI VIVI (tavolo genuinamente pieno: qualcuno si è
    //    appena seduto) → esito TIPIZZATO join_rejected{ROOM_JUST_TAKEN} (§5.4-C),
    //    così il FE mostra "Qualcuno si è appena seduto a quel tavolo" e fa un
    //    refresh della lista. Copre la corsa alla stessa sedia (F12) e il terzo
    //    che arriva su una partita già in corso.
    //  - Se il tavolo è pieno SOLO per un posto DISCONNESSO non reclamabile
    //    (tentativo di subentro mid-game, SEC-11) → resta l'errore generico "al
    //    completo": non si tratta di una sedia appena presa e non va incoraggiato
    //    un refresh/nuovo tentativo sullo stesso codice.
    this.logJoin("full", clientId);
    const anyDisconnected = this.players.some((p) => !this.isSeatLive(p));
    if (!anyDisconnected) {
      send(ws, {
        type: "join_rejected",
        code: "ROOM_JUST_TAKEN",
        reason: "Qualcuno si è appena seduto a quel tavolo.",
      });
      return;
    }
    send(ws, { type: "error", message: "La room è al completo." });
  }

  /**
   * DIAG (temporaneo, rimovibile): log di join per diagnosi accesso mobile.
   * Emette una riga greppabile con il RAMO scelto e lo stato dei posti al momento
   * della decisione. NON logga MAI segreti (token/clientId in chiaro): solo
   * booleani e conteggi. `clientIdMatch` confronta l'id in arrivo con quello dei
   * posti senza rivelarne il valore. Rimuovere l'intero metodo e le sue chiamate
   * al termine della diagnosi.
   */
  private logJoin(branch: string, incomingClientId?: string): void {
    // IGIENE (ciclo 2): diagnostica di join disattivata di default. Riattivabile
    // impostando DIAG_JOIN=true (nessun segreto loggato: solo booleani/conteggi).
    if (process.env.DIAG_JOIN !== "true") return;
    const slots = this.players.map((p) => ({
      seat: p.seat,
      live: this.isSeatLive(p),
      hasClientId: p.clientId !== undefined,
      clientIdMatch: incomingClientId !== undefined && p.clientId === incomingClientId,
    }));
    console.log(
      `[join] room=${this.code} branch=${branch} players=${this.players.length} ` +
        `slots=${JSON.stringify(slots)} engine=${this.engine !== null}`,
    );
  }

  /** Crea un nuovo slot per un ingresso ex-novo e prova ad avviare la partita. */
  private createSlot(ws: WebSocket, displayName: string, clientId?: string, userId?: string | null): void {
    const seat = this.players.length as Seat;
    const newToken = randomUUID();
    const slot: PlayerSlot = {
      seat,
      displayName: displayName.slice(0, 40) || `Giocatore ${seat + 1}`,
      token: newToken,
      tokenHash: sha256(newToken),
      prevToken: null,
      prevTokenExpiry: null,
      clientId,
      userId: userId ?? null,
      ws,
      status: "connected",
      graceTimer: null,
    };
    this.players.push(slot);
    // LOBBY: il primo posto è il creatore → ne memorizziamo il clientId.
    if (seat === 0 && clientId) this.creatorClientId = clientId;

    send(ws, {
      type: "room_joined",
      yourSeat: seat,
      yourToken: newToken,
      code: this.code,
      players: this.publicPlayers(),
      config: this.config,
      resumed: false, // primo ingresso
    });
    this.maybeStartMatch();
  }

  /**
   * Riconnessione/reclaim in uno slot esistente DISCONNESSO. Rebinda il socket,
   * ruota il token (SEC-10) e, se il token presentato è noto, lo mantiene valido
   * entro il TTL (NEW-1: no lockout se `room_joined` va perso). Per un reclaim
   * via clientId/fallback (`presentedToken === null`) non c'è un token precedente
   * da preservare. Invia lo stato corrente e prova ad avviare la partita (utile
   * quando il match non è ancora partito e questa riconnessione completa la coppia).
   */
  private reconnectInto(
    slot: PlayerSlot,
    ws: WebSocket,
    presentedToken: string | null,
    _displayName: string,
    clientId?: string,
    userId?: string | null,
  ): void {
    if (slot.graceTimer) {
      clearTimeout(slot.graceTimer);
      slot.graceTimer = null;
    }
    slot.ws = ws;
    slot.status = "connected";
    // (Ri)aggancia l'identità per-browser, così i reclaim futuri restano possibili.
    if (clientId) slot.clientId = clientId;
    // Aggiorna l'identità del posto se il rientro porta un principale risolto.
    // Non azzera un userId già noto quando il rientro non ne porta uno (es. reclaim
    // via clientId in dev senza authToken): l'aggancio all'account resta stabile.
    if (userId != null) slot.userId = userId;

    const rotated = randomUUID();
    slot.token = rotated;
    slot.tokenHash = sha256(rotated);
    if (presentedToken) {
      slot.prevToken = presentedToken;
      slot.prevTokenExpiry = Date.now() + this.rotationTtlMs();
    } else {
      slot.prevToken = null;
      slot.prevTokenExpiry = null;
    }

    send(ws, {
      type: "room_joined",
      yourSeat: slot.seat,
      yourToken: rotated,
      code: this.code,
      players: this.publicPlayers(),
      config: this.config,
      resumed: true, // riconnessione/reclaim di una sessione esistente
    });
    this.notifyOthers(slot.seat, { type: "player_reconnected", seat: slot.seat });
    this.sendStateTo(slot); // no-op se il match non è ancora avviato
    this.maybeStartMatch();
  }

  /**
   * Avvia la partita SOLO quando entrambi i seat hanno un socket VIVO. Invia il
   * roster aggiornato ai SOCKET CORRENTI dei due seat (mai a un `ws` morto: era
   * la causa del "non parte per nessuno"). Se un seat è disconnesso, si resta in
   * attesa/riconnessione senza avviare partite fantasma.
   */
  private maybeStartMatch(): void {
    if (this.engine) return;
    // Avvio a TAVOLO PIENO (N posti): servono `seatsTotal` slot, tutti vivi. In 1v1
    // `seatsTotal()` = 2, quindi la partita parte all'ingresso del secondo, come
    // prima; in 2v2 attende i quattro posti (nessuna partita a tavolo incompleto).
    if (this.players.length !== this.seatsTotal()) return;
    if (!this.players.every((p) => this.isSeatLive(p))) return;
    for (const p of this.players) {
      send(p.ws, {
        type: "room_joined",
        yourSeat: p.seat,
        yourToken: p.token, // token corrente (invariato): non è una riconnessione
        code: this.code,
        players: this.publicPlayers(),
        config: this.config,
        resumed: false,
      });
    }
    this.startMatch();
  }

  /**
   * LOBBY (§5.4-D): self-play = due posti QUALSIASI del tavolo condividono
   * l'identità per-browser (clientId) o lo stesso utente (userId). Generalizzato a
   * N posti (in 2v2 basta una coppia di posti collidente): in 1v1 (2 posti) è la
   * stessa verifica di prima. Serve almeno 2 posti per essere valutato.
   */
  private isSelfPlay(): boolean {
    if (this.players.length < 2) return false;
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i]!;
        const b = this.players[j]!;
        if (a.clientId !== undefined && a.clientId === b.clientId) return true;
        if (a.userId !== null && a.userId === b.userId) return true;
      }
    }
    return false;
  }

  private startMatch(): void {
    // A6: mazziere iniziale a caso fra i posti del tavolo. In 1v1 (`seatsTotal` = 2)
    // è 0 o 1 come prima; in 2v2 è un posto qualsiasi in [0, seatsTotal).
    const firstDealer: Seat = Math.floor(Math.random() * this.seatsTotal());
    this.engine = new GameEngine(this.config, firstDealer);

    // LOBBY (§5.4-D) — SELF-PLAY: i due posti sono lo stesso browser (clientId
    // condiviso) o lo stesso utente (userId condiviso). Avviso NON bloccante ai
    // due socket e ESCLUSIONE dalle statistiche persistendo con userId=null per
    // ENTRAMBI i posti: un match non attribuito non comparirà nelle stats di
    // nessuno, senza toccare il layer stats/query (decisione lead #3).
    const selfPlay = this.isSelfPlay();
    if (selfPlay) this.broadcast({ type: "self_play_notice" });

    // Persistenza best-effort (checkpoint/audit): match, players, hand 1.
    this.handId = randomUUID();
    this.matchStarted = true;
    void persistence.createMatch(this.matchId, this.config);
    void persistence.addPlayers(
      this.matchId,
      this.players.map((p) => ({
        seat: p.seat,
        // 2v2: la SQUADRA del posto (in 1v1 team = seat). Persistita in match_players.team.
        team: teamOfSeat(p.seat, this.config),
        displayName: p.displayName,
        tokenHash: p.tokenHash,
        userId: selfPlay ? null : p.userId,
      })),
    );
    void persistence.startHand(this.matchId, this.handId, this.engine.handNumber, this.engine.dealerSeat);

    // Il roster è già stato inviato ai due socket vivi da `maybeStartMatch`. Qui
    // basta lo stato iniziale (che riarma anche il turn timer) e l'evento di turno.
    this.broadcastState();
    this.emitTurnChanged();
  }

  /** Instrada un messaggio del client verso il motore. */
  onMessage(ws: WebSocket, msg: ClientMessage): void {
    const slot = this.slotByWs(ws);
    if (!slot) {
      send(ws, { type: "error", message: "Socket non associato a un giocatore." });
      return;
    }
    if (this.disposed) {
      send(ws, { type: "error", message: "La partita è conclusa." });
      return;
    }
    // NEW-1: qualunque messaggio valido su questo socket conferma la ricezione
    // del token corrente (incluso l'heartbeat periodico del client) → scarta il
    // token precedente. Chiude la finestra di replay del vecchio token (SEC-10).
    this.commitToken(slot);
    if (msg.type === "heartbeat") return; // liveness gestita a livello ws

    // LIFECYCLE: smontaggio esplicito del tavolo. Consentito quando il richiedente
    // è in ATTESA (nessun avversario) oppure l'avversario è DISCONNESSO; mai con
    // l'avversario connesso e attivo (in quel caso viene rifiutato in modo leggibile).
    if (msg.type === "reset_room") {
      this.handleReset(slot);
      return;
    }

    // ANNULLAMENTO unilaterale della partita in corso (§5). Autorizzazione: solo chi
    // è SEDUTO a questo tavolo (slot risolto dal socket) può annullare — l'identità
    // NON arriva mai dal payload. Idempotente e senza vincoli di stato del turno.
    if (msg.type === "game_abort") {
      this.abortGame(slot);
      return;
    }

    if (!this.engine) {
      send(ws, { type: "move_rejected", code: "GAME_NOT_ACTIVE", reason: "In attesa dell'avversario." });
      return;
    }

    const seat = slot.seat;
    // Correlation id opzionale delle sole azioni: opaco, non influenza le regole.
    const clientMoveId = (msg as { clientMoveId?: string }).clientMoveId;

    let result: MoveResult;
    switch (msg.type) {
      case "draw":
        result = this.engine.draw(seat, msg.source);
        break;
      case "meld_new":
        result = this.engine.meldNew(seat, msg.cards);
        break;
      case "meld_extend":
        result = this.engine.meldExtend(seat, msg.meldId, msg.cards);
        break;
      case "wild_substitute":
        result = this.engine.wildSubstitute(seat, msg.meldId, msg.cardInHand, msg.edge);
        break;
      case "discard":
        result = this.engine.discardCard(seat, msg.card);
        break;
      case "undo_last":
        result = this.engine.undoLast(seat);
        break;
      default:
        send(ws, { type: "move_rejected", code: "GAME_NOT_ACTIVE", reason: "Messaggio non gestito." });
        return;
    }

    if (!result.ok) {
      send(slot.ws, {
        type: "move_rejected",
        code: result.code,
        reason: result.reason,
        ...(clientMoveId ? { clientMoveId } : {}),
      });
      return;
    }

    // SEC-01: si logga SOLO dopo la validazione → nessuna scrittura DB per
    // azioni rifiutate o malformate (che non arrivano nemmeno qui).
    this.logEvent(msg.type, seat, msg);
    this.applyEffects(result.effects);
    this.broadcastState();
    // ACK per-attore TARGETIZZATO: separato dal broadcast `state`, mai redatto,
    // mai inviato all'avversario. Risolve il "pending per-carta" lato client.
    if (clientMoveId) send(slot.ws, { type: "move_applied", clientMoveId });
  }

  private applyEffects(effects: GameEffect[]): void {
    for (const eff of effects) {
      if (eff.kind === "turn_changed") {
        this.broadcast({ type: "turn_changed", seat: eff.seat, phase: eff.phase });
      } else if (eff.kind === "hand_ended") {
        this.broadcast({
          type: "hand_ended",
          closerSeat: eff.closerSeat,
          scores: eff.scores,
          // C6: cumulati PER SQUADRA. In 1v1 (team = seat) è [cum0, cum1], invariato.
          cumulative: this.teamScoresNow(eff.cumulative),
        });
        void persistence.endHand(this.matchId, this.handId, eff.closerSeat, eff.scores, this.snapshot());
        // Avvia la smazzata successiva dopo un ritardo, così i client mostrano
        // il riepilogo punteggi prima che il tavolo si aggiorni.
        // NOTA(co-design ui_ux): in alternativa si può sostituire con un pulsante
        // "Continua" esplicito; qui usiamo un timer per l'MVP.
        if (this.engine && this.engine.status === "hand_ended") {
          setTimeout(() => this.startNextHand(), Room.NEXT_HAND_DELAY_MS);
        }
      } else if (eff.kind === "game_ended") {
        this.broadcast({
          type: "game_ended",
          // C8: SQUADRA vincitrice (autoritativa dal motore, P4) + punteggi PER
          // SQUADRA. In 1v1 team = seat → valori invariati.
          winnerTeam: eff.winnerTeam,
          finalScores: this.teamScoresNow(eff.finalScores),
        });
        // §7: fine LEGITTIMA (obiettivo raggiunto) → UNICO percorso 'completed',
        // l'unico conteggiato nelle statistiche. Persiste il posto canonico (audit)
        // e la SQUADRA vincitrice (in 1v1 team = seat → winner_team = winner_seat).
        void persistence.completeMatch(this.matchId, eff.winnerSeat, eff.winnerTeam);
        // SEC-05: partita conclusa → GC della room (rimozione dalla mappa RAM).
        this.dispose();
      } else if (eff.kind === "pozzetto_taken") {
        // Evento CELEBRATIVO effimero: broadcast, non persistito, non replayato.
        this.broadcast({ type: "pozzetto_taken", seat: eff.seat });
      } else if (eff.kind === "burraco_made") {
        this.broadcast({ type: "burraco_made", seat: eff.seat, meldId: eff.meldId, clean: eff.clean });
      }
    }
  }

  private startNextHand(): void {
    if (!this.engine || this.engine.status !== "hand_ended") return;
    this.engine.startNextHand();
    this.handId = randomUUID();
    void persistence.startHand(
      this.matchId, this.handId, this.engine.handNumber, this.engine.dealerSeat,
    );
    this.broadcastState();
    this.emitTurnChanged();
  }

  private emitTurnChanged(): void {
    if (!this.engine) return;
    this.broadcast({ type: "turn_changed", seat: this.engine.currentSeat, phase: this.engine.phase });
  }

  /** Disconnessione: marca lo stato e avvia la finestra di grazia (riconnessione). */
  onDisconnect(ws: WebSocket): void {
    const slot = this.slotByWs(ws);
    if (!slot) return;
    slot.ws = null;
    slot.status = "disconnected";
    this.notifyOthers(slot.seat, { type: "player_disconnected", seat: slot.seat });

    // LIFECYCLE: alla SCADENZA della grazia (default 180s) il disconnesso non
    // rientra più. L'esito dipende da MODALITÀ e STATO (vedi sotto).
    if (slot.graceTimer) clearTimeout(slot.graceTimer);
    slot.graceTimer = setTimeout(() => {
      slot.graceTimer = null;
      if (this.disposed) return;
      // Riconnesso nel frattempo? Nessuna chiusura.
      if (slot.status === "connected") return;
      // Tutti disconnessi → room abbandonata: GC silenzioso senza messaggi.
      if (this.isEmpty()) {
        this.dispose();
        return;
      }
      // ITEM 1 — ABBANDONO DI COPPIA (2v2): a partita IN CORSO (`this.engine`
      // presente), la disconnessione oltre la grazia fa perdere a FORFAIT la
      // COPPIA dell'assente; vince la squadra AVVERSARIA. Passa per la stessa via
      // del forfait da stallo (`forfeitStalledSeat`, P4): game_ended{reason:
      // "forfeit"} ai posti vivi + completeMatch (status 'completed', conta nelle
      // statistiche). Vale anche se il COMPAGNO dell'assente è ancora connesso: la
      // coppia non può schierare entrambi i giocatori.
      //
      // In INDIVIDUALE (1v1) il comportamento è INVARIATO: partita ANNULLATA per
      // abbandono, SENZA vincitore (room_closed{abandoned}). In ATTESA
      // (`engine === null`, tavolo non ancora avviato) nessun forfait: si annulla
      // come oggi. Il ramo forfait è quindi condizionato a coppie + partita avviata.
      if (this.engine && this.config.modalita === "coppie") {
        this.forfeitStalledSeat(slot.seat);
        return;
      }
      // Avversario ancora presente (1v1 in corso, o tavolo in attesa) → partita
      // ANNULLATA per abbandono (no winner). Comportamento 1v1 invariato.
      this.closeRoom("abandoned");
    }, this.graceMs());
    slot.graceTimer.unref?.();
  }

  /**
   * LIFECYCLE: smonta il tavolo con un esito TERMINALE senza vincitore, distinto
   * da `game_ended`. "interrupted" = reset esplicito del richiedente; "abandoned"
   * = avversario non rientrato entro la grazia. Notifica i soli socket vivi e GC.
   */
  private closeRoom(reason: "interrupted" | "abandoned"): void {
    if (this.disposed) return;
    // §6.3: l'ABBANDONO (avversario non rientrato entro la grazia) di una partita
    // REALMENTE iniziata va marcato 'abandoned' su Neon. Non tocca i contatori
    // (status ≠ 'completed'). L'"interrupted" (teardown pre-partita / avversario già
    // offline via reset) resta un teardown senza scrittura di stato terminale.
    if (reason === "abandoned" && this.matchStarted) {
      void persistence.abandonMatch(this.matchId);
    }
    this.logLifecycle(reason);
    this.broadcast({ type: "room_closed", reason });
    this.dispose();
  }

  /**
   * §8: log di ciclo di vita del tavolo con SOLO codice tavolo, esito e timestamp.
   * Nessun dato personale (mai displayName/token/id).
   */
  private logLifecycle(event: "interrupted" | "abandoned" | "aborted"): void {
    console.log(`[room] ${event} room=${this.code} at=${new Date().toISOString()}`);
  }

  /**
   * LIFECYCLE: gestione di `reset_room`. Consentito solo se non c'è avversario
   * oppure l'avversario è disconnesso; con l'avversario VIVO viene rifiutato in
   * modo leggibile (nessuno smontaggio unilaterale di una partita in corso).
   */
  private handleReset(slot: PlayerSlot): void {
    // A N posti: lo smontaggio è vietato se un QUALSIASI altro posto è vivo (non
    // solo "l'avversario"). In 1v1 c'è un solo altro posto → verifica identica.
    const anyOtherLive = this.players.some((p) => p.seat !== slot.seat && this.isSeatLive(p));
    if (anyOtherLive) {
      send(slot.ws, {
        type: "error",
        message: "Non puoi chiudere il tavolo mentre l'avversario è connesso.",
      });
      return;
    }
    this.closeRoom("interrupted");
  }

  /**
   * ANNULLAMENTO UNILATERALE della partita (§5.3). In ordine e in modo idempotente:
   *  1. marca la partita 'aborted' su Neon con timestamp e l'identità dell'autore
   *     (la riga storica NON viene cancellata: audit + verifica statistiche);
   *  2. purga i checkpoint (stato transitorio) e rimuove lo stato dalla RAM liberando
   *     il codice tavolo (dispose → GC nel RoomManager): il codice torna subito
   *     riutilizzabile;
   *  3. NON tocca alcun contatore (status ≠ 'completed');
   *  4. notifica ENTRAMBI i client con il nome di chi ha annullato.
   * Doppio abort o abort su tavolo già chiuso → esito neutro (guardia `disposed`),
   * mai un 500. Senza partita realmente iniziata è un no-op (i teardown pre-partita
   * passano da `reset_room`).
   */
  private abortGame(slot: PlayerSlot): void {
    if (this.disposed) return;
    if (!this.engine || !this.matchStarted) return;
    void persistence.abortMatch(this.matchId, slot.userId);
    void persistence.deleteCheckpoints(this.matchId);
    this.logLifecycle("aborted");
    this.broadcast({ type: "game_aborted", byName: slot.displayName });
    this.dispose();
  }

  /**
   * LOBBY (§5.4-B): grazia CONDIZIONATA allo stato. In ATTESA (`engine === null`)
   * si usa la finestra breve WAITING_GRACE_MS (default 60s): non c'è partita da
   * salvare, ma non si punisce un cambio rete. In PARTITA resta RECONNECT_GRACE_MS
   * (default 180s), invariato. Letto dall'env a ogni disconnessione così i test
   * possono iniettare valori deterministici.
   */
  private graceMs(): number {
    if (!this.engine) return Number(process.env.WAITING_GRACE_MS ?? 60_000);
    return Number(process.env.RECONNECT_GRACE_MS ?? 180_000);
  }

  /**
   * LOBBY (§5.4-B): chiusura PULITA di un tavolo in ATTESA (beacon /session/leave
   * o annullamento immediato). Dispose solo se la partita non è iniziata: in
   * partita lo smontaggio passa dai canali esistenti (reset_room/abbandono).
   */
  leaveWaiting(): void {
    if (this.engine) return;
    this.dispose();
  }

  isEmpty(): boolean {
    return this.players.every((p) => p.ws === null);
  }

  /**
   * SEC-05: conclusione definitiva della room. Ferma tutti i timer (turn timer e
   * grazie), marca la room come smaltibile e notifica il RoomManager per la
   * rimozione dalla mappa in-RAM. Idempotente.
   */
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTurnTimer();
    for (const p of this.players) {
      if (p.graceTimer) {
        clearTimeout(p.graceTimer);
        p.graceTimer = null;
      }
    }
    this.onDispose?.();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /* ─────────────────────────── enforcement timeout turno ─────────────────── */

  /**
   * SEC-05: (ri)programma il timer di scadenza del turno in base alla deadline
   * autoritativa del motore (engine.turnEndsAt). Idempotente: azzera il timer
   * precedente e ne arma uno nuovo. Nessun timer se non c'è un turno attivo.
   */
  private scheduleTurnTimer(): void {
    this.clearTurnTimer();
    const e = this.engine;
    if (this.disposed || !e || e.status !== "playing") return;
    const deadline = e.turnEndsAt;
    if (deadline == null) return;
    const activeSeat = e.currentSeat;
    const ms = Math.max(0, deadline - Date.now());
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      this.autoPlayTurn(activeSeat);
    }, ms);
    this.turnTimer.unref?.();
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  /**
   * SEC-05: allo scadere del turno, il server esegue d'ufficio un TURNO MINIMO
   * LEGALE per il giocatore attivo (la partita PROSEGUE):
   *  - se deve ancora pescare, pesca dal mazzo (o dallo scarto se il mazzo è vuoto);
   *  - poi scarta una carta deterministica (preferendo una NON matta, per non
   *    violare la regola dell'ultimo scarto), provando in ordine finché una è legale;
   *  - il motore fa avanzare il turno. Nessuna calata automatica.
   * Riusa i metodi validati del motore: nessuna scorciatoia sulle regole.
   */
  private autoPlayTurn(activeSeat: Seat): void {
    const e = this.engine;
    if (this.disposed || !e || e.status !== "playing" || e.currentSeat !== activeSeat) return;

    const effects: GameEffect[] = [];

    // 1) Pesca, se dovuta.
    if (e.phase === "must_draw") {
      let r = e.draw(activeSeat, "deck");
      if (!r.ok) r = e.draw(activeSeat, "discard"); // mazzo vuoto → dallo scarto
      if (r.ok) effects.push(...r.effects);
    }

    // 2) Scarta una carta deterministica, se siamo ancora nel turno.
    if (e.status === "playing" && e.currentSeat === activeSeat && e.phase === "may_meld") {
      const hand = e.handOf(activeSeat);
      // Ordine di preferenza: dall'ultima alla prima, prima le NON matte.
      const reversed = [...hand].reverse();
      const candidates = [
        ...reversed.filter((c) => !c.isWild),
        ...reversed.filter((c) => c.isWild),
      ];
      for (const c of candidates) {
        const r = e.discardCard(activeSeat, c.id);
        if (r.ok) {
          effects.push(...r.effects);
          break;
        }
      }
    }

    if (effects.length > 0) {
      this.applyEffects(effects);
      this.broadcastState(); // riarma il timer per il nuovo turno (se la partita prosegue)
      return;
    }

    // Stallo. Dopo la pesca d'ufficio (ramo `must_draw`) questo caso NON è
    // raggiungibile: la mano ha ≥2 carte e uno scarto ordinario è sempre legale.
    // Resta raggiungibile SOLO se il giocatore aveva già pescato e si è calato
    // fino a un'unica carta NON scartabile come ultimo scarto (una matta, oppure
    // una naturale senza pozzetto disponibile e senza burraco per chiudere): non
    // esiste alcuna mossa automatica legale.
    //
    // La skill-burraco non copre questo vicolo cieco. Per non congelare il turno
    // (né riarmare un timer a 0ms, che ciclerebbe) adottiamo una risoluzione
    // DETERMINISTICA: forfeit d'ufficio del seat in stallo → l'avversario vince
    // la partita, per la stessa via `game_ended` già usata (reason "forfeit").
    this.forfeitStalledSeat(activeSeat);
  }

  /**
   * NEW-3 / FORFAIT DI COPPIA (P4): chiusura deterministica per FORFAIT del posto
   * indicato. Due chiamanti, stessa semantica:
   *  - turno in STALLO irrisolvibile (auto-play senza mossa legale);
   *  - ABBANDONO in COPPIE (ITEM 1): disconnessione oltre la grazia a partita in
   *    corso (percorso `onDisconnect`).
   * A perdere è la SQUADRA del posto, non un singolo posto: la vincitrice è la
   * squadra AVVERSARIA (mai il compagno). Riusa il canale `game_ended` (reason
   * "forfeit") + `completeMatch`. Poi GC della room.
   *
   * In 1v1 (team = seat, due squadre) la squadra avversaria è `1 - stalledSeat`:
   * vincitore e totali coincidono ESATTAMENTE col comportamento precedente. In 2v2
   * (squadre 0+2 / 1+3) la vecchia logica `players.find(seat !== stalled)` avrebbe
   * potuto premiare il COMPAGNO dello stallato: qui la vittoria va sempre all'altra
   * squadra. Lo scope ammette solo tavoli a 2 squadre, quindi l'avversaria è l'unica
   * squadra diversa da quella dello stallato.
   */
  private forfeitStalledSeat(stalledSeat: Seat): void {
    if (this.disposed) return;
    const e = this.engine;
    const loserTeam = teamOfSeat(stalledSeat, this.config);
    const winnerTeam = this.opposingTeam(loserTeam);
    // Posto canonico della squadra vincitrice per l'audit/persistenza (in 1v1
    // coincide col posto vincitore, come prima).
    const winnerSeat = canonicalSeatForTeam(winnerTeam, this.config);
    if (e && e.status === "playing") {
      e.status = "game_ended";
      e.winnerTeam = winnerTeam;
      e.winnerSeat = winnerSeat;
      e.turnEndsAt = null;
      // C8: SQUADRA vincitrice + punteggi PER SQUADRA.
      this.broadcast({
        type: "game_ended",
        winnerTeam,
        finalScores: this.teamScoresNow(e.cumulative),
        reason: "forfeit",
      });
      // Decisione Gate 1: il forfeit da stallo dichiara un vincitore reale → conta
      // come 'completed' (preserva il comportamento pre-esistente). Persiste il
      // posto canonico (audit) e la SQUADRA vincitrice (autoritativa, P4).
      void persistence.completeMatch(this.matchId, winnerSeat, winnerTeam);
    }
    this.dispose();
  }

  /**
   * Squadra AVVERSARIA di `team` in un tavolo a due squadre (scope 2v2:
   * {2, individuale} e {4, coppie} hanno entrambe 2 squadre). In 1v1 team = seat →
   * `1 - team`, identico a prima; in 2v2 è l'altra coppia.
   */
  private opposingTeam(team: TeamId): TeamId {
    // Due sole squadre nello scope corrente: l'avversaria è l'altra.
    return teamCount(this.config) === 2 ? ((team === 0 ? 1 : 0) as TeamId) : team;
  }

  /* ─────────────────────────── broadcast/redaction ─────────────────────── */

  private broadcast(msg: ServerMessage): void {
    for (const p of this.players) send(p.ws, msg);
  }

  /** Invia a OGNI giocatore lo stato redatto dal suo punto di vista. */
  broadcastState(): void {
    if (!this.engine) return;
    for (const p of this.players) this.sendStateTo(p);
    // Ogni cambio di stato può cambiare il turno attivo: riarma l'enforcement.
    this.scheduleTurnTimer();
  }

  private sendStateTo(slot: PlayerSlot): void {
    if (!this.engine) return;
    send(slot.ws, { type: "state", state: redactFor(this.engine, slot.seat, this.seatMeta()) });
  }

  /**
   * Notifica un messaggio a TUTTI gli altri posti (C9/D-B): a N posti l'avversario
   * non è più unico. Usato per `player_disconnected/reconnected`, che devono
   * raggiungere l'intera room tranne il posto interessato.
   */
  private notifyOthers(seat: Seat, msg: ServerMessage): void {
    for (const p of this.players) {
      if (p.seat !== seat) send(p.ws, msg);
    }
  }

  /**
   * Proiezione per SQUADRA dei cumulati per il CONTRATTO (C4/C6/C8). Usa l'array
   * autoritativo del motore (`engine.cumulative`), ripiegando sul per-seat passato
   * dall'effetto se il motore non è più presente. In 1v1 (team = seat) restituisce
   * `[cumulative[0], cumulative[1]]` — valori invariati.
   */
  private teamScoresNow(fallbackPerSeat: readonly number[]): number[] {
    return teamScores(this.engine ? this.engine.cumulative : fallbackPerSeat, this.config);
  }

  private logEvent(type: string, actorSeat: Seat, payload: unknown): void {
    void persistence.logEvent(this.matchId, this.handId, ++this.eventSeq, type, actorSeat, payload);
  }

  /** Stato pieno server-side per il checkpoint (MAI inviato ai client). */
  private snapshot(): unknown {
    const e = this.engine;
    if (!e) return {};
    return {
      handNumber: e.handNumber,
      dealerSeat: e.dealerSeat,
      currentSeat: e.currentSeat,
      phase: e.phase,
      cumulative: e.cumulative,
      melds: e.melds,
      discardCount: e.discard.length,
      drawPileCount: e.drawPile.length,
      pozzettiRemaining: e.pozzetti.length,
      // N posti: una mano per posto (in 1v1 resta [hand0, hand1]).
      hands: e.seats.map((_, i) => e.handOf(i as Seat)),
      status: e.status,
    };
  }
}
