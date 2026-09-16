# Spec Lotto 5 — Protezione login senza captcha: lockout progressivo (R8)

> **Branch:** `claude/protezione-login-lockout`. **Backend** (auth + migrazione `0004`) + micro-FE
> (honeypot). **Nessun captcha, nessuna dipendenza nuova, nessuna modifica alla CSP.**
> Verifica su URL di deploy + log Render. **Dipendenze:** indipendente.

---

## Stato attuale (già presente)
- Rate-limit **per-IP, finestra fissa, IN-RAM** su login/register/guest (`http/rateLimit.ts`); login
  `max:20 / 15min` (`http/app.ts:162`).
- Login **già a errore generico**: `401 INVALID_CREDENTIALS` anche per body malformato
  (`app.ts:185-199`); nessun oracolo email-vs-password; difesa timing con hash civetta
  (`auth/password.ts`, `auth/service.ts:120-139`).
- **Manca:** lockout progressivo per-account, honeypot, **persistenza** del contatore (il RAM si
  azzera al risveglio di Render → protezione vanificata). Nessuna tabella tentativi
  (`db/schema.ts`).

---

## Design (difesa a strati, in casa)

### Chiave e anti-weaponization
- Contatore keyed su **`hash(emailNormalizzata + IP)`** (non solo account). Così un attaccante da un
  IP che martella l'account-A rallenta **solo la coppia (A, quell'IP)**: l'utente legittimo di A dal
  **proprio** IP non è mai bloccato → niente denial-of-service sull'account altrui. Il brute-force
  multi-IP resta limitato dal **rate-limit per-IP già presente** (20/15min per IP). I due strati si
  combinano come richiesto.
- **Anti-oracle:** il contatore si applica **identico** che l'email esista o no (si registra il
  tentativo anche per email inesistenti) → il comportamento (messaggio **e** curva dei tempi) non
  rivela se l'account esiste. Il messaggio resta **sempre** `401 INVALID_CREDENTIALS`.

