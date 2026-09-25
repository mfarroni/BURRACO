# Audit di prontezza al lancio — Burraco Online (Circolo Nettuno)

**Autore:** agente_analista (lead) · **Data:** 2026-09-25
**Base verificata:** `main` al commit `e87d404` (merge PR #53)
**Natura:** audit in sola lettura. Nessun file applicativo modificato: questo è l'unico file scritto.
**Stato:** ⏸ **GATE 1**: in attesa della decisione di Massimo.

> Nota di metodo. Dove scrivo **"verificato"** ho una prova: riga di codice, test eseguito,
> log di GitHub o prova in un browser nella sandbox. Dove scrivo **"dedotto dal codice"**
> ho letto la logica ma non ho riprodotto il comportamento. Tutto ciò che dipende da
> Render, Vercel, Neon o Brevo in produzione è **NON VERIFICATO**: la rete della sandbox
> blocca `*.onrender.com` e `*.vercel.app` (risposta 403 del proxy).

---

## 1. Verdetto

| Scenario | Verdetto | Motivazione in una frase |
|---|---|---|
| **A — Lancio in prova** (amici, passaparola) | **PRONTA CON RISERVE**, a una condizione | Il gioco è stabile (405 test backend verdi, riconnessione, abbandono, statistiche). Manca però l'**informativa privacy con il recapito del titolare**, obbligatoria da quando si raccolgono email (R01). Si risolve con un testo, in meno di un giorno. Fino ad allora il verdetto formale è NON PRONTA. |
| **B — Pubblicità aperta** (sconosciuti, picchi) | **NON PRONTA** | Chi arriva da solo aspetta al tavolo vuoto senza limite di tempo (R02). Al primo accesso il server è quasi sempre spento, perché il keep-alive **non pinga nulla** (R03). Un deploy o un riavvio cancella le partite in corso senza avvisare (R04). Mancano i testi legali minimi e la cancellazione dell'account (R01, R05). Il database rischia di saturarsi (R06). |

**Ipotesi di partenza:** **confermata** su tutti e due i punti. Tornei e Shop non bloccano.
I veri blocchi sono nelle aree 1, 2 e 7, più l'area 6 (crescita del database).

**Tre premesse del brief sono superate dal codice su `main`.** Ne tengo conto in tutto il rapporto:
1. **Montepremi.** Nella landing non c'è più nessun montepremi né alcuna cifra in denaro. Tornei e Shop sono già una "roadmap onesta" (`Landing.tsx:107-126`), e il piè di pagina dichiara "Nessuna scommessa, nessun premio in denaro" (`Landing.tsx:497`). Se Massimo vede ancora i montepremi, l'URL che apre non serve `main`: vedi V01.
2. **2 contro 2.** Non è solo predisposto: è **attivo e selezionabile in lobby** (`Lobby.tsx:197-210`, merge PR #30 del 2026-09-15). La landing invece lo chiama ancora "In sviluppo" (R07).
3. **Trovare un avversario.** Esistono già una lista dei tavoli pubblici, l'abbinamento automatico "Gioca subito" e il codice proposto dal server. Non è vero che l'avversario debba "inventare lo stesso codice" (Area 1).

---

## 2. Risposta alla domanda di Massimo: servono Tornei e Shop?

**No, non sono bloccanti né per A né per B.**

- Nella landing di `main` compaiono solo come schede di una roadmap ("Progettato", "Idea"), senza date, senza pulsanti e senza montepremi (`Landing.tsx:114-125`). Nessun pulsante inerte promette una funzione.
- Il rischio regolatorio sui premi in denaro (Area 7) oggi **non è presente nel codice**. Resta da confermare che il sito pubblicato coincida con `main` (V01).
- Ciò che frena la pubblicità è altro: il giocatore solo (R02), il risveglio del server (R03), le partite perse al riavvio (R04) e i testi legali (R01/R05).
- **Proposta per lo Shop:** togliere la scheda dalla vetrina finché non si decide cosa vendere. Motivo: annunciare vendite ("Mazzi, tappetini, la guida stampata") crea aspettative e, un domani, obblighi da e-commerce (condizioni di vendita, recesso) senza portare nessun giocatore.
- **Proposta per i Tornei:** tenere la scheda così com'è. Il testo attuale, "Serate a calendario e classifica. Nessun montepremi in denaro.", è già quello prudente.

---

## 3. Tabella unica dei rilievi

Complessità della correzione: **B** = bassa, **M** = media, **A** = alta.

| ID | Area | Rilievo | Evidenza | Gravità | Compl. |
|---|---|---|---|---|---|
| R01 | 7 | Mancano l'informativa privacy e il recapito del titolare. Si raccolgono email, nomi, statistiche, IP (hash) e log | nessuna pagina o testo "privacy" in `FE_Burraco/src`; il piè (`Landing.tsx:494-501`) contiene solo il copyright | **BLOCCANTE A** | B |
| R02 | 1 | Chi arriva da solo non ha avversari: né computer né avvisi. Aspetta al tavolo vuoto a tempo indeterminato | `WaitingRoom.tsx:95`; nessun bot nel motore; nessuna scadenza del tavolo in attesa con il socket connesso (`Room.ts:887-890` vale solo alla disconnessione) | **BLOCCANTE B** | M–A |
| R03 | 2 | Il keep-alive non pinga nulla: la variabile `KEEPALIVE_URL` è vuota. In più GitHub esegue il cron ogni 1–2 ore invece che ogni 10 minuti | log del job 107862689787: `KEEPALIVE_URL non impostata: keep-alive saltato`; esecuzioni del 24/09 alle 17:31, 19:24, 20:45, 22:34, 23:33 UTC | **BLOCCANTE B** | B (config) + M |
| R04 | 2/3 | Un riavvio del backend (deploy, crash, riavvio di Render) cancella le partite in corso. Al rientro il client, col vecchio codice, finisce in un tavolo **nuovo** in 1v1 e parte una smazzata da zero senza spiegazioni | stato solo in RAM (`README` BE; nessun ripristino dai checkpoint); `RoomManager.ts:364-392` (codice sconosciuto → `getOrCreate(code, defaultGameConfig())`); `useGameSocket.ts:579-581`. *Dedotto dal codice, non riprodotto.* | **BLOCCANTE B** | M |
| R05 | 7 | L'utente non può cancellare da sé il proprio account e i propri dati. Esiste solo la cancellazione da parte dell'admin | nessuna rotta `/users/me` di cancellazione in `http/app.ts`; solo `/admin/users/:id/delete` (`http/app.ts:1065`, `admin/users.ts:131`) | **BLOCCANTE B** | B–M |
| R06 | 6 | Ogni mossa scrive una riga in `game_events`, ma la pulizia gira solo in simulazione. Con il traffico di B il budget interno di 10.000 righe salta in pochi giorni, e anche i limiti di Neon free sono a rischio | `Room.ts:700,1112` (`logEvent` per ogni mossa); `retention/constants.ts` (`budgetRows: 10_000`; cancellazione reale solo con `RETENTION_MODE=live`) | **BLOCCANTE B** | M |
| R07 | 7/8 | La landing contraddice il prodotto: il 2v2 risulta "In sviluppo" ma è attivo; "Burraco a due giocatori"; promette le regole "dal pannello al tavolo", che non esiste; "Vince chi chiude per primo" è sbagliato, perché vince chi arriva a 2005 | `Landing.tsx:103,111,250,354`; skill §vittoria riga 144 | DA FARE PRESTO | B |
| R08 | 7 | Mancano i termini d'uso e l'informativa cookie. Si usano solo `localStorage`/`sessionStorage` tecnici, nessun cookie di terzi | `sessionIdentity.ts`, `supportPrompt.ts`, `tableInvite.ts`, `useHandOrder.ts` | **BLOCCANTE B** (termini) · DA FARE PRESTO (cookie) | B |
| R09 | 2 | Nuovo visitatore a server spento: dopo "Gioca come ospite" l'attesa scade a 15 s e compare "Tempo scaduto… Riprova". Il risveglio di Render free può durare di più. Non c'è il messaggio "il server si sta svegliando" (esiste solo per chi ha già una sessione e in lobby) | `lib/auth.ts:52` (15 s); `page.tsx:223` (schermata di connessione solo con `hasSession`) | **BLOCCANTE B** | B |
| R10 | 3 | Nessun recupero password self-service: chi la dimentica può solo scrivere al circolo | nessuna rotta "forgot/reset" per utenti; solo `/admin/users/:id/reset-password` | DA FARE PRESTO | M |
| R11 | 6 | Non esiste un avviso di disservizio: Massimo se ne accorge solo aprendo il pannello | nessun monitor esterno; `/admin/status/check` è su richiesta | DA FARE PRESTO | B (config esterna) |
| R12 | 6 | Nessuna procedura documentata di backup o ripristino del database | nessuno script né documento nel repo | NON VERIFICATO → DA FARE PRESTO | B |
| R13 | 4 | Mobile orizzontale (812×375): la barra azioni, fissa in basso, copre la parte bassa della mano. In verticale occupa circa il 38% dello schermo | prova Playwright nella sandbox (vedi Area 4) | DA FARE PRESTO | M |
| R14 | 8 | Nessuna favicon; 404 e pagina d'errore sono quelle predefinite di Next, in inglese | nessun `icon.*`/`favicon.*`, `not-found.tsx` o `error.tsx` in `FE_Burraco/src/app` | MIGLIORIA | B |
| R15 | 8 | Immagini della landing pesanti: circa 4,8 MB di PNG. File inutilizzato `pergamena.png` da 3,6 MB | `public/images/landing/*` (tabella in Area 8) | MIGLIORIA (DA FARE PRESTO per B su mobile) | B |
| R16 | 5 | `npm audit` FE: 15 high e 1 critical, **tutti** nella dipendenza di sviluppo `vercel` (CLI). Produzione: 0 | `npm audit` e `npm audit --omit=dev` (Area 5) | MIGLIORIA | B |
| R17 | 7 | Il link donazioni punta all'account Buy Me a Coffee `granmasterchess`, un nome scacchistico e non "Circolo Nettuno": può sembrare una pagina estranea | `DonationButton.tsx:17` | MIGLIORIA | B |
| R18 | 8 | I mockup interni sono pubblici su `/mockups/*.html` (circa 1,5 MB) | `FE_Burraco/public/mockups/` | MIGLIORIA | B |
| R19 | 6 | Il consenso alle comunicazioni promozionali (`promo_opt_in`) non si può attivare da nessuna schermata: le promozionali non raggiungono nessuno | `db/schema.ts:62-66`; nessun riferimento nel FE | MIGLIORIA | B |
| R20 | 3 | Documentazione della grazia di riconnessione incoerente (45 s / 120 s / 180 s). Nel codice il valore effettivo è 180 s | `config.ts:28` (45 000, non usata); `README` BE (120 000); `Room.ts:889` (180 000) | MIGLIORIA | B |
| V01…V09 | — | Verifiche che solo Massimo può fare | vedi §5.2 | NON VERIFICATO | — |

---

## 4. Dettaglio per area

### Area 1 — Trovare un avversario

**Cosa esiste davvero (verificato):**
- **Lista dei tavoli pubblici in attesa**, aggiornata ogni 5 s (`lib/lobby.ts:20,87-127`; `GET /tables`), con il creatore, l'attesa trascorsa, i posti e il pulsante "Siediti" (`Lobby.tsx`).
- **Contatore dei giocatori in lobby**: "1 altro giocatore in lobby" / "Sei il primo in lobby" (`Lobby.tsx`, contatore).
- **"Gioca subito"**: abbinamento automatico lato server. Siede al tavolo pubblico più vecchio con la stessa modalità, oppure ne crea uno (`RoomManager.ts`, `handleQuickMatch`). Provato nella sandbox: due ospiti che premono "Gioca subito" si trovano e la partita parte.
- **"Apri un tavolo"** (codice proposto dal server, pubblico o privato), **ingresso con codice** e **link d'invito** `/?tavolo=` condivisibile.
- **Nessun avversario computer, nessuna notifica, nessun orario fisso di gioco.**

**Esperienza di chi arriva da solo, passo per passo:**
1. Landing → "Gioca come ospite" → nome → lobby.
2. La lobby dice "Sei il primo in lobby" e "Nessun tavolo aperto in questo momento". A 375 px il pulsante "Gioca subito" è sotto la piega, dopo un lungo testo sullo stato vuoto (screenshot della sandbox).
3. "Gioca subito" → sala d'attesa: "La partita inizia appena qualcuno si siede al tavolo", con un timer.
4. **Si blocca qui.** Nessuno arriva, perché nello scenario B il traffico è rado e sparso nella giornata. Il tavolo resta aperto finché la scheda è aperta. Su mobile, se la scheda va in background e il socket cade, il tavolo sparisce dopo 60 s (`config.ts`, `waitingGraceMs`). Nessuno avvisa quando arriva qualcun altro.
5. In 2v2 il problema si moltiplica: servono **quattro** persone contemporanee.

Nello scenario A il problema quasi non esiste: si arriva in coppia, con un link d'invito. Nello scenario B è **il** blocco principale (R02).

**Opzioni possibili (non progettate):**

| Opzione | Complessità | Impatto su backend e WebSocket |
|---|---|---|
| a) **"Serate del circolo"** a orario fisso (es. 21:00) annunciate in landing, lobby ed email, così la gente arriva nella stessa finestra | bassa | quasi nullo: testi, più eventualmente la tabella `events` già esistente |
| b) **Avviso "c'è qualcuno al tavolo"**: email (infrastruttura broadcast già pronta) o notifica web a chi ha dato il consenso, quando un tavolo pubblico aspetta da più di N minuti | media | BE: trigger sul tavolo in attesa, quota Brevo (300/giorno) e consenso (R19). Notifiche web: service worker e CSP. Il WebSocket non cambia |
| c) **Avversario computer** (1v1) | alta | BE: un "posto robot" nella `Room` che gioca mosse legali con il motore. Da escludere da statistiche e storico. Redazione e anti-leak restano invariati (il robot sta lato server). Nuovo tipo di tavolo nel contratto e nella lobby |

