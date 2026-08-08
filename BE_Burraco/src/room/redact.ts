import type { GameStatePublic, Seat } from "../contract/types.js";
import type { GameEngine } from "../engine/game.js";

/**
 * ANTI-LEAK (Definition of Done). Produce lo stato PUBBLICO per un singolo
 * destinatario. Non devono MAI trapelare: la mano dell'avversario (solo il
 * conteggio), il contenuto dei pozzetti non presi, l'ordine/contenuto del
 * mazzo di pesca. Il monte scarti espone solo la carta in cima + il conteggio.
 *
 * Regola di sicurezza: qui si COSTRUISCE da zero un oggetto whitelisted; non si
 * fa mai spread dello stato interno. Così una nuova proprietà interna non può
 * finire accidentalmente nel payload.
 */
export function redactFor(engine: GameEngine, viewer: Seat): GameStatePublic {
  const opponent = (1 - viewer) as Seat;
  const top = engine.discard.length > 0 ? engine.discard[engine.discard.length - 1]! : null;

  return {
    yourSeat: viewer,
    yourHand: engine.handOf(viewer).map((c) => ({ ...c })),
    tableMelds: engine.melds.map((m) => ({ ...m, cards: m.cards.map((c) => ({ ...c })) })),
    opponentHandCount: engine.handCount(opponent),
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
    scores: [engine.cumulative[0], engine.cumulative[1]],
    status: engine.status,
  };
}
