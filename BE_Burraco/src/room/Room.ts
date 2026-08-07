import { randomUUID, createHash } from "node:crypto";
import { WebSocket } from "ws";
import type {
  ClientMessage,
  ConnectionStatus,
  GameConfig,
  PlayerPublic,
  Seat,
  ServerMessage,
} from "../contract/types.js";
import { GameEngine, type GameEffect, type MoveResult } from "../engine/game.js";
import { redactFor } from "./redact.js";
import { persistence } from "../db/persistence.js";

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

  private players: PlayerSlot[] = [];
  private engine: GameEngine | null = null;
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

  constructor(code: string, config: GameConfig) {
    this.code = code;
    this.config = config;
    this.matchId = randomUUID();
  }

  isFull(): boolean {
    return this.players.length >= 2;
  }

  hasEngine(): boolean {
    return this.engine !== null;
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
    }));
  }

  /**
   * Ingresso o riconnessione. Se il token corrisponde a un giocatore esistente
   * → rebind del socket e invio dello stato corrente (riconnessione). Altrimenti
   * assegna un nuovo seat, se disponibile.
   */
  join(ws: WebSocket, token: string | undefined, displayName: string): void {
    if (this.disposed) {
      send(ws, { type: "error", message: "La partita è conclusa." });
      return;
    }

    // Riconnessione per token. Il token è accettato se coincide con quello
    // CORRENTE oppure con il PRECEDENTE ancora entro il TTL (NEW-1).
    if (token) {
      const existing = this.players.find((p) => this.tokenMatches(p, token));
      if (existing) {
        // SEC-04: takeover di sessione ATTIVA vietato. Si rebinda SOLO se lo
        // slot è disconnesso; se il socket è ancora vivo, si rifiuta il secondo
        // ingresso e NON si tocca la connessione legittima. Il controllo vale
        // anche per il token PRECEDENTE: finché il legittimo è connesso, nessun
        // token (corrente o precedente) dà accesso.
        if (existing.status === "connected" && existing.ws && existing.ws.readyState === WebSocket.OPEN) {
          send(ws, { type: "error", message: "Sessione già attiva su un'altra connessione." });
          try {
            ws.close(1008, "Sessione già attiva.");
          } catch {
            /* socket già in chiusura */
          }
          return;
        }

        // Riconnessione legittima (slot disconnesso): rebind + rotazione token.
        if (existing.graceTimer) {
          clearTimeout(existing.graceTimer);
          existing.graceTimer = null;
        }
        existing.ws = ws;
        existing.status = "connected";
        // SEC-10 + NEW-1: ruota il token a ogni riconnessione, MA tieni valido
        // ANCORA il token appena presentato (come `prevToken`) entro un breve
        // TTL. Così, se `room_joined{yourToken}` va perso e il client riprova
        // con il token vecchio, viene comunque riconosciuto e riammesso. Il
        // token vecchio muore alla PRIMA azione valida sul nuovo socket
        // (commit, vedi onMessage) o allo scadere del TTL: non resta
        // rigiocabile a lungo (SEC-10 sostanzialmente preservato).
        const rotated = randomUUID();
        existing.prevToken = token; // il token appena presentato dal client
        existing.prevTokenExpiry = Date.now() + this.rotationTtlMs();
        existing.token = rotated;
        existing.tokenHash = sha256(rotated);
        send(ws, {
          type: "room_joined",
          yourSeat: existing.seat,
          yourToken: rotated,
          players: this.publicPlayers(),
          config: this.config,
          resumed: true, // riconnessione a sessione esistente
        });
        this.notifyOpponent(existing.seat, { type: "opponent_reconnected", seat: existing.seat });
        this.sendStateTo(existing);
        return;
      }
      // Token non riconosciuto (né corrente né precedente-entro-TTL): si prosegue
      // come nuovo ingresso; se la room è piena verrà rifiutato sotto.
    }

    if (this.isFull()) {
      send(ws, { type: "error", message: "La room è al completo." });
      return;
    }

    const seat = this.players.length as Seat;
    const newToken = randomUUID();
    const slot: PlayerSlot = {
      seat,
      displayName: displayName.slice(0, 40) || `Giocatore ${seat + 1}`,
      token: newToken,
      tokenHash: sha256(newToken),
      prevToken: null,
      prevTokenExpiry: null,
      ws,
      status: "connected",
      graceTimer: null,
    };
    this.players.push(slot);

    send(ws, {
      type: "room_joined",
      yourSeat: seat,
      yourToken: newToken,
      players: this.publicPlayers(),
      config: this.config,
      resumed: false, // primo ingresso
    });

    // A7: nessun room_joined ridondante. Il giocatore appena entrato ha già il
    // suo. Quando la room si completa, aggiorniamo il roster del PRIMO giocatore
    // (una sola volta) e avviamo la partita. In attesa dell'avversario, invece,
    // non c'è nessun altro da aggiornare: niente broadcast superfluo.
    if (this.players.length === 2 && !this.engine) {
      const first = this.players.find((p) => p.seat !== seat);
      if (first) {
        send(first.ws, {
          type: "room_joined",
          yourSeat: first.seat,
          yourToken: first.token, // token invariato: non è una riconnessione
          players: this.publicPlayers(),
          config: this.config,
          resumed: false,
        });
      }
      this.startMatch();
    }
  }

  private startMatch(): void {
    const firstDealer: Seat = Math.random() < 0.5 ? 0 : 1; // A6: mazziere a caso
    this.engine = new GameEngine(this.config, firstDealer);

    // Persistenza best-effort (checkpoint/audit): match, players, hand 1.
    this.handId = randomUUID();
    void persistence.createMatch(this.matchId, this.config);
    void persistence.addPlayers(
      this.matchId,
      this.players.map((p) => ({ seat: p.seat, displayName: p.displayName, tokenHash: p.tokenHash })),
    );
    void persistence.startHand(this.matchId, this.handId, this.engine.handNumber, this.engine.dealerSeat);

    // A7: il roster è già stato inviato in `join`. Qui basta lo stato iniziale
    // (che riarma anche il turn timer) e l'evento di turno.
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
    // NEW-1: qualunque messaggio valido su questo socket conferma la ricezione
    // del token corrente (incluso l'heartbeat periodico del client) → scarta il
    // token precedente. Chiude la finestra di replay del vecchio token (SEC-10).
    this.commitToken(slot);
    if (msg.type === "heartbeat") return; // liveness gestita a livello ws

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
      case "pinella_substitute":
        result = this.engine.pinellaSubstitute(seat, msg.meldId, msg.cardInHand);
        break;
      case "discard":
        result = this.engine.discardCard(seat, msg.card);
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
          cumulative: eff.cumulative,
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
          winnerSeat: eff.winnerSeat,
          finalScores: eff.finalScores,
        });
        void persistence.endMatch(this.matchId, eff.winnerSeat);
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
    this.notifyOpponent(slot.seat, { type: "opponent_disconnected", seat: slot.seat });

    // SEC-05: alla SCADENZA della grazia, il disconnesso abbandona.
    if (slot.graceTimer) clearTimeout(slot.graceTimer);
    slot.graceTimer = setTimeout(() => {
      slot.graceTimer = null;
      if (this.disposed) return;
      // Riconnesso nel frattempo? Nessun forfeit.
      if (slot.status === "connected") return;
      // Entrambi disconnessi → room abbandonata: GC senza vincitore.
      if (this.isEmpty()) {
        this.dispose();
        return;
      }
      // Avversario ancora presente → FORFEIT del disconnesso.
      this.forfeit(slot.seat);
    }, this.reconnectGraceMs());
    slot.graceTimer.unref?.();
  }

  /**
   * SEC-05: forfeit del giocatore disconnesso. In 2 giocatori l'avversario
   * connesso è dichiarato vincitore con motivazione di abbandono. Poi GC.
   */
  private forfeit(disconnectedSeat: Seat): void {
    if (this.disposed) return;
    const opp = this.players.find((p) => p.seat !== disconnectedSeat);
    if (this.engine && this.engine.status === "playing" && opp && opp.status === "connected") {
      this.engine.status = "game_ended";
      this.engine.winnerSeat = opp.seat;
      this.engine.turnEndsAt = null;
      const finalScores: [number, number] = [this.engine.cumulative[0], this.engine.cumulative[1]];
      this.broadcast({ type: "game_ended", winnerSeat: opp.seat, finalScores, reason: "forfeit" });
      void persistence.endMatch(this.matchId, opp.seat);
    }
    this.dispose();
  }

  private reconnectGraceMs(): number {
    return Number(process.env.RECONNECT_GRACE_MS ?? 120_000);
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
   * NEW-3: chiusura deterministica di un turno in stallo irrisolvibile: il seat
   * in stallo perde d'ufficio, l'avversario è dichiarato vincitore della
   * partita. Riusa il canale `game_ended` (reason "forfeit"). Poi GC della room.
   */
  private forfeitStalledSeat(stalledSeat: Seat): void {
    if (this.disposed) return;
    const e = this.engine;
    const opp = this.players.find((p) => p.seat !== stalledSeat);
    const winnerSeat = (opp ? opp.seat : (1 - stalledSeat)) as Seat;
    if (e && e.status === "playing") {
      e.status = "game_ended";
      e.winnerSeat = winnerSeat;
      e.turnEndsAt = null;
      const finalScores: [number, number] = [e.cumulative[0], e.cumulative[1]];
      this.broadcast({ type: "game_ended", winnerSeat, finalScores, reason: "forfeit" });
      void persistence.endMatch(this.matchId, winnerSeat);
    }
    this.dispose();
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
    send(slot.ws, { type: "state", state: redactFor(this.engine, slot.seat) });
  }

  private notifyOpponent(seat: Seat, msg: ServerMessage): void {
    const opp = this.players.find((p) => p.seat !== seat);
    if (opp) send(opp.ws, msg);
  }

  private logEvent(type: string, actorSeat: Seat, payload: unknown): void {
    void persistence.logEvent(this.matchId, this.handId, ++this.eventSeq, type, actorSeat, payload);
  }

  /** Stato pieno server-side per il checkpoint (MAI inviato ai client). */
  private snapshot(): unknown {
    if (!this.engine) return {};
    return {
      handNumber: this.engine.handNumber,
      dealerSeat: this.engine.dealerSeat,
      currentSeat: this.engine.currentSeat,
      phase: this.engine.phase,
      cumulative: this.engine.cumulative,
      melds: this.engine.melds,
      discardCount: this.engine.discard.length,
      drawPileCount: this.engine.drawPile.length,
      pozzettiRemaining: this.engine.pozzetti.length,
      hands: [this.engine.handOf(0), this.engine.handOf(1)],
      status: this.engine.status,
    };
  }
}
