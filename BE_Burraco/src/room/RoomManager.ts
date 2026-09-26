import { randomInt } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  ClientMessage,
  GameConfig,
  ServerMessage,
  WaitingTableView,
} from "../contract/types.js";
import { defaultGameConfig, env } from "../config.js";
import { Room, type RoomOptions } from "./Room.js";
import type { AuthService } from "../auth/service.js";

/**
 * Orchestratore in-RAM di tutte le room attive (v1 single-instance).
 * Mappa i socket alla loro room e instrada join/messaggi/disconnessioni.
 *
 * Macro-ciclo 1 — Auth: quando `authService` è presente e `requireAuth` è true,
 * l'ingresso (`join_room`/`open_table`/`quick_match`) è gated su un authToken
 * VALIDO (SEC-08): senza principale risolto non si occupa alcun posto. Il
 * `display_name` usato è quello AUTORITATIVO del principale (mai il displayName
 * arbitrario del client). Se `requireAuth` è false (dev/test), vale il
 * comportamento legacy col displayName del client.
 *
 * LOBBY (macro-ciclo lobby): aggiunge le porte "Apri un tavolo" (open_table) e
 * "Gioca subito" (quick_match), la lista dei tavoli pubblici in attesa, il
 * registro di presenza in lobby e la chiusura pulita del tavolo in attesa.
 * Invariante di ATOMICITÀ: l'identità si risolve (await) PRIMA, poi la ricerca +
 * creazione/seduta è un BLOCCO SINCRONO senza `await` interposti (§5.4).
 */

/** Alfabeto senza ambiguità per i codici tavolo (esclusi I, L, O, 0, 1). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Lunghezza del codice generato dal server (decisione lead #4). */
const CODE_LENGTH = 5;

/** Identità risolta dal token (mai dal displayName del client). */
interface Identity {
  name: string;
  userId: string | null;
  clientId?: string;
  playerToken?: string;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket in chiusura */
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketRoom = new WeakMap<WebSocket, Room>();
  /**
   * LOBBY: al più UN tavolo in ATTESA per sessione (anti tavoli-fantasma,
   * idempotenza §6.1). Chiave = identità stabile (userId, altrimenti clientId).
   * Ripulito in modo lazy: una entry che punta a una room smaltita o non più in
   * attesa viene scartata all'accesso.
   */
  private waitingBySession = new Map<string, Room>();
  /**
   * LOBBY (§6.2): presenza in lobby = ultimo `GET /tables` per sessione. Il conteggio
   * esclude chi è seduto (waiting/playing). Chiave = userId del principale.
   */
  private lobbyPresence = new Map<string, number>();
  private readonly authService: AuthService | undefined;
  private readonly requireAuth: boolean;

  constructor(opts?: { authService?: AuthService; requireAuth?: boolean }) {
    this.authService = opts?.authService;
    this.requireAuth = opts?.requireAuth ?? false;
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase().slice(0, 12);
  }

  /**
   * Crea una Room registrandone l'hook di GC (rimozione dalla mappa quando si
   * conclude) e inserendola nella mappa. Unico punto di creazione.
   */
  private makeRoom(code: string, config: GameConfig, opts?: RoomOptions): Room {
    const room = new Room(code, config, opts);
    room.onDispose = () => {
      if (this.rooms.get(code) === room) this.rooms.delete(code);
    };
    this.rooms.set(code, room);
    return room;
  }

  private getOrCreate(code: string, config: GameConfig): Room {
    const room = this.rooms.get(code);
    // Se la room esiste ma è già stata smaltita (conclusa/abbandonata), la si
    // sostituisce con una nuova: nessun aggancio a una room morta. Il codice
    // sconosciuto/legacy nasce come tavolo PRIVATO manuale (semantica join_room:
    // reperibile solo col codice, mai in lista, mai fuso).
    if (!room || room.isDisposed()) return this.makeRoom(code, config);
    return room;
  }

