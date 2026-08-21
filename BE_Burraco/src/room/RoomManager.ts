import type { WebSocket } from "ws";
import type { ClientMessage, GameConfig } from "../contract/types.js";
import { defaultGameConfig } from "../config.js";
import { Room } from "./Room.js";
import type { AuthService } from "../auth/service.js";

/**
 * Orchestratore in-RAM di tutte le room attive (v1 single-instance).
 * Mappa i socket alla loro room e instrada join/messaggi/disconnessioni.
 *
 * Macro-ciclo 1 — Auth: quando `authService` è presente e `requireAuth` è true,
 * `join_room` è gated su un authToken VALIDO (SEC-08): senza principale risolto
 * non si occupa alcun posto. Il `display_name` usato è quello AUTORITATIVO del
 * principale (mai il displayName arbitrario del client). Se `requireAuth` è false
 * (dev/test), vale il comportamento legacy col displayName del client, così le
 * suite d'integrazione preesistenti restano valide.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketRoom = new WeakMap<WebSocket, Room>();
  private readonly authService: AuthService | undefined;
  private readonly requireAuth: boolean;

  constructor(opts?: { authService?: AuthService; requireAuth?: boolean }) {
    this.authService = opts?.authService;
    this.requireAuth = opts?.requireAuth ?? false;
  }

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

  /**
   * Gestione di `join_room`. È ASINCRONA perché la risoluzione dell'authToken
   * richiede l'AuthService (store DB o in-memory). Gli errori vengono gestiti qui
   * (nessuna promise non catturata risale al chiamante sincrono in `server.ts`).
   */
  private async handleJoin(
    ws: WebSocket,
    msg: Extract<ClientMessage, { type: "join_room" }>,
  ): Promise<void> {
    const code = this.normalizeCode(msg.roomCode);
    if (!code) {
      ws.send(JSON.stringify({ type: "error", message: "Codice room mancante." }));
      return;
    }

    // SEC-08 (Auth): con gating attivo, servono un AuthService e un authToken
    // VALIDO per entrare. Il displayName usato è quello autoritativo del principale.
    let authoritativeName = msg.displayName ?? "";
    // Macro-ciclo 3 (WIRING): identità che occupa il posto, per collegare la
    // partita all'utente in match_players.user_id. Risolta SOLO dal token (mai dal
    // client). `null` finché non c'è un principale (dev/test o gating off senza token).
    let userId: string | null = null;
    if (this.requireAuth && this.authService) {
      if (!msg.authToken) {
        ws.send(
          JSON.stringify({
            type: "join_rejected",
            code: "AUTH_REQUIRED",
            reason: "Devi accedere prima di entrare in un tavolo.",
          }),
        );
        return;
      }
      const principal = await this.authService.getPrincipalByToken(msg.authToken);
      if (!principal) {
        ws.send(
          JSON.stringify({
            type: "join_rejected",
            code: "AUTH_INVALID",
            reason: "Sessione non valida o scaduta: accedi di nuovo.",
          }),
        );
        return;
      }
      // Nome autoritativo dal server: IGNORA qualsiasi displayName del client.
      authoritativeName = principal.displayName;
      userId = principal.userId;
    } else if (this.authService && msg.authToken) {
      // Gating disattivato ma authToken presente e valido → usa comunque il nome
      // autoritativo se risolvibile (nessun rifiuto se assente/non valido in dev).
      const principal = await this.authService.getPrincipalByToken(msg.authToken);
      if (principal) {
        authoritativeName = principal.displayName;
        userId = principal.userId;
      }
    }

    const room = this.getOrCreate(code, defaultGameConfig());
    this.socketRoom.set(ws, room);
    // playerToken/clientId restano il meccanismo di riconnessione del POSTO
    // (SEC-04/10/11), non toccato: authToken aggiunge identità, non la sostituisce.
    room.join(ws, msg.playerToken, authoritativeName, msg.clientId, userId);
  }

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    if (msg.type === "join_room") {
      // Fire-and-forget con cattura interna degli errori: il join può awaitare la
      // risoluzione del token, ma il chiamante (server.ts) resta sincrono.
      void this.handleJoin(ws, msg).catch((err) => {
        console.error("[ws] errore join_room:", (err as Error).message);
        try {
          ws.send(JSON.stringify({ type: "error", message: "Errore interno durante l'ingresso." }));
        } catch {
          /* socket in chiusura */
        }
      });
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
    // (token o clientId); alla scadenza, se l'avversario è presente, la partita è
    // ANNULLATA per abbandono (room_closed{abandoned}) e la room si auto-rimuove
    // dalla mappa tramite l'hook onDispose (GC).
  }
}
