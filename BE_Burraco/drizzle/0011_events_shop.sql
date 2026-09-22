-- CICLO Pannello Admin + Email — PREDISPOSIZIONE Eventi (Tornei) e Shop.
-- Migrazione ADDITIVA e idempotente. Solo scaffolding dati: tabelle nuove, nessuna
-- esposizione pubblica in questo ciclo (CRUD admin minimale create/list, niente
-- vetrina/carrello/pagamento). Entrambe entrano nel presidio occupazione.
--
-- Scelte non ovvie:
--   - prezzo_cent è un intero in CENTESIMI (mai float sul denaro).
--   - immagine_url è un URL, non un blob (il DB non è un CDN: l'immagine vive altrove).
--   - pubblicato/disponibile sono interruttori bozza↔pubblicazione senza cancellare.
--   - created_by è nullable (audit soft) con FK a users senza cascade.
--
-- Rollback:
--   DROP INDEX IF EXISTS "shop_products_disponibile_idx";
--   DROP TABLE IF EXISTS "shop_products";
--   DROP INDEX IF EXISTS "events_inizio_idx";
--   DROP TABLE IF EXISTS "events";

CREATE TABLE IF NOT EXISTS "events" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "titolo"      text NOT NULL,
  "descrizione" text,
  "luogo"       text,
  "inizio_at"   timestamptz NOT NULL,
  "fine_at"     timestamptz,
  "pubblicato"  boolean NOT NULL DEFAULT false,       -- bozza finché true (predisposto)
  "created_by"  uuid REFERENCES "users"("id"),        -- admin autore (nullable: audit soft)
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "events_inizio_idx" ON "events" ("inizio_at" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shop_products" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nome"         text NOT NULL,
  "descrizione"  text,
  "prezzo_cent"  integer NOT NULL DEFAULT 0,          -- CENTESIMI (mai float sul denaro)
  "valuta"       text NOT NULL DEFAULT 'EUR',
  "immagine_url" text,                                -- URL, non blob: il DB non è un CDN
  "disponibile"  boolean NOT NULL DEFAULT true,
  "created_by"   uuid REFERENCES "users"("id"),
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shop_products_disponibile_idx" ON "shop_products" ("disponibile");
