-- Lotto 5 (R8 — PROTEZIONE LOGIN / LOCKOUT PROGRESSIVO): una sola tabella ADDITIVA
-- per persistere il contatore dei tentativi di login falliti. Migrazione scritta a
-- mano (coerente con lo stile idempotente di 0000/0001/0002/0003). Tutte le
-- operazioni sono idempotenti: sicure da rieseguire. NON applicata a Neon in questa
-- tappa (i test girano in-memory con DATABASE_URL assente): file versionato; la
-- applica l'utente su Neon.
--
-- Contenuto NON sensibile: la colonna "key" è un hash sha256 di (email normalizzata
-- + IP), MAI l'email o l'IP in chiaro; nessun segreto (niente password/token). La
-- tabella non è referenziata da alcuna FK, quindi il rollback non rompe nulla.
--
-- Rollback: DROP TABLE IF EXISTS "login_attempts";

-- 1) login_attempts — contatore per-chiave. La chiave è hash(email + IP) (R8): un
--    attaccante che martella l'account-A da un IP rallenta SOLO la coppia (A, quell'IP),
--    non l'utente legittimo di A dal proprio IP (nessuna weaponization). failed_count
--    cresce entro la finestra e si azzera dopo WINDOW_MS di inattività (nessun blocco
--    definitivo). window_started_at = inizio della serie corrente; last_failed_at =
--    ultimo fallimento (governa azzeramento e sweep).
CREATE TABLE IF NOT EXISTS "login_attempts" (
  "key" text PRIMARY KEY,                                        -- hash(email + ip); nessun segreto in chiaro
  "failed_count" integer NOT NULL DEFAULT 0,
  "window_started_at" timestamptz NOT NULL DEFAULT now(),        -- inizio della serie corrente (audit)
  "last_failed_at" timestamptz NOT NULL DEFAULT now()            -- ultimo fallimento (azzeramento + sweep)
);
--> statement-breakpoint

-- 2) Indice su last_failed_at per lo sweep periodico (pruneLoginAttempts): elimina i
--    record inattivi da oltre la finestra senza scansionare l'intera tabella.
CREATE INDEX IF NOT EXISTS "login_attempts_last_failed_idx"
  ON "login_attempts" ("last_failed_at");
