import { desc } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import type { EventRow, ShopProductRow } from "./types.js";

/**
 * CICLO Pannello Admin — PREDISPOSIZIONE Eventi (Tornei) e Shop (§2.6). CRUD MINIMALE:
 * solo create + list dietro `requireAdmin`. Niente update/delete, niente vetrina
 * pubblica, niente carrello/pagamento in questo ciclo: il dato è inseribile e
 * conservato, l'esposizione al pubblico è un ciclo futuro.
 */

const LIST_LIMIT = 100;

/* ── Eventi / Tornei ─────────────────────────────────────────────────────── */

export interface CreateEventInput {
  titolo: string;
  descrizione?: string;
  luogo?: string;
  inizioAt: number; // epoch ms
  fineAt?: number; // epoch ms
  pubblicato?: boolean;
}

export async function createEvent(authorId: string, input: CreateEventInput): Promise<EventRow | null> {
  if (!db) return null;
  const [row] = await db
    .insert(schema.events)
    .values({
      titolo: input.titolo,
      descrizione: input.descrizione ?? null,
      luogo: input.luogo ?? null,
      inizioAt: new Date(input.inizioAt),
      fineAt: input.fineAt != null ? new Date(input.fineAt) : null,
      pubblicato: input.pubblicato ?? false,
      createdBy: authorId,
    })
    .returning({
      id: schema.events.id,
      titolo: schema.events.titolo,
      inizioAt: schema.events.inizioAt,
      luogo: schema.events.luogo,
      pubblicato: schema.events.pubblicato,
    });
  if (!row) return null;
  return { id: row.id, titolo: row.titolo, inizioAt: new Date(row.inizioAt).getTime(), luogo: row.luogo, pubblicato: row.pubblicato };
}

export async function listEvents(): Promise<EventRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: schema.events.id,
      titolo: schema.events.titolo,
      inizioAt: schema.events.inizioAt,
      luogo: schema.events.luogo,
      pubblicato: schema.events.pubblicato,
    })
    .from(schema.events)
    .orderBy(desc(schema.events.inizioAt))
    .limit(LIST_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    titolo: r.titolo,
    inizioAt: new Date(r.inizioAt).getTime(),
    luogo: r.luogo,
    pubblicato: r.pubblicato,
  }));
}

/* ── Prodotti Shop ───────────────────────────────────────────────────────── */

export interface CreateShopProductInput {
  nome: string;
  descrizione?: string;
  prezzoCent?: number; // centesimi (mai float sul denaro)
  valuta?: string;
  immagineUrl?: string;
  disponibile?: boolean;
}

export async function createShopProduct(authorId: string, input: CreateShopProductInput): Promise<ShopProductRow | null> {
  if (!db) return null;
  const [row] = await db
    .insert(schema.shopProducts)
    .values({
      nome: input.nome,
      descrizione: input.descrizione ?? null,
      prezzoCent: Math.max(0, Math.trunc(input.prezzoCent ?? 0)),
      valuta: input.valuta ?? "EUR",
      immagineUrl: input.immagineUrl ?? null,
      disponibile: input.disponibile ?? true,
      createdBy: authorId,
    })
    .returning({
      id: schema.shopProducts.id,
      nome: schema.shopProducts.nome,
      prezzoCent: schema.shopProducts.prezzoCent,
      valuta: schema.shopProducts.valuta,
      disponibile: schema.shopProducts.disponibile,
    });
  if (!row) return null;
  return { id: row.id, nome: row.nome, prezzoCent: row.prezzoCent, valuta: row.valuta, disponibile: row.disponibile };
}

export async function listShopProducts(): Promise<ShopProductRow[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: schema.shopProducts.id,
      nome: schema.shopProducts.nome,
      prezzoCent: schema.shopProducts.prezzoCent,
      valuta: schema.shopProducts.valuta,
      disponibile: schema.shopProducts.disponibile,
      createdAt: schema.shopProducts.createdAt,
    })
    .from(schema.shopProducts)
    .orderBy(desc(schema.shopProducts.createdAt))
    .limit(LIST_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    prezzoCent: r.prezzoCent,
    valuta: r.valuta,
    disponibile: r.disponibile,
  }));
}
