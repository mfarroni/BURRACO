-- FASE 4 — Totali consolidati per utente registrato. Migrazione ADDITIVA e
-- idempotente. Le statistiche sono ON-THE-FLY sul dettaglio: potare il dettaglio
-- (retention §4.2) le cancellerebbe. Questa tabella conserva le voci PERMANENTI
-- così il profilo mostra i totali anche dopo la potatura.
--
-- Aggiornata incrementalmente su `completeMatch` (una UPSERT per partita) +
-- riconciliazione periodica come rete di sicurezza. Solo utenti registrati hanno
-- una riga (gli ospiti non hanno profilo). Orizzonte: PERMANENTE.
--
-- Rollback: DROP TABLE IF EXISTS "user_stats_totals";

CREATE TABLE IF NOT EXISTS "user_stats_totals" (
  "user_id"           uuid PRIMARY KEY REFERENCES "users"("id"),
  "matches_played"    integer NOT NULL DEFAULT 0,
  "matches_won"       integer NOT NULL DEFAULT 0,
  "matches_lost"      integer NOT NULL DEFAULT 0,
  "matches_abandoned" integer NOT NULL DEFAULT 0,
  "total_points"      integer NOT NULL DEFAULT 0,
  "best_match_score"  integer,
  "burrachi_puliti"   integer NOT NULL DEFAULT 0,
  "burrachi_sporchi"  integer NOT NULL DEFAULT 0,
  "vs_registered"     integer NOT NULL DEFAULT 0,
  "vs_guest"          integer NOT NULL DEFAULT 0,
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);