### Area 2 — Primo avvio e disponibilità del backend

- **Tempo di risposta a freddo: NON VERIFICATO.** La sandbox non raggiunge `be-burraco.onrender.com` (403 del proxy). Istruzioni per misurarlo in V02.
- **Il keep-alive oggi non funziona (verificato, R03).** `.github/workflows/keep-alive.yml` pinga soltanto se esiste la variabile di repository `KEEPALIVE_URL`, e nei log dell'ultimo job è vuota ("keep-alive saltato"). In più GitHub esegue i cron di rado: 36 esecuzioni in tutto, l'ultimo giorno ogni 1–2 ore. Render free spegne il servizio dopo 15 minuti senza traffico. **Anche impostando la variabile, il cron di GitHub non basta a tenerlo sveglio.**
- **Attenzione, effetto collaterale:** `/health` (e `/`) esegue un `SELECT 1` su Neon (`http/app.ts:323-340`). Ogni ping tiene sveglio **anche Neon** e ne consuma le ore di calcolo. Il commento del workflow stesso stima circa 480 h/mese. Il piano free di Neon ha un tetto mensile di calcolo (V05): un keep-alive troppo zelante può spegnere il database a fine mese, un danno peggiore del risveglio lento.
- **Cosa vede l'utente durante l'attesa (verificato nel codice):**
  - **landing:** statica su Vercel, si vede subito;
  - **chi ha già una sessione:** schermata "Stiamo apparecchiando il tavolo…", che dopo 45 s diventa "ci mette più del solito…", con ingresso automatico (`ConnectionScreen.tsx`, `useServiceHealth.ts`). **Comprensibile;**
  - **nuovo visitatore** che preme "Gioca come ospite": il pulsante mostra "Un attimo…" e dopo **15 s** compare "Tempo scaduto: il server non ha risposto… Riprova" (`lib/auth.ts:52,69-75`). Se il risveglio dura di più, **la prima impressione è di un sito rotto** (R09). Il probe di `/health` parte all'apertura della pagina, quindi chi legge la landing per mezzo minuto non se ne accorge;
  - **lobby:** "Al primo accesso il server si sta svegliando: può richiedere fino a mezzo minuto", con "Annulla" (`Lobby.tsx:258-277`). **Comprensibile.**
