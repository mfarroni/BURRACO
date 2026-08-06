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
    // v1: timeout del turno NON enforced dal server → nessuna deadline, niente
    // countdown lato client. Quando l'enforcement verrà attivato, esporre qui la
    // deadline assoluta (es. engine.turnEndsAt) in epoch millis.
    turnEndsAt: null,
    phase: engine.phase,
    yourPozzettoTaken: engine.pozzettoTaken(viewer),
    scores: [engine.cumulative[0], engine.cumulative[1]],
    status: engine.status,
  };
}