  /**
   * MODALITÀ (Tappa 3a): costruisce la config di una NUOVA room dai campi scelti nel
   * messaggio (open_table/quick_match), VALIDANDO la combinazione. Ammesse SOLO
   * {2, individuale} e {4, coppie}; ogni altra combinazione (inclusi campi assenti o
   * incoerenti come {4, individuale} o {2, coppie}) è NORMALIZZATA al 1v1 di default.
   * Il resto della config (`punteggioObiettivo`, varianti, timeout) resta quello di
   * `defaultGameConfig()`. Non rifiuta il messaggio: normalizza in modo sicuro.
   */
  private configForMode(numeroGiocatori?: number, modalita?: string): GameConfig {
    const base = defaultGameConfig();
    if (numeroGiocatori === 4 && modalita === "coppie") {
      return { ...base, numeroGiocatori: 4, modalita: "coppie" };
    }
    return base; // {2, individuale} (default / normalizzazione delle combinazioni non ammesse)
  }

  /**
   * FIRMA di fusione (Tappa 3a): dimensione + modalità del tavolo. La seduta e la
   * fusione quick_match avvengono SOLO fra tavoli con la stessa firma (un 2v2 non
   * entra in un 1v1 e viceversa).
   */
  private mergeSignature(room: Room): string {
    return `${room.seatsTotal()}:${room.config.modalita}`;
  }

  /** Numero di room attive in memoria (per test/diagnostica GC). */
  activeRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * R2a (SEC-LOBBY-03): tetto GLOBALE al numero di room. Vero quando la mappa ha
   * raggiunto `env.maxRooms`: da controllare PRIMA di creare un nuovo tavolo, mai
   * prima di sedersi/riconnettersi a una room esistente (che non fa crescere la mappa).
   */
  private atRoomCapacity(): boolean {
    // Letto a runtime (come le grace in Room) così i test possono abbassare la
    // soglia via process.env; default da env.maxRooms.
    const max = Number(process.env.MAX_ROOMS ?? env.maxRooms);
    return this.rooms.size >= max;
  }

  /** R2a: rifiuto leggibile quando il tetto globale di room è raggiunto. */
  private rejectAtCapacity(ws: WebSocket): void {
    send(ws, {
      type: "error",
      message: "Il server ha troppi tavoli attivi in questo momento: riprova tra poco.",
    });
  }

  /** Room per codice normalizzato (o undefined). Non crea nulla. */
  findByCode(code: string): Room | undefined {
    const room = this.rooms.get(this.normalizeCode(code));
    return room && !room.isDisposed() ? room : undefined;
  }