- **Durante una partita** il frontend chiama `/health` ogni 60 s e la lobby fa polling ogni 5 s: finché c'è una pagina aperta, il servizio non si spegne. *Dedotto dal codice.*
- **Riavvio del servizio (R04):** lo stato dei tavoli vive **solo in RAM**. I checkpoint su Neon servono ad audit e statistiche, non a ripristinare la partita: nessun codice li rilegge all'avvio. **La partita si perde.** Peggio, il client si ricollega da solo col vecchio codice, il server non lo conosce e crea un tavolo nuovo in 1v1: i primi due che rientrano ricominciano da zero senza spiegazioni, e un tavolo 2v2 rinasce 1v1 (`RoomManager.ts:386`, `defaultGameConfig()`). *Dedotto dal codice, non riprodotto.* La partita interrotta resta su Neon senza esito e non entra nelle statistiche.
- **Limiti di Neon free rispetto ai due scenari:** vedi Area 6 (R06) e V05. Il backend assume **una sola istanza** (rate-limit in RAM, dispatcher email): va bene per A e per un B moderato; l'autoscaling non va attivato (`README` BE).
- **Costo di superamento (indicativo, da verificare sui listini):** Render Starter, sempre acceso, circa 7 $/mese per il solo servizio. Neon ha piani a consumo sopra il free. La decisione è di Massimo.

