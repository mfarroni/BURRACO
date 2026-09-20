-- FASE 5.1 — Fondamenta dell'area webmaster. Migrazione ADDITIVA e idempotente.
--
-- `users.role` DEFAULT 'user' non confligge con 2v2 (0003) né statistiche
-- (0002/0007). Il ruolo è letto dal DB a OGNI richiesta amministrativa (token
-- opachi → revoca istantanea, nessun claim da scadere).
--
-- Promozione del PRIMO admin: query manuale documentata (nessun endpoint la esegue):
--   UPDATE users SET role='admin' WHERE email = 'mfarroni@gmail.com';
--
-- `admin_audit_log`: traccia scritta PRIMA dell'esecuzione, nella stessa
-- transazione dell'operazione. `outcome` include 'dry_run'. Retention 12 mesi.
--
-- Rollback:
--   DROP TABLE IF EXISTS "admin_audit_log";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "role";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id"   uuid NOT NULL REFERENCES "users"("id"),  -- chi
  "action"     text NOT NULL,                            -- quale azione
  "target"     jsonb,                                    -- su quali soggetti (id/criterio)
  "outcome"    text NOT NULL,                            -- 'ok'|'rejected'|'error'|'dry_run'
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_audit_log_created_at_idx"
  ON "admin_audit_log" ("created_at" DESC);
