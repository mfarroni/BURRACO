-- Proposta donazione/condivisione — Lotto D: CONTATORE ANONIMO dei clic su
-- "Offri un caffè" e "Invita un amico". Migrazione ADDITIVA e idempotente: una
-- tabella nuova, nessun impatto sulle esistenti.
--
-- Scelte non ovvie:
--   - AGGREGATO per (giorno, tipo, punto): una riga per combinazione, incrementata.
--     Nessuna riga per clic → volumi minimi (al più 2 tipi × 6 punti al giorno) e
--     nessun dato del singolo evento.
--   - NESSUN dato personale: niente user id, niente IP (nemmeno hashato), niente
--     user agent. Il giorno è in UTC.
--   - Retention: righe oltre 180 giorni potate dal framework di retention.
--
-- Rollback:
--   DROP TABLE IF EXISTS "support_clicks";

CREATE TABLE IF NOT EXISTS "support_clicks" (
  "day"       date    NOT NULL,
  "kind"      text    NOT NULL,   -- 'caffe'|'invito'
  "placement" text    NOT NULL,   -- 'fine_partita'|'landing'|'lobby'|'sala_attesa'|'profilo'|'footer'
  "count"     integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("day", "kind", "placement")
);
