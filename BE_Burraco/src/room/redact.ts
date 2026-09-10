import type {
  ConnectionStatus,
  GameStatePublic,
  Seat,
  SeatPublic,
} from "../contract/types.js";
import type { GameEngine } from "../engine/game.js";
import { teamOfSeat, teamScores } from "../engine/teams.js";

/**
 * Metadati per-posto NON noti al motore (vivono nel Room): nome autoritativo e
 * stato di connessione. Passati a `redactFor` per popolare `SeatPublic`. Array
 * indicizzato per `seat` (`seatMeta[seat]`); posti mancanti ricevono un default.
 */
export interface SeatMeta {
  displayName: string;
  connectionStatus: ConnectionStatus;
}

/**
 * ANTI-LEAK (Definition of Done, P3). Produce lo stato PUBBLICO per un singolo
 * destinatario. Non devono MAI trapelare: la mano di NESSUN altro posto (compagno
 * incluso in coppie: solo il conteggio), il contenuto dei pozzetti non presi,
 * l'ordine/contenuto del mazzo di pesca. Il monte scarti espone solo la carta in
 * cima + il conteggio.
 *
 * Regola di sicurezza: qui si COSTRUISCE da zero un oggetto whitelisted; non si fa
 * MAI spread dello stato interno né delle mani. `seats[]` porta per ogni posto —
 * viewer compreso (D-A) — SOLO il `handCount`, mai le carte. L'unica mano completa
 * nel payload è `yourHand` del destinatario.
 */
export function redactFor(
  engine: GameEngine,
  viewer: Seat,
  seatMeta: readonly SeatMeta[] = [],
): GameStatePublic {
  const top = engine.discard.length > 0 ? engine.discard[engine.discard.length - 1]! : null;

  // Vista per-posto (TUTTI i posti, viewer incluso): mai le carte, solo il conteggio.
  const seatCount = engine.config.numeroGiocatori;
  const seats: SeatPublic[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    const meta = seatMeta[seat];
    seats.push({
      seat,
      team: teamOfSeat(seat, engine.config),
      handCount: engine.handCount(seat),
      connectionStatus: meta?.connectionStatus ?? "connected",
      displayName: meta?.displayName ?? `Giocatore ${seat + 1}`,
    });
  }

  return {
    yourSeat: viewer,
    yourHand: engine.handOf(viewer).map((c) => ({ ...c })),
    tableMelds: engine.melds.map((m) => ({ ...m, cards: m.cards.map((c) => ({ ...c })) })),
    seats,
    discardTop: top ? { ...top } : null,
    discardCount: engine.discard.length,
    drawPileCount: engine.drawPile.length,
    pozzettiRemaining: engine.pozzetti.length,
    whoseTurn: engine.currentSeat,
    // Deadline REALE del turno attivo (epoch millis) per il countdown VISIVO del
    // client. Il server enforce il timeout (SEC-05). Esposta solo durante un
    // turno attivo: a mano/partita conclusa non c'è deadline.
    turnEndsAt: engine.status === "playing" ? engine.turnEndsAt : null,
    phase: engine.phase,
    yourPozzettoTaken: engine.pozzettoTaken(viewer),
    // Presentazionale: abilita il pulsante "Annulla ultima mossa" solo per il
    // giocatore di mano in may_meld con almeno una calata annullabile. Non
    // divulga stato nascosto (solo disponibilità dell'azione).
    canUndo: engine.canUndo(viewer),
    // Punteggi PER SQUADRA (C4/D-E): somma dei cumulati dei posti della squadra.
    // In 1v1 (team = seat) coincide con [cumulative[0], cumulative[1]].
    scores: teamScores(engine.cumulative, engine.config),
    status: engine.status,
  };
}
