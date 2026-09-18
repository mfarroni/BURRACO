# ANALISI — CONTATTI, AREA WEBMASTER, EMAIL, DISPONIBILITÀ E RETENTION

**Autore fase:** agente_analista (lead)
**Fase:** ANALISI (nessun codice applicativo; ammessi solo SQL, firme endpoint, nomi env)
**Branch:** `claude/Area-webmaster-contatti` (creato da `origin/main`, isolato — §0-bis)
**Destinatario a valle:** `agente_develop`
**Data:** 2026-09-18

> **Regola d'oro rispettata (§0):** motore di gioco, tavolo, lobby, WebSocket e
> contratto FE/BE sono FUORI SCOPE. Dove un'esigenza sfiora `engine/`, `room/` o
> `contract/`, il documento lo segnala e propone una via che NON li tocca (vedi §D3, §5.2).

---

## A. STATO REALE DEL CODICE (verificato, non riscoperto)

| Area | Fatto verificato | Riferimento |
|---|---|---|
| Migrazioni | Ultima presente = **0004**. Prossima libera = **0005**. | `BE_Burraco/drizzle/0000…0004_*.sql`, `meta/_journal.json` |
| Generazione migrazioni | `drizzle-kit generate` / `migrate`; schema in `db/schema.ts`. | `BE_Burraco/package.json` (`db:generate`, `db:migrate`) |
| Auth | **Token di sessione OPACHI** (sha256 in tabella `sessions`), risolti sul DB a ogni richiesta via `getPrincipalByToken`. **NON JWT con claim.** | `auth/service.ts:277`, `auth/types.ts` |
| Principale | `AuthPrincipal = { userId, displayName, isGuest }` — nessun `role`. | `auth/types.ts:57` |
| Rotte HTTP | `createHttpApp(auth, stats?, manager?)` monta `/health`, `/auth/*`, `/users/me/*`, `/tables*`, `/session/leave`. | `http/app.ts:109` |
| Rate-limit | In-RAM, finestra fissa, chiave `IP+nome`. Login 20/15min, register/guest 50/15min. | `http/rateLimit.ts`, `http/app.ts:164` |
| Honeypot | Pattern **già in uso** sul login: campo nascosto `website` → 401 immediato. | `http/app.ts:200`, `useAuth.ts:26` |
| `/health` | Esiste, ritorna `{status:"ok"}` — **NON tocca il DB**. | `http/app.ts:155` |
| Scheduler periodico | Pattern `setInterval(...).unref()` già presente; `authSweep` ogni **6h** chiama `authService.runMaintenance()`. | `ws/server.ts:176` |
| Manutenzione | `runMaintenance()` pota sessioni/ospiti/login-attempts; `pruneInactiveGuests` **già** elimina ospiti scaduti **non referenziati** da partite. | `auth/service.ts:262`, `auth/types.ts:136` |
| Statistiche | **Calcolate ON-THE-FLY** (decisione A): nessuna tabella denormalizzata, solo aggregati su `matches`/`match_players`/`hand_scores`. | `stats/types.ts:12`, `stats/store.drizzle.ts:20` |
| FE routing | App Router **a rotta singola**: `app/layout.tsx` + `app/page.tsx`. Nessun segmento aggiuntivo. `globals.css` caricato ovunque. | `app/layout.tsx`, `app/page.tsx` |
| CSP | Enforce su `/:path*`; `connect-src 'self' + API/WS`; nessuna risorsa esterna. | `next.config.mjs:49` |
| FK verso `users.id` | `sessions.user_id`, `matches.aborted_by`, `match_players.user_id`. | `db/schema.ts:62,92,121` |
| Env FE pubbliche | `NEXT_PUBLIC_KOFI_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` (mailto vetrina), `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`. | `Landing.tsx:35`, `.env.example` |

### A1. Discrepanze brief ↔ realtà (da confermare col lead)

1. **Il form contatti "inerte" NON esiste.** La sezione Contatti attuale (`Landing.tsx:459-478`)
   è la **v2**: solo un CTA `mailto:` ("Scrivi al circolo") gated su `NEXT_PUBLIC_CONTACT_EMAIL`.
   Non c'è né form disabilitato né la riga "Modulo in arrivo prossimamente". Il commento in
   testa al file lo dichiara: *"Contatti senza form disabilitato: un solo CTA mail"*.
   → **Impatto:** la Fase 2 non "riattiva" un form, lo **costruisce da zero** sostituendo/affiancando
   il CTA mailto. Nessun `disabled` da rimuovere.
2. **Non è JWT, sono token opachi.** Il Contesto (§1) e la Fase 5.1 parlano di "claim nel JWT".
   L'implementazione reale usa token opachi risolti sul DB a ogni richiesta. → **Buona notizia:**
   il requisito "ruolo letto dal DB a ogni richiesta amministrativa" è **già soddisfatto
   dall'architettura**; una revoca è istantanea. Non serve alcun accorgimento anti-claim.
3. **Nessuna cartella `.github/`.** Il workflow keep-alive (Fase 3, Livello 1) è un file **nuovo**.

---

## FASE 0 — Testo vetrina + verifica regola di chiusura

### 0.1 Testo vetrina (modifica applicativa, la sola di questa fase)
- **Stringa:** `FE_Burraco/src/components/Landing.tsx:66`, array `STEPS`, passo "Chiudi":
  - Attuale: `"Due burraco in tavola e la mano vuota. Poi si contano i punti."`
  - Nuova: `"Burraco in tavola e la mano vuota. Poi si contano i punti."`
  - Interventi: rimuovere `"Due "`, maiuscolizzare `burraco → Burraco`, spaziatura invariata.
- **Unicità/test:** `grep` conferma **una sola** occorrenza di "Due burraco" nell'intero repo (quella).
  Il FE **non ha test**; i 40 test BE non referenziano stringhe di vetrina → **modifica sicura**.
- **Motivazione dominio (§2.7):** "due burraco" nel testo suggeriva erroneamente il numero di
  burrachi richiesti per chiudere. La skill parla di due **tipi** (pulito/sporco), non due burrachi.
  La modifica **allinea** il testo alla regola, non è una scelta redazionale.

### 0.2 Verifica regola di chiusura nel motore (SOLO verifica, nessuna correzione — §Fase 0)
**Esito: il motore è ALLINEATO al §2.7. Nessun disallineamento da segnalare.**