  /**
   * Genera un codice tavolo LIBERO: 5 caratteri dall'alfabeto senza ambiguità.
   * Estrae, verifica che non sia in uso, riprova (poche iterazioni: spazio ≈ 31⁵).
   */
  generateFreeCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    // Fallback estremamente improbabile: allunga il codice finché è libero.
    let code = "";
    do {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    } while (this.rooms.has(code));
    return code;
  }

  /* ─────────────────────────── LOBBY: lista & presenza ────────────────────── */

  /** Chiave di sessione stabile: userId (dal token) o, in dev, clientId. */
  private sessionKey(id: Identity): string | null {
    return id.userId ?? id.clientId ?? null;
  }

  /** Tavolo in ATTESA attualmente posseduto dalla sessione (o undefined). Prune lazy. */
  private waitingForSession(key: string | null): Room | undefined {
    if (!key) return undefined;
    const room = this.waitingBySession.get(key);
    if (room && !room.isDisposed() && room.isWaiting()) return room;
    if (room) this.waitingBySession.delete(key);
    return undefined;
  }

  private registerWaiting(key: string | null, room: Room): void {
    if (key) this.waitingBySession.set(key, room);
  }

  /**
   * LOBBY (§6.2): registra un heartbeat di presenza per una sessione in lobby.
   * Chiamato dalla rotta HTTP `GET /tables`.
   */
  touchLobby(userId: string): void {
    this.lobbyPresence.set(userId, Date.now());
  }

  /**
   * LOBBY (§6.2): conteggio delle sessioni realmente in lobby = poll recente
   * (entro il TTL) e NON sedute. Esclude i creatori di un tavolo in attesa; chi
   * sta giocando smette di fare polling e cade dal conteggio per TTL. Prune lazy
   * delle entry scadute a ogni chiamata.
   */
  lobbyPlayerCount(): number {
    const now = Date.now();
    const ttl = env.lobbyPresenceTtlMs;
    // Insieme delle sessioni sedute a un tavolo in attesa (da escludere).
    const seated = new Set<string>();
    for (const [key, room] of this.waitingBySession) {
      if (!room.isDisposed() && room.isWaiting()) seated.add(key);
    }
    let count = 0;
    for (const [key, lastSeen] of this.lobbyPresence) {
      if (lastSeen < now - ttl) {
        this.lobbyPresence.delete(key);
        continue;
      }
      if (!seated.has(key)) count += 1;
    }
    return count;
  }

  /**
   * Audit lancio R02 (Ciclo 3) — presenze AGGREGATE per la vetrina pubblica: chi è
   * in lobby più chi è seduto con un socket vivo (in attesa o in partita). Solo
   * conteggi: nessun nome, codice o identità esce da qui.
   */
  presenceSummary(): { playersOnline: number; waitingTables: number } {
    let seated = 0;
    for (const room of this.rooms.values()) {
      if (!room.isDisposed()) seated += room.seatsTakenLive();
    }
    return {
      playersOnline: this.lobbyPlayerCount() + seated,
      waitingTables: this.listPublicWaitingTables().length,
    };
  }

  /**
   * LOBBY (§6.1): lista dei tavoli PUBBLICI in attesa con almeno un posto vivo.
   * WHITELIST rigorosa (Room.waitingView): nessun privato, nessun campo interno.
   */
  listPublicWaitingTables(): WaitingTableView[] {
    const out: WaitingTableView[] = [];
    for (const room of this.rooms.values()) {
      const view = room.waitingView();
      if (view) out.push(view);
    }
    // Ordine stabile: i più vecchi in cima (coerente con "attende da di più").
    out.sort((a, b) => a.openedAt - b.openedAt);
    return out;
  }

  /**
   * LOBBY (§5.4-B): chiusura PULITA del tavolo in attesa della sessione (beacon
   * `POST /session/leave`). Dispose immediato → sparizione dalla lista prima dei
   * 60s di grazia. Idempotente. `key` = userId del principale.
   */
  leaveWaiting(key: string): void {
    const room = this.waitingForSession(key);
    if (room) {
      room.leaveWaiting();
      this.waitingBySession.delete(key);
    }
    // La sessione ha lasciato la lobby: rimuovila anche dalla presenza.
    this.lobbyPresence.delete(key);
  }

  /* ─────────────────────────── risoluzione identità ───────────────────────── */

  /**
   * true quando l'identità richiede una risoluzione ASINCRONA del token (gating
   * attivo, oppure authToken presente da risolvere). Quando è false NON si deve
   * introdurre alcun `await`: il percorso resta SINCRONO (necessario per
   * l'atomicità del posto e per i test deterministici che creano la room e la
   * verificano nello stesso tick).
   */
  private needsAsyncAuth(msg: { authToken?: string }): boolean {
    if (this.requireAuth && this.authService) return true;
    if (this.authService && msg.authToken) return true;
    return false;
  }

  /** Identità SINCRONA (dev/test o gating off senza token): dal displayName del client. */
  private syncIdentity(msg: {
    displayName?: string;
    clientId?: string;
    playerToken?: string;
  }): Identity {
    return {
      name: msg.displayName ?? "",
      userId: null,
      clientId: msg.clientId,
      playerToken: msg.playerToken,
    };
  }

  /**
   * Risolve l'identità AUTORITATIVA dal token (mai dal displayName del client).
   * Con gating attivo, l'assenza/invalidità del token produce join_rejected e
   * ritorna null. Usata SOLO quando `needsAsyncAuth` è true.
   */
  private async asyncIdentity(
    ws: WebSocket,
    msg: {
      displayName?: string;
      authToken?: string;
      clientId?: string;
      playerToken?: string;
    },
  ): Promise<Identity | null> {
    let name = msg.displayName ?? "";
    let userId: string | null = null;
    if (this.requireAuth && this.authService) {
      if (!msg.authToken) {
        send(ws, {
          type: "join_rejected",
          code: "AUTH_REQUIRED",
          reason: "Devi accedere prima di entrare in un tavolo.",
        });
        return null;
      }
      const principal = await this.authService.getPrincipalByToken(msg.authToken);
      if (!principal) {
        send(ws, {
          type: "join_rejected",
          code: "AUTH_INVALID",
          reason: "Sessione non valida o scaduta: accedi di nuovo.",
        });
        return null;
      }
      name = principal.displayName;
      userId = principal.userId;
    } else if (this.authService && msg.authToken) {
      const principal = await this.authService.getPrincipalByToken(msg.authToken);
      if (principal) {
        name = principal.displayName;
        userId = principal.userId;
      }
    }
    return { name, userId, clientId: msg.clientId, playerToken: msg.playerToken };
  }

  /* ─────────────────────────── porte d'ingresso ───────────────────────────── */

  /**
   * Dispatcher che preserva l'ATOMICITÀ: se serve risolvere il token, aspetta la
   * risoluzione (await) e SOLO DOPO esegue il blocco sincrono `run`; se non serve
   * (dev/gating off), esegue tutto SINCRONO nello stesso tick. In entrambi i casi
   * il blocco `run` non contiene alcun `await` interposto tra ricerca e seduta.
   */
  private withIdentity(
    ws: WebSocket,
    msg: { authToken?: string; displayName?: string; clientId?: string; playerToken?: string },
    run: (id: Identity) => void,
  ): void {
    if (!this.needsAsyncAuth(msg)) {
      run(this.syncIdentity(msg));
      return;
    }
    void this.asyncIdentity(ws, msg)
      .then((id) => {
        if (id) run(id);
      })
      .catch((err) => this.onAsyncError(ws, err));
  }

  /**
   * Door (c) — `join_room`. Codice sconosciuto → nuovo tavolo PRIVATO manuale
   * (legacy). Il blocco sincrono crea/siede senza `await` interposti.
   */
  private handleJoin(ws: WebSocket, msg: Extract<ClientMessage, { type: "join_room" }>): void {
    const code = this.normalizeCode(msg.roomCode);
    if (!code) {
      send(ws, { type: "error", message: "Codice room mancante." });
      return;
    }
    this.withIdentity(ws, msg, (id) => {
      // R1b (SEC-LOBBY-02): un socket appartiene a UNA sola room viva. Un secondo
      // `join_room` sullo stesso socket con un codice diverso creerebbe una nuova
      // room privata e lascerebbe la precedente ORFANA (handleClose smaltisce solo
      // l'ultima room mappata → leak permanente). Se il socket è già in una room
      // NON smaltita, ignoriamo il nuovo join. La guardia esclude le room già
      // smaltite (partita conclusa) così un socket riusato non resta bloccato — il
      // client reale apre comunque sempre un NUOVO socket per join/riconnessione.
      const prev = this.socketRoom.get(ws);
      if (prev && !prev.isDisposed()) return;
      const existing = this.rooms.get(code);
      // Audit lancio R04: RICONNESSIONE a un tavolo che non esiste più (riavvio o
      // deploy del server: lo stato vive solo in RAM). Prima si creava in silenzio un
      // tavolo NUOVO col vecchio codice (1v1 di default) e i primi due che rientravano
      // ricominciavano da zero; ora il client riceve un esito terminale chiaro.
      if (msg.resume === true && (!existing || existing.isDisposed())) {
        console.log(`[room] lost room=${code} at=${new Date().toISOString()}`);
        send(ws, { type: "room_closed", reason: "lost" });
        return;
      }
      // R2a: non creare oltre il tetto globale (solo se il codice porterebbe a una
      // NUOVA room; la riconnessione a una room esistente resta sempre ammessa).
      if ((!existing || existing.isDisposed()) && this.atRoomCapacity()) {
        this.rejectAtCapacity(ws);
        return;
      }
      const room = this.getOrCreate(code, defaultGameConfig());
      this.socketRoom.set(ws, room);
      room.join(ws, id.playerToken, id.name, id.clientId, id.userId);
    });
  }

  /**
   * Door (a) — `open_table`. Crea un tavolo in attesa con il codice scelto
   * dall'utente. Codice già in uso → open_rejected{CODE_IN_USE} (nessun takeover).
   */
  private handleOpenTable(ws: WebSocket, msg: Extract<ClientMessage, { type: "open_table" }>): void {
    this.withIdentity(ws, msg, (id) => {
      if (this.socketRoom.has(ws)) return; // socket già in una room (resend)
      // R1a (SEC-LOBBY-01): tetto "1 tavolo in attesa per sessione" (§6.1), come già
      // fa quick_match. Se la sessione ha GIÀ un tavolo in attesa, ci si riaggancia
      // (reclaim del proprio posto) invece di crearne un secondo — impedisce a una
      // singola identità di creare N tavoli pubblici aprendo N socket.
      const own = this.waitingForSession(this.sessionKey(id));
      if (own) {
        this.socketRoom.set(ws, own);
        own.join(ws, id.playerToken, id.name, id.clientId, id.userId);
        return;
      }
      const code = this.normalizeCode(msg.code) || this.generateFreeCode();
      const existing = this.rooms.get(code);
      if (existing && !existing.isDisposed()) {
        send(ws, { type: "open_rejected", code: "CODE_IN_USE" });
        return;
      }
      // R2a: rispetta il tetto globale prima di creare un nuovo tavolo.
      if (this.atRoomCapacity()) {
        this.rejectAtCapacity(ws);
        return;
      }
      // Tappa 3a: config-driven. La room nasce con la MODALITÀ scelta e validata
      // ({2,individuale} | {4,coppie}); default 1v1 se i campi sono assenti/incoerenti.
      const room = this.makeRoom(code, this.configForMode(msg.numeroGiocatori, msg.modalita), {
        visibility: msg.private ? "privato" : "pubblico",
        origin: "apertura_manuale",
      });
      this.socketRoom.set(ws, room);
      this.registerWaiting(this.sessionKey(id), room);
      room.join(ws, id.playerToken, id.name, id.clientId, id.userId);
    });
  }

  /**
   * Door (b) — `quick_match`. Decisione tutta server-side: siede sul tavolo
   * pubblico quick_match più vecchio in attesa, oppure ne crea uno e tenta la
   * fusione (§5.4-A). Idempotente: se la sessione ha già un tavolo in attesa, vi
   * si riaggancia invece di crearne un secondo.
   */
  private handleQuickMatch(ws: WebSocket, msg: Extract<ClientMessage, { type: "quick_match" }>): void {
    this.withIdentity(ws, msg, (id) => {
      if (this.socketRoom.has(ws)) return;
      const key = this.sessionKey(id);
      // Tappa 3a: firma richiesta (dimensione + modalità), validata e normalizzata.
      const wanted = this.configForMode(msg.numeroGiocatori, msg.modalita);

      // Idempotenza: la sessione ha già un tavolo in attesa → riaggancia il socket
      // (reclaim del proprio posto se il vecchio socket è morto). NB: si riaggancia
      // al PROPRIO tavolo qualunque ne sia la modalità (idempotenza del posto).
      const own = this.waitingForSession(key);
      if (own) {
        this.socketRoom.set(ws, own);
        own.join(ws, id.playerToken, id.name, id.clientId, id.userId);
        return;
      }

      // Cerca il candidato pubblico quick_match più vecchio con posto libero E DELLA
      // STESSA FIRMA (modalità/dimensione): un 2v2 non si siede su un tavolo 1v1.
      const candidate = this.findQuickMatchCandidate(wanted);
      if (candidate) {
        this.socketRoom.set(ws, candidate);
        candidate.join(ws, id.playerToken, id.name, id.clientId, id.userId); // → siede; avvia a tavolo pieno
        return;
      }

      // Nessun candidato: crea un nuovo tavolo pubblico quick_match della firma scelta.
      // R2a: rispetta il tetto globale prima di creare.
      if (this.atRoomCapacity()) {
        this.rejectAtCapacity(ws);
        return;
      }
      const code = this.generateFreeCode();
      const room = this.makeRoom(code, wanted, {
        visibility: "pubblico",
        origin: "quick_match",
      });
      this.socketRoom.set(ws, room);
      this.registerWaiting(key, room);
      room.join(ws, id.playerToken, id.name, id.clientId, id.userId);
      // Rete di sicurezza deterministica contro la simmetria (§5.4-A): fonde solo
      // tavoli della stessa firma.
      this.mergeQuickMatchTables();
    });
  }

  /**
   * Candidato quick_match più vecchio (openedAt minimo) con posto libero e della
   * STESSA FIRMA (dimensione + modalità) del tavolo richiesto. In 1v1 la firma è
   * `2:individuale`: la selezione coincide col comportamento precedente.
   */
  private findQuickMatchCandidate(wanted: GameConfig): Room | undefined {
    const wantedSig = `${wanted.numeroGiocatori}:${wanted.modalita}`;
    let best: Room | undefined;
    for (const room of this.rooms.values()) {
      if (!room.isMergeableQuickMatch()) continue;
      if (this.mergeSignature(room) !== wantedSig) continue;
      if (!best || room.openedAt < best.openedAt) best = room;
    }
    return best;
  }

  /**
   * LOBBY (§5.4-A) — FUSIONE deterministica dei tavoli pubblici quick_match con un
   * solo posto vivo. Sposta l'occupante del tavolo PIÙ RECENTE dentro il PIÙ
   * VECCHIO (ordinamento per openedAt → nessun ping-pong), poi distrugge quello
   * svuotato. Tutto SINCRONO (nessun await): due fusioni non si interfoliano.
   * Tocca SOLO tavoli pubblici quick_match (mai privati né apertura_manuale).
   */
  mergeQuickMatchTables(): void {
    // Ripete finché resta una fusione eseguibile. Ogni iterazione consolida UN
    // tavolo sorgente nel più vecchio della sua FIRMA, poi ricomincia sullo stato
    // aggiornato. Termina perché ogni fusione riuscita smaltisce una sorgente.
    for (;;) {
      // Raggruppa i tavoli fondibili per firma (dimensione + modalità): un 2v2 non
      // si fonde mai con un 1v1.
      const groups = new Map<string, Room[]>();
      for (const r of this.rooms.values()) {
        if (!r.isMergeableQuickMatch()) continue;
        const sig = this.mergeSignature(r);
        let arr = groups.get(sig);
        if (!arr) {
          arr = [];
          groups.set(sig, arr);
        }
        arr.push(r);
      }

      let progressed = false;
      for (const list of groups.values()) {
        if (list.length < 2) continue;
        list.sort((a, b) => a.openedAt - b.openedAt);
        const target = list[0]!; // il più vecchio della firma
        const source = list[list.length - 1]!; // il più recente
        const movers = source.liveSeatIdentities();
        const free = target.seatsTotal() - target.seatsTakenLive();
        // Fonde SOLO se l'intera sorgente entra nel target: nessun giocatore viene
        // mai lasciato indietro/scartato (in 1v1 la sorgente ha 1 posto e il target
        // ha 1 posto libero → sempre fondibile, comportamento invariato).
        if (movers.length === 0 || movers.length > free) continue;

        for (const m of movers) {
          // Prima l'evento esplicativo, poi la seduta nel tavolo di destinazione.
          send(m.ws, { type: "room_merged", newCode: target.code });
          this.socketRoom.set(m.ws, target);
          target.join(m.ws, undefined, m.name, m.clientId, m.userId);
        }
        // La sorgente è stata interamente svuotata: dispose (sparisce dalla lista).
        source.leaveWaiting();
        progressed = true;
        break; // rifai da capo sullo stato aggiornato
      }

      if (!progressed) return;
    }
  }

  /* ─────────────────────────── routing dei messaggi ───────────────────────── */

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    if (msg.type === "join_room") {
      this.handleJoin(ws, msg);
      return;
    }
    if (msg.type === "open_table") {
      this.handleOpenTable(ws, msg);
      return;
    }
    if (msg.type === "quick_match") {
      this.handleQuickMatch(ws, msg);
      return;
    }
    const room = this.socketRoom.get(ws);
    if (!room) {
      send(ws, { type: "error", message: "Non sei in nessuna room. Invia join_room." });
      return;
    }
    room.onMessage(ws, msg);
  }

  private onAsyncError(ws: WebSocket, err: unknown): void {
    console.error("[ws] errore ingresso:", (err as Error).message);
    send(ws, { type: "error", message: "Errore interno durante l'ingresso." });
  }

  handleClose(ws: WebSocket): void {
    const room = this.socketRoom.get(ws);
    if (!room) return;
    room.onDisconnect(ws);
    this.socketRoom.delete(ws);
    // La room resta in memoria durante la finestra di grazia per la riconnessione
    // (token o clientId); alla scadenza si auto-rimuove tramite l'hook onDispose.
  }
}