### Ritardo progressivo con azzeramento automatico
- Finestra `WINDOW_MS` (es. **15 min**). Entro la finestra si conta `failedCount`.
- Soglia di grazia `FREE_TRIES` (es. **3**): i primi tentativi non hanno ritardo (errori umani).
- Oltre la soglia, ritardo server-side **crescente e cappato**:
  `delay = min(BASE_MS * 2^(failedCount - FREE_TRIES), MAX_DELAY_MS)` (es. BASE=500ms, MAX=8s).
  Il ritardo si applica **prima** di rispondere al fallimento (rallenta il brute-force da
  quell'IP/quella coppia).
- **Successo** (password corretta) → `clearLoginAttempts(key)`: l'utente legittimo che conosce la
  password entra; l'eventuale attesa accumulata è breve e auto-inflitta.
- **Azzeramento automatico:** trascorsa `WINDOW_MS` senza nuovi fallimenti, il contatore riparte da
  zero. **Nessun blocco definitivo.**
- Cap prudente al ritardo (MAX 8-10s) per non trasformare il ritardo stesso in un vettore DoS su
  Render free single-instance; il numero di risposte ritardate concorrenti è naturalmente limitato
  dal rate-limit per-IP.
- Parametri centralizzati e commentati (tarabili dal lead), come le costanti in `auth/service.ts`.

### Honeypot
- Campo nascosto nel **form di login** (`AuthPanel.tsx`, ramo `mode==="login"`), invisibile e
  `autocomplete="off"`, `tabindex="-1"`, `aria-hidden="true"` (i bot lo compilano, gli umani no).
- Il BE lo riceve nel body login: se **valorizzato** → risposta `401 INVALID_CREDENTIALS` immediata
  (stesso messaggio generico), **senza** verifica password né consumo argon2. Costo trascurabile.

---

## Contratto / superficie API
- **Nessun nuovo tipo pubblico.** `POST /auth/login` conserva firma e risposte: 401
  `INVALID_CREDENTIALS` in ogni caso di fallimento (credenziali errate, account inesistente,
  rallentato, honeypot). Cambia solo il **body accettato** (campo honeypot opzionale, ignorato se
  vuoto). Nessun header nuovo che riveli lo stato di lockout.
- Il FE non ha bisogno di conoscere il lockout: continua a mostrare lo stesso errore generico.

## Migrazione `0004` (additiva, idempotente — stile 0000-0003)
`BE_Burraco/drizzle/0004_login_attempts.sql` + `db/schema.ts`:
```sql
CREATE TABLE IF NOT EXISTS "login_attempts" (
  "key" text PRIMARY KEY,                        -- hash(email + ip)
  "failed_count" integer NOT NULL DEFAULT 0,
  "window_started_at" timestamptz NOT NULL DEFAULT now(),
  "last_failed_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_last_failed_idx"
  ON "login_attempts" ("last_failed_at");        -- per lo sweep dei record vecchi
```
- Rollback: `DROP TABLE IF EXISTS "login_attempts";`. Nessun impatto su dati esistenti (tabella
  nuova, non referenziata da FK).
- **Nessun segreto** in tabella: solo un hash chiave + contatori/timestamp (né email in chiaro né
  password).

## AuthStore — nuovi metodi (interfaccia + Drizzle + Memory)
`BE_Burraco/src/auth/types.ts` (interfaccia) e le due impl (`store.drizzle.ts`, `store.memory.ts`):
```
getLoginAttempt(key: string): Promise<{ failedCount: number; windowStartedAt: Date; lastFailedAt: Date } | null>;
recordFailedLogin(key: string, now: Date, windowMs: number): Promise<number>;  // ritorna il nuovo failedCount (reset se fuori finestra)
clearLoginAttempts(key: string): Promise<void>;                                 // su login riuscito
pruneLoginAttempts(cutoff: Date): Promise<number>;                              // sweep periodico (runMaintenance)
```
La **MemoryAuthStore** replica la stessa semantica in RAM (per test/dev senza DB), coerente con il
resto dello store.

## AuthService.login — nuova logica
`BE_Burraco/src/auth/service.ts` (`login`, `:120-139`) riceve anche l'**IP** (passato dall'handler):
1. calcola `key = hash(normEmail + ip)`; legge `getLoginAttempt(key)`;
2. se in finestra e `failedCount > FREE_TRIES`, calcola e **attende** `delay` prima di procedere;
3. esegue la verifica esistente (con hash civetta se l'utente non esiste: invariato);
4. **fallimento** → `recordFailedLogin(key, ...)` poi `throw INVALID_CREDENTIALS` (generico);
5. **successo** → `clearLoginAttempts(key)` e prosegue come oggi (emissione sessione).
- `runMaintenance` (`:198-202`) chiama anche `pruneLoginAttempts(now - WINDOW_MS)` (best-effort).

## HTTP handler — passaggio IP + honeypot
`BE_Burraco/src/http/app.ts` (`/auth/login`, `:185-199`):
- estendere `loginBody` con un campo honeypot opzionale (es. `website: z.string().optional()` — nome
  neutro e plausibile per i bot); se valorizzato → `401 INVALID_CREDENTIALS` immediato.
- passare `req.ip` (già affidabile, `trust proxy` impostato, SEC-A1) a `auth.login(email, password, ip)`.
- Il `loginLimiter` per-IP resta **davanti** (invariato).

## FE — honeypot
`FE_Burraco/src/components/AuthPanel.tsx`: nel form login un input nascosto (CSS: fuori schermo o
`display:none` + `tabindex="-1"` + `aria-hidden`), inviato nel body solo se il browser lo compila
(di norma vuoto). `FE_Burraco/src/lib/auth.ts`/`useAuth.ts`: includere il campo (vuoto) nella
chiamata login. **Nessun testo visibile**, nessun impatto UX per l'utente reale.

## Whitelist
- `BE_Burraco/drizzle/0004_login_attempts.sql` (nuovo) + `db/schema.ts` (tabella).
- `BE_Burraco/src/auth/types.ts`, `store.drizzle.ts`, `store.memory.ts`, `service.ts`.
- `BE_Burraco/src/http/app.ts` (honeypot + IP; `loginBody`).
- `FE_Burraco/src/components/AuthPanel.tsx`, `FE_Burraco/src/lib/auth.ts` / `useAuth.ts` (campo honeypot).
- Costanti di tuning: in `auth/service.ts` (o un piccolo modulo dedicato), commentate.

## Blacklist
- `FE_Burraco/next.config.mjs` (CSP) — invariata.
- Nessuna nuova dipendenza (niente Redis/librerie captcha/proof-of-work).
- Il rate-limit per-IP esistente (`http/rateLimit.ts`): confermato, **non** rimosso (resta lo strato IP).
- Register/guest: fuori scope (il `409 EMAIL_TAKEN` resta com'è, rischio v1 accettato).

## Requisiti da dichiarare (e verificare)
1. **Messaggio identico** in ogni caso: credenziali errate, account inesistente, account rallentato,
   honeypot → sempre `401 INVALID_CREDENTIALS`, stesso testo.
2. **Lockout non weaponizzabile:** ripetuti fallimenti da un IP contro l'account-A **non** impediscono
   ad A di entrare dal proprio IP; nessun blocco definitivo (azzeramento automatico dopo la finestra).
3. **Contatore persistito:** sopravvive al riavvio/risveglio del servizio (DB, non RAM).

## Criteri di accettazione (verificabili su deploy + log Render)
1. Dopo N (> FREE_TRIES) tentativi falliti ravvicinati sulla **stessa email dallo stesso IP**, i
   tentativi successivi rispondono **più lentamente** (ritardo crescente), sempre con lo **stesso**
   messaggio; i log Render mostrano l'incremento del contatore.
2. Con la **password corretta** l'utente entra comunque (il successo azzera il contatore).
3. Un attaccante che fallisce su A da un IP **non** impedisce l'accesso di A da un IP diverso
   (nessun DoS sull'account).
4. Il messaggio d'errore è **identico** per email inesistente, password errata e account rallentato.
5. Dopo un **riavvio del servizio** (o cold start Render), il contatore **non riparte da zero** (letto
   dal DB) — verificabile riprovando dopo un risveglio.
6. Il campo **honeypot** compilato produce `401` immediato senza log di verifica password.
7. `next lint`/`typecheck` verdi; migrazione `0004` applicata a Neon senza errori (o dichiarato se
   l'ambiente dell'agente non ha la toolchain/DB).
