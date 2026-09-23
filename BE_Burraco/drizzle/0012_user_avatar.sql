-- CICLO Profilo + Webmaster — FOTO PROFILO dell'utente registrato.
-- Migrazione ADDITIVA e idempotente: una tabella nuova, nessun impatto sulle esistenti.
--
-- Scelte non ovvie:
--   - tabella DEDICATA (non una colonna di "users"): l'utente è letto a OGNI richiesta
--     autenticata (select completo nello store auth); una colonna da decine di KB lo
--     appesantirebbe. Qui la foto si legge solo quando serve (GET /users/me/avatar).
--   - "data" è un data URL (data:image/jpeg|png|webp;base64,...) già RIDIMENSIONATO dal
--     client (256x256) e con tetto di dimensione lato server. Nessun object storage
--     disponibile (Render + Neon) e la CSP del FE ammette solo img-src 'self' data:.
--   - ON DELETE CASCADE: la cancellazione di un utente rimuove anche la sua foto.
--
-- Rollback:
--   DROP TABLE IF EXISTS "user_avatars";

CREATE TABLE IF NOT EXISTS "user_avatars" (
  "user_id"    uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "data"       text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
