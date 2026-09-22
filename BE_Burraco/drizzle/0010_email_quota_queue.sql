-- CICLO Pannello Admin + Email — quota email condivisa e coda transazionale.
-- Migrazione ADDITIVA e idempotente: nessun impatto sulle tabelle esistenti.
--
-- Due oggetti nuovi:
--   1) email_quota_daily — contatore INTERNO di invii ACCETTATI da Brevo per
--      giorno-solare (fuso Europe/Rome). È la fonte di verità di "quanto inviato
--      oggi", preferita a interrogare l'API Brevo a ogni invio: una UPSERT locale.
--      "Azzerato a mezzanotte" = il cambio di giorno crea una nuova riga a sent=0
--      (nessun job di reset). Contiamo SOLO gli esiti 'sent' (skipped/error non
--      consumano quota reale Brevo).
--   2) email_queue — coda delle email TRANSAZIONALI (oggi 'benvenuto'; predisposta
--      ad altri tipi one-off). I broadcast NON entrano qui: hanno già la loro coda
--      per-destinatario in broadcast_recipients (idempotenza + conteggi esistenti).
--
-- Un UNICO dispatcher (scheduler ws/server.ts) svuota PRIMA email_queue (priorità),
-- POI broadcast_recipients, entrambi entro la quota residua del giorno.
--
-- Rollback:
--   DROP INDEX IF EXISTS "email_queue_pending_idx";
--   DROP TABLE IF EXISTS "email_queue";
--   DROP TABLE IF EXISTS "email_quota_daily";

CREATE TABLE IF NOT EXISTS "email_quota_daily" (
  "day"        date PRIMARY KEY,                      -- data nel fuso Europe/Rome (YYYY-MM-DD)
  "sent"       integer NOT NULL DEFAULT 0,            -- SOLO invii 'sent' (skipped/error non contano)
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "email_queue" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tipo"       text NOT NULL,                         -- 'benvenuto' (estendibile)
  "to_email"   text NOT NULL,
  "to_name"    text,
  "subject"    text NOT NULL,
  "body"       text NOT NULL,                         -- SOLO testo semplice, già composto
  "priorita"   integer NOT NULL DEFAULT 0,            -- 0 = massima (benvenuto)
  "stato"      text NOT NULL DEFAULT 'in_attesa',     -- 'in_attesa'|'inviata'|'fallita'|'saltata'
  "tentativi"  integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at"    timestamptz
);
--> statement-breakpoint

-- Indice PARZIALE sui soli pendenti: la coda resta piccola per il dispatcher anche
-- con storico grande. L'ordinamento (priorita, created_at) fa pescare prima i più
-- prioritari e, a parità, i più vecchi.
CREATE INDEX IF NOT EXISTS "email_queue_pending_idx"
  ON "email_queue" ("stato", "priorita", "created_at")
  WHERE "stato" = 'in_attesa';
