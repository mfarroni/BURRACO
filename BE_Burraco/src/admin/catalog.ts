import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import type { EventRow, ShopProductRow } from "./types.js";

/**
 * CICLO Pannello Admin — PREDISPOSIZIONE Eventi (Tornei) e Shop (§2.6), dietro
 * `requireAdmin`. Eventi: create + list. Prodotti shop: CRUD completo (create, list,
 * update, delete) con descrizione e foto (CICLO Webmaster). Niente vetrina pubblica,
 * niente carrello/pagamento: l'esposizione al pubblico è un ciclo futuro.
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
  /** URL o data URL d'immagine (validato dall'handler HTTP). */
  immagineUrl?: string;
  disponibile?: boolean;
}

/** Aggiornamento PARZIALE: solo i campi presenti cambiano; `null` svuota descrizione/foto. */
export interface UpdateShopProductInput {
  nome?: string;
  descrizione?: string | null;
  prezzoCent?: number;
  valuta?: string;
  immagineUrl?: string | null;
  disponibile?: boolean;
}

const productColumns = {
  id: schema.shopProducts.id,
  nome: schema.shopProducts.nome,
  descrizione: schema.shopProducts.descrizione,
  prezzoCent: schema.shopProducts.prezzoCent,
  valuta: schema.shopProducts.valuta,
  immagineUrl: schema.shopProducts.immagineUrl,
  disponibile: schema.shopProducts.disponibile,
};

function toProductRow(r: {
  id: string;
  nome: string;
  descrizione: string | null;
  prezzoCent: number;
  valuta: string;
  immagineUrl: string | null;
  disponibile: boolean;
}): ShopProductRow {
  return {
    id: r.id,
    nome: r.nome,
    descrizione: r.descrizione,
    prezzoCent: r.prezzoCent,
    valuta: r.valuta,
    immagineUrl: r.immagineUrl,
    disponibile: r.disponibile,
  };
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
    .returning(productColumns);
  return row ? toProductRow(row) : null;
}

export async function listShopProducts(): Promise<ShopProductRow[]> {
  if (!db) return [];
  const rows = await db
    .select(productColumns)
    .from(schema.shopProducts)
    .orderBy(desc(schema.shopProducts.createdAt))
    .limit(LIST_LIMIT);
  return rows.map(toProductRow);
}

/** Aggiorna un prodotto. `undefined` = non toccare il campo. Ritorna null se inesistente. */
export async function updateShopProduct(id: string, input: UpdateShopProductInput): Promise<ShopProductRow | null> {
  if (!db) return null;
  const set: Partial<typeof schema.shopProducts.$inferInsert> = { updatedAt: new Date() };
  if (input.nome !== undefined) set.nome = input.nome;
  if (input.descrizione !== undefined) set.descrizione = input.descrizione;
  if (input.prezzoCent !== undefined) set.prezzoCent = Math.max(0, Math.trunc(input.prezzoCent));
  if (input.valuta !== undefined) set.valuta = input.valuta;
  if (input.immagineUrl !== undefined) set.immagineUrl = input.immagineUrl;
  if (input.disponibile !== undefined) set.disponibile = input.disponibile;
  const [row] = await db
    .update(schema.shopProducts)
    .set(set)
    .where(eq(schema.shopProducts.id, id))
    .returning(productColumns);
  return row ? toProductRow(row) : null;
}

/** Cancella un prodotto. Ritorna false se inesistente. */
export async function deleteShopProduct(id: string): Promise<boolean> {
  if (!db) return false;
  const rows = await db
    .delete(schema.shopProducts)
    .where(eq(schema.shopProducts.id, id))
    .returning({ id: schema.shopProducts.id });
  return rows.length > 0;
}
