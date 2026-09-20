-- FASE 5.3 — Comunicazioni ai registrati (Blocco B). Migrazione ADDITIVA e
-- idempotente. Consenso promozionale + disiscrizione su `users`; tabelle
-- `broadcasts` (aggregato) e `broadcast_recipients` (un destinatario per riga).
--
-- Idempotenza: UNIQUE(broadcast_id, user_id) → un doppio send non duplica.
-- Invio ASINCRONO a lotti (mai in linea con la risposta HTTP), un'email per
-- destinatario. Retention: broadcast_recipients 90gg dopo invio.
--
-- Rollback:
--   DROP TABLE IF EXISTS "broadcast_recipients";
--   DROP TABLE IF EXISTS "broadcasts";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "unsub_token";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "promo_opt_in";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "promo_opt_in" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "unsub_token" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "broadcasts" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "author_id"  uuid NOT NULL REFERENCES "users"("id"),
  "oggetto"    text NOT NULL,
  "corpo"      text NOT NULL,                  -- SOLO testo semplice
  "tipo"       text NOT NULL,                  -- 'servizio' | 'promozionale'
  "criterio"   jsonb NOT NULL,                 -- {registratiDopo?, minPartite?, inattiviDaGiorni?, all?}
  "stato"      text NOT NULL DEFAULT 'bozza',  -- 'bozza'|'in_invio'|'completato'|'errore'
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "broadcast_recipients" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "broadcast_id" uuid NOT NULL REFERENCES "broadcasts"("id"),
  "user_id"      uuid NOT NULL REFERENCES "users"("id"),
  "stato"        text NOT NULL DEFAULT 'in_coda', -- 'in_coda'|'inviato'|'errore'|'saltato'
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Idempotenza per destinatario (un doppio send non duplica le righe).
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_recipients_broadcast_user_uq"
  ON "broadcast_recipients" ("broadcast_id", "user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "broadcast_recipients_broadcast_idx"
  ON "broadcast_recipients" ("broadcast_id");
