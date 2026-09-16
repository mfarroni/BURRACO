# Analisi — lotto UI tavolo / profilo / grafica accesso / donazione (R1–R8)

> **Fase:** Iterazione 1 — ricognizione sul codice reale (nessun codice applicativo).
> **Autore:** agente_analista (lead). **Data:** 2026-09-16.
> **Fonte del task:** `docs/prompts/PROMPT_ANALISI_LOTTO_UI_PROFILO_v4.md`.
> **Stato:** presentata al `⏸ GATE 1`, in attesa di autorizzazione.
> **Branch dei documenti:** `claude/burraco-lotto-analysis-ui-4a891a` (worktree corrente;
> il prompt proponeva `claude/analisi-lotto-ui-profilo` — nessun impatto, il merge è manuale).

---

## 0. Stato del repository — premessa che cambia il triage

Il repository è al **post-Macro-ciclo-3 (2v2) mergiato** (`main` include il merge #30). Questo
ribalta due assunzioni del prompt v4:

1. **La regola della matta è GIÀ CORRETTA** nel motore (Fasi 0 e 0b del Macro-ciclo 3). Non
   esiste più il bug "la matta torna in mano".
2. **Il contratto porta GIÀ i nomi per posto** (`SeatPublic.displayName`) e il FE li rende già.

Conseguenza pratica: **R1, R2 e R7 sono in larga parte già implementati**. Il lavoro reale si
concentra su R3/R4 (layout), R5 (grafica), R6 (donazione) e R8 (lockout login).

---

## 1. Ricognizione per requisito

### R1 — Rimuovere il pulsante "Sostituisci matta"

**Cosa attiva la sostituzione oggi**
- FE, pulsante: `FE_Burraco/src/components/ActionBar.tsx:75-81` ("Sostituisci matta"), cablato via
  prop `onWildSubstitute` (`ActionBar.tsx:23`).
- FE, flusso Cima/Fondo + trigger: `FE_Burraco/src/app/page.tsx:676-701` (blocco `wild-edge-choice`,
  stato `wildAttempt`) e `page.tsx:713-720` (handler `onWildSubstitute`).
- FE, invio WS: `FE_Burraco/src/lib/useGameSocket.ts:801-803` → messaggio `wild_substitute`.
- Contratto: messaggio `wild_substitute` con `edge?: "top"|"bottom"` — BE `contract/types.ts:411-417`,
  copia FE `lib/contract.ts:221` (**già allineate**).

**Verifica raggiungibilità (R1 punto 2) — ESITO**
- Il dispatch BE resta attivo: `BE_Burraco/src/room/Room.ts:668-669` → `engine.wildSubstitute(...)`,
  validato da `ws/validate.ts:108-137`. **Tolto il pulsante, l'azione resta raggiungibile** inviando
  `wild_substitute` da un client modificato. Rimuovere un controllo UI non disabilita un endpoint.

**Fatto che cambia R1 punto 3 — il "debito" previsto NON esiste più**
- Il motore `wildSubstitute` (`engine/game.ts:327-436`) implementa **la regola corretta**: la matta
  non torna mai in mano; in sequenza si sposta a cima/fondo (rifiuti `WILD_NO_LEGAL_POSITION` /
  `WILD_EDGE_REQUIRED`); nel gruppo resta dentro (+1 carta); eccezione 2-naturale→pulito solo per la
  pinella, il jolly resta sporco; burraco 6→7 emesso. È server-authoritative e protetto da turno/
  fase/proprietà-di-squadra.
- Quindi il `docs/specs/debito-tecnico-matta.md` previsto dal prompt documenterebbe una correzione
  di motore **che è già avvenuta**. Il solo fatto residuo da registrare è: *un'azione legittima e
  corretta resta raggiungibile a livello di protocollo pur non essendo più offerta dalla UI 1v1*.
  → **Domanda tecnica al Gate 1** (vedi §2, punto A).

**Perimetro di rimozione (solo FE):** `ActionBar.tsx` (pulsante + prop), `page.tsx` (blocco
Cima/Fondo, stato `wildAttempt`, handler). Il metodo `useGameSocket.wildSubstitute` può restare
inerte o essere rimosso (decisione di lotto). **Motore, contratto e test BE non si toccano.**

---

### R2 — Nome di ogni giocatore visibile al tavolo — **in gran parte già fatto**

- `redactFor()` (`BE_Burraco/src/room/redact.ts:32-78`) espone **già** `seats[]` con
  `displayName` per ogni posto, **senza** userId né email (anti-leak: solo nome + conteggio carte).
  `SeatPublic` è definito in `contract/types.ts:139-146` (già copiato nel FE).
- Il FE **già** mostra il nome avversario: `page.tsx:377` (`opponentName`), `page.tsx:418-422`
  (targa per-posto a 4), `OpponentStatus` nell'header (`page.tsx:523`); il proprio nome a
  `page.tsx:656`.
- **Nessun cambio di contratto necessario** (il nome è già nello stato ridotto).
- **Suffisso "(ospite)":** al tavolo NON esiste un flag `isGuest` per posto (`PlayerPublic`/
  `SeatPublic` non lo portano). Per il prompt il suffisso va mostrato "**dove il contratto lo
  prevede già**": al tavolo non è previsto → **niente suffisso al tavolo, nessuna estensione**.
  (Il suffisso esiste già nello storico: `ProfilePanel.tsx:55`, via `MatchSummary.opponentIsGuest`.)

**Delta reale R2 (piccolo, solo FE/CSS):** garantire che ogni postazione mostri sempre il
`displayName` (evitare il fallback "Avversario" quando il nome è disponibile) e definire il
**troncamento** per `displayName` fino a 40 caratteri a 375px (oggi non c'è una regola di ellissi
dedicata sulle targhe). Da confermare in Iterazione 2.

---

### R3 — Colonne centrali più larghe per le calate — CSS/layout

- Griglia tavolo: `.table-grid` (`globals.css:540-575`). `data-seats="2"` = colonna unica
  (`:557-559`); `data-seats="4"` = `minmax(0,1fr) auto minmax(0,1fr)` (`:567-569`, **da preservare**).
- Isola centrale (le calate): `.tableau` `grid-template-columns: repeat(auto-fit, minmax(96px,1fr))`
  (`globals.css:659`); `.melds` `1fr 1fr` → `1fr` sotto breakpoint mobile (`:941-950`).
- **Quantificazione (1920/1366/768/375) rinviata a Iterazione 2**: numero massimo plausibile di
  giochi calati per smazzata, larghezza carta attuale, e cosa cedere per allargare (lo spazio va
  tolto da qualche parte). Vincolo: restare compatibili con `[data-seats="4"]` senza implementarlo.

---

### R4 — Le calate devono scorrere *dietro* il contenitore della mano — stacking context

- Scala z-index esplicita (`globals.css:136-145`): `--z-melds:5` < `--z-cards:10` <
  `--z-hand-card-active:15` …
- `.bottom-hand` (`globals.css:1811-1828`) è `position: sticky; bottom:88px` con
  **`isolation: isolate`** (contesto di impilamento locale) e **sfondo opaco** di base
  (`--surface-sunken: #0b241d`, `globals.css:77`) più un velo dorato translucido sopra.
- **Diagnosi:** lo sfondo È opaco → il problema NON è la trasparenza, ma **l'ordine di stacking**
  fra il contesto di `.bottom-hand` e i `.meld` (`--z-melds`). Fix da definire in Iterazione 2
  (verifica antenati con `transform/filter/opacity/will-change`, comportamento a 375px dove la
  mano occupa gran parte dello schermo).
- **Sovrapposizione con R3 CONFERMATA:** stessi selettori/stesso file (`globals.css`, regione
  tavolo). R3 e R4 vanno **nello stesso lotto**, integrati insieme (vedi §3, Lotto 2).

---

### R5 — Sfondo "tavolo verde" per accesso / registrazione / lobby — **RISCHIO di regressione**

- Il fondo app è **già feltro verde**: `body { background-color: var(--felt-900) }`
  (`globals.css:159-172`). I pannelli auth/lobby/profilo sono **card** `.lobby`
  (`globals.css:331-336`, sfondo `linear-gradient(--surface-raised,--surface)`).
- **Rischio numero uno di R5:** la classe base `.lobby` è **condivisa** da tre schermate:
  - AuthPanel: `.lobby.auth-panel` (`AuthPanel.tsx:99`)
  - Lobby: `.lobby-wide`/`.lobby-body` (contenitore `.lobby`, `Lobby.tsx:106` + `globals.css:2880-2883`)
  - **ProfilePanel: `.lobby.profile-panel`** (`ProfilePanel.tsx:158`)
  Un `.lobby { background: verde }` **colerebbe nel profilo**, che il prompt vuole **identico a
  prima**. Lo sfondo verde va **circoscritto** ad auth+lobby (es. `.auth-panel`, contenitore lobby)
  con esplicita esclusione di `.profile-panel`. Il controllo di non-regressione visiva sul profilo
  è il collaudo del CSS.
- Texture: se servono, **self-hostate** in `public/images/` (`img-src 'self'`) o gradiente CSS.
- WCAG AA sui testi sovrapposti: da verificare con i rapporti reali in Iterazione 2.

---

### R6 — Pulsante donazione "Buy Me a Coffee" — nuovo componente, 3 punti

- **Immagini già presenti e git-tracked** (nomi minuscoli corretti):
  `FE_Burraco/public/images/donazione/buymeacoffee-button.png`, `…@2x.png`, `…-logo.png`.
- **CSP compatibile:** `img-src 'self' data:` (`next.config.mjs`) → i PNG locali si servono; nessun
  CDN, nessuno script del marchio (entrambi bloccati, come da prompt). Il link
  `https://www.buymeacoffee.com/granmasterchess` è navigazione, non governata dalla CSP.
- **Nuovo componente** `FE_Burraco/src/components/DonationButton.tsx` + `DonationButton.css`
  (classi tutte prefissate `bmc-`, `<img>` nativo con `srcSet @2x`, `width/height`,
  `target=_blank` + `rel="noopener noreferrer"`, `alt` IT, prop dimensione normale/compatto).
- **Punti d'inserimento individuati:**
  - Landing: dopo `section#contatti` (`Landing.tsx:458-476`), prima/entro `footer.site-footer`
    (`:479-485`).
  - Lobby: dopo `.join-by-code` (`Lobby.tsx:337-364`), in fondo a `.lobby-body`. Visibile anche
    agli ospiti.
  - Profilo: in fondo a `.profile-panel`, **dopo** la sezione statistiche/andamento/partite
    (`ProfilePanel.tsx`). Solo utente registrato.
- Divieti: mai al tavolo in partita; mai elemento fisso/sticky/overlay; mai nei flussi di auth.

---

### R7 — Pagina profilo con macro-statistiche — **già implementato, solo delta**

- Rotte REST **già attive e complete**: `GET /users/me/stats`, `/users/me/matches`,
  `/users/me/matches/:id` (`http/app.ts:254-330`). Utente derivato dal token (nessun IDOR);
  ospite→403; dettaglio→404 per non-partecipazione (mai 403).
- DTO completi: `UserStats`, `StyleAnalysis`, `MatchSummary`, `MatchDetail`, `StatMetric`,
  `StatTrend` (`contract/types.ts:226-368`), con soglia di significatività (`StatMetric.value:null`
  sotto soglia — già implementata).
- UI **già presente**: `ProfilePanel.tsx` mostra % vittorie, punti totali, giocate, vinte, perse,
  abbandonate, punteggio finale medio; blocco "Come giochi" (puliti/sporchi per smazzata, rapporto,
  pozzetto %, in diretta %, chiusure %, malus, penalità media); "Andamento" (sparkline SVG in linea);
  "Partite recenti". Filtro periodo (`all/30d/season`).
- **Delta reale R7 = solo le voci del menu §5 non ancora calcolate.** Candidate (da scegliere al
  Gate — vedi §4): serie di vittorie in corso e migliore; esito ultime 5 come pallini; data di
  iscrizione (già in `users.created_at`); partite vs registrati/ospiti; avversari più frequenti.
  Nota: `PROMPT_STATISTICHE_GIOCATORE.md` citato dal prompt **non esiste**; il lavoro fu consegnato
  in `docs/specs/analisi-storico-partite.md`.

---

### R8 — Protezione del login senza captcha — delta di backend

- **Esistente:** rate-limit **per-IP, finestra fissa, IN-RAM** su login/register/guest
  (`http/rateLimit.ts`); login a `max:20/15min` (`http/app.ts:162`). Errore di login **già
  generico** (401 `INVALID_CREDENTIALS` anche per body malformato, `app.ts:185-199`); difesa
  timing con hash civetta (`auth/password.ts`).
- **Mancante (delta R8):**
  1. **Lockout progressivo per-account** con ritardo crescente entro finestra e azzeramento
     automatico (valutare combinazione account+IP per evitare il DoS sull'account altrui). Oggi
     assente (nessun contatore per-account in `auth/service.ts`).
  2. **Persistenza del contatore** in DB: **non esiste** una tabella tentativi (`db/schema.ts` ha
     users/sessions/matches/…; nessuna `login_attempts`). Il RAM si azzera al risveglio di Render →
     serve **migrazione additiva `0004`** + `db/schema.ts` + store.
  3. **Honeypot** invisibile nel form login (`AuthPanel.tsx` form a `:128`, ramo `mode==="login"`)
     + scarto lato BE se valorizzato.
- Requisiti da dichiarare in spec: messaggio identico in ogni caso (già così); lockout non
  weaponizzabile (finestra + azzeramento); contatore persistito.
- Nota fuori-R8 (registrazione): `409 EMAIL_TAKEN` è enumerazione utenti accettata per v1
  (`app.ts:174-179`); resta fuori scope, la segnalo solo per completezza.

---

## 2. Fatti tecnici da chiarire al `⏸ GATE 1`
*(Solo fatti scoperti sul codice; nessuna decisione di prodotto riaperta — §4/§6 del prompt.)*

- **A) Matta già corretta → `debito-tecnico-matta.md` da ridefinire.** La premessa di R1
  (motore con regola sbagliata da rinviare) è superata: il motore è già corretto. Il pulsante
  si rimuove comunque (decisione non rinegoziabile), ma:
  - il documento di debito, se lo si vuole, non documenta più "correzione motore rinviata" bensì
    il fatto residuo: *azione `wild_substitute` corretta ma raggiungibile via WS pur senza UI 1v1*;
  - inoltre, per trasparenza: rimuovere il pulsante toglie dalla UI 1v1 un'azione di gioco
    **legittima e funzionante** (la sostituzione della matta esiste eccome nel Burraco). Procedo
    con la rimozione come da R1; segnalo solo il fatto perché la motivazione originale
    ("la regola non c'è più") non corrisponde allo stato del codice.
  - **Serve una decisione tecnica:** manteniamo `debito-tecnico-matta.md` (ridefinito come sopra)
    oppure lo omettiamo, dato che non c'è alcun bug di motore da rinviare?

- **B) R2 senza contratto e quasi completo.** Il nome è già nel contratto e già reso. Il Lotto 1
  si riduce a: rimozione pulsante (R1) + troncamento/robustezza targhe (R2). Confermo che va bene
  tenerli insieme (entrambi al tavolo, solo FE), oppure R1 può stare da solo.

