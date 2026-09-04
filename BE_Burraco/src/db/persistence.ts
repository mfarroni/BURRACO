import type { GameConfig, HandScoreDetail, Seat } from "../contract/types.js";
import { db, schema } from "./client.js";
import { eq } from "drizzle-orm";

/**
 * Persistenza best-effort (checkpoint + audit). Ogni operazione è isolata in
 * try/catch e non deve MAI bloccare o far crashare il gioco: se il DB è assente
 * o fallisce, si logga e si prosegue. Il Room genera gli id (uuid) e li passa
 * qui, così i FK sono coerenti anche senza round-trip di lettura.
 */

async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  if (!db) return;
  try {
    await fn();
  } catch (err) {
    console.error(`[persistence] ${label} fallita:`, (err as Error).message);
  }
}

export const persistence = {
  async createMatch(matchId: string, config: GameConfig): Promise<void> {
    await safe("createMatch", () =>
      db!.insert(schema.matches).values({
        id: matchId,
        config,
        targetScore: config.punteggioObiettivo,
        status: "playing",
      }),
    );
  },

  async addPlayers(
    matchId: string,
    players: { seat: Seat; displayName: string; tokenHash: string; userId?: string | null }[],
  ): Promise<void> {
    await safe("addPlayers", () =>
      db!.insert(schema.matchPlayers).values(
        players.map((p) => ({
          matchId,
          seat: p.seat,
          displayName: p.displayName,
          playerTokenHash: p.tokenHash,
          // Macro-ciclo 3: collega il posto all'identità (account o ospite) che lo
          // occupa. Nullable: partite pre-auth/senza principale restano valide. Il
          // meccanismo del POSTO (playerToken/clientId, SEC-04/10/11) è INVARIATO.
          userId: p.userId ?? null,
        })),
      ),
    );
  },

  async startHand(
    matchId: string,
    handId: string,
    handNumber: number,
    dealerSeat: Seat,
  ): Promise<void> {
    await safe("startHand", () =>
      db!.insert(schema.hands).values({
        id: handId,
        matchId,
        handNumber,
        dealerSeat,
        status: "playing",
      }),
    );
  },

  logEvent(
    matchId: string,
    handId: string | null,
    seq: number,
    type: string,
    actorSeat: Seat | null,
    payload: unknown,
  ): void {
    // Fire-and-forget: il log eventi non deve rallentare le mosse.
    void safe("logEvent", () =>
      db!.insert(schema.gameEvents).values({
        matchId,
        handId: handId ?? null,
        seq,
        type,
        actorSeat: actorSeat ?? null,
        payload: payload as object,
      }),
    );
  },

  async endHand(
    matchId: string,
    handId: string | null,
    closerSeat: Seat | null,
    scores: HandScoreDetail[],
    fullState: unknown,
  ): Promise<void> {
    if (!handId) return;
    await safe("endHand.scores", () =>
      db!.insert(schema.handScores).values(
        scores.map((s) => ({
          handId,
          seat: s.seat,
          ptsMelds: s.ptsMelds,
          ptsBonus: s.ptsBonus,
          ptsPenaltyHand: s.ptsPenaltyHand,
          ptsPozzetto: s.ptsPozzetto,
          totalDelta: s.totalDelta,
        })),
      ),
    );
    await safe("endHand.update", () =>
      db!
        .update(schema.hands)
        .set({ status: "ended", closerSeat: closerSeat ?? null, endedAt: new Date() })
        .where(eq(schema.hands.id, handId)),
    );
    await safe("endHand.checkpoint", () =>
      db!.insert(schema.checkpoints).values({
        matchId,
        handId,
        seq: 0,
        state: fullState as object,
      }),
    );
  },

  /**
   * Fine LEGITTIMA della partita (obiettivo raggiunto): UNICO percorso che marca
   * `status='completed'` e quindi l'UNICO conteggiato nelle statistiche (§7). È il
   * punto di scrittura consolidato: prima `endMatch` era chiamato da due punti (fine
   * normale + forfeit da stallo); entrambi rappresentano una vittoria reale e ora
   * passano di qui.
   */
  async completeMatch(matchId: string, winnerSeat: Seat | null): Promise<void> {
    await safe("completeMatch", () =>
      db!
        .update(schema.matches)
        .set({ status: "completed", winnerSeat: winnerSeat ?? null, endedAt: new Date() })
        .where(eq(schema.matches.id, matchId)),
    );
  },

  /**
   * ANNULLAMENTO unilaterale (§5.3): marca `status='aborted'` con timestamp e
   * l'identità dell'utente che ha annullato (audit). La riga storica NON viene
   * cancellata. Non tocca alcun contatore (status ≠ 'completed'). `abortedByUserId`
   * può essere null (join senza principale risolto: dev/test).
   */
  async abortMatch(matchId: string, abortedByUserId: string | null): Promise<void> {
    await safe("abortMatch", () =>
      db!
        .update(schema.matches)
        .set({ status: "aborted", endedAt: new Date(), abortedBy: abortedByUserId ?? null })
        .where(eq(schema.matches.id, matchId)),
    );
  },

  /**
   * ABBANDONO (§6.3): l'avversario non è rientrato entro la finestra di grazia.
   * Marca `status='abandoned'` con timestamp. Nessun vincitore, nessun contatore
   * toccato (status ≠ 'completed').
   */
  async abandonMatch(matchId: string): Promise<void> {
    await safe("abandonMatch", () =>
      db!
        .update(schema.matches)
        .set({ status: "abandoned", endedAt: new Date() })
        .where(eq(schema.matches.id, matchId)),
    );
  },

  /**
   * Elimina i CHECKPOINT (stato pieno server-side, mai esposto) di una partita:
   * dati transitori purgati all'annullamento (§5.3.2), così non resta stato di gioco
   * nascosto persistito dopo che il tavolo è stato liberato. La riga `matches` e le
   * partecipazioni `match_players` restano per audit e correttezza statistiche.
   */
  async deleteCheckpoints(matchId: string): Promise<void> {
    await safe("deleteCheckpoints", () =>
      db!.delete(schema.checkpoints).where(eq(schema.checkpoints.matchId, matchId)),
    );
  },
};
