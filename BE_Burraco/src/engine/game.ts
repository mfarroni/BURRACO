import type {
  Card,
  GameConfig,
  HandScoreDetail,
  Meld,
  Phase,
  Seat,
} from "../contract/types.js";
import { createDeck, shuffle } from "./cards.js";
import { interpretMeld, type MeldInterpretation } from "./meld.js";
import { scoreHand, type SeatEndState } from "./scoring.js";

/**
 * Motore di gioco autoritativo del Burraco 2p (SERVER-ONLY, decisione #3).
 * Detiene lo stato completo in RAM e applica le regole. Ogni intenzione del
 * client passa da qui: le mosse illegali sono rifiutate con un codice stabile.
 */

export interface RejectResult {
  ok: false;
  code:
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
    | "GAME_NOT_ACTIVE";
  reason: string;
}

/** Effetti collaterali che il Room traduce in eventi WS + persistenza. */
export type GameEffect =
  | { kind: "turn_changed"; seat: Seat; phase: Phase }
  | { kind: "hand_ended"; closerSeat: Seat | null; scores: HandScoreDetail[]; cumulative: [number, number] }
  | { kind: "game_ended"; winnerSeat: Seat | null; finalScores: [number, number] };

export interface OkResult {
  ok: true;
  effects: GameEffect[];
}

export type MoveResult = OkResult | RejectResult;

interface SeatState {
  hand: Card[];
  pozzettoTaken: boolean;
}

const reject = (code: RejectResult["code"], reason: string): RejectResult => ({
  ok: false,
  code,
  reason,
});

let meldSeq = 0;
const nextMeldId = () => `meld-${Date.now().toString(36)}-${(meldSeq++).toString(36)}`;

export class GameEngine {
  readonly config: GameConfig;

  drawPile: Card[] = [];
  discard: Card[] = [];
  pozzetti: Card[][] = [];
  melds: Meld[] = [];
  seats: [SeatState, SeatState] = [
    { hand: [], pozzettoTaken: false },
    { hand: [], pozzettoTaken: false },
  ];

  dealerSeat: Seat = 0;
  currentSeat: Seat = 1;
  phase: Phase = "must_draw";
  handNumber = 0;
  cumulative: [number, number] = [0, 0];
  status: "playing" | "hand_ended" | "game_ended" = "playing";
  lastHandScores: HandScoreDetail[] = [];
  winnerSeat: Seat | null = null;

  constructor(config: GameConfig, firstDealer: Seat) {
    this.config = config;
    this.dealerSeat = firstDealer;
    this.startHand(firstDealer);
  }

  /* ─────────────────────────── setup smazzata ─────────────────────────── */

  private startHand(dealer: Seat): void {
    const deck = shuffle(createDeck());
    const take = (n: number): Card[] => deck.splice(0, n);

    this.seats[0] = { hand: take(11), pozzettoTaken: false }; // A1: 11 carte
    this.seats[1] = { hand: take(11), pozzettoTaken: false };
    this.pozzetti = [take(11), take(11)]; // A2: due pozzetti da 11
    this.drawPile = deck; // 64 carte residue
    this.discard = []; // A3-ter: monte scarti vuoto all'inizio
    this.melds = [];
    this.dealerSeat = dealer;
    this.currentSeat = (1 - dealer) as Seat; // A6: inizia il non-mazziere
    this.phase = "must_draw";
    this.status = "playing";
    this.handNumber += 1;
  }

  /* ─────────────────────────────── mosse ─────────────────────────────── */

  draw(seat: Seat, source: "deck" | "discard"): MoveResult {
    const g = this.guardTurn(seat, "must_draw");
    if (g) return g;

    if (source === "deck") {
      if (this.drawPile.length === 0) {
        // A4 (rivista): il mazzo esaurito NON termina da solo la smazzata.
        // La mano finisce solo se ANCHE il monte scarti è vuoto; altrimenti il
        // giocatore deve pescare dallo scarto.
        if (this.discard.length === 0) return this.endHand(null);
        return reject("DECK_EMPTY", "Il mazzo di pesca è esaurito: pesca dal monte scarti.");
      }
      this.seats[seat].hand.push(this.drawPile.shift()!);
    } else {
      if (this.discard.length === 0) {
        // Se anche il mazzo è vuoto -> entrambe le fonti esaurite: fine smazzata.
        if (this.drawPile.length === 0) return this.endHand(null);
        return reject("EMPTY_DISCARD", "Il monte scarti è vuoto.");
      }
      // A3: si prende l'INTERO monte scarti (inclusa la carta in cima).
      this.seats[seat].hand.push(...this.discard);
      this.discard = [];
    }

    this.phase = "may_meld";
    return { ok: true, effects: [{ kind: "turn_changed", seat, phase: this.phase }] };
  }