| Requisito §2.7 | Implementazione | Riferimento |
|---|---|---|
| Ultima carta scartata ≠ matta | `if (willEmpty && card.isWild) reject("ILLEGAL_LAST_DISCARD")` | `engine/game.ts:483-487` |
| Serve **un** burraco (della coppia) | `canClose` richiede almeno un burraco della squadra (`italiana` → qualsiasi) | `engine/game.ts:684-689` |
| Serve il pozzetto preso | `canClose` richiede `teamHasPozzetto(team)` | `engine/game.ts:683` |
| "Basta un burraco" (non due) | La condizione è `some(... isBurraco ...)`, non un conteggio ≥ 2 | `engine/game.ts:684` |

→ **Non modificare il motore in questo ciclo.** La skill di dominio **non va toccata**.

---

## FASE 1 — Brevo: credenziali e modulo email condiviso

### 1.1 Motivazione della collocazione (solo BE) — da riportare, come richiesto
- Il FE è interamente `"use client"`: **qualunque** variabile che lo raggiunge è leggibile
  dall'utente → la API key non può stare sul FE.
- La CSP ha `connect-src 'self' <API_URL,WS_URL>`: il browser **non può** contattare
  `api.brevo.com` comunque (verrebbe bloccato). L'unica via è il BE come proxy.
- Coerenza architetturale: ogni integrazione esterna vive dietro il backend. → **Su Vercel non si
  configura nulla di Brevo; nessuna `NEXT_PUBLIC_` associata a Brevo** (§2.1 vincolante).

### 1.2 Variabili d'ambiente (Render), replicate in `BE_Burraco/.env.example` con valori fittizi

| Variabile | Uso | Esempio fittizio in `.env.example` |
|---|---|---|
| `BREVO_API_KEY` | Autenticazione API (header `api-key`) | `xkeysib-xxxxxxxx-fittizia` |
| `BREVO_SENDER_EMAIL` | Mittente verificato | `no-reply@circolonettuno.example` |
| `BREVO_SENDER_NAME` | Nome mittente | `Circolo Nettuno` |
| `CONTACT_TO_EMAIL` | Destinatario dei messaggi del form contatti | `contatti@circolonettuno.example` |
| `BREVO_ENABLED` | Interruttore invio (senza rimuovere codice) | `false` |

> `.env.example` è versionato e pubblico: **valori fittizi soltanto**, mai la key reale.

### 1.3 Modulo di invio UNICO — firma e contratto
Nuovo modulo BE, **non su `contract/`** (§0.d): `BE_Burraco/src/mail/`
- `mail/types.ts` — tipi interni (nessun tipo esposto ai client):
  ```ts
  export interface SendEmailInput {
    to: { email: string; name?: string };
    subject: string;      // già sanificato dal chiamante (§2 anti-injection)
    text: string;         // SOLO testo semplice (§2.4), niente HTML
    replyTo?: { email: string; name?: string };
    tags?: string[];      // es. ["contact"] | ["broadcast:<id>"] per diagnosi
  }
  export type SendEmailResult =
    | { status: "sent"; providerId?: string }
    | { status: "skipped"; reason: "disabled" | "quota" }   // non è un errore
    | { status: "error"; reason: "network" | "timeout" | "provider"; httpStatus?: number };
  ```
- `mail/brevo.ts` — trasporto con **`fetch` nativo** (Node 20+, nessuna dipendenza):
  - Endpoint: `POST https://api.brevo.com/v3/smtp/email`, header `api-key: <BREVO_API_KEY>`,
    `content-type: application/json`; body `{ sender, to:[…], subject, textContent, replyTo? }`.
  - **Timeout:** `AbortController`, proposta **8 s** (Render↔Brevo è veloce; oltre è anomalia).
  - **Retry:** al più **1** ritentativo su errore transitorio (5xx / rete / timeout), backoff breve
    (~1 s). **Nessun retry** su 4xx (400/401 = config errata, 402/429 = quota/limite → `skipped:quota`).
  - **`BREVO_ENABLED=false`** → ritorna `skipped:disabled` **senza** chiamare la rete.
  - **Quota esaurita** (429/402) → `skipped:quota` (mai eccezione al chiamante).
  - **Log:** MAI la key, MAI l'indirizzo completo. Ammesso: dominio del destinatario, esito,
    `httpStatus`, `tags`. (es. `[mail] to=***@dominio esito=sent`).
- `mail/index.ts` — `sendEmail(input): Promise<SendEmailResult>`, l'**unico** punto usato sia dal
  form contatti (§2) sia dalle comunicazioni webmaster (§5.3). *Motivo: due implementazioni
  divergerebbero nel comportamento d'errore.*

### 1.4 Attività del LEAD (non del codice) — da riportare
- **Verifica SPF/DKIM** del dominio mittente sulla console Brevo: senza, le email finiscono in spam.
- **Verifica il tetto giornaliero reale** del piano Brevo attivo (console → *SMTP & API / Plan*).
  ⚠️ **Non assumere.** (Storicamente il free è nell'ordine delle centinaia/giorno, ma il numero va
  **letto e citato con la fonte** — §9, e serve alla Fase 5.3 per il lotto broadcast.) → **Gate 2**.

---

## FASE 2 — Form contatti

### 2.1 Principio portante
**Il messaggio si salva SEMPRE sul database; l'email è un di più.** Brevo irraggiungibile o a
quota esaurita → l'utente **non** perde il messaggio e **non** vede un errore.

### 2.2 Tabella `contact_messages` (migrazione **0005**)
```sql
CREATE TABLE contact_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  email        text NOT NULL,
  oggetto      text NOT NULL,
  messaggio    text NOT NULL,
  user_id      uuid REFERENCES users(id),         -- nullable: form pubblico
  ip_hash      text NOT NULL,                      -- sha256(ip + salt): mai IP in chiaro
  stato_invio  text NOT NULL DEFAULT 'salvato',    -- 'salvato'|'inviato'|'errore_invio'|'skippato'
  created_at   timestamptz NOT NULL DEFAULT now(),
  letto_at     timestamptz                         -- valorizzato quando il webmaster lo legge
);
CREATE INDEX contact_messages_created_at_idx ON contact_messages (created_at DESC);
```
- `user_id` FK **ON DELETE no action** (coerente con lo schema esistente): un ospite referenziato
  qui non è cancellabile finché la riga vive; ricade nella retention (§4).