### Area 3 — Stabilità della partita

- **Stallo della lobby:** la diagnosi (`docs/specs/diagnosi-stallo-lobby.md`) aveva trovato un **disallineamento di deploy**, non un difetto di codice: il backend su Render era più vecchio del frontend. Il commit citato allora (`d7dc942`) non esiste più nella storia. Il protocollo lobby è però su `main` con la "lobby anti-stallo canonica": `84ae2dc` (BE), `41c88c4` (test), `1ba5fa1` (FE), PR #29 del 2026-09-09. Test che lo coprono: `lobby.rooms.test.ts`, `lobby.http.test.ts`, `lobby.extra.test.ts`, `remediation.lobby.test.ts`, `coppie.lobby.test.ts`. **Verificato nella sandbox:** due ospiti con "Gioca subito" si incontrano e la partita parte. **Resta NON VERIFICATO** che Render e Vercel servano davvero `main` (V01), cioè proprio la causa di allora.
- **Riconnessione:** in partita il posto resta tenuto **180 s** (`Room.ts:887-890`; `.env.example` 180 000); in sala d'attesa 60 s. Il client tenta di rientrare ogni 1,5 s (`useGameSocket.ts:33,605-607`) e reclama il posto con token e clientId. L'identità è resistente alla navigazione privata (`sessionIdentity.ts`). Il valore effettivo su Render dipende dall'env `RECONNECT_GRACE_MS` (V04). Documentazione incoerente: R20.
- **Abbandono:** l'avversario vede "disconnesso" subito (`player_disconnected`). Dopo 180 s: in **1v1** la partita è **annullata per abbandono**, senza vincitore (`room_closed{abandoned}`), e non conta nelle statistiche; in **2v2** la coppia dell'assente perde a forfait (`Room.ts:767-808`). Nel frattempo il timer di turno (90 s) gioca d'ufficio (`Room.ts:943-1015`), quindi la partita non si blocca.
- **Fine partita:** `game_ended` e `completeMatch` a 2005 punti, anche su più smazzate (`startNextHand`). Salvataggio idempotente (`stats.persistence.idempotency.test.ts`, `stats.history.engine.test.ts`, `game.flow.test.ts`). **Eccezione: il riavvio del server (R04).**
- **Test eseguiti (verificato, 2026-09-25):**

| Cartella | Comando | Esito |
|---|---|---|
| `BE_Burraco` | `npx tsx --test test/*.test.ts` (50 file) | **405 pass, 0 fail** |
| `BE_Burraco` | `tsc --noEmit` | 0 errori |
| `FE_Burraco` | `node --test test/*.mjs` (2 file) | **15 pass, 0 fail** |
| `FE_Burraco` | `tsc --noEmit` · `next lint` · `next build` | 0 errori · solo avvisi `<img>` · build riuscita |

  *Nota: nessuna delle due cartelle ha uno script `npm test`; ho usato i comandi indicati nei file di test.*
- **Aree senza test:**
  - **ripristino dopo un riavvio:** nessun test e nessuna funzione (R04);
  - **frontend:** solo `cardArt` e `jollyColor`. Riconnessione (`useGameSocket`), lobby, schermata di connessione e flussi di autenticazione lato client **non hanno test automatici**;
  - **coerenza dei deploy FE↔BE:** nessun test end-to-end sugli URL pubblici (la diagnosi dello stallo lo segnalava già);
  - **tetto `MAX_ROOMS`:** un solo file lo tocca.

### Area 4 — Browser e dispositivi

- **Safari e Opera in navigazione privata:** risolto nel codice. L'identità vive in memoria e lo storage è un di più; ogni accesso a `localStorage`/`sessionStorage` è in `try/catch` (`sessionIdentity.ts:1-30`, `tableInvite.ts:44-58`, `supportPrompt.ts:73-89`, `useHandOrder.ts:24-41`). **Nessun cookie di terze parti.** Il token di autenticazione viaggia nell'header `Authorization` e sta in `sessionStorage` o in memoria. Conseguenza voluta: in navigazione privata la sessione non sopravvive alla chiusura della scheda. **Sui dispositivi reali: NON VERIFICATO** (checklist §5.1).
- **Dipendenze dallo storage:**
  - `localStorage`: `burraco_client_id` (continuità dopo il refresh) e lo stato del promemoria donazioni;
  - `sessionStorage`: token di autenticazione, token di tavolo, codice d'invito, ordine della mano.
