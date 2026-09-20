import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

/**
 * FASE 4 — Consolidamento dei TOTALI permanenti per utente (`user_stats_totals`).
 *
 * Perché: le statistiche sono ON-THE-FLY sul dettaglio (hand_scores/…); la retention
 * (§4.2) pota il dettaglio a 3 mesi. Senza consolidamento, il profilo di un
 * registrato perderebbe i totali. Qui si mantiene una riga per utente registrato,
 * aggiornata:
 *  - INCREMENTALMENTE alla conclusione di una partita (una UPSERT, dentro la stessa
 *    transazione di `matches.status='completed'` → nessuna finestra di incoerenza);
 *  - per RICONCILIAZIONE periodica (ricalcolo da zero) come rete di sicurezza.
 *
 * Solo utenti REGISTRATI hanno una riga (gli ospiti non hanno profilo). La logica di
 * vinta/pareggio e di conteggio avversari rispecchia `DrizzleStatsStore.getStats`
 * (squadra, non posto — P4): in 1v1 team = seat → identico al comportamento storico.
 */

type Db = NodePgDatabase<typeof schema>;
/** Tipo della transazione passata da `db.transaction(cb)`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Esecutore comune: sia il db "piatto" sia una transazione. */
type Exec = Db | Tx;

const num = (v: unknown): number => Number(v ?? 0);

interface Participant {
  seat: number;
  team: number | null;
  userId: string | null;
  isGuest: boolean | null;
}

/** Aggregati per posto di una singola partita. */
interface SeatAgg {
  total: number;
  puliti: number;
  sporchi: number;
}

/**
 * Consolida i totali per i partecipanti REGISTRATI di UNA partita conclusa.
 * Idempotenza: va chiamata SOLO quando `matches` transita davvero a 'completed'
 * (il chiamante lo garantisce con un UPDATE condizionato che ritorna le righe
 * effettivamente modificate), così una partita non viene mai contata due volte.
 */
export async function consolidateMatchTotals(
  exec: Exec,
  matchId: string,
  winnerTeamResolved: number | null,
): Promise<void> {
  const participants: Participant[] = await exec
    .select({
      seat: schema.matchPlayers.seat,
      team: schema.matchPlayers.team,
      userId: schema.matchPlayers.userId,
      isGuest: schema.users.isGuest,
    })
    .from(schema.matchPlayers)
    .leftJoin(schema.users, eq(schema.users.id, schema.matchPlayers.userId))
    .where(eq(schema.matchPlayers.matchId, matchId));

  if (participants.length === 0) return;

  // Punteggi per posto della partita (una riga per smazzata × posto).
  const scoreRows = await exec
    .select({
      seat: schema.handScores.seat,
      total: sql<number>`coalesce(sum(${schema.handScores.totalDelta}), 0)`,
      puliti: sql<number>`coalesce(sum(${schema.handScores.burrachiPuliti}), 0)`,
      sporchi: sql<number>`coalesce(sum(${schema.handScores.burrachiSporchi}), 0)`,
    })
    .from(schema.handScores)
    .innerJoin(schema.hands, eq(schema.hands.id, schema.handScores.handId))
    .where(eq(schema.hands.matchId, matchId))
    .groupBy(schema.handScores.seat);

  const bySeat = new Map<number, SeatAgg>();
  for (const r of scoreRows) {
    bySeat.set(r.seat, { total: num(r.total), puliti: num(r.puliti), sporchi: num(r.sporchi) });
  }

  const now = new Date();
  for (const p of participants) {
    // Solo registrati con identità: gli ospiti non hanno profilo/totali.
    if (!p.userId || p.isGuest) continue;
    const team = p.team ?? p.seat;
    const won = winnerTeamResolved !== null && winnerTeamResolved === team;
    const agg = bySeat.get(p.seat) ?? { total: 0, puliti: 0, sporchi: 0 };

    // Rappresentante avversario (posto minore dell'ALTRA squadra) per il flag ospite,
    // coerente con lo storico on-the-fly.
    const opponents = participants
      .filter((o) => (o.team ?? o.seat) !== team)
      .sort((a, b) => a.seat - b.seat);
    const hasOpp = opponents.length > 0;
    const oppIsGuest = opponents[0]?.isGuest ?? false;

    await exec
      .insert(schema.userStatsTotals)
      .values({
        userId: p.userId,
        matchesPlayed: 1,
        matchesWon: won ? 1 : 0,
        matchesLost: won ? 0 : 1,
        matchesAbandoned: 0,
        totalPoints: agg.total,
        bestMatchScore: agg.total,
        burrachiPuliti: agg.puliti,
        burrachiSporchi: agg.sporchi,
        vsRegistered: hasOpp && !oppIsGuest ? 1 : 0,
        vsGuest: hasOpp && oppIsGuest ? 1 : 0,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.userStatsTotals.userId,
        set: {
          matchesPlayed: sql`${schema.userStatsTotals.matchesPlayed} + 1`,
          matchesWon: sql`${schema.userStatsTotals.matchesWon} + ${won ? 1 : 0}`,
          matchesLost: sql`${schema.userStatsTotals.matchesLost} + ${won ? 0 : 1}`,
          totalPoints: sql`${schema.userStatsTotals.totalPoints} + ${agg.total}`,
          burrachiPuliti: sql`${schema.userStatsTotals.burrachiPuliti} + ${agg.puliti}`,
          burrachiSporchi: sql`${schema.userStatsTotals.burrachiSporchi} + ${agg.sporchi}`,
          vsRegistered: sql`${schema.userStatsTotals.vsRegistered} + ${hasOpp && !oppIsGuest ? 1 : 0}`,
          vsGuest: sql`${schema.userStatsTotals.vsGuest} + ${hasOpp && oppIsGuest ? 1 : 0}`,
          // Miglior punteggio in una singola partita (mai regredisce).
          bestMatchScore: sql`greatest(coalesce(${schema.userStatsTotals.bestMatchScore}, ${agg.total}), ${agg.total})`,
          updatedAt: now,
        },
      });
  }
}

