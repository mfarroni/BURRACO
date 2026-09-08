-- Macro-ciclo STORICO PARTITE & STATISTICHE: fatti di STILE per smazzata,
-- chiave d'idempotenza e indici per le query aggregate. Migrazione scritta a mano
-- (coerente con lo stile idempotente di 0001_lobby_session_hygiene.sql).
-- Tutte le operazioni sono idempotenti: sicure da rieseguire.

-- 1) hand_scores: fatti di STILE (analisi di gioco). Additivi, con default
--    retro-compatibili: le smazzate storiche restano valide (0 burrachi, pozzetto
--    non in diretta).
ALTER TABLE "hand_scores" ADD COLUMN IF NOT EXISTS "burrachi_puliti" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "hand_scores" ADD COLUMN IF NOT EXISTS "burrachi_sporchi" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "hand_scores" ADD COLUMN IF NOT EXISTS "pozzetto_in_diretta" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- 2) Bonifica di eventuali righe punteggio duplicate per (hand_id, seat) PRIMA di
--    creare la UNIQUE (finora endHand è chiamato una volta per smazzata: in pratica
--    non dovrebbero esistere duplicati, ma la deduplica rende la creazione sicura).
--    Tiene la riga con id minimo per ogni coppia (hand_id, seat).
DELETE FROM "hand_scores" a
USING "hand_scores" b
WHERE a."hand_id" = b."hand_id"
  AND a."seat" = b."seat"
  AND a."id" > b."id";
--> statement-breakpoint

-- 3) Chiave di idempotenza: una sola riga punteggio per (smazzata, seat). Un
--    secondo endHand sullo stesso hand_id viene respinto (INSERT ... ON CONFLICT
--    DO NOTHING) → nessun doppio conteggio.
CREATE UNIQUE INDEX IF NOT EXISTS "hand_scores_hand_seat_uq" ON "hand_scores" ("hand_id","seat");
--> statement-breakpoint

-- 4) Indici per le query aggregate. Le FK non sono auto-indicizzate in Postgres.
CREATE INDEX IF NOT EXISTS "match_players_user_match_idx" ON "match_players" ("user_id","match_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_ended_at_idx" ON "matches" ("ended_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hands_match_idx" ON "hands" ("match_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hand_scores_hand_idx" ON "hand_scores" ("hand_id");