- **Layout a 375 px (verificato nella sandbox con Chromium e Playwright, iPhone-like 375×812):**
  - **nessuno scorrimento orizzontale** su landing, lobby e tavolo (`scrollWidth = 375`);
  - il tavolo **richiede scorrimento verticale**: la pagina è alta circa 1820 px. La barra azioni è fissa in basso e occupa circa 310 px, il 38% dello schermo;
  - **in orizzontale (812×375) la barra azioni copre la parte bassa della mano** (R13);
  - una partita intera a 375 px **non l'ho giocata**: ho verificato solo l'avvio e la prima distribuzione.

### Area 5 — Sicurezza di base (solo regressioni)

| Requisito | Esito | Evidenza |
|---|---|---|
| CSP in **enforce** | ✅ | `next.config.mjs`: header `Content-Security-Policy` (non report-only); `unsafe-eval` solo in sviluppo |
| CORS con allowlist ancorata e solo https | ✅ | `net/originPolicy.ts` (regex `^https://…$`, fail-closed in produzione); `http/app.ts:292-302` |
| Stessa allowlist per il WebSocket | ✅ | `ws/server.ts:91` (`isOriginAllowed`) |
| Rate limit su login, registrazione, ospite, comunicazioni admin | ✅ | `http/app.ts:348-350` (register 50, guest 50, login 20 ogni 15 min); `:843` (invio broadcast 10 ogni 30 s); `:839` (admin 60/min) |
| Lockout progressivo al login | ✅ | `auth/service.ts:58,154` (chiave `hash(email+IP)`) e `test/auth.hardening.ciclo2*.test.ts` |
| Rotte admin → 404 ai non admin | ✅ | `admin/requireAdmin.ts`; tutte le 21 rotte `/admin/*` chiamano `requireAdmin` (controllo riga per riga) |
| Nessun segreto nel repository | ✅ | ricerca su tutti i 173 commit (chiavi Brevo, stringhe Postgres, AWS, GitHub, Render, Neon): trovati solo segnaposto (`xkeysib-xxxxxxxx-fittizia`, `user:password@ep-xxxx`, `u:p@127.0.0.1` nei test); `.env*` è in `.gitignore` |
| `npm audit` BE | ✅ 0 high / 0 critical | 4 moderate, solo in sviluppo (`drizzle-kit` → `esbuild`) |
| `npm audit` FE | ⚠️ 15 high / 1 critical, **tutti in sviluppo** | via `vercel` (CLI): `tar` (critical), `undici`, `path-to-regexp`, `minimatch`, `js-yaml`, `smol-toml`, `@vercel/*`. `npm audit --omit=dev`: **0 vulnerabilità**. Nulla arriva agli utenti (R16) |

**Nessuna regressione trovata.**

### Area 6 — Dati, backup e monitoraggio

- **Backup e ripristino:** nel repository non c'è nessuno script di dump né una procedura scritta. Il ripristino a un istante passato (point-in-time) di Neon dipende dal piano: nel free la finestra è breve (V06). **Segnalato (R12).**
- **Quota Brevo esaurita durante un picco: la registrazione prosegue (verificato nel codice).** L'email di benvenuto è solo messa in coda (`http/app.ts:374`, `void enqueueWelcome(...).catch(() => {})`). Il dispatcher invia entro il tetto di 300 al giorno e rimanda il resto al giorno dopo (`mail/dispatcher.ts`). Se Brevo è spento (`BREVO_ENABLED` diverso da `true`) non parte niente e non c'è errore. Il valore in produzione è da verificare (V07).
- **Crescita dei dati (R06):** ogni mossa accettata scrive una riga in `game_events` (`Room.ts:700,1112`). Una partita a 2005 punti conta diverse centinaia di mosse. *Stima da confermare con il pannello Occupazione.* Il budget interno è di 10.000 righe (`retention/constants.ts`), e la pulizia **cancella davvero solo con `RETENTION_MODE=live`**: di default simula soltanto. Lo scenario A regge; lo scenario B, con decine di partite al giorno, satura il budget in pochi giorni e poi avvicina i limiti di spazio e calcolo di Neon free.
- **Conseguenza di Neon pieno o sospeso:** il gioco in RAM continua, ma **accesso, registrazione e ingresso ospite passano dal DB** (`auth/store.drizzle.ts`). Un database fermo vuol dire nessun nuovo ingresso.
- **Avviso di disservizio (R11), solo come proposta, da non configurare ora:** un monitor esterno gratuito (UptimeRobot, Better Stack o simili) su un URL del backend, con avviso via email o app. **Attenzione:** puntarlo su `/health` sveglia anche Neon a ogni controllo (vedi Area 2). Meglio un intervallo lungo, oppure in futuro un endpoint che non interroghi il DB. Lo stesso monitor, a 10–14 minuti, sostituirebbe il cron di GitHub come keep-alive, se Massimo accetta il consumo di ore.

### Area 7 — Contenuti pubblici e obblighi minimi

> ⚖️ **Le valutazioni che seguono sono segnalazioni tecniche, non pareri legali. Vanno confermate da un professionista** (privacy/GDPR, e ADM per i giochi a distanza con premi).