- **Conservazione dichiarata (§4):** proposta **retention 180 giorni** dopo `letto_at` (o dopo
  `created_at` se mai letto oltre una soglia), poi eliminazione. *Motivo: sono messaggi operativi,
  non storico di dominio; concorrono al budget 10k (§4).* → orizzonte da approvare al **Gate 3**.

### 2.3 Endpoint `POST /api/contact` — PUBBLICO (il punto più esposto dell'app)
Firma (montato in `createHttpApp`, **non richiede** Bearer):
```
POST /api/contact
body: { nome, email, oggetto, messaggio, website?, renderedAt? }
→ 200 { ok: true }            // risposta SEMPRE generica (non rivela l'esito email)
→ 400 { error:"INVALID_BODY" }
→ 429 { error:"RATE_LIMITED" }
→ 413 { error:"PAYLOAD_TOO_LARGE" }
```
Difese (server-authoritative; nascondere un pulsante non è sicurezza):
- **Rate-limit per IP più severo degli esistenti.** Riuso di `rateLimit()`; proposta
  **`contact`: max 5 / 60 min per IP** (login è 20/15min; il contatto pubblico va più stretto).
- **Limiti di lunghezza (zod):** `nome ≤ 80`, `email ≤ 254` + formato email, `oggetto ≤ 120`,
  `messaggio ≤ 2000`. Corpo JSON oltre soglia → 413 (il cap globale è 8kb; valutare cap dedicato).
- **Anti-spam senza servizi esterni** (la CSP li vieta):
  1. **Honeypot** — campo nascosto (riuso del nome `website` già in uso lato login); valorizzato →
     **200 generico** senza salvare né inviare (rifiuto silenzioso).
  2. **Soglia di tempo minimo di compilazione** — `renderedAt` (timestamp di render del form,
     firmato lato server o confrontato con una finestra): submit < ~3 s → trattato come bot
     (rifiuto silenzioso). *Nota: `renderedAt` dal client è manipolabile; vale come filtro
     statistico, non come prova.*
  3. **Rate-limit** (sopra).
  - **Cosa NON copre:** attaccante determinato, IP distribuiti/botnet, spam a bassa frequenza.
    A questa scala (un circolo, volumi bassi) i tre livelli abbattono lo spam automatico comune;
    per volumi maggiori servirebbe un servizio esterno (oggi vietato dalla CSP).
- **Anti-injection di intestazioni:** nessun campo utente entra in `subject`/`replyTo`/header senza
  **sanificazione di newline e caratteri di controllo** (`\r`, `\n`, `\0`, ecc.). L'oggetto email
  interno è **generato dal server** (es. `"[Contatti] " + oggetto_sanificato`); l'email utente va
  in `replyTo` **solo dopo** validazione formato + strip di newline.
- **`ip_hash`:** `sha256(ip + salt)` (riuso della disciplina "mai segreti in chiaro" di `login_attempts`).

### 2.4 Flusso server
1. Valida (zod) → 400 se non valido. 2. Honeypot/tempo → 200 generico silenzioso se sospetto.
3. Rate-limit → 429. 4. **INSERT `contact_messages` (`stato_invio='salvato'`)** — questo non deve
mai fallire silenziosamente. 5. `sendEmail()` best-effort → aggiorna `stato_invio`
(`inviato`|`errore_invio`|`skippato`) fuori dal path critico. 6. Risposta **200 generica** a
prescindere dall'esito email.

### 2.5 Stati UI (FE, coerenti con le modali esistenti)
- Sostituire/affiancare il CTA mailto con un form reale nella sezione `#contatti`.
- Stati: **invio** (`aria-busy="true"`, pulsante disabilitato), **successo** (`role="alert"`
  messaggio generico "Grazie, ti risponderemo"), **errore di rete** (`role="alert"`, solo per
  fallimento HTTP del `POST`, mai per l'esito email). Campo honeypot nascosto (fuori tab-order,
  `aria-hidden`, `autocomplete="off"`).

---

## FASE 3 — Disponibilità del servizio

### 3.1 Riformulazione del problema (da riportare)
La lentezza del primo accesso ha **due cause di peso diverso**: **Render free** si sospende e
riparte nell'ordine delle **decine di secondi** (collo di bottiglia percepito); **Neon** riparte
nell'ordine del **mezzo secondo**. Il bersaglio primario è Render, non il DB.

### 3.2 Passo obbligatorio: MISURARE
Estendere `/health` (`http/app.ts:155`) affinché esegua anche un **`SELECT 1`** e strumenti i log:
```
GET /health → { status:"ok", db:"ok"|"down", tProcessMs, tQueryMs }
```
- `tProcessMs`: tempo dal boot del processo alla richiesta (misura il risveglio del processo).
- `tQueryMs`: durata del `SELECT 1` (misura il risveglio del compute Neon).
- **Sola lettura**, nessuna scrittura. Se `db` è null (no `DATABASE_URL`) → `db:"down"` senza errore.
- Sul deploy di branch è l'**unico** modo per il lead di vedere il fenomeno (nessun ambiente locale).

### 3.3 Livello 1 — keep-alive in fascia oraria (GitHub Actions schedulato)
- File **nuovo** `.github/workflows/keep-alive.yml`: `schedule: cron` che fa `curl` a `/health`.
- **Sola lettura**, riconoscibile nei log (es. header `User-Agent: keepalive-ci`), **non scrive** sul DB.
- **Fascia proposta 8:00–24:00 ora italiana** (16h/giorno). Cron GH Actions è in **UTC**: l'estate
  (CEST, UTC+2) è `0 6-21 * * *`; l'inverno (CET, UTC+1) è `0 7-22 * * *`. *Nota: GH Actions non
  gestisce i fusi; il DST va gestito con due finestre o una finestra prudente.*
- ⚠️ **Gate 2 — quote reali, da VERIFICARE e CITARE (non assumere, §9):**
  - **Render** (console → servizio → *Metrics/Billing*): ore di compute incluse/mese sul piano free.
  - **Neon** (console → *Usage*): ore di compute incluse/mese sul piano free.
  - **Aritmetica di copertura:** 16h/giorno × 30 = **480 h/mese** di "sveglio". L'intervallo del
    keep-alive (es. ogni 10–14 min) va scelto **dopo** aver verificato che 480 h/mese **rientrino**
    nella quota; una copertura 24/7 (720 h) rischia di esaurire la quota e causare un blocco a fine
    mese — **danno peggiore del problema**. → intervallo e fascia **approvati dal lead al Gate 2**.