  meldNew(seat: Seat, cardIds: string[]): MoveResult {
    const g = this.guardTurn(seat, "may_meld");
    if (g) return g;

    // A5: limite di calate prima del pozzetto.
    if (!this.seats[seat].pozzettoTaken) {
      const own = this.melds.filter((m) => m.ownerSeat === seat).length;
      if (own >= this.config.limiteCalatePrimaDelPozzetto)
        return reject(
          "MELD_LIMIT_REACHED",
          `Prima di prendere il pozzetto puoi calare al massimo ${this.config.limiteCalatePrimaDelPozzetto} giochi.`,
        );
    }

    const picked = this.pickFromHand(seat, cardIds);
    if (!picked) return reject("CARD_NOT_IN_HAND", "Carte non presenti in mano o duplicate.");

    const interp = interpretMeld(picked);
    if (!interp) return reject("INVALID_MELD", "Le carte non formano un gioco valido.");

    const handAfter = this.seats[seat].hand.length - picked.length;
    const guardEmpty = this.guardHandNotEmptied(seat, handAfter);
    if (guardEmpty) return guardEmpty;

    // Commit
    this.removeFromHand(seat, cardIds);
    this.melds.push(this.buildMeld(interp, seat));
    return this.afterMeldMutation(seat, handAfter);
  }

  meldExtend(seat: Seat, meldId: string, cardIds: string[]): MoveResult {
    const g = this.guardTurn(seat, "may_meld");
    if (g) return g;

    const meld = this.melds.find((m) => m.id === meldId);
    if (!meld) return reject("MELD_NOT_FOUND", "Gioco inesistente.");
    if (meld.ownerSeat !== seat)
      return reject("NOT_MELD_OWNER", "Puoi ampliare solo i tuoi giochi.");

    const picked = this.pickFromHand(seat, cardIds);
    if (!picked) return reject("CARD_NOT_IN_HAND", "Carte non presenti in mano o duplicate.");

    const interp = interpretMeld([...meld.cards, ...picked]);
    if (!interp) return reject("INVALID_MELD", "L'ampliamento non forma un gioco valido.");

    const handAfter = this.seats[seat].hand.length - picked.length;
    const guardEmpty = this.guardHandNotEmptied(seat, handAfter);
    if (guardEmpty) return guardEmpty;

    // Commit
    this.removeFromHand(seat, cardIds);
    this.replaceMeld(meld.id, this.buildMeld(interp, seat, meld.id));
    return this.afterMeldMutation(seat, handAfter);
  }

  pinellaSubstitute(seat: Seat, meldId: string, cardInHand: string): MoveResult {
    const g = this.guardTurn(seat, "may_meld");
    if (g) return g;

    const meld = this.melds.find((m) => m.id === meldId);
    if (!meld) return reject("MELD_NOT_FOUND", "Gioco inesistente.");
    if (meld.ownerSeat !== seat)
      return reject("NOT_MELD_OWNER", "Puoi agire solo sui tuoi giochi.");

    const card = this.seats[seat].hand.find((c) => c.id === cardInHand);
    if (!card) return reject("CARD_NOT_IN_HAND", "Carta non presente in mano.");

    const before = interpretMeld(meld.cards);
    if (!before) return reject("INVALID_MELD", "Stato del gioco incoerente.");

    // Individua le pinelle (2 usati come matta) presenti nel gioco.
    const pinelle = before.wilds.filter((w) => w.isPinella);
    if (pinelle.length === 0)
      return reject("NO_PINELLA_TO_SUBSTITUTE", "Nel gioco non c'è una pinella da sostituire.");

    // Prova a sostituire: rimuovi la pinella, inserisci la carta naturale,
    // rivalida. Deve restare valido e ridurre di uno le matte (recupero reale).
    for (const p of pinelle) {
      const rebuilt = meld.cards.filter((c) => c.id !== p.cardId).concat(card);
      const after = interpretMeld(rebuilt);
      if (after && after.wildCount === before.wildCount - 1) {
        // Commit: la carta esce dalla mano, la pinella rientra in mano.
        const pinellaCard = meld.cards.find((c) => c.id === p.cardId)!;
        this.removeFromHand(seat, [card.id]);
        this.seats[seat].hand.push(pinellaCard);
        this.replaceMeld(meld.id, this.buildMeld(after, seat, meld.id));
        return { ok: true, effects: [] };
      }
    }
    return reject(
      "NO_PINELLA_TO_SUBSTITUTE",
      "La carta indicata non corrisponde a nessuna pinella calata.",
    );
  }

