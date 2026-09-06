# ANALISI — Storico Partite e Statistiche del Giocatore Registrato

**Agente:** agente_analista
**Fase:** analisi (nessun codice applicativo prodotto qui; solo schema, query d'esempio, specifiche)
**Feature:** storico partite + statistiche del registrato
**Data:** 2026-09-06
**Stato:** in attesa di approvazione del lead (cancello del piano)

---

## 0. Sintesi esecutiva (leggere prima di tutto)

Il prompt è stato scritto assumendo un campo verde: *«persistenza del risultato — oggi
non esiste; è il prerequisito di tutto»*. **La verifica del repository (richiesta esplicitamente
dal §1 del prompt) smentisce questa premessa.**

Due accertamenti dirimenti:

1. **Il motore di fine partita ESISTE ed è completo.** `BE_Burraco/src/engine/game.ts`
   produce gli effetti `hand_ended` (con il dettaglio punteggi per smazzata) e `game_ended`
   (con `winnerSeat` e i punteggi finali). C'è un vincitore dichiarato.
   → **Nessun blocco da segnalare al lead**: non serve costruire prima l'end-game.

2. **La persistenza e gran parte della feature SONO GIÀ COSTRUITE** (in un ciclo precedente
   che il codice etichetta "macro-ciclo 3"). Esistono:
   - lo **schema DB** (`matches`, `match_players`, `hands`, `hand_scores`, `game_events`,
     `checkpoints`) con migrazioni applicate;
   - il **punto di scrittura** nel `Room` (fine mano → `endHand`, fine partita → `completeMatch`);
   - il **layer statistiche** (`StatsStore` con implementazioni Drizzle/Neon e in-memory);
   - due **endpoint autenticati** `GET /users/me/stats` e `GET /users/me/matches`;
   - la **UI profilo** "Le mie partite" (`ProfilePanel.tsx`) con contatori, storico paginato
     e stati vuoto/caricamento/errore;
   - una **suite di test** (`stats.http.test.ts`, `stats.store.test.ts`, `stats.wiring.test.ts`,
     `stats.extra.coverage.test.ts`) che copre IDOR, gate ospite (403), paginazione.

**Conseguenza sullo scope.** Questa analisi NON riprogetta da zero: farlo butterebbe via codice
testato e in esercizio. Il lavoro va riscoperto come **DELTA** su un impianto esistente. Ciò che
manca davvero è **il terzo strato analitico**: le statistiche di *stile* (burrachi puliti/sporchi,
pozzetto in diretta/differita, % chiusure, malus), il **dettaglio smazzata-per-smazzata**, la
**vista di dettaglio** con i grafici d'andamento, e l'**irrobustimento di idempotenza/indici**.
La ragione è precisa: il motore calcola quei fatti ma **non li persiste** — `hand_scores` salva
solo la scomposizione a punti, non i conteggi di burrachi né la modalità di presa del pozzetto.

Il §2 elenca le divergenze fra prompt e realtà con la raccomandazione per ciascuna: è il
**cancello di approvazione** da sciogliere prima di lanciare agente_develop.

---

## 1. Stato reale del repository — mappa del già-esistente

### 1.1 Terminologia: il prompt e il codice chiamano le stesse cose con nomi diversi

Questa è la prima fonte di errore per agente_develop. Va fissata subito.

| Concetto del prompt | Nel codice esistente | Nota |
|---|---|---|
| `match` (partita) | tabella `matches` | ✓ stesso concetto |
| `deal` / smazzata | tabelle `hands` **+** `hand_scores` | il livello-smazzata è **spezzato in due**: `hands` (una riga per smazzata) e `hand_scores` (una riga per seat per smazzata). **NON creare una nuova `match_deals`**: estendere questa coppia. |
| `match_players` | tabella `match_players` | ✓ ma con campi diversi (vedi §1.3) |
| `esito` (vinta/persa) | derivato: `matches.winner_seat == match_players.seat` | non è una colonna: è calcolato |
| `punteggio_finale` | derivato: `SUM(hand_scores.total_delta)` per seat | non è una colonna |
| stato `in_corso`/`conclusa`/`abbandonata` | `matches.status`: `playing`/`completed`/`aborted`/`abandoned` | vocabolario diverso e **più ricco** (esiste anche `aborted`) |
| endpoint `/api/me/*` | `/users/me/*` | già montati e già consumati dal FE |

**Raccomandazione trasversale:** adottare i nomi del codice esistente (D2, D4 al §2). Rinominare
romperebbe FE e test già verdi senza alcun beneficio.

### 1.2 Schema DB esistente (fonte: `BE_Burraco/src/db/schema.ts` + migrazioni 0000/0001)

```
users(id, email?, display_name, password_hash?, is_guest, created_at, last_seen_at, expired_at)
sessions(id, token_hash unique, user_id→users, expires_at, revoked_at, created_at)

matches(id, config jsonb, target_score, status, winner_seat?, ended_at?, aborted_by?→users, created_at)
match_players(id, match_id→matches, seat, display_name, player_token_hash, connection_status, user_id?→users)
hands(id, match_id→matches, hand_number, dealer_seat, closer_seat?, status, started_at, ended_at?)
hand_scores(id, hand_id→hands, seat, pts_melds, pts_bonus, pts_penalty_hand, pts_pozzetto, total_delta)
game_events(id, match_id, hand_id?, seq, type, actor_seat?, payload jsonb, created_at)   -- audit
checkpoints(id, match_id, hand_id, seq, state jsonb, created_at)                         -- stato pieno, mai esposto
```

Osservazioni rilevanti per il §3:
- **La "predisposizione" del prompt (tipo_burraco, numero_giocatori, modalità, variante_chiusura)
  esiste già**, ma dentro `matches.config` (jsonb), non come colonne. `GameConfig` contiene tutti
  questi campi. → predisposizione **soddisfatta**; promuoverli a colonne serve solo se si vorrà
  filtrare le statistiche per variante (oggi non richiesto: vedi D6 al §2).
- **Identità ospite unificata:** gli ospiti NON sono un `guest_name` in `match_players`; sono
  righe in `users` con `is_guest = true`. Quindi il vincolo `CHECK (user_id XOR guest_name)` del
  prompt **non si applica** a questa architettura (D4 al §2).
- **Nessun indice** oltre alle PK e alle UNIQUE (`users.email`, `sessions.token_hash`). In
  Postgres le **foreign key NON generano indice automatico**: `match_players.user_id`,
  `match_players.match_id`, `hands.match_id`, `hand_scores.hand_id` sono **tutti non indicizzati**.
  È un problema reale per le query aggregate (§3.4).

### 1.3 `match_players`: confronto campo-per-campo col prompt

| Campo chiesto dal prompt | Presente? | Come è risolto oggi |
|---|---|---|
| `match_id`, `seat` | ✓ | identici |
| `user_id` (nullable) | ✓ | FK a `users`; null per join dev/test senza principale |
| `guest_name` (nullable) | ✗ | non serve: l'ospite è un `users` con `is_guest=true`; il nome vive in `users.display_name` (e in `match_players.display_name` autoritativo) |
| `team` (coppie future) | ✗ | fuori perimetro (coppie non implementate); predisposizione rinviabile |
| `punteggio_finale` | ✗ | derivato da `SUM(hand_scores.total_delta)` |
| `esito` | ✗ | derivato da `winner_seat` vs `seat` |
| CHECK `user_id XOR guest_name` | ✗ | non applicabile (identità unificata) |

### 1.4 Punto di scrittura e ciclo di vita (fonte: `Room.ts` + `persistence.ts`)

Il modello di scrittura **non** è un unico blocco atomico a fine partita: è **incrementale e
best-effort** (ogni scrittura è in `try/catch`, non deve mai bloccare il gioco). Percorso reale:

- `startMatch()` → `createMatch` + `addPlayers` + `startHand(#1)` (una volta sola: guardia
  `matchStarted` + `if (this.engine) return`).
- ad ogni `hand_ended` → `endHand()` = INSERT `hand_scores` (una riga per seat) + UPDATE `hands`
  (status=ended, closer_seat, ended_at) + INSERT `checkpoint`.
- a `game_ended` → `completeMatch()` = UPDATE `matches` (status='completed', winner_seat, ended_at),
  poi `dispose()` della room.
- percorsi terminali che **non** contano nelle statistiche: `abortMatch` (status='aborted'),
  `abandonMatch` (status='abandoned'). Solo `status='completed'` alimenta le statistiche.

**Idempotenza / abbandono — cosa è già risolto e cosa no (deliverable §3.2 del prompt):**
- **Abbandono:** già gestito. Disconnessione oltre la finestra di grazia
  (`RECONNECT_GRACE_DEFAULT_MS`, 45s) → `abandonMatch` → status `abandoned`, **non contato come
  sconfitta**. Il requisito del prompt è già soddisfatto; da documentare, non da costruire.
- **Doppia notifica di fine partita:** nel design single-instance in-RAM un secondo `game_ended`
  è impedito da `disposed` (i messaggi successivi cadono). MA **non esiste un presidio a livello DB**:
  `endHand` fa INSERT non idempotenti su `hand_scores`, e non c'è vincolo che impedisca righe
  doppie. Il prompt chiede una **chiave di idempotenza esplicita**: la forniamo al §3.3.

### 1.5 Statistiche ed endpoint esistenti

- `StatsStore.getStats(userId)` → `UserStats { matchesPlayed, matchesWon, matchesLost, winRate,
  totalPoints }` (solo i **contatori base**; nessuna analisi di stile).
- `StatsStore.getRecentMatches(userId, {limit, offset})` → `MatchSummary[] { matchId, endedAt,
  result, opponentName, yourScore, opponentScore }`. **Paginazione a offset** (limit 1–50 def. 10,
  offset 0–100000 def. 0). `opponentName` = `display_name` **senza** suffisso `(ospite)`
  (confermato da `stats.http.test.ts`: si attende `"Avv"`, non `"Avv (ospite)"`).
- **Non esiste** un metodo di dettaglio smazzata-per-smazzata né la rotta `/users/me/matches/:id`.
- Endpoint: `GET /users/me/stats` e `GET /users/me/matches` — Bearer, **solo registrati**
  (ospite → 403 `GUEST_NO_PROFILE`), utente **derivato dal token** (nessun IDOR). Montati solo
  se uno `StatsStore` è iniettato.
- FE: `ProfilePanel.tsx` rende contatori + storico + stati vuoto/caricamento/errore, con esito
  già **non affidato al solo colore** (icona ▲/▼ + parola "Vittoria/Sconfitta", `sr-only`,
  `aria-live`). Client in `lib/profile.ts`. Il contratto FE è una **copia a mano** di quello BE
  (`contract.ts`): ogni nuovo DTO va specchiato su entrambi i lati.

---

## 2. Divergenze dal prompt e decisioni da approvare (cancello del piano)

Ogni voce ha una raccomandazione motivata in una riga. **Nessuna comporta riscrivere l'esistente.**

| # | Il prompt chiede… | Realtà del repo | Raccomandazione |
|---|---|---|---|
| **D1** | una nuova tabella `match_deals` con burrachi/pozzetto/chiusura | esiste `hands`+`hand_scores`; mancano solo 3 fatti di stile | **Estendere** `hand_scores` con 3 colonne (§3.2), non creare `match_deals`: il livello-smazzata già esiste e alimenta le query correnti. |
| **D2** | endpoint `/api/me/*` | montati come `/users/me/*`, già consumati dal FE | **Mantenere** `/users/me/*`. Rinominare romperebbe FE e test senza beneficio. |
| **D3** | paginazione a `cursor` | offset già implementata, validata, testata, capata | **Mantenere l'offset**. Il cursore è teoricamente più solido su insert concorrenti, ma qui lo storico di un utente cresce lentamente e l'ordinamento è stabile (`ended_at`, poi `id`): l'offset è adeguato. Divergenza accettata. |
| **D4** | `guest_name` + CHECK `user_id XOR guest_name` | identità ospite **unificata** in `users(is_guest)` | **Mantenere l'identità unificata.** Il CHECK non si applica. Per onorare *«avversario mostrato come Marco (ospite)»* basta **join su `users.is_guest`** e aggiungere il suffisso (oggi mancante): è un piccolo gap concreto, non un cambio di modello. |
| **D5** | scrittura **unica, atomica e idempotente** a fine partita | scrittura **incrementale best-effort** già in esercizio | **Mantenere l'incrementale** (sopravvive a crash con dati parziali utili) **+ irrobustire**: `UNIQUE(hand_id, seat)` come chiave d'idempotenza e transazione per il trittico `endHand` (§3.3). |
| **D6** | filtrare per variante (tipo_burraco, ecc.) | i campi vivono in `matches.config` (jsonb) | **Tenere in jsonb** per ora. `?periodo=` è **temporale**, non per-variante; nessun filtro per variante è richiesto in questo ciclo. Promuovere a colonne + indice solo quando servirà. |

> **Richiesta al lead:** approvare D1–D6 così come raccomandate. Se il lead volesse invece la
> tabella `match_deals` separata o le rotte `/api/me/*`, va deciso **ora**: cambia il piano di
> agente_develop a valle. In assenza di indicazione contraria, si procede con le raccomandazioni.

---

## 3. Iterazione 1 — Modello dati (delta)

### 3.1 Principio guida

Aggiungere **solo i fatti non derivabili**. Tutto ciò che si può ricavare da colonne esistenti
**non** diventa una nuova colonna (evita ridondanza e rischio di incoerenza).

| Fatto chiesto dal prompt (per smazzata, per seat) | Serve una colonna nuova? | Da dove si ricava / dove va |
|---|---|---|
| `punti_smazzata` | no | `hand_scores.total_delta` |
| `punti_carte_in_mano` (negativi) | no | `hand_scores.pts_penalty_hand` |
| `malus_pozzetto` (bool, il −100) | no | derivato: `pts_pozzetto = -100` |
| `pozzetto_preso` (bool) | no | derivato: `pts_pozzetto = 0` |
| `ha_chiuso` (bool) | no | derivato: `hands.closer_seat = seat` (in 1v1 è netto) |
| `burrachi_puliti` (conteggio) | **sì** | non ricavabile: `pts_bonus` fonde burrachi + bonus chiusura |
| `burrachi_sporchi` (conteggio) | **sì** | idem |
| `pozzetto_preso_in_diretta` (bool) | **sì** | il motore conosce solo `pozzettoTaken` (bool), non la *modalità* |

### 3.2 Migrazione proposta (delta, idempotente nello stile di 0001)

> SQL a titolo illustrativo — l'implementazione (file `drizzle/0002_*.sql` + `schema.ts`) è
> compito di agente_develop.

```sql
-- 0002: fatti di STILE per smazzata (analisi di gioco). Additivi, con default
-- retro-compatibili: le smazzate storiche restano valide (0 burrachi, pozzetto non in diretta).
ALTER TABLE "hand_scores" ADD COLUMN IF NOT EXISTS "burrachi_puliti"      integer NOT NULL DEFAULT 0;
ALTER TABLE "hand_scores" ADD COLUMN IF NOT EXISTS "burrachi_sporchi"     integer NOT NULL DEFAULT 0;
ALTER TABLE "hand_scores" ADD COLUMN IF NOT EXISTS "pozzetto_in_diretta"  boolean NOT NULL DEFAULT false;

-- Chiave di idempotenza (§3.3): una sola riga punteggio per (smazzata, seat).
-- Va bonificata l'eventuale duplicazione storica prima di crearla (vedi nota).
CREATE UNIQUE INDEX IF NOT EXISTS "hand_scores_hand_seat_uq" ON "hand_scores" ("hand_id","seat");

-- Indici per le query aggregate (§3.4). Le FK non sono auto-indicizzate in Postgres.
CREATE INDEX IF NOT EXISTS "match_players_user_match_idx" ON "match_players" ("user_id","match_id");
CREATE INDEX IF NOT EXISTS "matches_ended_at_idx"         ON "matches" ("ended_at" DESC);
CREATE INDEX IF NOT EXISTS "hands_match_idx"              ON "hands" ("match_id");
CREATE INDEX IF NOT EXISTS "hand_scores_hand_idx"         ON "hand_scores" ("hand_id");
```

> Nota bonifica: la UNIQUE va creata **dopo** aver verificato che non esistano già righe doppie
> `(hand_id, seat)` in produzione. Se il DB Neon è ancora vuoto o senza duplicati, la creazione è
> immediata; altrimenti agente_develop deduplica prima (le partite reali non dovrebbero averne,
> perché finora `endHand` è chiamato una volta per smazzata).

**Origine dei nuovi valori (modifica al motore, minima):**
- `burrachi_puliti` / `burrachi_sporchi`: calcolabili **al momento del punteggio** in
  `engine/scoring.ts::scoreHand`, contando i meld propri con `isBurraco` divisi per `clean`.
  Vanno aggiunti al tipo `HandScoreDetail` (contratto) e quindi persistiti da `endHand`.
- `pozzetto_in_diretta`: il motore oggi tiene solo `SeatState.pozzettoTaken: boolean`. Serve un
  campo nuovo `pozzettoInDiretta: boolean`, impostato in `game.ts::afterMeldMutation` (ramo presa
  in diretta) e lasciato `false` nel ramo differita (`discardCard`). Poi confluisce in
  `HandScoreDetail`.

> `HandScoreDetail` è **broadcastato** in `hand_ended` e **copiato a mano** nel contract FE:
> l'aggiunta dei tre campi è additiva ma va specchiata in `FE_Burraco/src/lib/contract.ts`.

### 3.3 Momento della scrittura, atomicità, idempotenza

- **Momento:** invariato. `endHand` (fine smazzata) scrive i punteggi di smazzata arricchiti;
  `completeMatch` (fine partita) marca `completed`. Il motore fornisce già tutti i dati.
- **Chiave di idempotenza:** `UNIQUE(hand_id, seat)` su `hand_scores`. Poiché `hand_id` è un uuid
  **stabile** generato dal `Room` per quella smazzata, un secondo `endHand` sullo stesso `hand_id`
  verrebbe respinto dal vincolo → nessuna doppia riga, nessun doppio conteggio. L'INSERT dovrà
  usare `ON CONFLICT (hand_id, seat) DO NOTHING` per restare best-effort senza sollevare.
- **Atomicità:** avvolgere il trittico di `endHand` (INSERT `hand_scores` + UPDATE `hands` +
  INSERT `checkpoint`) in **una transazione**, così un fallimento parziale non lascia punteggi
  senza la smazzata marcata conclusa. Resta best-effort verso il gioco (il `try/catch` esterno
  non propaga l'errore al motore).
- **`completeMatch` idempotente:** renderlo condizionale — `UPDATE matches SET status='completed',
  … WHERE id = ? AND status <> 'completed'` — così un doppio invio o una gara con `abort` non
  sovrascrive uno stato terminale già scritto.

> **Divergenza dichiarata (D5):** il prompt chiede *un'unica* scrittura atomica a fine partita.
> Qui la scrittura resta **incrementale** (per smazzata) per scelta architetturale già in
> esercizio: sopravvive ai crash conservando le smazzate già chiuse. L'idempotenza e l'atomicità
> richieste dal prompt sono ottenute **per-smazzata** con i presidi sopra, che sono equivalenti
> ai fini della correttezza statistica.

### 3.4 Indici — motivazione rispetto alle query del §4

| Indice | Query servita | Perché |
|---|---|---|
| `match_players(user_id, match_id)` | `getStats`, `getRecentMatches`, dettaglio | ogni query parte da "le partecipazioni di questo utente"; senza indice è un seq-scan di tutta la tabella |
| `matches(ended_at DESC)` | ordinamento dello storico | consente di **semplificare** `getRecentMatches`: ordinare per `matches.ended_at` (già valorizzato da `completeMatch`) invece che per `MAX(hands.ended_at)`, eliminando un group-by e rendendo l'indice efficace |
| `hands(match_id)` | somma punteggi per partita, dettaglio | join `hands→match` non indicizzato oggi |
| `hand_scores(hand_id)` | ogni `SUM(total_delta)` e il dettaglio | join `hand_scores→hands` non indicizzato oggi; è il join più caldo |

### 3.5 Retention (deliverable §3.2)

Politica proposta, da confermare:
- **Storico e statistiche — a tempo indeterminato:** `matches`, `match_players`, `hands`,
  `hand_scores` sono la memoria del giocatore e occupano poche righe per partita: **si conservano
  sempre**.
- **Audit e stato pieno — purga:** `checkpoints` è già purgato all'annullamento; proporre la
  purga di `game_events` **e** dei `checkpoints` delle partite `completed`/`aborted`/`abandoned`
  **dopo 30 giorni** (servono a replay/diagnosi, non alle statistiche). Bilancia i due jsonb
  pesanti senza toccare i dati statistici. Uno sweep periodico o un job on-demand: dettaglio a
  develop.

---

## 4. Iterazione 2 — API e specifiche UI

### 4.1 Endpoint (delta)

| Rotta | Stato | Azione |
|---|---|---|
| `GET /users/me/stats?periodo=` | esiste (senza `periodo`) | **estendere** il DTO con il blocco analisi; aggiungere `periodo` |
| `GET /users/me/matches?limit=&offset=` | esiste | aggiungere il suffisso `(ospite)` all'avversario e il conteggio smazzate |
| `GET /users/me/matches/:id` | **nuovo** | dettaglio smazzata-per-smazzata; nuovo metodo `StatsStore.getMatchDetail` |

Regole comuni (già in vigore, da preservare): Bearer obbligatorio; utente **dal token**; **solo
registrati** (ospite → 403); rotte montate solo con `StatsStore` iniettato.

**`GET /users/me/matches/:id` — specifica:**
- `:id` è un uuid. Validare il formato (uuid) → altrimenti 400.
- Autorizzazione: la partita deve avere una riga `match_players` con `user_id = principale`.
  **Se non esiste → 404** (non 403): un 403 confermerebbe l'esistenza della partita altrui.
  Stesso 404 per uuid ben formato ma inesistente. → l'esistenza di partite altrui non è mai
  osservabile.
- Risposta (bozza DTO `MatchDetail`):
  ```jsonc
  {
    "matchId": "…",
    "endedAt": 1725600000000,        // epoch ms, può essere null
    "status": "completed",           // completed | aborted | abandoned
    "result": "won",                 // won | lost | null (partite non 'completed')
    "opponent": { "name": "Marco", "isGuest": true },
    "targetScore": 2005,
    "yourSeat": 0,
    "finalScore": { "you": 2040, "opponent": 980 },
    "deals": [
      {
        "numeroSmazzata": 1,
        "dealerSeat": 1,
        "closerSeat": 0,
        "you": {
          "puntiSmazzata": 320, "puntiCarteInMano": -40,
          "burrachiPuliti": 1, "burrachiSporchi": 0,
          "pozzettoPreso": true, "pozzettoInDiretta": false,
          "haChiuso": true, "malusPozzetto": false
        },
        "opponent": { /* stessi campi */ }
      }
    ]
  }
  ```
- **Comportamento a lista vuota:** una partita ha sempre ≥1 smazzata; `deals` vuoto non è un caso
  atteso (se accade, 200 con `deals: []` e la UI mostra "dettaglio non disponibile", mai un errore).

**`GET /users/me/stats` — parametro `periodo`:**
- valori: `all` (default) | `30d` | `season`(dal 1° gennaio) — insieme piccolo e chiuso,
  validato con zod (enum). Valore non ammesso → 400. Il filtro si applica su `matches.ended_at`.

**Paginazione (invariata):** `limit ∈ [1,50]` def. 10; `offset ∈ [0,100000]` def. 0; `limit`
abnorme → 400 (già testato). La risposta resta `{ items, limit, offset }`.

### 4.2 Statistiche da esporre — query e lettura del numero

Estensione di `UserStats`. Le prime sono le core già esistenti; il **blocco analisi** è nuovo.
Tutte le query filtrano su `match_players.user_id = :me AND matches.status = 'completed'`
(salvo `matchesAbandoned`) ed eventualmente su `matches.ended_at` per `periodo`. `:me` è **sempre**
il principale del token.

**Contatori base (esistono; aggiungerne 2):**

| Campo | Query (schematica) | Come si legge |
|---|---|---|
| `matchesPlayed` | `COUNT(*)` partite completed dell'utente | quante partite concluse |
| `matchesWon` / `matchesLost` | `COUNT` con `winner_seat = seat` / `<> seat` | vinte / perse |
| `matchesAbandoned` *(nuovo)* | `COUNT` partite `status='abandoned'` dell'utente | abbandonate; **non** pesano su vinte/perse |
| `winRate` | `won / played` (0 se played=0) | percentuale di vittoria |
| `totalPoints` | `SUM(hand_scores.total_delta)` per il seat dell'utente | punti netti accumulati |
| `avgFinalScore` *(nuovo)* | `AVG` del punteggio finale per partita | punteggio medio con cui chiude le partite |

**Blocco analisi (nuovo, tutto da `hand_scores` arricchito + `hands`):**

| Campo | Query (schematica, per il seat dell'utente) | Come si legge | Soglia |
|---|---|---|---|
| `dealsPlayed` | `COUNT(hand_scores)` dell'utente | numero di smazzate: è la **base statistica** | — |
| `burrachiPulitiPerDeal` | `SUM(burrachi_puliti)/dealsPlayed` | quanti burrachi puliti in media per smazzata | ≥10 smazzate |
| `burrachiSporchiPerDeal` | `SUM(burrachi_sporchi)/dealsPlayed` | idem, sporchi | ≥10 |
| `cleanDirtyRatio` | `SUM(puliti)/NULLIF(SUM(sporchi),0)` | **indicatore di stile**: alto = gioca "pulito" (più punti/burraco, più lento); basso = chiude sporco in fretta | ≥10 e ≥1 sporco |
| `pozzettoRate` | `AVG(pozzetto_preso)` = quota smazzate con `pts_pozzetto=0` | con che frequenza arriva al pozzetto | ≥10 |
| `pozzettoInDirettaShare` | `SUM(pozzetto_in_diretta)/SUM(pozzetto_preso)` | fra i pozzetti presi, quanti "in diretta" (svuotando la mano prima dello scarto) vs differita | ≥5 pozzetti presi |
| `closureRate` | quota smazzate con `hands.closer_seat = seat` | con che frequenza è **lui** a chiudere | ≥10 |
| `avgHandPenalty` | `AVG(pts_penalty_hand)` | punti medi persi per carte rimaste in mano (numero negativo) | ≥10 |
| `malusPozzettoCount` | `COUNT` smazzate con `pts_pozzetto=-100` | quante volte ha subito il −100 | — (conteggio) |
| `avgPointsPerDeal` | `AVG(total_delta)` | media punti per smazzata | ≥10 |
| `trend` | serie `total_delta` medio per partita, **ultime 20** partite completed, in ordine cronologico | andamento: sta migliorando o calando | ≥3 partite |

**Sotto soglia (deliverable §4.2 del prompt):** ogni statistica del blocco analisi va restituita
con il proprio `sampleSize` (di norma `dealsPlayed`, o il denominatore specifico) **accanto al
valore**. Quando `sampleSize < soglia`, il BE restituisce `null` per il valore (non uno zero
fuorviante) mantenendo `sampleSize`. La UI mostra "dati insufficienti (N/soglia)". Le soglie sopra
sono proposte, tarabili dal lead.

> **Motivazione della separazione lista/statistiche (§4.1 del prompt):** `getRecentMatches` resta
> una query paginata; `getStats` resta un'aggregazione unica. Non vanno fuse: gli aggregati non si
> ricalcolano a ogni pagina.

### 4.3 UI — tre viste dentro il pannello profilo

La voce "Le mie partite" è **già** assente per gli ospiti — non nascosta via CSS, ma per gate
server (403) e per ramo dedicato nel `ProfilePanel` (invito a registrarsi). Da preservare.

**Vista 1 — Riepilogo (estendere l'esistente):**
- riga di contatori in alto (già c'è: %Vittorie, Punti totali, Giocate, Vinte, Perse); aggiungere
  Abbandonate e Punteggio medio;
- **blocco "Come giochi"**: card per le statistiche di stile (rapporto pulito/sporco, % pozzetto,
  quota in diretta, % chiusure, malus). Ogni card con etichetta + valore + micro-spiegazione;
- **sparkline andamento** (ultime 20 partite): **SVG inline**, nessuna libreria da CDN
  (CSP `default-src 'self'`; il BE serve con CSP `default-src 'none'`). Un polyline SVG con
  `<title>`/`aria-label` e **alternativa testuale/tabellare** per screen reader;
- stati: vuoto (nessuna partita → invito a giocare, già presente); sotto-soglia (card che mostra
  "dati insufficienti" invece del numero); caricamento (skeleton già presente); errore (già presente).

**Vista 2 — Lista (estendere l'esistente):**
- righe già presenti (esito con badge icona+parola, avversario, data, punteggio);
- **aggiungere** il suffisso `(ospite)` all'avversario quando `opponent.isGuest` (gap D4);
- **aggiungere** "N smazzate" per riga;
- riga **cliccabile** → apre la Vista 3 (dettaglio); accessibile da tastiera (elemento
  interattivo, focus visibile).

**Vista 3 — Dettaglio (nuova):**
- intestazione: avversario (con `(ospite)`), esito, punteggio finale, data;
- **tabella delle smazzate**: numero, chi ha chiuso, punti smazzata, burrachi (puliti/sporchi),
  pozzetto (preso? in diretta/differita), carte in mano, malus;
- **responsive a 375px:** la tabella larga non ci sta. **Decisione: a 375px diventa a schede**
  (una card per smazzata) — più accessibile dello scroll orizzontale, che nasconde colonne e
  penalizza tastiera/screen reader. Su desktop resta tabella;
- stati: caricamento (skeleton), errore (con "Riprova"), "dettaglio non disponibile" per il caso
  degenere `deals: []`.

**Accessibilità da passare a valle (agente_ui_ux / agente_test):** contrasto **WCAG AA**; esito
**mai** affidato al solo colore (già rispettato: icona + parola); sparkline con alternativa
testuale; navigazione da tastiera sulle righe cliccabili; annunci `aria-live` sugli stati.

---

## 5. Iterazione 3 — Flow diagram e piano di test

### 5.1 Flow — dalla fine dell'ultima smazzata alla lettura del profilo

```mermaid
flowchart TD
  A[Ultimo scarto valido: discardCard chiude la smazzata] --> B[GameEngine.endHand]
  B --> C[scoreHand: punteggi + burrachi puliti/sporchi + pozzetto in diretta]
  C --> D{obiettivo raggiunto?}
  D -- no --> E[effetto hand_ended]
  E --> F[Room: broadcast hand_ended ai due client]
  F --> G[persistence.endHand in TRANSAZIONE:\nINSERT hand_scores ON CONFLICT hand_id,seat DO NOTHING\n+ UPDATE hands ended\n+ INSERT checkpoint]
  G --> H[startNextHand dopo il ritardo] --> A
  D -- sì --> I[effetto game_ended winnerSeat]
  I --> J[Room: broadcast game_ended]
  J --> K[persistence.completeMatch:\nUPDATE matches SET status=completed\nWHERE status<>completed]
  K --> L[dispose room]

  subgraph Lettura profilo (registrato)
    M[FE apre Profilo] --> N[GET /users/me/stats + /users/me/matches\nBearer, utente dal token]
    N --> O[StatsStore aggrega su matches/hands/hand_scores\nsolo status=completed]
    O --> P[Riepilogo + Lista]
    P --> Q[click riga] --> R[GET /users/me/matches/:id]
    R --> S{partecipazione dell'utente?}
    S -- no --> T[404]
    S -- sì --> U[Dettaglio smazzata-per-smazzata]
  end
  K -.-> O
  G -.-> O
```

### 5.2 Test funzionali

| # | Caso | Esito atteso |
|---|---|---|
| 1 | partita vinta contro **registrato** | compare in entrambi gli storici con esito corretto (win per uno, loss per l'altro) |
| 2 | partita vinta contro **ospite** | compare nello storico del registrato; avversario reso `Nome (ospite)` (`opponent.isGuest=true`); l'ospite non ha profilo (403) |
| 3 | partita **abbandonata** (grazia scaduta) | `status='abandoned'`; **non** conteggiata come sconfitta; entra in `matchesAbandoned` |
| 3b | partita **annullata** (`game_abort`) | `status='aborted'`; non conteggiata; checkpoint purgati |
| 4 | **doppia** `endHand` sullo stesso `hand_id` | una sola riga per `(hand_id, seat)` (UNIQUE + ON CONFLICT); nessun doppio conteggio |
| 4b | **doppia** `completeMatch` | idempotente; `status='completed'` una volta sola |
| 5 | utente **senza partite** | stato **vuoto** (invito a giocare), non errore; stats a zero, blocco analisi "dati insufficienti" |
| 6 | paginazione: pagina 2 (offset) e `offset` oltre il totale | pagina 2 corretta; oltre il totale → `items: []` (non errore) |
| 7 | partita con **più smazzate** | somma `total_delta` delle smazzate del seat = punteggio finale del match (caso 10) e il conteggio smazzate del dettaglio quadra col totale |
| 8 | **burraco pulito e sporco** nella stessa smazzata | `burrachi_puliti` e `burrachi_sporchi` contati separatamente e correttamente |
| 9 | **malus pozzetto** non preso | `pts_pozzetto=-100` registrato; `malusPozzetto=true` nel dettaglio; entra in `malusPozzettoCount` |
| 10 | **coerenza punti** | `SUM(smazzate.total_delta per seat) == punteggio finale del match` |
| 11 | **pozzetto in diretta vs differita** | presa svuotando la mano prima dello scarto → `pozzetto_in_diretta=true`; presa dopo lo scarto → `false`; la quota `pozzettoInDirettaShare` riflette il rapporto |
| 12 | **soglia** statistiche | con `dealsPlayed < soglia` il valore analitico è `null` + `sampleSize`, non uno 0 fuorviante |

### 5.3 Test di sicurezza

| # | Caso | Esito atteso |
|---|---|---|
| S1 | `GET /users/me/matches/:id` di una partita **altrui** | **404** (non 403): l'esistenza altrui non è osservabile |
| S2 | `:id` uuid ben formato ma inesistente | 404 (indistinguibile da S1) |
| S3 | `:id` non-uuid / malformato | 400 |
| S4 | richiesta **senza token** | 401 |
| S5 | token **scaduto/revocato** | 401 |
| S6 | tentativo di indicare un **altro utente** via query/param | ignorato: l'utente è **solo** dal token; risposta = dati del token |
| S7 | sessione **ospite** su `/users/me/*` | 403 `GUEST_NO_PROFILE` (già coperto per stats/matches; **estendere a `:id`**) |
| S8 | `limit` abnorme (es. 100000) | 400 (cap zod), **mai** un dump del DB |
| S9 | non-esposizione campi interni | la risposta non contiene `user_id` altrui, email, `password_hash`, `player_token_hash`, `token_hash`, né lo `state` dei checkpoint |
| S10 | `periodo` non ammesso | 400 (enum zod), nessun errore SQL |

> I test S1–S3, S7 (su `:id`) e tutti i casi 8/11/12 sono **nuovi** (coprono il delta). Gli altri
> estendono la suite `stats.*` esistente. Nessuna query va costruita per concatenazione di stringhe:
> `userId` e id di pagina restano **parametrizzati** (già così nello store Drizzle).

---

## 6. OUTPUT PER: agente_develop

Implementare nell'**ordine di dipendenza** seguente. Non riscrivere l'esistente: è un **delta**.
Prerequisito: **approvazione del lead su D1–D6 (§2)**. Ogni cambio ai DTO va **specchiato** in
`FE_Burraco/src/lib/contract.ts` (copia a mano).

1. **Schema/migrazione (`0002`)** — §3.2: aggiungere a `hand_scores` le colonne `burrachi_puliti`,
   `burrachi_sporchi`, `pozzetto_in_diretta` (default retro-compatibili); creare la UNIQUE
   `(hand_id, seat)` (previa bonifica duplicati) e i 4 indici. Aggiornare `db/schema.ts`.
2. **Motore** — §3.2: contare i burrachi puliti/sporchi in `scoring.ts::scoreHand`; tracciare
   `pozzettoInDiretta` in `game.ts` (`afterMeldMutation` = true, `discardCard` differita = false);
   estendere `HandScoreDetail` (contract BE + copia FE) con i tre campi.
3. **Persistenza** — §3.3: `endHand` in transazione, INSERT `hand_scores` con
   `ON CONFLICT (hand_id, seat) DO NOTHING`, includendo i nuovi campi; `completeMatch` condizionale
   (`WHERE status <> 'completed'`). Nessuna propagazione d'errore al gioco (resta best-effort).
4. **StatsStore** — §4.2: estendere `getStats` (contatori nuovi + blocco analisi + `periodo` +
   `sampleSize`/soglie); **semplificare** `getRecentMatches` all'ordinamento per `matches.ended_at`,
   aggiungere `opponent.isGuest` (join `users`) e il conteggio smazzate; nuovo `getMatchDetail`
   (dettaglio smazzata-per-smazzata con autorizzazione per partecipazione). Aggiornare `store.memory`
   in parallelo.
5. **HTTP** — §4.1: estendere il DTO di `/users/me/stats` (+ validazione `periodo`); estendere
   `/users/me/matches`; nuova rotta `GET /users/me/matches/:id` (validazione uuid → 400; non
   partecipante → **404**; ospite → 403; utente dal token).
6. **DTO/contract** — §4.1/§4.2: definire `MatchDetail`, `MatchDeal`, l'estensione di `UserStats`
   e di `MatchSummary` (`opponentIsGuest`, `dealsCount`) in BE `contract/types.ts` **e** FE
   `lib/contract.ts`.
7. **FE** — §4.3: estendere `lib/profile.ts` (`fetchMatchDetail`, `periodo`); estendere
   `ProfilePanel` con il blocco "Come giochi", la sparkline SVG inline (con alternativa testuale),
   il suffisso `(ospite)`, le righe cliccabili e la **nuova vista Dettaglio** (tabella → schede a
   375px). Stati vuoto/sotto-soglia/caricamento/errore per ogni vista.
8. **Test** — §5.2/§5.3: estendere la suite `stats.*` con i casi nuovi (idempotenza via UNIQUE,
   burrachi separati, pozzetto in diretta, soglie, dettaglio 404/400/403, non-esposizione campi).

A seguire, il testimone passa ad **agente_ui_ux** (rifinitura del blocco analisi, della sparkline e
della vista Dettaglio, WCAG AA), poi **agente_test** e **agente_security** secondo il flusso del
macro-ciclo.