### 3.4 Livello 2 — schermata di connessione con riprova automatica (FE)
- Sostituisce l'errore/attesa muta quando il backend riparte. Serve **anche a servizio sempre
  acceso**, perché **ogni deploy = un riavvio**.
- Messaggio in tono ("stiamo apparecchiando il tavolo…"), **tentativi ripetuti con backoff**
  (es. 1s→2s→4s→8s cap), **ingresso automatico** appena `/health` risponde, **messaggio diverso**
  dopo un tempo lungo (es. >45s: "il tavolo ci mette più del solito…").
- **Nessun** pulsante "riprova" come unica via d'uscita; **nessun** timer che chieda solo di aspettare.
- Aggancio: probe verso `/health` (già in `connect-src`), non verso il WS.

### 3.5 Livello 3 — solo da documentare (non implementare)
- Il piano a pagamento di Render elimina lo spegnimento alla radice. **Riportare il costo mensile
  attuale rilevato in console (citare la fonte)** e valutarne la convenienza vs la complessità del
  keep-alive, come **decisione futura del lead**. → **Gate 2** (dato da verificare, non assumere).

---

## FASE 4 — Conservazione dei dati e budget di 10.000 righe

Il vincolo è **10.000 righe complessive**. La politica va definita **prima** di introdurre le
tabelle della Fase 5.