  discardCard(seat: Seat, cardId: string): MoveResult {
    const g = this.guardTurn(seat, "may_meld");
    if (g) return g;

    const card = this.seats[seat].hand.find((c) => c.id === cardId);
    if (!card) return reject("CARD_NOT_IN_HAND", "Carta non presente in mano.");

    const willEmpty = this.seats[seat].hand.length === 1;

    // Ultimo scarto non può essere una matta (jolly o pinella).
    if (willEmpty && card.isWild)
      return reject(
        "ILLEGAL_LAST_DISCARD",
        "L'ultima carta scartata non può essere un jolly né una pinella.",
      );

    if (willEmpty) {
      const s = this.seats[seat];
      if (!s.pozzettoTaken && this.pozzetti.length > 0) {
        // Pozzetto DIFFERITA: prende il pozzetto ma lo gioca dal turno successivo.
        this.removeFromHand(seat, [cardId]);
        this.discard.push(card);
        this.takePozzetto(seat);
        return this.endTurn();
      }
      // Deve chiudere: serve almeno un burraco (variante italiana: qualsiasi).
      if (!this.canClose(seat))
        return reject(
          "CANNOT_CLOSE_NO_BURRACO",
          "Non puoi terminare la mano senza aver realizzato un burraco.",
        );
      // CHIUSURA valida.
      this.removeFromHand(seat, [cardId]);
      this.discard.push(card);
      return this.endHand(seat);
    }

    // Scarto ordinario: termina il turno.
    this.removeFromHand(seat, [cardId]);
    this.discard.push(card);
    return this.endTurn();
  }

  /* ─────────────────────────── helper interni ─────────────────────────── */

  private guardTurn(seat: Seat, phase: Phase): RejectResult | null {
    if (this.status !== "playing")
      return reject("GAME_NOT_ACTIVE", "La partita non è in corso.");
    if (seat !== this.currentSeat) return reject("NOT_YOUR_TURN", "Non è il tuo turno.");
    if (this.phase !== phase)
      return reject("WRONG_PHASE", `Azione non consentita nella fase "${this.phase}".`);
    return null;
  }

  /**
   * Vieta di svuotare la mano con una calata quando il pozzetto è già preso
   * (bisogna tenere una carta per lo scarto/chiusura). Se il pozzetto NON è
   * ancora preso, svuotare è lecito: scatterà la presa "in diretta".
   */
  private guardHandNotEmptied(seat: Seat, handAfter: number): RejectResult | null {
    // Se il pozzetto è già preso (o non ce ne sono da prendere) non si può
    // svuotare la mano con una calata: serve una carta per lo scarto/chiusura.
    if (handAfter === 0 && (this.seats[seat].pozzettoTaken || this.pozzetti.length === 0))
      return reject(
        "MUST_KEEP_CARD_TO_DISCARD",
        "Devi tenere almeno una carta per lo scarto finale.",
      );
    return null;
  }

  /** Gestione post-calata: eventuale presa pozzetto "in diretta". */
  private afterMeldMutation(seat: Seat, handAfter: number): MoveResult {
    if (handAfter === 0 && !this.seats[seat].pozzettoTaken && this.pozzetti.length > 0) {
      // Pozzetto IN DIRETTA: prende subito il pozzetto e continua lo stesso turno.
      this.takePozzetto(seat);
    }
    return { ok: true, effects: [] };
  }

  private takePozzetto(seat: Seat): void {
    const pozzetto = this.pozzetti.shift();
    if (pozzetto) this.seats[seat].hand.push(...pozzetto);
    this.seats[seat].pozzettoTaken = true;
  }