- **C) R7 già implementato.** Confermo che il lavoro R7 è **solo delta** sulle voci del menu §5
  (§4 sotto). Nessuna riprogettazione, nessuno spostamento fuori dal pannello profilo.

- **D) R5 rischio `.lobby` condivisa col profilo.** Lo sfondo verde sarà circoscritto ad
  auth+lobby con esclusione esplicita di `.profile-panel`; il profilo resta identico (verificato a
  vista come non-regressione).

---

## 3. Lotti proposti (rivisti dalla ricognizione)

| Lotto | Contenuto | Branch proposto | Note dalla ricognizione |
|---|---|---|---|
| **1** | R1 (rimozione pulsante matta) + R2 (nomi/troncamento) | `claude/tavolo-matta-nomi` | **Più piccolo del previsto:** solo FE, **nessun** cambio di contratto, **nessun** debito motore. Motore/test BE intoccati. |
| **2** | R3 (colonne) + R4 (stacking calate) | `claude/tavolo-layout-calate` | **Sovrapposizione confermata** (stesso `globals.css`, regione tavolo): un solo lotto, integrati insieme. Solo CSS/layout. |
| **3** | R5 (sfondi verdi auth/registrazione/lobby) | `claude/grafica-auth-lobby` | Solo FE/CSS. Rischio `.lobby` condivisa → scoping esplicito + non-regressione profilo. |
| **4** | R6 (donazione ×3) + R7 (delta statistiche) | `claude/profilo-statistiche-donazione` | Immagini pronte e tracciate; R7 = solo delta menu §5. Componente `DonationButton` riusato 3 volte. |
| **5** | R8 (lockout progressivo login) | `claude/protezione-login-lockout` | **Unico lotto backend + migrazione `0004`** (tabella tentativi) + honeypot FE. Indipendente. |

