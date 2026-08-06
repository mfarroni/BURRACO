import type { WebSocket } from "ws";
import type { ClientMessage, GameConfig } from "../contract/types.js";
import { defaultGameConfig } from "../config.js";
import { Room } from "./Room.js";

/**
 * Orchestratore in-RAM di tutte le room attive (v1 single-instance).
 * Mappa i socket alla loro room e instrada join/messaggi/disconnessioni.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketRoom = new WeakMap<WebSocket, Room>();

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase().slice(0, 12);
  }

  private getOrCreate(code: string, config: GameConfig): Room {
    let room = this.rooms.get(code);
    // Se la room esiste ma è già stata smaltita (conclusa/abbandonata), la si
    // sostituisce con una nuova: nessun aggancio a una room morta.
    if (!room || room.isDisposed()) {
      room = new Room(code, config);
      // SEC-05 GC: quando la room si conclude, rimuovila dalla mappa in-RAM
      // (solo se è ancora QUESTA la room mappata sotto quel codice).
      room.onDispose = () => {
        if (this.rooms.get(code) === room) this.rooms.delete(code);
      };
      this.rooms.set(code, room);
    }
    return room;
  }

  /** Numero di room attive in memoria (per test/diagnostica GC). */
  activeRoomCount(): number {
    return this.rooms.size;
  }

  handleJoin(ws: WebSocket, msg: Extract<ClientMessage, { type: "join_room" }>): void {
    const code = this.normalizeCode(msg.roomCode);
    if (!code) {
      ws.send(JSON.stringify({ type: "error", message: "Codice room mancante." }));
      return;
    }
    const room = this.getOrCreate(code, defaultGameConfig());
    this.socketRoom.set(ws, room);
    room.join(ws, msg.playerToken, msg.displayName ?? "");
  }

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    if (msg.type === "join_room") {
      this.handleJoin(ws, msg);
      return;
    }
    const room = this.socketRoom.get(ws);
    if (!room) {
      ws.send(JSON.stringify({ type: "error", message: "Non sei in nessuna room. Invia join_room." }));
      return;
    }
    room.onMessage(ws, msg);
  }

  handleClose(ws: WebSocket): void {
    const room = this.socketRoom.get(ws);
    if (!room) return;
    room.onDisconnect(ws);
    this.socketRoom.delete(ws);
    // La room resta in memoria durante la finestra di grazia per la riconnessione
    // via token; alla scadenza la room fa forfeit/abbandono e si auto-rimuove
    // dalla mappa tramite l'hook onDispose (SEC-05, GC).
  }
}
