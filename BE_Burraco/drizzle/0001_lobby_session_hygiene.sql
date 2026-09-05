-- Macro-ciclo LOBBY: elenco tavoli aperti, annullamento partita, igiene sessioni,
-- computo vittorie. Migrazione scritta a mano (coerente con lo stile idempotente di
-- 0000_hesitant_penance.sql; drizzle/meta assente → nessuna generazione automatica).
-- Tutte le operazioni sono idempotenti: sicure da rieseguire.

-- 1) matches: fine partita + autore dell'annullamento (audit).
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "aborted_by" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matches" ADD CONSTRAINT "matches_aborted_by_users_id_fk" FOREIGN KEY ("aborted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 2) users: marca di scadenza del record OSPITE (igiene sessioni, §6.4). NULL per i
--    registrati (mai marcati/cancellati).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "expired_at" timestamp with time zone;
--> statement-breakpoint

-- 3) Vocabolario di stato partita: le vittorie storiche (status legacy 'ended')
--    diventano 'completed' così continuano a contare nelle statistiche, che ora
--    filtrano su 'completed'. 'aborted'/'abandoned' verranno scritti dai nuovi
--    percorsi e non conteggiati.
UPDATE "matches" SET "status" = 'completed' WHERE "status" = 'ended';