### 4.1 Censimento e proiezione — METODO (i numeri reali li rileva il lead sul DB Neon)
⚠️ In questo ambiente `DATABASE_URL` è **assente** → il censimento sul DB reale **non è eseguibile
qui**. Fornisco lo strumento; i conteggi vanno eseguiti dal lead e riportati (→ **Gate 3**).
```sql
-- Righe per tabella (eseguire sul DB Neon)
SELECT 'users' t, count(*) FROM users
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'matches', count(*) FROM matches
UNION ALL SELECT 'match_players', count(*) FROM match_players
UNION ALL SELECT 'hands', count(*) FROM hands
UNION ALL SELECT 'hand_scores', count(*) FROM hand_scores
UNION ALL SELECT 'game_events', count(*) FROM game_events
UNION ALL SELECT 'checkpoints', count(*) FROM checkpoints
UNION ALL SELECT 'login_attempts', count(*) FROM login_attempts
ORDER BY 2 DESC;
-- Ospiti e quanti referenziati da una partita CONCLUSA
SELECT count(*) FILTER (WHERE is_guest) AS ospiti,
       count(*) FILTER (WHERE is_guest AND id IN (SELECT user_id FROM match_players WHERE user_id IS NOT NULL)) AS ospiti_referenziati
FROM users;
```
- **Candidata a saturare per prima (da verificare, non dare per scontato):** `hand_scores`
  — **una riga per (smazzata × posto)**: in 1v1 = 2 righe/smazzata, e una partita ha molte smazzate.
  Concorrono `game_events` (molte righe/mossa) e `checkpoints` (uno/smazzata; **purgati** all'annullo).
- **Righe da sessioni ospite:** vivono in `users` (`is_guest=true`), referenziate da
  `match_players.user_id` e `matches.aborted_by`. Il `display_name` dell'ospite è **già
  denormalizzato** in `match_players.display_name` (testo) alla creazione partita → lo storico
  dell'avversario registrato mostra già `Marco (ospite)` a prescindere dalla riga `users`.

### 4.2 Principio: aggregare PRIMA di cancellare
**Nessuna cancellazione può far perdere a un registrato i propri totali.** Ma le statistiche sono
oggi **ON-THE-FLY** su `matches`/`match_players`/`hand_scores`: **potare quelle righe cancella le
statistiche.** Serve quindi una tabella di **totali consolidati per utente**.

**Nuova tabella `user_stats_totals` (migrazione 0007)** — una riga per utente registrato:
```sql
CREATE TABLE user_stats_totals (
  user_id          uuid PRIMARY KEY REFERENCES users(id),
  matches_played   integer NOT NULL DEFAULT 0,
  matches_won      integer NOT NULL DEFAULT 0,
  matches_lost     integer NOT NULL DEFAULT 0,
  matches_abandoned integer NOT NULL DEFAULT 0,
  total_points     integer NOT NULL DEFAULT 0,
  best_match_score integer,
  burrachi_puliti  integer NOT NULL DEFAULT 0,
  burrachi_sporchi integer NOT NULL DEFAULT 0,
  vs_registered    integer NOT NULL DEFAULT 0,
  vs_guest         integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```
- Le colonne rispecchiano le voci **permanenti** di `UserStats` (`contract/types.ts:303`) — le voci
  legate al periodo (`lastFive`, `topOpponents`, analisi di stile) restano derivabili dal **dettaglio
  finché esiste**, poi degradano con grazia. Il profilo utente mostrerà i **totali permanenti** anche
  dopo la potatura del dettaglio.
- **Quando aggiornarla — proposta: alla CONCLUSIONE della partita** (nel percorso `completeMatch`,
  `persistence.ts:161`), incrementale, in transazione con la scrittura di `matches.status='completed'`.
  *Motivo vs processo periodico:* correttezza immediata (nessuna finestra in cui una partita conclusa
  non è ancora consolidata) e costo minimo (una UPSERT per partita). Un **processo periodico di
  riconciliazione** (ricalcolo da zero) resta come rete di sicurezza contro derive.
  → La scelta fra le due strade è **da approvare** (Gate 3). L'alternativa "solo periodico" è più
  semplice ma lascia una finestra di inconsistenza e ricalcola tutto lo storico ogni volta.
- **Solo utenti registrati** hanno una riga (gli ospiti non hanno profilo — coerente con `/users/me/*`
  che dà 403 agli ospiti).

**Tre orizzonti di conservazione (valori PROPOSTI, ognuno da approvare singolarmente — Gate 3):**

| Livello | Contenuto | Orizzonte proposto | Motivo |
|---|---|---|---|
| Dettaglio | `hand_scores`, `game_events`, `checkpoints` | **3 mesi** (il più breve) | è il volume che satura; già consolidato nei totali |
| Partita | `matches`, `match_players`, `hands` | **12 mesi** | tiene lo storico paginato per un anno |
| Totali | `user_stats_totals` | **permanente** | mai perdere i totali di un registrato |

**Altre tabelle che crescono — orizzonte dichiarato (Gate 3):**

| Tabella | Orizzonte proposto |
|---|---|
| `contact_messages` | 180 gg dopo letto (§2.2) |
| `app_events` (log applicativi, §5.4) | 30–90 gg + tetto righe |
| `admin_audit_log` (§5.1) | 12 mesi (tracciabilità amministrativa) |
| `broadcast_recipients` (§5.3) | 90 gg dopo invio (poi resta l'aggregato in `broadcasts`) |
| `login_attempts` | già potata da `pruneLoginAttempts` (invariata) |

### 4.3 Ospiti e account inattivi
- **Ospiti:** riuso ed **estensione** di `pruneInactiveGuests` (`auth/store.drizzle.ts`). Oggi tiene
  gli ospiti ancora referenziati. Poiché il `display_name` è **già** copiato in
  `match_players.display_name`, per renderli eliminabili basta **annullare i riferimenti FK** prima
  della delete fisica: `UPDATE match_players SET user_id=NULL WHERE user_id=<guest>` e
  `UPDATE matches SET aborted_by=NULL WHERE aborted_by=<guest>`. Lo storico dell'avversario registrato
  continua a mostrare `Marco (ospite)`. **Nessuna interfaccia** (§2.2 vincolante): processo automatico.
  *Decisione da approvare (Gate 3):* se preferire questo (delete fisica dopo denormalizzazione) o
  mantenere il comportamento attuale (ospiti referenziati NON eliminati). La delete riduce le righe;
  il mantenimento è più conservativo.
- **Account registrati inattivi:** soglia proposta **12 mesi senza accesso** (`last_seen_at`), con
  **avviso via email PRIMA** (usa il modulo §1.3) e successiva **ANONIMIZZAZIONE** (§5.2), **mai
  cancellazione fisica**. Un account registrato **non viene mai toccato** dai processi di pulizia
  sessioni/ospiti: principio **già codificato** (`markGuestExpired`/`pruneInactiveGuests` ristretti
  agli ospiti) e da **riaffermare** nei nuovi processi. → soglia da approvare (Gate 3).

### 4.4 Presidio e trasparenza
- **Contatore di occupazione** (pagina webmaster, §5.4): righe per tabella, totale, **percentuale sul
  budget 10k**, soglia d'allarme visibile **80%** (proposta). Fonte: query di conteggio (come §4.1).
- **Disclaimer nel profilo utente** (FE `ProfilePanel.tsx`), testo proposto:
  > *"Conserviamo il dettaglio delle tue partite per N mesi; le statistiche complessive restano
  > sempre disponibili."*
  Deve dire **cosa** si conserva e **per quanto**; **non** parla di cancellazione di avversari. Va
  ripreso anche nell'informativa.
- **Audit dei processi di pulizia:** ogni esecuzione scrive in `app_events`/`admin_audit_log`
  **quante righe** ha rimosso e **da quale tabella**, con **modalità di sola simulazione** disponibile
  (dry-run: conta senza cancellare). → nessun processo in modalità reale prima di una simulazione
  mostrata al lead (Gate 3).

---

## FASE 5 — Area webmaster (tre blocchi indipendenti)

### 5.1 Fondamenta: ruolo e accesso

**Migrazione additiva `users.role` + `admin_audit_log` (migrazione 0006):**
```sql
ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user';   -- 'user' | 'admin'
CREATE TABLE admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL REFERENCES users(id),  -- chi
  action      text NOT NULL,                        -- quale azione
  target      jsonb,                                -- su quali soggetti (id/criterio)
  outcome     text NOT NULL,                        -- 'ok'|'rejected'|'error'|'dry_run'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_created_at_idx ON admin_audit_log (created_at DESC);
```
- **Additiva**: `role` con default `'user'` non confligge con 2v2 (0003) né statistiche (0002/0007).
- **Primo admin:** promozione con **query manuale** documentata (nessun endpoint la esegue):
  ```sql
  UPDATE users SET role='admin' WHERE email = 'mfarroni@gmail.com';
  ```
- **Ruolo letto dal DB a ogni richiesta amministrativa** — **già naturale** (token opachi, §A1.2).
  Estendere `AuthPrincipal` con `role` e far leggere `getUserById` la colonna. **Costo:** una lettura
  utente per richiesta admin (già fatta oggi da `getPrincipalByToken`) → costo nullo aggiuntivo.
  Revoca istantanea (nessun claim da scadere).
- **Gate admin (helper `requireAdmin`)**: risolve il principale dal Bearer; se assente/non-admin
  **risponde 404** (non 403 — un 403 confermerebbe l'esistenza dell'area). Middleware riusabile su
  tutte le rotte `/admin/*`.
- **Prima rotta applicativa aggiuntiva del FE:** nuovo segmento **`app/webmaster/page.tsx`** (+ CSS
  scopato `.webmaster-root`, variabili prefissate, nessuna regola su `body`/`html` — pattern landing).
  `app/layout.tsx` **non va toccato**. Verifica esplicita sul deploy Vercel: **il reload diretto di
  `/webmaster` funziona** (App Router genera una rotta reale per segmento).
- **Un non-admin non vede contenuto nascosto via CSS:** la pagina **non si renderizza** (redirect/vuoto)
  e gli endpoint rispondono **404**.
- **Audit scritto PRIMA dell'esecuzione, nella stessa transazione** dell'operazione.

### 5.2 Blocco A — Utenti registrati

**Endpoint (tutti dietro `requireAdmin` → 404 se non admin):**
```
GET  /admin/users?limit&offset&q&sort          → { items: AdminUserRow[], total, limit, offset }
GET  /admin/users/:id                           → AdminUserDetail        (404 se inesistente)
POST /admin/users/anonymize                     → { dryRun, count, sample?, done? }
```
**DTO di risposta — whitelist in POSITIVO (mai hash/token/dati non necessari):**
```ts
interface AdminUserRow {
  id: string; displayName: string; email: string | null; isGuest: boolean;
  role: "user" | "admin"; createdAt: number; lastSeenAt: number | null; matchesCount: number;
}
// NIENTE password_hash, token_hash, ip_hash, checkpoint, payload di gioco.
```
- **Lista paginata** da `users` con ricerca per email/nome (`q`), ordinamento (`sort` su enum chiuso),
  `limit ∈ [1,50]`, `offset ≥ 0` (riuso dei cap zod esistenti). **Nessuna sezione ospiti** (§2.2).
- **Rimozione = ANONIMIZZAZIONE** (§2.5 lead, mai delete fisica di registrati):
  ```sql
  UPDATE users SET email = NULL, display_name = 'Utente cancellato',
         password_hash = NULL, role = 'user' WHERE id = <target>;
  -- le sessioni vanno revocate: revokeAllForUser(target)
  ```
- **Effetto su ogni tabella che referenzia `users` (FK analizzate):**

  | Tabella.colonna | Effetto anonimizzazione | Conteggi avversario |
  |---|---|---|
  | `match_players.user_id` | **invariato** (riga partita conservata) | `display_name` è già copia testuale → storico avversario **invariato** |
  | `matches.aborted_by` | invariato (audit) | n/a |
  | `sessions.user_id` | sessioni **revocate** (`revokeAllForUser`) | n/a |
  | `contact_messages.user_id` | invariato (o NULL, da decidere) | n/a |
  | `admin_audit_log.actor_id` | invariato (traccia) | n/a |
  | `user_stats_totals.user_id` | **da decidere:** azzerare o conservare i totali dell'anonimizzato | non tocca gli avversari |

  → **§6.4 garantito:** l'anonimizzazione tocca solo la riga `users`, **non** `match_players` né i
  punteggi → i conteggi vinte/perse **degli avversari** non cambiano.
- **Regole invalicabili dell'operazione (singola o di gruppo):**
  - **Assenza di criterio → 400.** "tutti" richiede un **parametro esplicito dedicato** (es.
    `{ scope: "all", confirm: "<frase>" }`), mai default su tutti.
  - **Simulazione obbligatoria:** prima passata `{ dryRun: true }` → ritorna **conteggio esatto** +
    **campione** dei soggetti; la conferma richiede di **digitare una frase** esatta.
  - **L'admin non può rimuovere sé stesso**; **non si rimuovono altri admin** senza passaggio manuale su DB.
  - **Non si rimuove un utente con una PARTITA IN CORSO.** Rilevazione **senza toccare il motore**:
    query DB `SELECT 1 FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.user_id=<t>
    AND m.status='playing'`. → se esiste, **rifiuto** con messaggio chiaro.
    *Motivo (nota §D3):* la mappa room in RAM (`room/`) sarebbe più fresca ma è **fuori scope** (§0);
    lo stato `playing` è server-authoritative e sufficiente per il guard.
  - **Tutto in transazione, con audit nella stessa** (audit scritto prima dell'esecuzione).
- **Gate 4:** questo blocco **resta sul branch** e **non** si propone per l'integrazione senza
  **approvazione separata**, anche se il resto del ciclo è approvato.

### 5.3 Blocco B — Comunicazioni ai registrati

**Tabelle (migrazione 0008) + flag consenso su `users`:**
```sql
ALTER TABLE users ADD COLUMN promo_opt_in boolean NOT NULL DEFAULT false;   -- consenso promozionale
ALTER TABLE users ADD COLUMN unsub_token text;                              -- disiscrizione (nullable)

CREATE TABLE broadcasts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id  uuid NOT NULL REFERENCES users(id),
  oggetto    text NOT NULL,
  corpo      text NOT NULL,                 -- SOLO testo semplice
  tipo       text NOT NULL,                 -- 'servizio' | 'promozionale'
  criterio   jsonb NOT NULL,                -- {registratiDopo?, minPartite?, inattiviDaGiorni?, all?}
  stato      text NOT NULL DEFAULT 'bozza', -- 'bozza'|'in_invio'|'completato'|'errore'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE broadcast_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  stato        text NOT NULL DEFAULT 'in_coda', -- 'in_coda'|'inviato'|'errore'|'saltato'
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, user_id)            -- idempotenza per destinatario
);
```
**Endpoint (dietro `requireAdmin`):**
```
POST /admin/broadcasts            { oggetto, corpo, tipo, criterio, dryRun? } → { id, count, sample? }
POST /admin/broadcasts/:id/send   → { accepted: true }         // avvia l'invio ASINCRONO
GET  /admin/broadcasts            → elenco con stato
GET  /unsubscribe?token=…         (PUBBLICO) → disiscrizione promozionale
```
- **Destinatari:** singolo, gruppo per criterio (registrati dopo data / con ≥ N partite / inattivi da
  N giorni) o tutti i registrati. **Ospiti esclusi per costruzione** (query su `is_guest=false`).
- **Corpo in testo semplice.** Nessun HTML immesso dall'admin; il client di posta rende cliccabili gli
  URL da sé. Sanificare comunque newline/caratteri di controllo (come §2.3).
- **Invio ASINCRONO a lotti**, **mai in linea con la risposta HTTP** (centinaia di destinatari →
  timeout su Render). `send` inserisce le righe `broadcast_recipients` (`in_coda`) e ritorna subito;
  un worker (aggancio allo scheduler `ws/server.ts:176`) processa a lotti.
  - **Dimensione lotto + intervallo:** proposti **lotti da ~40**, intervallo tale da **restare sotto
    il tetto giornaliero Brevo** (→ **verificare il tetto reale**, §1.4 Gate 2). Superarlo
    silenziosamente = comunicazioni perse.
- **Idempotenza:** `UNIQUE (broadcast_id, user_id)` + stato per destinatario → un doppio `send` non
  duplica (le righe già presenti restano `inviato`, non si re-inviano). **Chiave proposta:**
  `(broadcast_id, user_id)`.
- **Mai indirizzi in copia fra destinatari:** **un `sendEmail()` per destinatario** (§1.3), mai un
  unico invio con centinaia di indirizzi.
- **Consenso e disiscrizione:** `tipo='servizio'` (transazionale, sempre inviabile) vs
  `tipo='promozionale'` (richiede `promo_opt_in=true`); `unsub_token` + rotta pubblica
  `GET /unsubscribe` che azzera `promo_opt_in`. È un **requisito**, non un abbellimento.
- **Conservazione (§4):** `broadcast_recipients` 90 gg dopo invio; `broadcasts` resta come aggregato.

### 5.4 Blocco C — Log di sistema (tre fonti, tutte in sola lettura)

**Tabella `app_events` (migrazione 0009):**
```sql
CREATE TABLE app_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  livello    text NOT NULL,          -- 'info'|'warn'|'error'
  categoria  text NOT NULL,          -- 'auth'|'contact'|'cleanup'|'broadcast'|…
  messaggio  text NOT NULL,          -- già redatto (nessun segreto)
  meta       jsonb,                  -- già redatto
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_events_created_at_idx ON app_events (created_at DESC);
```
- Tetto righe + conservazione **30–90 gg** dichiarata (§4.2): tabella che cresce, ricade nel budget.

**Fonti ed endpoint (dietro `requireAdmin`):**
```
GET /admin/logs/app?from&to&limit&level     → app_events + admin_audit_log (paginato, finestra obbligatoria)
GET /admin/logs/render?from&to&limit        → proxy log Render (BE→Render, chiave mai sul FE)
GET /admin/logs/db                           → pg_stat_activity (+ pg_stat_statements se disponibile)
```
1. **Log applicativi Render** — via API ufficiale, con `RENDER_API_KEY` e l'**id del servizio** come
   **env del BE**; il **FE non vede mai la chiave**, il BE fa da **proxy**. Nuove env (Render):
   `RENDER_API_KEY`, `RENDER_SERVICE_ID`.
2. **Stato del DB** — `pg_stat_activity` (connessioni attive) e query lente (`pg_stat_statements`).
   ⚠️ **Verificare che `pg_stat_statements` sia disponibile sul piano Neon attivo** (Gate 2/3): se
   **non** lo è, dichiararlo e mostrare al suo posto `pg_stat_activity` + un riepilogo da `app_events`
   — **non inventare** una fonte inesistente.
3. **Eventi applicativi nostri** — `app_events` + `admin_audit_log`: errori, accessi falliti,
   operazioni amministrative, esiti dei processi di pulizia. È l'unica fonte che controlliamo.

**Vincoli non negoziabili della vista (evidenziati per agente_security):**
- **Una riga di log NON è HTML** → renderizzata come **testo** (React di default fa escaping; vietato
  `dangerouslySetInnerHTML`). **Rischio specifico del blocco:** un `<script>` iniettato da un utente
  in un campo (es. form contatti) e finito nei log diventerebbe **XSS nell'unica pagina con i privilegi
  più alti**. → test dedicato (§7).
- **Redazione lato SERVER** di token, indirizzi completi e header di autorizzazione **prima** che i
  dati raggiungano il browser (non delegata al client).
- **Paginazione e finestra temporale OBBLIGATORIE**: nessuna query che scarichi tutto (`from`/`to`
  richiesti, `limit` cappato).

---

## 6. Contraddizioni e rischi di rottura — verifica esplicita (§6)

| # | Punto | Esito |
|---|---|---|
| 1 | La rotta riservata non altera `/` né la macchina a stati di `useAuth()` | ✅ `/webmaster` è un **segmento nuovo** (`app/webmaster/`); `useAuth` invariato; `layout.tsx` non toccato |
| 2 | Il CSS della nuova area non contamina lobby/tavolo/profilo | ✅ CSS **scopato** `.webmaster-root`, variabili prefissate, nessuna regola su `body`/`html` (pattern landing) |
| 3 | `users.role` additiva, non confligge con 2v2 né statistiche | ✅ `ALTER TABLE … ADD COLUMN role … DEFAULT 'user'`; numerazione **0006** dopo l'ultima (0004) |
| 4 | L'anonimizzazione non altera i conteggi vinte/perse degli avversari | ✅ tocca solo `users`; `match_players.display_name` è copia testuale; punteggi intatti |
| 5 | I processi di pulizia non toccano mai un registrato attivo né una partita in corso | ✅ pulizia ristretta agli ospiti (già così); guard `status='playing'` sull'anonimizzazione |
| 6 | Nessuna chiamata verso domini esterni dal browser | ✅ Brevo/Render solo lato BE; CSP `connect-src 'self'+API/WS` invariata |
| 7 | Nessuna dipendenza aggiunta a `package.json` | ✅ Brevo/Render via `fetch` nativo; nessun SDK/grafici/CAPTCHA |
| 8 | `git diff` non tocca `contract/`, `engine/`, `room/` | ✅ per progetto: DTO nuovi in **moduli nuovi** (`mail/`, `contact/`, `admin/`), **non** in `contract/types.ts` (vedi §D). ⚠️ vincolo per agente_develop |
| 9 | Il lavoro è tutto sul branch dedicato; `main` invariato | ✅ branch `claude/Area-webmaster-contatti` da `origin/main`; nessuna PR, nessun merge (§0-bis) |

### D. Note architetturali per agente_develop
- **D1 — Numerazione migrazioni (ordine di dipendenza):** `0005` contatti · `0006` role+audit ·
  `0007` totali · `0008` broadcast+consenso · `0009` app_events. Verificare `meta/_journal.json`
  prima di `db:generate` per non collidere.
- **D2 — DTO fuori da `contract/` (§6.8):** oggi alcuni DTO HTTP vivono in `contract/types.ts`
  (`TablesResponse`, `MatchSummary`, `UserStats`). Per **non toccare `contract/`**, i DTO dei nuovi
  endpoint (contatti, admin, mail) vanno in **moduli nuovi** (es. `contact/types.ts`, `admin/types.ts`).
  La copia FE (§P2 del ciclo 2v2) riguarda il **contratto di gioco**: i nuovi DTO HTTP hanno le proprie
  copie FE in file nuovi, senza toccare `lib/contract.ts`.
- **D3 — "Partita in corso" senza `room/`:** rilevata via DB (`matches.status='playing'`), non dalla
  mappa room in RAM, per rispettare il divieto di toccare `room/` (§0).
- **D4 — Scheduler:** i job periodici (retention, worker broadcast, consolidamento totali di
  riconciliazione) si agganciano al pattern `setInterval().unref()` di `ws/server.ts:176`, accanto ad
  `authSweep`; il consolidamento **incrementale** dei totali si aggancia invece a `completeMatch`.

---

## 7. Piano di test da consegnare a valle (per agente_test / agente_security)

**Funzionali** (formulati per URL di deploy di branch Vercel + log di Render — nessun ambiente locale):
- Form contatti con `BREVO_ENABLED=true` e `=false`: in **entrambi** i casi il messaggio è in
  `contact_messages` (`stato_invio` coerente) e l'utente vede successo generico.
- Honeypot compilato → **rifiuto silenzioso** (200, nessuna riga salvata).
- Rate-limit contatti superato → 429.
- Utente non-admin su rotta `/webmaster` e su endpoint `/admin/*` → **404** (mai 403).
- Admin che tenta di rimuovere sé stesso → rifiuto; rimozione di un altro admin → rifiuto.
- Rimozione di utente con partita `playing` → rifiuto con messaggio chiaro.
- `dryRun` mostra conteggio esatto + campione; senza criterio → **400**.
- Doppio `send` della stessa comunicazione → **nessun duplicato** (UNIQUE broadcast_id,user_id).
- Pulizia ospiti in dry-run e reale → **account registrati intatti**; ospiti referenziati gestiti
  per denormalizzazione.
- Anonimizzazione → statistiche dell'avversario **invariate**.
- Contatore di occupazione coerente coi conteggi reali.
- Vista log paginata e **vuota** (nessun crash su zero righe).
- Testo vetrina aggiornato ("Burraco in tavola…").
- Schermata di attesa con backend spento che **entra da sola** alla ripartenza; e a ogni deploy.

**Sicurezza:**
- Token di utente normale su endpoint admin → 404; token scaduto → negato.
- **Ruolo revocato sul DB con token ancora valido → accesso negato** (verifica la lettura-DB-per-richiesta).
- Endpoint di rimozione senza criterio → 400; **IDOR** su `/admin/users/:id`.
- Stringa `<script>` immessa nel form contatti e **riemersa nella vista log** → resa come testo (no XSS).
- **Injection di header** nell'email (newline in nome/oggetto/reply-to) → neutralizzata.
- Nessuna risposta espone hash, token, `BREVO_API_KEY`, `RENDER_API_KEY`.
- `limit` abnorme sulle liste → cappato.
- Endpoint keep-alive (`/health`) non espone info di sistema e non è usabile come amplificatore.

---

## 8. Elementi che richiedono il LEAD prima di procedere (cancelli)

- **Gate 1 (piano):** approvazione di schema, endpoint, politiche di conservazione e UI qui descritti.
- **Gate 2 (disponibilità):** **quote reali** Render/Neon (ore compute/mese) e **tetto giornaliero
  Brevo** e **costo piano Render a pagamento** — **verificati in console e citati con la fonte**,
  prima di fissare fascia/intervallo del keep-alive. **Non assunti** (§9).
- **Gate 2/3 (Neon):** disponibilità di `pg_stat_statements` sul piano attivo (altrimenti fallback §5.4).
- **Gate 3 (conservazione):** **censimento reale** (§4.1) + approvazione **singola** dei tre orizzonti
  e della soglia inattività; nessun processo in modalità reale prima di una **simulazione** mostrata.
- **Gate 4 (rimozione utenti):** il Blocco A resta sul branch, non proposto per l'integrazione senza
  approvazione separata.
- **A1 (discrepanze):** conferma che il form contatti va **costruito da zero** (non esiste form inerte).

---

## OUTPUT PER: agente_develop

**Migrazioni (ordine di dipendenza):**
`0005` `contact_messages` → `0006` `users.role` + `admin_audit_log` → `0007` `user_stats_totals`
→ `0008` `broadcasts` + `broadcast_recipients` + `users.promo_opt_in`/`unsub_token` → `0009` `app_events`.
(Aggiornare `db/schema.ts`; verificare `meta/_journal.json`.)

**Endpoint da esporre** (in `createHttpApp`, con rate-limit dedicati e header esistenti):
- Pubblici: `POST /api/contact`, `GET /unsubscribe`, `GET /health` (esteso con `SELECT 1` + timing).
- Admin (dietro `requireAdmin` → 404): `GET /admin/users`, `GET /admin/users/:id`,
  `POST /admin/users/anonymize`, `POST /admin/broadcasts`, `POST /admin/broadcasts/:id/send`,
  `GET /admin/broadcasts`, `GET /admin/logs/app`, `GET /admin/logs/render`, `GET /admin/logs/db`.

**Modulo email condiviso:** `BE_Burraco/src/mail/` (`brevo.ts` + `types.ts` + `index.ts`), `fetch`
nativo, usato da contatti e broadcast. Env Render: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`,
`BREVO_SENDER_NAME`, `CONTACT_TO_EMAIL`, `BREVO_ENABLED` (+ `.env.example` fittizio).
Log/proxy Render: `RENDER_API_KEY`, `RENDER_SERVICE_ID`.

**Processi periodici** (scheduler `ws/server.ts`): worker broadcast a lotti; retention/cleanup con
dry-run + audit; consolidamento totali (incrementale su `completeMatch` + riconciliazione periodica).

**Componenti FE da costruire:** form contatti nella sezione `#contatti` (stati invio/successo/errore,
honeypot); schermata di connessione con backoff (livello 2); segmento `app/webmaster/` (CSS scopato,
`layout.tsx` intatto); disclaimer retention in `ProfilePanel`.

**Whitelist file toccabili (agente_develop):**
- BE: `drizzle/0005…0009_*.sql`, `db/schema.ts`, `db/persistence.ts`, `config.ts`, `http/app.ts`,
  `http/rateLimit.ts`, `auth/service.ts`+`auth/types.ts`+`auth/store.*` (aggiunta `role`),
  `stats/*` (consolidamento totali), **nuovi** `mail/*`, `contact/*`, `admin/*`, `ws/server.ts`
  (aggancio job), `.env.example`.
- FE: `components/Landing.tsx` (Fase 0 + form), nuovi `app/webmaster/*`, `components/ProfilePanel.tsx`
  (disclaimer), `lib/*` per i nuovi client HTTP (nuovi file), schermata di connessione.
- Infra: **nuovo** `.github/workflows/keep-alive.yml`.
- **VIETATI:** `contract/`, `engine/`, `room/`, `lib/contract.ts`, i file `.md` di prompt/subagenti,
  la skill di dominio; nessuna PR, nessun merge, nessun push su `main` (§0-bis).

---
*Fine analisi. Prossimo passo: approvazione dei cancelli 1–4 del lead, poi `agente_develop`.*