**Ordine consigliato:** 1 → 2 → 3 → 4 → 5. Lotti 1 e 2 toccano entrambi il tavolo ma file diversi
(1 = TSX componenti; 2 = `globals.css`): se paralleli, integrare prima il 2 (layout) poi il 1
(rimozione pulsante), o viceversa senza conflitti reali (superfici disgiunte).

---

## 4. Menu statistiche R7 — da scegliere al Gate (solo il DELTA non ancora presente)

*Già disponibili e mostrate* (nessun lavoro): % vittorie, punti totali, giocate/vinte/perse/
abbandonate, punteggio medio, burrachi puliti/sporchi per smazzata e rapporto, pozzetto % e in
diretta %, chiusure %, penalità media mano, malus pozzetto, andamento (sparkline), storico.

*Candidate del delta* (costo indicato):
- Serie di vittorie in corso + serie migliore — *nuova query* (da `matches` per utente).
- Esito ultime 5 partite come pallini (con parola/icona, mai solo colore) — *nuova query* (dati già
  presenti).
- Data di iscrizione — *già disponibile* (`users.created_at`), manca solo l'esposizione.
- Partite vs registrati / vs ospiti, distinte — *nuova query* (join `match_players`).
- Avversari più frequenti — *nuova query*.
- Miglior punteggio in una singola partita — *nuova query* (o già derivabile).

Nessun nuovo campo DB risulta necessario per queste voci (tutte derivabili dai dati esistenti).
Regole da rispettare: soglia di significatività (già presente), nessuna libreria di grafici
(SVG/CSS in linea), esito mai affidato al solo colore.

---

## 5. Prossimi passi

`⏸ GATE 1` — in attesa di: (a) approvazione dei lotti e dell'ordine; (b) decisione sul punto §2-A
(`debito-tecnico-matta.md` ridefinito o omesso); (c) scelta delle voci del menu §4 per R7.
Solo dopo l'ok procedo con l'**Iterazione 2** (specifiche dei soli lotti approvati) e il `⏸ GATE 2`.