- **Premi in denaro e cifre nella landing:** **nessuno** su `main`. Occorrenze della parola "montepremi": `Landing.tsx:117` ("Nessun montepremi in denaro") e un commento (`:19`). "Premio": solo `Landing.tsx:497` ("Nessuna scommessa, nessun premio in denaro"). Gli euro compaiono solo nel pannello admin dello Shop (prezzi in centesimi, `webmaster/page.tsx:1389-1430`), non visibile al pubblico. Nei mockup pubblici non ci sono cifre (R18).
  - **Il rischio ADM oggi non risulta dal codice.** Se nel sito pubblicato compaiono ancora montepremi, il sito non è allineato a `main` (V01).
  - **Testo alternativo:** non serve, quello attuale è già prudente. Se si vuole essere ancora più espliciti: "Tornei amichevoli del circolo — prossimamente. Si gioca per la classifica, mai per denaro."
- **Shop:** proposta di **nasconderlo** (vedi §2).

| Documento | Stato | Nota |
|---|---|---|
| Informativa privacy | **Assente** | dati trattati: email, nome visualizzato, password (hash), avatar, statistiche e storico, log applicativi, hash dell'IP dal form contatti, messaggi di contatto, email via Brevo (responsabile esterno), hosting Render/Vercel/Neon (R01) |
| Informativa cookie | **Assente** | solo storage tecnico del browser, niente cookie di profilazione né di terzi: probabilmente basta un'informativa breve, senza banner (da confermare) (R08) |
| Termini d'uso | **Assenti** | regole di condotta, nomi offensivi, esclusione di responsabilità, gratuità (R08) |
| Recapito del titolare | **Incompleto** | c'è il form contatti e un `mailto` opzionale, se è impostata `NEXT_PUBLIC_CONTACT_EMAIL` (`Landing.tsx:40,480-485`). **Manca l'identità del titolare** (chi è "Circolo Nettuno") |

- **Cancellazione dell'account da parte dell'utente:** **assente** (R05). La logica di cancellazione esiste già per l'admin (`admin/users.ts:131-141`) e si può riusare.
- **Testi:** nessun "Lorem", "TODO" o `href="#"` vuoto nei componenti. Ma:
  - testi **non veritieri** (R07): 2v2 "In sviluppo" mentre è attivo; "Burraco a due giocatori"; la regola VI promette un pannello regole al tavolo che non esiste (`docs/specs/pannello-regole.md`: "DA IMPLEMENTARE"); "Vince chi chiude per primo" contraddice la skill ("vince chi raggiunge… il punteggio_obiettivo");
  - refusi di spaziatura nella lobby: "1 contro 1- Testa a testa" (`Lobby.tsx:197-198`, e lo stesso per il 2v2);
  - la vetrina ha solo due pulsanti inerti dichiarati: le schede roadmap, che non sono pulsanti.

### Area 8 — Prima impressione e condivisione

- **Titolo e descrizione:** ✅ "Burraco — Circolo Nettuno" / "Burraco online gratuito e senza pubblicità…" (`app/layout.tsx`).
- **Anteprima Open Graph (WhatsApp, social):** ✅ immagine 1200×630 generata a build (`app/opengraph-image.tsx`) e metadati `og:*` e `twitter:*`. **Da verificare** che `NEXT_PUBLIC_SITE_URL` sia impostata su Vercel: nella build di prova Next avverte che senza `metadataBase` ripiega su un URL di default (V08).
- **Favicon:** ❌ assente (R14).
- **Pagine 404 ed errore:** ❌ predefinite di Next ("404 · This page could not be found", "Application error"), in inglese e fuori stile (R14). Il backend risponde 404 in JSON: corretto.
- **Peso della landing:** JavaScript al primo caricamento 143 kB (build). Font: solo di sistema, nessuno scaricato. **Immagini circa 4,8 MB**, tutte PNG (R15):

| File | Peso | Uso |
|---|---|---|
| `tavolo.png`, `tavolo2.png`, `tavolo3.png` | 1,68 MB | slider dell'hero, caricati tutti e tre |
| `sala.png` | 1,29 MB | sfondo e "Chi siamo" |
| `rotolo-alto/centro/basso.png` | 1,66 MB | cornice delle regole |
| 4 assi | 0,13 MB | logo |
| `pergamena.png` | 3,6 MB | **non usato** |

  Su una rete mobile lenta la landing è pesante: con la pubblicità conta.
- **Regole per il nuovo giocatore:** oggi ci sono "Come si gioca, in 30 secondi" (4 passi) e un rotolo di 6 regole sintetiche nella landing (`Landing.tsx:65-105`). **In partita non c'è nessun pannello regole** (spec in backlog). Una delle frasi della landing è sbagliata (R07).

---

## 5. Checklist di prova manuale e verifiche per Massimo

### 5.1 Checklist di prova manuale (Area 4)

Da ripetere su: **iPhone con Safari**, **Android con Chrome**, **desktop con Chrome, Edge e Firefox**. Su iPhone ripetere anche in **Navigazione privata**. Servono due dispositivi, o due browser diversi, per fare A e B.

