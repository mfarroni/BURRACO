import type { StatMetric, StatTrend, StatsPeriod, StyleAnalysis } from "../contract/types.js";

/**
 * Logica CONDIVISA del blocco analisi di stile (BE-only). Vive qui una sola volta
 * così le due implementazioni di StatsStore (Drizzle/Neon e in-memory) producono
 * ESATTAMENTE gli stessi numeri e le stesse soglie. Nessuna query qui: solo il
 * calcolo delle metriche a partire da aggregati già estratti.
 */

/** Soglie minime di campione (tarabili dal lead). */
export const THRESHOLDS = {
  /** Metriche "per smazzata": servono almeno N smazzate. */
  deals: 10,
  /** Quota pozzetti in diretta: serve almeno N pozzetti presi. */
  pozzetti: 5,
  /** Andamento (sparkline): servono almeno N partite. */
  trend: 3,
} as const;

/** Aggregati grezzi per il solo posto dell'utente, sulle partite completed nel periodo. */
export interface RawAggregate {
  dealsPlayed: number;
  sumPuliti: number;
  sumSporchi: number;
  /** Smazzate in cui il pozzetto è stato preso (pts_pozzetto = 0). */
  pozzettiPresi: number;
  /** Fra i presi, quanti "in diretta". */
  pozzettiDiretta: number;
  /** Smazzate chiuse dall'utente (closer_seat = seat). */
  closures: number;
  /** Somma di pts_penalty_hand (≤ 0). */
  sumPenalty: number;
  /** Somma di total_delta. */
  sumDelta: number;
  /** Smazzate con malus del pozzetto (pts_pozzetto = -100). */
  malusCount: number;
}

/** Costruisce una metrica: value=null se il campione è sotto soglia o la condizione extra non regge. */
function metric(
  value: number,
  sampleSize: number,
  threshold: number,
  extraOk = true,
): StatMetric {
  const ok = sampleSize >= threshold && extraOk;
  return { value: ok ? value : null, sampleSize, threshold };
}

/**
 * Calcola il blocco analisi a partire dagli aggregati grezzi e dalla serie
 * d'andamento (già in ordine cronologico ascendente).
 */
export function buildAnalysis(agg: RawAggregate, trendPoints: number[]): StyleAnalysis {
  const d = agg.dealsPlayed;
  const safeDiv = (n: number, den: number): number => (den === 0 ? 0 : n / den);

  const trend: StatTrend = {
    points: trendPoints,
    sampleSize: trendPoints.length,
    threshold: THRESHOLDS.trend,
  };

  return {
    dealsPlayed: d,
    burrachiPulitiPerDeal: metric(safeDiv(agg.sumPuliti, d), d, THRESHOLDS.deals),
    burrachiSporchiPerDeal: metric(safeDiv(agg.sumSporchi, d), d, THRESHOLDS.deals),
    // Rapporto puliti/sporchi: definito solo con almeno uno sporco a denominatore.
    cleanDirtyRatio: metric(
      safeDiv(agg.sumPuliti, agg.sumSporchi),
      d,
      THRESHOLDS.deals,
      agg.sumSporchi >= 1,
    ),
    pozzettoRate: metric(safeDiv(agg.pozzettiPresi, d), d, THRESHOLDS.deals),
    // Denominatore = pozzetti presi (non le smazzate): soglia dedicata.
    pozzettoInDirettaShare: metric(
      safeDiv(agg.pozzettiDiretta, agg.pozzettiPresi),
      agg.pozzettiPresi,
      THRESHOLDS.pozzetti,
    ),
    closureRate: metric(safeDiv(agg.closures, d), d, THRESHOLDS.deals),
    avgHandPenalty: metric(safeDiv(agg.sumPenalty, d), d, THRESHOLDS.deals),
    avgPointsPerDeal: metric(safeDiv(agg.sumDelta, d), d, THRESHOLDS.deals),
    malusPozzettoCount: agg.malusCount,
    trend,
  };
}

/** Blocco analisi vuoto (nessuna smazzata): tutte le metriche sotto soglia. */
export function emptyAnalysis(): StyleAnalysis {
  return buildAnalysis(
    {
      dealsPlayed: 0,
      sumPuliti: 0,
      sumSporchi: 0,
      pozzettiPresi: 0,
      pozzettiDiretta: 0,
      closures: 0,
      sumPenalty: 0,
      sumDelta: 0,
      malusCount: 0,
    },
    [],
  );
}

/**
 * Inizio del periodo (epoch ms), o null per "all". Applicato su matches.ended_at.
 *  - 30d: ultimi 30 giorni;
 *  - season: dal 1° gennaio (UTC) dell'anno corrente.
 */
export function periodStartMs(periodo: StatsPeriod, now = Date.now()): number | null {
  if (periodo === "30d") return now - 30 * 24 * 60 * 60 * 1000;
  if (periodo === "season") return Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  return null;
}
