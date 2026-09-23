import { gte, lt, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";

/**
 * CONTATORE ANONIMO dei clic su "Offri un caffè" e "Invita un amico"
 * (docs/specs/proposta-donazione-condivisione.md §8.6, Lotto D).
 *
 * - Aggregato per (giorno UTC, tipo, punto della UI): nessuna riga per singolo clic.
 * - Nessun dato personale: il chiamante NON passa utente, IP o altro.
 * - Best-effort: un errore di scrittura non deve mai rompere la risposta.
 *
 * Due implementazioni intercambiabili (stessa filosofia di ContactStore): Drizzle con
 * DATABASE_URL, in-memory senza (test/dev).
 */

export const CLICK_KINDS = ["caffe", "invito"] as const;
export const CLICK_PLACEMENTS = ["fine_partita", "landing", "lobby", "sala_attesa", "profilo", "footer"] as const;
export type ClickKind = (typeof CLICK_KINDS)[number];
export type ClickPlacement = (typeof CLICK_PLACEMENTS)[number];

/** Orizzonte massimo interrogabile e di conservazione. */
export const CLICKS_MAX_DAYS = 180;

export interface ClickRow {
  day: string; // YYYY-MM-DD (UTC)
  kind: ClickKind;
  placement: ClickPlacement;
  count: number;
}

export interface ClickSummary {
  days: number;
  since: string;
  totals: Record<ClickKind, number>;
  byPlacement: { kind: ClickKind; placement: ClickPlacement; count: number }[];
  daily: { day: string; caffe: number; invito: number }[];
}

export interface SupportClickStore {
  record(kind: ClickKind, placement: ClickPlacement, day: string): Promise<void>;
  /** Righe con `day >= since` (YYYY-MM-DD). */
  rowsSince(since: string): Promise<ClickRow[]>;
}

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Aggrega le righe grezze nel riepilogo per il pannello admin. Funzione pura. */
export function summarize(rows: ClickRow[], days: number, since: string): ClickSummary {
  const totals: Record<ClickKind, number> = { caffe: 0, invito: 0 };
  const byKey = new Map<string, { kind: ClickKind; placement: ClickPlacement; count: number }>();
  const byDay = new Map<string, { day: string; caffe: number; invito: number }>();
  for (const r of rows) {
    totals[r.kind] += r.count;
    const k = `${r.kind}|${r.placement}`;
    const p = byKey.get(k) ?? { kind: r.kind, placement: r.placement, count: 0 };
    p.count += r.count;
    byKey.set(k, p);
    const d = byDay.get(r.day) ?? { day: r.day, caffe: 0, invito: 0 };
    d[r.kind] += r.count;
    byDay.set(r.day, d);
  }
  return {
    days,
    since,
    totals,
    byPlacement: [...byKey.values()].sort((a, b) => b.count - a.count),
    daily: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
  };
}

class DrizzleSupportClickStore implements SupportClickStore {
  async record(kind: ClickKind, placement: ClickPlacement, day: string): Promise<void> {
    await db!
      .insert(schema.supportClicks)
      .values({ day, kind, placement, count: 1 })
      .onConflictDoUpdate({
        target: [schema.supportClicks.day, schema.supportClicks.kind, schema.supportClicks.placement],
        set: { count: sql`${schema.supportClicks.count} + 1` },
      });
  }

  async rowsSince(since: string): Promise<ClickRow[]> {
    const rows = await db!
      .select()
      .from(schema.supportClicks)
      .where(gte(schema.supportClicks.day, since));
    return rows.map((r) => ({
      day: String(r.day),
      kind: r.kind as ClickKind,
      placement: r.placement as ClickPlacement,
      count: Number(r.count),
    }));
  }
}

export class MemorySupportClickStore implements SupportClickStore {
  readonly rows = new Map<string, ClickRow>();

  async record(kind: ClickKind, placement: ClickPlacement, day: string): Promise<void> {
    const k = `${day}|${kind}|${placement}`;
    const r = this.rows.get(k) ?? { day, kind, placement, count: 0 };
    r.count += 1;
    this.rows.set(k, r);
  }

  async rowsSince(since: string): Promise<ClickRow[]> {
    return [...this.rows.values()].filter((r) => r.day >= since).map((r) => ({ ...r }));
  }
}

export function createSupportClickStore(): SupportClickStore {
  if (db) return new DrizzleSupportClickStore();
  return new MemorySupportClickStore();
}

/** Condizione di retention: righe più vecchie di CLICKS_MAX_DAYS. */
export function supportClicksExpiredCond(now: Date = new Date()) {
  const cutoff = utcDay(new Date(now.getTime() - CLICKS_MAX_DAYS * 24 * 60 * 60 * 1000));
  return lt(schema.supportClicks.day, cutoff);
}
