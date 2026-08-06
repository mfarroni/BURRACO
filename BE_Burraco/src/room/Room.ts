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
  token: string; // token effimero (in chiaro solo in RAM)
  tokenHash: string;
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
    // Riconnessione per token.
    if (token) {
      const existing = this.players.find((p) => p.token === token);
      if (existing) {
        if (existing.graceTimer) {
          clearTimeout(existing.graceTimer);
          existing.graceTimer = null;
        }
        existing.ws = ws;
        existing.status = "connected";
        send(ws, {
          type: "room_joined",
          yourSeat: existing.seat,
          yourToken: existing.token,
          players: this.publicPlayers(),
          config: this.config,
        });
        this.notifyOpponent(existing.seat, { type: "opponent_reconnected", seat: existing.seat });
        this.sendStateTo(existing);
        return;
      }
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
    });

    // Quando entrambi i seat sono occupati, avvia la partita.
    if (this.players.length === 2 && !this.engine) {
      this.startMatch();
    } else {
      // In attesa dell'avversario: aggiorna comunque il primo giocatore.
      this.broadcastPlayers();
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

    this.broadcastPlayers();
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
    if (msg.type === "heartbeat") return; // liveness gestita a livello ws

    if (!this.engine) {
      send(ws, { type: "move_rejected", code: "GAME_NOT_ACTIVE", reason: "In attesa dell'avversario." });
      return;
    }

    const seat = slot.seat;
    this.logEvent(msg.type, seat, msg);

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
      send(slot.ws, { type: "move_rejected", code: result.code, reason: result.reason });
      return;
    }

    this.applyEffects(result.effects);
    this.broadcastState();
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

    // Hook riconnessione (v1 forma minima): la room resta viva entro la grazia.
    // TODO(ciclo 2): allo scadere, gestire abbandono/forfeit. Per ora no-op.
    slot.graceTimer = setTimeout(() => {
      slot.graceTimer = null;
      // Punto di aggancio per l'enforcement del timeout/abbandono (rimandato).
    }, this.reconnectGraceMs());
  }

  private reconnectGraceMs(): number {
    return Number(process.env.RECONNECT_GRACE_MS ?? 120_000);
  }

  isEmpty(): boolean {
    return this.players.every((p) => p.ws === null);
  }

  /* ─────────────────────────── broadcast/redaction ─────────────────────── */

  private broadcast(msg: ServerMessage): void {
    for (const p of this.players) send(p.ws, msg);
  }

  private broadcastPlayers(): void {
    const players = this.publicPlayers();
    for (const p of this.players) {
      send(p.ws, {
        type: "room_joined",
        yourSeat: p.seat,
        yourToken: p.token,
        players,
        config: this.config,
      });
    }
  }

  /** Invia a OGNI giocatore lo stato redatto dal suo punto di vista. */
  broadcastState(): void {
    if (!this.engine) return;
    for (const p of this.players) this.sendStateTo(p);
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