| # | Azione | Risultato atteso |
|---|---|---|
| 1 | Aprire l'URL pubblico di Vercel | La landing appare entro 3 s, senza scorrimento orizzontale |
| 2 | Toccare "Gioca come ospite", scrivere un nome, confermare | Si entra in lobby. Se compare "Tempo scaduto", annotare dopo quanti secondi e riprovare (misura di R09) |
| 3 | Su A: "Gioca subito" | Sala d'attesa con timer |
| 4 | Su B: ospite → nella lobby si vede il tavolo di A → "Siediti" | La partita parte su entrambi entro pochi secondi |
| 5 | Su A: pescare, calare un gioco, scartare | Le mosse compaiono su B entro 1–2 s |
| 6 | Mobile: ruotare in orizzontale | La mano resta visibile e toccabile (R13) |
| 7 | Su B: ricaricare la pagina a metà partita | B rientra allo stesso posto con la stessa mano; A vede "disconnesso" e poi "riconnesso" |
| 8 | Su B: chiudere la scheda e aspettare 3 minuti | A vede prima "disconnesso", poi dopo circa 180 s "partita annullata per abbandono" |
| 9 | A e B: con "Apri un tavolo", usare il pulsante d'invito | Il link apre la landing con l'avviso "Un amico ti aspetta al tavolo…"; dopo l'ingresso il codice è già compilato |
| 10 | Registrarsi con un'email vera | Registrazione riuscita; email di benvenuto entro qualche minuto (se Brevo è attivo) |
| 11 | Da registrato, giocare una partita fino alla fine | Punteggio finale mostrato; Profilo → statistiche aggiornate |
| 12 | Condividere l'URL su WhatsApp | Anteprima con titolo, descrizione e immagine verde e oro |
| 13 | Aprire `URL/pagina-inesistente` | Oggi: pagina 404 inglese di Next (R14) |

### 5.2 Verifiche che deve fare Massimo (tutti i NON VERIFICATO)

| ID | Cosa verificare | Come, passo per passo |
|---|---|---|
| **V01** | Il sito pubblicato coincide con `main` (frontend e backend) | Vercel → progetto → Deployments: il deploy "Production" deve riportare il commit `e87d404`. Render → servizio → Events: l'ultimo deploy deve essere sullo stesso commit. Se il sito mostra ancora montepremi, non è allineato |
| **V02** | Tempo di risposta a freddo del backend | Lasciare il sito inutilizzato per **almeno 20 minuti**. Aprire una scheda nuova, F12 → scheda Network. Aprire `https://be-burraco.onrender.com/health` (URL da `.env.example`: confermare quello reale su Render). Annotare "Time" della richiesta e i campi `tProcessMs` (un valore piccolo vuol dire che il processo si è appena svegliato) e `tQueryMs` (risveglio di Neon). Ripetere subito dopo per avere il tempo "a caldo" |
| **V03** | Keep-alive | GitHub → Settings → Secrets and variables → Actions → Variables: `KEEPALIVE_URL` oggi **non c'è** (lo dicono i log). Non aggiungerla prima di aver letto V05 |
| **V04** | Env su Render | Render → Environment: valori di `RECONNECT_GRACE_MS`, `RETENTION_MODE`, `BREVO_ENABLED`, `ALLOWED_ORIGINS`, `NODE_ENV=production`, `IP_HASH_SALT` presente. Riportare solo **se sono impostate** e i valori non segreti |
| **V05** | Limiti del piano Neon | Console Neon → Billing/Usage: spazio usato e tetto, ore di calcolo usate e tetto mensile, sospensione automatica, finestra di ripristino |
| **V06** | Backup | Console Neon → Branches/Restore: fino a quanto indietro si può tornare. Decidere se serve un dump periodico |
| **V07** | Brevo | Dashboard Brevo: piano, 300/giorno, mittente verificato; nel pannello admin il contatore quota del giorno |
| **V08** | Anteprima di condivisione | Vercel → Environment Variables: `NEXT_PUBLIC_SITE_URL` impostata con l'URL definitivo. Poi prova 12 della checklist |
| **V09** | Occupazione DB reale | Pannello admin → Occupazione: righe totali e righe di `game_events` per partita. Serve a confermare la stima di R06 |

---

## 6. Percorso proposto

Solo i rilievi **BLOCCANTE A** e **BLOCCANTE B**, in tre cicli ordinati. Gli altri (DA FARE PRESTO / MIGLIORIA) possono entrare in un ciclo quando toccano gli stessi file, se Massimo lo approva.

### Ciclo 1 — "Onestà e obblighi minimi" → sblocca lo scenario A
**Obiettivo:** poter invitare gli amici in regola, con una vetrina che non promette ciò che non c'è.
- **R01** Informativa privacy con recapito e identità del titolare (pagina statica e link nel piè). *Testo da far validare a un professionista.*
- **R08** Termini d'uso e breve informativa cookie/storage tecnico.
- **R05** Cancellazione dell'account da parte dell'utente (Profilo → "Elimina account", riusando `deleteUser`).
- *(Stessi file, costo minimo, facoltativi: R07 testi della landing, Shop nascosto, R14 favicon e 404 in italiano.)*
- **Complessità:** bassa (testi) + bassa-media (R05). Nessun impatto su motore e WebSocket.

### Ciclo 2 — "Il server risponde sempre" → prima metà dello scenario B
**Obiettivo:** chi arriva da uno spot trova il sito sveglio, non perde la partita per un deploy e non riempie il database.
- **R03** Keep-alive affidabile. Decisione di Massimo tra (a) monitor esterno a 10–14 minuti nelle ore di punta, accettando il consumo di ore Neon (V05), e (b) piano Render sempre acceso. Più l'eventuale endpoint di salute senza DB.
- **R09** Il nuovo visitatore non vede "Tempo scaduto" durante il risveglio: attesa guidata come per chi ha già una sessione.
- **R04** Al riavvio, **niente partita nuova silenziosa**: messaggio chiaro "la partita è stata interrotta dal server" e ritorno alla lobby (minimo). Il ripristino dai checkpoint è un'opzione più costosa, da valutare a parte. Più la regola operativa "deploy solo in orari morti".
- **R06** Controllo della crescita di `game_events` (volume per partita e retention reale dopo la simulazione mostrata al lead, come già previsto al Gate 3).
- **Complessità:** media. Tocca `Room`/`RoomManager` (R04) e il frontend di autenticazione (R09). Il contratto WS cambia solo se il messaggio di R04 richiede un codice nuovo: in quel caso **copia FE nello stesso commit** (P2).