  private canClose(seat: Seat): boolean {
    return this.melds.some(
      (m) =>
        m.ownerSeat === seat &&
        m.isBurraco &&
        (this.config.varianteChiusura === "italiana" || m.clean),
    );
  }

  private endTurn(): OkResult {
    this.currentSeat = (1 - this.currentSeat) as Seat;
    this.phase = "must_draw";
    // Nota (A4 rivista): l'esaurimento del mazzo NON termina qui la smazzata. Il
    // nuovo giocatore può pescare dallo scarto; la fine per esaurimento è decisa
    // in draw() quando mazzo E monte scarti sono entrambi vuoti.
    return {
      ok: true,
      effects: [{ kind: "turn_changed", seat: this.currentSeat, phase: this.phase }],
    };
  }

  private endHand(closerSeat: Seat | null): OkResult {
    const seatStates: SeatEndState[] = this.seats.map((s, i) => ({
      seat: i as Seat,
      hand: s.hand,
      pozzettoTaken: s.pozzettoTaken,
    }));
    const scores = scoreHand(seatStates, this.melds, closerSeat);
    this.lastHandScores = scores;

    for (const sc of scores) this.cumulative[sc.seat] += sc.totalDelta;

    const effects: GameEffect[] = [
      { kind: "hand_ended", closerSeat, scores, cumulative: [...this.cumulative] as [number, number] },
    ];

    // Fine partita al raggiungimento dell'obiettivo.
    const [a, b] = this.cumulative;
    const reached = a >= this.config.punteggioObiettivo || b >= this.config.punteggioObiettivo;
    let winner: Seat | null = null;
    if (reached) {
      if (a !== b) {
        // Vince chi ha il cumulato più alto.
        winner = a > b ? 0 : 1;
      } else if (closerSeat !== null) {
        // Q4: parità esatta all'obiettivo -> vince chi ha CHIUSO la smazzata.
        winner = closerSeat;
      }
      // Parità esatta SENZA closer (smazzata finita per esaurimento): nessun
      // vincitore -> si gioca un'altra smazzata (winner resta null).
    }

    if (reached && winner !== null) {
      this.status = "game_ended";
      this.winnerSeat = winner;
      effects.push({ kind: "game_ended", winnerSeat: winner, finalScores: [a, b] });
    } else {
      // Nuova smazzata: il mazziere alterna (A6).
      this.status = "hand_ended";
    }
    return { ok: true, effects };
  }

  /** Avvia la smazzata successiva (chiamato dal Room dopo un hand_ended). */
  startNextHand(): void {
    if (this.status !== "hand_ended") return;
    this.startHand((1 - this.dealerSeat) as Seat);
  }

  private pickFromHand(seat: Seat, cardIds: string[]): Card[] | null {
    if (cardIds.length === 0) return null;
    if (new Set(cardIds).size !== cardIds.length) return null; // duplicati nell'input
    const hand = this.seats[seat].hand;
    const picked: Card[] = [];
    for (const id of cardIds) {
      const c = hand.find((h) => h.id === id);
      if (!c) return null;
      picked.push(c);
    }
    return picked;
  }

  private removeFromHand(seat: Seat, cardIds: string[]): void {
    const ids = new Set(cardIds);
    this.seats[seat].hand = this.seats[seat].hand.filter((c) => !ids.has(c.id));
  }

  private buildMeld(interp: MeldInterpretation, seat: Seat, keepId?: string): Meld {
    return {
      id: keepId ?? nextMeldId(),
      type: interp.type,
      cards: interp.orderedCards,
      ownerSeat: seat,
      isBurraco: interp.isBurraco,
      clean: interp.clean,
    };
  }

  private replaceMeld(id: string, meld: Meld): void {
    const idx = this.melds.findIndex((m) => m.id === id);
    if (idx >= 0) this.melds[idx] = meld;
  }

  /* ─────────────────── viste per la redazione (anti-leak) ─────────────────── */

  handCount(seat: Seat): number {
    return this.seats[seat].hand.length;
  }

  handOf(seat: Seat): Card[] {
    return this.seats[seat].hand;
  }

  pozzettoTaken(seat: Seat): boolean {
    return this.seats[seat].pozzettoTaken;
  }
}