/** +1 partite abbandonate per i partecipanti REGISTRATI di una partita 'abandoned'. */
export async function consolidateAbandonedTotals(exec: Exec, matchId: string): Promise<void> {
  const participants = await exec
    .select({ userId: schema.matchPlayers.userId, isGuest: schema.users.isGuest })
    .from(schema.matchPlayers)
    .leftJoin(schema.users, eq(schema.users.id, schema.matchPlayers.userId))
    .where(eq(schema.matchPlayers.matchId, matchId));
  const now = new Date();
  for (const p of participants) {
    if (!p.userId || p.isGuest) continue;
    await exec
      .insert(schema.userStatsTotals)
      .values({ userId: p.userId, matchesAbandoned: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.userStatsTotals.userId,
        set: {
          matchesAbandoned: sql`${schema.userStatsTotals.matchesAbandoned} + 1`,
          updatedAt: now,
        },
      });
  }
}

/**
 * RICONCILIAZIONE periodica (rete di sicurezza contro derive): ricalcola i totali
 * da zero replayando tutte le partite concluse/abbandonate, in UNA transazione (mai
 * una finestra a zero visibile). Best-effort a livello di chiamante (scheduler).
 */
export async function reconcileTotals(db: Db): Promise<{ users: number; matches: number }> {
  return db.transaction(async (tx) => {
    // Azzeramento e replay: consolidate INCREMENTA, quindi si parte da vuoto.
    await tx.delete(schema.userStatsTotals);

    const completed = await tx
      .select({
        id: schema.matches.id,
        winnerSeat: schema.matches.winnerSeat,
        winnerTeam: schema.matches.winnerTeam,
      })
      .from(schema.matches)
      .where(eq(schema.matches.status, "completed"));
    for (const m of completed) {
      await consolidateMatchTotals(tx, m.id, m.winnerTeam ?? m.winnerSeat);
    }

    const abandoned = await tx
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(eq(schema.matches.status, "abandoned"));
    for (const m of abandoned) {
      await consolidateAbandonedTotals(tx, m.id);
    }

    const [countRow] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(schema.userStatsTotals);
    return { users: num(countRow?.n), matches: completed.length + abandoned.length };
  });
}
