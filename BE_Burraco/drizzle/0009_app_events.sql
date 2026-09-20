-- FASE 5.4 — Log applicativi nostri (Blocco C). Migrazione ADDITIVA e idempotente.
-- È l'unica fonte di log che controlliamo (le altre viste sono proxy Render e
-- pg_stat_*). `messaggio`/`meta` sono GIÀ redatti (nessun segreto/token/indirizzo
-- completo): la redazione avviene a monte, alla scrittura, mai al render.
--
-- Nessuna FK verso questa tabella. Tetto righe + retention 30–90gg (§4.2): cresce,
-- ricade nel budget di 10k righe.
--
-- Rollback: DROP TABLE IF EXISTS "app_events";

CREATE TABLE IF NOT EXISTS "app_events" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "livello"    text NOT NULL,          -- 'info'|'warn'|'error'
  "categoria"  text NOT NULL,          -- 'auth'|'contact'|'cleanup'|'broadcast'|…
  "messaggio"  text NOT NULL,          -- già redatto (nessun segreto)
  "meta"       jsonb,                  -- già redatto
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "app_events_created_at_idx"
  ON "app_events" ("created_at" DESC);