### Ciclo 3 — "Chi arriva da solo gioca" → seconda metà dello scenario B
**Obiettivo:** uno sconosciuto che arriva da solo trova un avversario, o sa quando trovarlo.
- **R02** Scelta tra le opzioni dell'Area 1: (a) serate a orario fisso, bassa; (b) avviso "c'è qualcuno al tavolo", media; (c) avversario computer, alta. **Consiglio:** (a) subito, perché costa poco e funziona anche per il 2v2, poi (b). La (c) solo se i numeri lo giustificano.
- **Complessità:** da bassa ad alta secondo l'opzione. La (c) richiede prima l'aggiornamento della skill `skill-burraco` (comportamento del robot) e un piano approvato.

---

## ⏸ GATE 1 — Decisione di Massimo

Mi fermo qui. Servono le decisioni di Massimo su:
1. **Quali rilievi correggere e in che ordine.** Proposta: Ciclo 1 → Ciclo 2 → Ciclo 3.
2. **Montepremi e Shop.** I montepremi su `main` non ci sono già più: verificare V01. Per lo Shop, nasconderlo o tenerlo?
3. **Piani gratuiti.** Accettare i limiti (keep-alive a finestre, rischio di risveglio lento) o valutare Render sempre acceso e/o un piano Neon superiore? Prima vanno lette le verifiche V02 e V05.
4. **Le verifiche V01–V09**, soprattutto V01, V02 e V05, che possono cambiare le gravità di R03, R06 e R09.

Nessun lavoro di correzione parte senza approvazione esplicita. Nessun merge di questo branch: lo fa Massimo.

**OUTPUT PER: agente_develop**: da emettere **solo dopo il Gate 1**, con il primo ciclo approvato, i rilievi inclusi e i file che si possono modificare.

---

## 7. Decisioni del Gate 1 (Massimo, 2026-09-25) e stato del Ciclo 1

**Decisioni**
1. Ordine approvato: Ciclo 1 → Ciclo 2 → Ciclo 3.
2. Shop: **nascosto** dalla vetrina. Montepremi: su `main` non ci sono più; resta V01.
3. Piani gratuiti: **si accettano i limiti**. In cambio, una finestra spiega l'attesa: "Stiamo preparando il tavolo — tra circa 30 secondi sarà pronto". Restano da fare le verifiche V02 e V05.

**Ciclo 1: fatto su questo branch**

| Rilievo | Cosa è stato fatto | File principali |
|---|---|---|
| R01 | Pagina `/privacy` con i dati realmente trattati, basi giuridiche, fornitori, conservazione, diritti e titolare (variabili `NEXT_PUBLIC_TITOLARE` e `NEXT_PUBLIC_CONTACT_EMAIL`) | `FE_Burraco/src/app/privacy/page.tsx`, `components/LegalPage.tsx` |
| R08 | Pagine `/termini` e `/cookie` (elenco delle chiavi di memoria del browser realmente usate). Link nel piè della vetrina e sotto il modulo d'accesso | `app/termini`, `app/cookie`, `Landing.tsx`, `AuthPanel.tsx` |
| R05 | "Elimina il mio account" nel Profilo (solo registrati, conferma con password). Nuova rotta `POST /users/me/delete`; pulizia condivisa con la cancellazione admin (`account/purge.ts`). Ospite → 403; admin → 403. 6 test nuovi | `BE_Burraco/src/account/purge.ts`, `auth/*`, `http/app.ts`, `test/account.delete.http.test.ts`, `DeleteAccountForm.tsx` |
| R09 (anticipato) | Finestra di risveglio con conto alla rovescia sul pannello d'accesso (pannello inerte finché il server non risponde); stesso testo nella schermata di chi ha già una sessione | `components/WakeUpNotice.tsx`, `ConnectionScreen.tsx`, `app/page.tsx` |
| R07 | Testi della vetrina corretti: 2v2 "già al tavolo", "uno contro uno o a coppie", vittoria a 2005 punti, niente promessa di un pannello regole. Shop nascosto. Refusi della lobby | `Landing.tsx`, `Lobby.tsx`, `page.tsx` |
| R14 | Favicon, pagina 404 e pagina d'errore in italiano | `app/icon.svg`, `app/not-found.tsx`, `app/error.tsx` |

**Verifiche eseguite:** 411 test backend verdi (405 esistenti + 6 nuovi), 15 test frontend, `tsc`, `next lint` e `next build` puliti. Prove nel browser della sandbox a 375 px:
- nessuno scorrimento orizzontale sulle pagine legali, sulla 404 e sulla vetrina;
- con il backend spento la finestra di risveglio compare; all'avvio del backend si chiude da sola e l'ingresso da ospite riesce;
- la cancellazione dell'account rifiuta la password errata; con quella giusta torna alla vetrina con l'avviso, e il login successivo dà 401.

**Azioni di Massimo prima del lancio in prova**
- Su Vercel impostare `NEXT_PUBLIC_TITOLARE` (nome del titolare) e `NEXT_PUBLIC_CONTACT_EMAIL`. Senza, le pagine dicono "il gestore del Circolo Nettuno".
- Su Render impostare `RETENTION_MODE=live`, dopo aver visto la simulazione nel pannello admin: l'informativa dichiara i tempi di conservazione (3/12 mesi, 180 e 90 giorni), che sono veri solo se la pulizia gira davvero (collegato a R06).
- Far rileggere privacy e termini a un professionista, compresa la soglia dei 14 anni per i minori, che è una scelta del titolare.
