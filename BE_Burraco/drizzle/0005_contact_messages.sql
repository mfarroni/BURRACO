-- FASE 2 — Form contatti pubblico. Migrazione ADDITIVA, scritta a mano e
-- idempotente (coerente con lo stile di 0000..0004). Nessuna FK verso questa
-- tabella: il rollback non rompe nulla.
--
-- Principio (§2.1): il messaggio si salva SEMPRE; l'email è un di più. `ip_hash`
-- è sha256(ip + salt): mai l'IP in chiaro. `stato_invio` traccia l'esito email
-- senza mai rivelarlo all'utente (risposta sempre generica).
--
-- Conservazione dichiarata (§4, Gate 3): 180gg dopo `letto_at` (o dopo
-- `created_at` oltre soglia se mai letto), poi eliminazione.
--
-- Rollback: DROP TABLE IF EXISTS "contact_messages";

CREATE TABLE IF NOT EXISTS "contact_messages" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nome"        text NOT NULL,
  "email"       text NOT NULL,
  "oggetto"     text NOT NULL,
  "messaggio"   text NOT NULL,
  "user_id"     uuid REFERENCES "users"("id"),        -- nullable: form pubblico
  "ip_hash"     text NOT NULL,                         -- sha256(ip + salt): mai IP in chiaro
  "stato_invio" text NOT NULL DEFAULT 'salvato',       -- 'salvato'|'inviato'|'errore_invio'|'skippato'
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "letto_at"    timestamptz                            -- valorizzato quando il webmaster legge
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "contact_messages_created_at_idx"
  ON "contact_messages" ("created_at" DESC);
