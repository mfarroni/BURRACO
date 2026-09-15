-- Macro-ciclo 3 (MODALITÀ 2v2 A COPPIE): due sole colonne ADDITIVE per il modello
-- di SQUADRA. Migrazione scritta a mano (coerente con lo stile idempotente di
-- 0000/0001/0002; drizzle/meta assente → nessuna generazione automatica).
-- Tutte le operazioni sono idempotenti: sicure da rieseguire. NON applicata a Neon
-- in questa tappa (i test girano in-memory con DATABASE_URL assente): file versionato.
--
-- Rollback: DROP delle due colonne (sono nullable additive, nessuna perdita per l'1v1):
--   ALTER TABLE "match_players" DROP COLUMN "team";
--   ALTER TABLE "matches" DROP COLUMN "winner_team";

-- 1) match_players.team — SQUADRA del posto (P4). Nullable: le partite pre-migrazione
--    restano valide. In individuale/1v1 team = seat; in coppie posti opposti (0+2, 1+3).
--    Il codice scrive sempre `team`; le letture usano `team ?? seat` per lo storico.
ALTER TABLE "match_players" ADD COLUMN IF NOT EXISTS "team" integer;
--> statement-breakpoint

-- 2) Backfill: le partecipazioni storiche non hanno squadra → team = seat (in 1v1 è
--    esattamente la squadra corretta). Solo dove ancora NULL (idempotente).
UPDATE "match_players" SET "team" = "seat" WHERE "team" IS NULL;
--> statement-breakpoint

-- 3) matches.winner_team — SQUADRA vincitrice. `winner_seat` RESTA (audit: posto che
--    ha chiuso). Nullable: valorizzato solo per le partite completate con un vincitore.
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "winner_team" integer;
--> statement-breakpoint

-- 4) Backfill: per le sole partite COMPLETATE con un vincitore, winner_team = winner_seat
--    (in 1v1 la squadra vincitrice coincide col posto). Le partite non completate o
--    senza vincitore restano NULL. Idempotente: riscrive lo stesso valore.
UPDATE "matches" SET "winner_team" = "winner_seat"
  WHERE "status" = 'completed' AND "winner_seat" IS NOT NULL;
