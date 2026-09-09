# BURRACO ONLINE — MACRO-CICLO 3: CORREZIONE MATTA + MODALITÀ 2v2
**Versione:** 3.0
**Data:** 2026-09-09
**Macro-ciclo:** 3 di 3
**Status:** In attesa di approvazione del Piano

---

## CONTESTO PROGETTO

**Piattaforma:** Burraco Online
**Stato precedente:**
- Macro-ciclo 1 (autenticazione, ospiti, bottom hand) ✅ completato e mergiato
- Macro-ciclo 2 (landing page) ✅ completato e mergiato
- In produzione: partita 1v1 completa (motore, lobby, storico, statistiche)

**Scope Macro-ciclo 3:**
0. **CORREZIONE BUG DI REGOLA** sulla sostituzione della matta (impatta l'1v1 in produzione)
1. **Refactoring abilitante** a comportamento invariato: posti e squadre
2. **Modalità 2v2** (4 giocatori a coppie): motore, contratto, redazione stato, lobby, UI

**Stack:** Next.js/React (Vercel), API su Render, PostgreSQL (Neon)
**Fonte di verità del dominio:** skill `skill-burraco` (aggiornata con le regole 2v2 complete)

---

## ⚠️ PREMESSA VINCOLANTE — LEGGERE PRIMA DI TUTTO

### P1. L'1v1 in produzione non deve regredire
La partita 1v1 è live e funzionante. **La suite esistente di 40 file di test in
`BE_Burraco/test/` è dichiarata SUITE DI NON-REGRESSIONE.** Deve restare verde a ogni
singolo passo, con la sola eccezione dei test che coprono la regola della matta (Fase 0,
che li cambia deliberatamente). Un agente che rompe questi test si ferma e lo segnala:
non li adatta per farli passare.

### P2. Il contratto FE/BE non è verificato dal compilatore
Per decisione architetturale #8, `FE_Burraco/src/lib/contract.ts` è una **copia manuale**
di `BE_Burraco/src/contract/types.ts`. Nessuno strumento controlla che siano allineati.
**Regola vincolante: ogni commit che tocca `contract/types.ts` o `room/redact.ts` deve
aggiornare la copia FE nello stesso commit.** Questo è il rischio numero uno del ciclo.

### P3. Anti-leak esteso al compagno
In 2v2 il destinatario dello stato ha tre altri giocatori, di cui **uno alleato**. I giochi
della coppia sono condivisi e visibili; **la MANO del compagno resta privata esattamente
come quella degli avversari**. Non esistono eccezioni "per aiutare la coppia".

### P4. Priorità di proprietà: squadra, mai posto
Dopo la Fase 1, **nessun controllo di proprietà di un gioco calato può usare `ownerSeat`**.
Si usa sempre la squadra. Vale per: chiusura, ampliamento, sostituzione matta, limite calate
prima del pozzetto, punteggio, raggruppamento nella UI.

---

## PIANO DEL MACRO-CICLO 3
*(Da approvare prima di avviare il flusso)*

### FASE 0 — Correzione della regola della matta (1v1 + 2v2)
**Perché è la fase zero:** la skill affermava che la matta sostituita "torna in mano".
È sbagliato. La regola corretta (skill, sezione "SOSTITUZIONE DELLA MATTA") è che la matta
**non torna mai in mano**: nelle sequenze si sposta in cima o in fondo, nei gruppi resta
dentro come carta in più. Il codice attuale (`engine/game.ts`, `pinellaSubstitute`)
implementa la regola sbagliata. Va corretto **prima** di costruirci sopra il 2v2.

- [ ] `agente_analista`: specifica della nuova meccanica, inclusi i casi limite
      (sequenza già ad Asso alto, nessuna posizione legale → rifiuto; gruppo che cresce;
      transizione 6→7 carte che genera un burraco sporco)
- [ ] `agente_develop`: riscrittura di `pinellaSubstitute` + nuovo codice di rifiuto per
      "nessuna posizione legale per la matta"; aggiornamento del contratto se il client
      deve poter scegliere cima/fondo
- [ ] `agente_test`: sostituzione dei test sulla vecchia semantica; nuovi scenari
- [ ] **CANCELLO:** l'1v1 gira con la regola corretta e la suite è verde → si prosegue

### FASE 1 — Refactoring abilitante (comportamento INVARIATO)
Nessun cambiamento funzionale. Ogni passo è verificabile con la suite esistente.

- [ ] **1a.** De-duplicare i file degli agenti: oggi `.claude/agents/agente_*.md` e
      `subagents/agente_*.md` sono byte-identici. Scegliere UNA sorgente di verità.
      Stessa scelta per `skill-burraco` (copia repo vs skill di account).
- [ ] **1b.** `Seat` da tipo letterale `0 | 1` a numerico; introdurre `TeamId` e la funzione
      `teamOfSeat(seat, config)`. In modalità individuale: `team === seat`.
- [ ] **1c.** Aggiungere `Meld.ownerTeam` e spostare **tutti** i controlli di proprietà da
      `ownerSeat` a `ownerTeam` (vedi P4). In 1v1 il comportamento è identico.
- [ ] **1d.** Motore generico: `seats: SeatState[]`, `cumulative: number[]`, turno
      `(seat + 1) % n`, mazziere `(dealer + 1) % n`, distribuzione di `n` mani.
      In 1v1 `(0+1)%2` equivale a `1-0`: nessuna differenza osservabile.
- [ ] **CANCELLO:** suite di non-regressione verde, nessun cambiamento visibile → si prosegue

### FASE 2 — Analisi 2v2 (Agente_analista)
- [ ] Modello dati: migrazione `0003` **additiva** (`match_players.team` con default = seat;
      `matches.winner_team` nullable). Con backfill e piano di rollback.
- [ ] **Piano di rottura del contratto FE/BE**: elenco puntuale dei campi che cambiano in
      `contract/types.ts` e la corrispondente modifica in `FE_Burraco/src/lib/contract.ts`.
      È il deliverable più importante di questa fase.
- [ ] Specifica della redazione stato per 4 posti (`redactFor`: da `opponentHandCount` a
      `seats[]` con seat, conteggio carte, squadra, stato di connessione)
- [ ] Specifica lobby a 4 posti: sala d'attesa, assegnazione dei posti, formazione delle
      coppie (posti opposti 0+2 / 1+3), avvio a tavolo pieno
- [ ] Specifica punteggio di coppia: come registrare in `hand_scores` (che è per-seat) i
      fatti che sono **di coppia e una volta sola** (bonus chiusura +100, malus pozzetto −100)
- [ ] Impatto su storico e statistiche: `MatchSummary`/`MatchDeal`/`MatchDetail` sono
      binari (`you`/`opponent`); definire come diventano di coppia
- [ ] Piano di test (funzionale + sicurezza)
- [ ] Output → `agente_develop`

### FASE 3 — Sviluppo (Agente_develop)
- [ ] Migrazione DB `0003` + `db/schema.ts` + `db/persistence.ts`
- [ ] Motore: pozzetti riservati per coppia; chiusura di coppia; punteggio di squadra
      (carte in mano di entrambi i compagni sottratte; +100 e −100 una volta sola)
- [ ] `redactFor` a N posti, con anti-leak sulla mano del compagno (P3)
- [ ] Contratto WS + **copia FE nello stesso commit** (P2)
- [ ] `Room`: `isFull()` da `seatsTotal()` e non dalla costante 2; notifica a tutti gli altri
      posti e non a "l'avversario"; snapshot a N mani; forfait di coppia
- [ ] Lobby a 4 posti
- [ ] FE: `data-seats="4"` (CSS già presente), `teamOf` reale passato a `Melds`,
      generalizzazione della postazione avversario in `app/page.tsx`
- [ ] Output → `agente_ui_ux`

### FASE 4 — UI/UX (Agente_ui_ux)
- [ ] Base già esistente: mockup `05-tavolo-2v2-desktop.html` e `06-tavolo-2v2-mobile.html`,
      CSS `[data-seats="4"]`, colori di squadra e crest già definiti in `direzione-visiva.md`
- [ ] **Decisione aperta da chiudere:** `docs/specs/tavolo-e-interazione-carte.md` §5.2
      ammette che in portrait piccolo le quattro postazioni non ci stanno. Proporre la
      soluzione (compressione, scroll, postazioni collassate) e motivarla.
- [ ] Leggibilità compagno vs avversari con i tre canali ridondanti già stabiliti
      (posizione, colore di squadra, etichetta + crest) — mai il solo colore
- [ ] Accessibility review WCAG 2.1 AA sul tavolo a 4
- [ ] Output → `agente_test`

### FASE 5 — Test (Agente_test)
- [ ] Suite di **non-regressione 1v1**: i 40 file esistenti devono restare verdi
- [ ] Fixture a 4 giocatori e rotazione oraria dei turni
- [ ] Scenari di chiusura di coppia (burraco del compagno abilita la chiusura)
- [ ] Scenari di pozzetto: riservato per coppia, seconda presa negata alla stessa coppia,
      giocatore che svuota la mano senza pozzetto disponibile
- [ ] Scenari di punteggio di coppia: +100 e −100 contati **una volta sola**; carte in mano
      del compagno sottratte
- [ ] Scenari sulla nuova regola della matta (sequenza cima/fondo, gruppo, rifiuto)
- [ ] Test responsive del tavolo a 4 (desktop, tablet, mobile portrait e landscape)
- [ ] Output → `agente_security`

### FASE 6 — Security (Agente_security)
- [ ] **Priorità assoluta: leak della mano del compagno.** Test anti-leak esplicito che
      verifichi che `redactFor` non esponga mai le carte di nessun altro posto, alleato incluso
- [ ] Verifica che nessun campo interno nuovo (`team`, riserve pozzetto) finisca nel payload
- [ ] Autorizzazione delle mosse: un giocatore non può agire sui giochi della coppia avversaria
      né muovere per conto del compagno
- [ ] Riconnessione e reclaim posto con 4 slot (SEC-04/10/11 restano validi)
- [ ] Abbandono: verificare che il forfait chiuda per **coppia** e non per singolo
- [ ] Output piano remediation → `agente_analista`

### FASE 7 — Remediation (se necessaria)
- [ ] `agente_analista` riceve il report, crea il PIANO DI REMEDIATION, lo sottopone
- [ ] Se approvato: develop → test → security → analista (**senza** ripassare da ui_ux)

---

## SCOPE DETTAGLIATO

### ✅ Incluso
1. Correzione della regola della matta (1v1 e 2v2)
2. Refactoring posti/squadre a comportamento invariato
3. Modalità coppie a 4 giocatori: motore, punteggio, chiusura, pozzetti
4. Redazione stato a N posti con anti-leak esteso
5. Lobby e sala d'attesa a 4 posti con formazione delle coppie
6. Tavolo a 4 postazioni, desktop e mobile
7. Storico e statistiche adattati alla coppia

### ❌ Escluso
- Modalità individuale a 3 e 5 giocatori
- Coppie a 6 giocatori
- Varianti `tipo_burraco` (Reale, Aperto, Chiuso, Chiuso STBL)
- Scelta del compagno tramite invito diretto (in questo ciclo: assegnazione ai posti)
- Chat di coppia, spettatori, tornei

---

## REGOLE 2v2 — RIFERIMENTO RAPIDO
*(fonte autorevole: skill `skill-burraco`, sezione "MODALITÀ A COPPIE". In caso di
discrepanza vince la skill, non questo riassunto.)*

| Aspetto | Regola |
|---|---|
| Posti | 0,1,2,3 in senso orario |
| Coppie | posti opposti: A = 0+2, B = 1+3 |
| Turno | `(seat + 1) % 4` |
| Mazziere | `(dealer + 1) % 4`; apre `(dealer + 1) % 4` |
| Giochi calati | della COPPIA; si possono ampliare quelli del compagno |
| Matta | mai in mano: sequenze → cima/fondo, gruppi → resta dentro |
| Pozzetti | due, **uno per coppia**, riservato; mai due alla stessa coppia |
| Chiusura | serve un burraco DI COPPIA + pozzetto preso dalla coppia |
| Bonus chiusura | +100 alla COPPIA, una volta sola |
| Malus pozzetto | −100 alla COPPIA, una volta sola |
| Carte in mano | si sommano quelle di ENTRAMBI i compagni e si sottraggono |
| Vittoria | la COPPIA che raggiunge per prima il punteggio obiettivo |
| Abbandono | oltre la grazia (180s): la sua COPPIA perde a forfait |

---

## NOTE PER GLI AGENTI
- **3 iterazioni interne** per ogni agente prima di passare il testimone
- **Output standardizzato:** ogni agente termina con `OUTPUT PER: <agente successivo>`
- **Comunicazione:** output esplicito, nessuna assunzione
- **Consultare sempre la skill `skill-burraco`** prima di toccare logica di gioco, punteggi,
  stati o condizioni di vittoria. Regola non coperta → chiedere al lead, mai improvvisare.
- **Documento di riferimento architetturale:** `docs/specs/analisi-2v2-readiness.md`
  (audit completo con riferimenti `file:riga` dei punti da modificare)

---

## CANCELLI DI APPROVAZIONE
- ✋ **BLOCCO:** Prima di lanciare `agente_develop`, il piano deve essere approvato
- ✋ **BLOCCO:** Fine Fase 0 — la regola della matta è corretta e la suite è verde
- ✋ **BLOCCO:** Fine Fase 1 — refactoring completato senza alcun cambiamento osservabile
- ✋ **BLOCCO:** Ricevuti i bug di security, l'analista crea il PIANO DI REMEDIATION
- ✋ **BLOCCO:** Al termine del Macro-ciclo 3/3 — essendo l'ultimo ciclo previsto, l'analista
  NON avvia un nuovo giro: presenta lo stato finale e i problemi residui e chiede se
  (a) chiudere, (b) autorizzare cicli extra, (c) ridefinire lo scope

---

## CHECKLIST OPERATIVA (per te)

- [ ] Leggi questo file
- [ ] Verifica che la skill `skill-burraco` aggiornata sia quella attiva
- [ ] Leggi il piano di `agente_analista`
- [ ] Approvi il piano?
- [ ] Se sì → Fase 0 (correzione matta), poi cancello
- [ ] Fase 1 (refactoring invariato), poi cancello
- [ ] Fase 2 → analista → approvazione → develop → ui_ux → test → security → analista

---

## PROBLEMI O CHIARIMENTI?
Se durante il ciclo mancano specifiche, gli agenti chiedono a te (lead) prima di procedere.

---

*Prossimi passi: approvazione del Piano, poi Fase 0.*
