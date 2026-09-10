# Analisi di prontezza architetturale — evoluzione 2v2 (coppie)

> **Stato:** AUDIT read-only dell'intero pacchetto software. Nessun codice modificato.
> **Data:** 2026-09-09
> **Perimetro esaminato:** `BE_Burraco/src` (28 file, ~6.3k righe), `FE_Burraco/src`
> (22 file, ~6.4k righe), `BE_Burraco/drizzle` (3 migrazioni), `BE_Burraco/test`
> (40 file), `docs/specs`, `.claude/agents`, `subagents`, `.claude/skills`.
> **Fonte di verita' del dominio:** `.claude/skills/skill-burraco/SKILL.md`.

---

## 0. Verdetto

**Nessun blocco architetturale insormontabile.** L'architettura e' sana e in parte
gia' predisposta: il DB ragiona per `seat` (non `player1/player2`), la redazione
anti-leak e' centralizzata in un unico file, il layout FE e il CSS a 4 postazioni
esistono gia'.

Il costo e' **concentrato e prevedibile**, non diffuso: tre file del backend
(`engine/game.ts`, `engine/scoring.ts`, `room/redact.ts`) contengono la quasi
totalita' delle assunzioni binarie di gioco. Il resto e' propagazione di tipo.

**Il rischio principale non e' il motore: e' il contratto FE/BE.** La decisione
architetturale #8 (il FE tiene una COPIA MANUALE di `contract/types.ts`) rende ogni
rottura di contratto un doppio intervento non verificato dal compilatore.

---

## 1. Cio' che e' GIA' pronto per il 2v2

| Elemento | Evidenza | Perche' aiuta |
|---|---|---|
| Schema DB per posto | `db/schema.ts:96-158` — `match_players(match_id, seat, ...)`, `hands(dealer_seat, closer_seat)`, `hand_scores(hand_id, seat)`, `game_events(actor_seat)` | Nessun `player1/player2` da smontare. Servono solo colonne additive. |
| Assegnazione posti generica | `room/Room.ts:399` — `const seat = this.players.length as Seat` | Gia' scala a N posti senza modifiche. |
| Posti totali da config | `room/Room.ts:150-153` — `seatsTotal() { return this.config.numeroGiocatori }` | Il numero di posti e' gia' un dato, non una costante. |
| Redazione centralizzata | `room/redact.ts` (41 righe, funzione unica `redactFor(engine, viewer)`) | Esiste gia' **un solo punto** in cui si decide cosa vede chi. |
| Motore parametrico | `contract/types.ts:66-79` — `GameConfig` con `varianteChiusura`, `presaPozzetto`, `limiteCalatePrimaDelPozzetto` | Il pattern "motore che legge parametri" e' gia' adottato. |
| FE gia' ragiona per squadra | `components/Melds.tsx:39-45` — prop `teamOf?: (seat) => "us"\|"them"`, con default 1v1 | Il raggruppamento dei giochi e' gia' per squadra, non per posto. |
| CSS a 4 postazioni | `app/globals.css:567-578` — `[data-seats="4"]` con aree `north/west/east/south` | La griglia 2v2 esiste gia'. |
| Mockup 2v2 | `public/mockups/05-tavolo-2v2-desktop.html`, `06-tavolo-2v2-mobile.html` | Il design e' gia' stato fatto. |
| Rete di sicurezza | 40 file di test in `BE_Burraco/test` | Il refactor a comportamento invariato e' verificabile. |

---

## 2. Blocchi reali, in ordine di costo

### B1 — `Seat` e' un tipo LETTERALE binario
`contract/types.ts:21` e `FE_Burraco/src/lib/contract.ts:20`: `export type Seat = 0 | 1;`
Occorrenze: **105 nel BE, 34 nel FE**.
Allargarlo fa fallire il typecheck in decine di punti. E' un **bene** (il compilatore
elenca cosa rivedere), ma va affrontato come primo passo pianificato, non a valle.

### B2 — Il motore e' binario per costruzione (`engine/game.ts`)
- `:105` `seats: [SeatState, SeatState]` — tupla a lunghezza fissa
- `:122` `cumulative: [number, number]`
- `:155` `this.currentSeat = (1 - dealer)` — apertura come complemento a 1
- `:495` `endTurn()`: `this.currentSeat = (1 - this.currentSeat)` — **turno come toggle, non come rotazione**
- `:556` `startNextHand()`: `this.startHand((1 - this.dealerSeat))` — mazziere alternato, non ruotato
- `:159-161` `startHand()` distribuisce esattamente 2 mani
- `:533` `endHand()`: `winner = a > b ? 0 : 1` — confronto fra due soli cumulati

### B3 — Proprieta' dei giochi legata al POSTO, non alla SQUADRA
E' il blocco piu' importante dal punto di vista delle regole.
- `engine/game.ts:487` `canClose(seat)`: `m.ownerSeat === seat` — in coppie la condizione
  di chiusura e' **della coppia** (skill: "basta UN pozzetto per permettere la chiusura
  della coppia"; i giochi calati sono CONDIVISI)
- `engine/game.ts:219` `meldExtend`: `if (meld.ownerSeat !== seat) return reject("NOT_MELD_OWNER")`
  — in 2v2 devi poter ampliare i giochi del **compagno**
- `engine/game.ts:253` `pinellaSubstitute`: stesso rifiuto
- `engine/game.ts:206` limite calate pre-pozzetto: `m.ownerSeat === seat`
- `engine/scoring.ts:38` `melds.filter(m => m.ownerSeat === s.seat)` — **i punti dei giochi
  vanno a chi li ha calati.** In coppie i giochi sono della squadra: senza questo cambio
  il punteggio di coppia e' sbagliato.

### B4 — `redactFor` conosce UN solo avversario
`room/redact.ts:15` `const opponent = (1 - viewer)` → `:22` `opponentHandCount: engine.handCount(opponent)`.
Serve `seats: { seat, handCount, connectionStatus, team }[]`.
File piccolo (41 righe) ma **cambia il contratto verso il FE**.

### B5 — Contratto WebSocket binario (`contract/types.ts`)
- `:67-68` `numeroGiocatori: 2` e `modalita: "individuale"` sono **tipi letterali**, non valori
- `:105` `opponentHandCount: number`
- `:138` `scores: [number, number]`
- `:444`, `:451` `cumulative` / `finalScores: [number, number]`
- `:469-470` `opponent_disconnected` / `opponent_reconnected` al singolare
Ogni voce va replicata a mano in `FE_Burraco/src/lib/contract.ts` (decisione #8): **nessun
compilatore verifica l'allineamento**. E' la superficie piu' esposta a errori silenziosi.

### B6 — `Room` notifica e fotografa in binario
- `:970` `notifyOpponent(seat, msg)` — cerca **un** avversario (`p.seat !== seat`)
- `:988` `snapshot()` — `hands: [this.engine.handOf(0), this.engine.handOf(1)]`
- `:937` `forfeitStalledSeat()` — `winnerSeat = opp ? opp.seat : (1 - stalledSeat)`
- `:131` `isFull(): return this.players.length >= 2` — **costante hardcoded, non usa `seatsTotal()`**

### B7 — Disconnessione: regola di prodotto MANCANTE per il 2v2
Oggi (`Room.ts:696-720`) la scadenza della grazia chiude la partita: `closeRoom("abandoned")`.
Con 4 giocatori questo non regge: l'abbandono di 1 su 4 non puo' semplicemente annullare la
partita agli altri 3. **Non esiste una regola nella skill.** Va decisa (vedi §5).

### B8 — Statistiche e storico interamente binari
- `stats/store.drizzle.ts:226`, `:266` e `stats/store.memory.ts:330`, `:357` — `oppSeat = (1 - yourSeat)`
- DTO: `MatchSummary.opponentName/opponentScore` (`contract/types.ts:251-255`),
  `MatchDeal.you/opponent` (`:287`), `MatchDetail.finalScore.{you,opponent}` (`:304`)
- UI: `components/ProfilePanel.tsx` (739 righe) costruita su quei DTO
Nota: `docs/specs/analisi-storico-partite.md:102` dichiara esplicitamente la colonna `team`
**"fuori perimetro, predisposizione rinviabile"**. E' la decisione da ribaltare adesso.

### B9 — Duplicazione dei file agente
`.claude/agents/agente_*.md` e `subagents/agente_*.md` sono **byte-identici** (verificato su
tutti e 5). Aggiornare un solo lato produce due verita' divergenti. Da risolvere **prima** di
toccare i prompt per il 2v2.

### B10 — Lobby dimensionata su 2 posti
`Room.isFull()` (`:131`), `startMatch()` (`:521`) all'ingresso del secondo giocatore,
`isMergeableQuickMatch(): seatsTakenLive() === 1` (`:172-179`), `WaitingTableView.seatsTotal`
("oggi sempre 2", `contract/types.ts:523`). Con 4 posti servono: sala d'attesa a 4 slot,
assegnazione/scelta del compagno, avvio a tavolo pieno.

---

## 3. Cosa si puo' fare ADESSO senza toccare il comportamento 1v1

Strategia: **modellare l'1v1 come "due squadre da un giocatore"**. I passi 0-3 sono a
comportamento invariato e sono coperti dai 40 file di test esistenti.

| # | Passo | File | Rompe il contratto? |
|---|---|---|---|
| 0 | De-duplicare i file agente: una sola sorgente di verita' | `.claude/agents` vs `subagents` | no |
| 1 | `Seat` da letterale a numerico + introdurre `TeamId` e `teamOfSeat(seat, config)` (in individuale: `team = seat`) | `contract/types.ts`, copia FE | no (solo tipi) |
| 2 | Aggiungere `Meld.ownerTeam` e far passare **tutti** i controlli di proprieta' da `ownerTeam`: `canClose`, `meldExtend`, `pinellaSubstitute`, limite calate, `scoreHand`, `Melds.tsx` | `engine/game.ts`, `engine/scoring.ts`, `components/Melds.tsx` | no (in 1v1 team = seat) |
| 3 | Motore generico: `seats: SeatState[]`, `cumulative: number[]`, turno `(currentSeat + 1) % n`, mazziere `(dealerSeat + 1) % n`, `startHand` distribuisce n mani | `engine/game.ts` | no — in 1v1 `(0+1)%2 === 1-0` |
| 4 | `redactFor`: sostituire `opponentHandCount` con `seats[]` (seat, handCount, team, stato) | `room/redact.ts` + contratto + copia FE | **si'** |
| 5 | `GameConfig`: `numeroGiocatori: number`, `modalita: "individuale" \| "coppie"`, validati a runtime | `contract/types.ts`, `config.ts` | **si'** |
| 6 | Migrazione `0003` **additiva**: `match_players.team` (default = seat), `matches.winner_team` nullable. `hand_scores` resta per-seat: il totale di coppia e' una SUM | `drizzle/`, `db/schema.ts`, `db/persistence.ts` | no (additiva) |
| 7 | FE: passare un `teamOf` reale a `Melds`, generalizzare `page.tsx:339-344`, attivare `data-seats="4"` | `app/page.tsx`, `components/` | dipende da 4 |

**Ordine consigliato:** 0 → 1 → 2 → 3 (invariati, verificabili dai test attuali), poi
4 → 5 → 6 → 7 in un macro-ciclo dedicato con approvazione esplicita.

**Perche' farlo ora:** ogni funzionalita' di gioco aggiunta sul modello binario raddoppia
il costo della migrazione. I passi 1-3 vanno fatti **prima** di scrivere altra logica.

---

## 4. Impatto su skill e agenti

### 4.1 `skill-burraco` — va aggiornata (bloccante)
Oggi la skill **vieta esplicitamente** di implementare le coppie (righe 33 e 172:
"NON implementare senza richiesta ESPLICITA"). Finche' resta cosi', ogni agente che legge
la skill rifiutera' di lavorare al 2v2. Serve:
1. promuovere la sezione "Modalita' a coppie" da **DOCUMENTAZIONE** a **SPECIFICA IMPLEMENTATIVA**;
2. aggiornare la sezione "Stato di implementazione" e la `description` del frontmatter;
3. colmare i buchi di regola elencati in §5.

### 4.2 `CLAUDE.md` (radice)
Oggi e' il Macro-ciclo 2 (Landing page). Serve un `CLAUDE.md` di Macro-ciclo 3 con:
scope "abilitazione 2v2", **vincolo di non-regressione dell'1v1 come cancello**,
i passi 0-7 come tappe approvabili.

### 4.3 Subagenti
| Agente | Cosa cambia |
|---|---|
| `agente_analista` | Deve produrre due piani distinti: (a) migrazione DB `0003` additiva con backfill e rollback; (b) piano di **rottura del contratto FE/BE** — e' la parte rischiosa, perche' la copia FE e' manuale. |
| `agente_develop` | Due invarianti vincolanti: (1) *nessun controllo di proprieta' di un meld usa `ownerSeat`: si usa sempre `ownerTeam`*; (2) *nessuna modifica a `redact.ts` o `contract/types.ts` senza aggiornare nello stesso commit `FE_Burraco/src/lib/contract.ts`*. |
| `agente_ui_ux` | Mockup 05/06 e CSS `data-seats="4"` esistono gia'. Il lavoro nuovo e' il **portrait mobile a 4 posti**: `docs/specs/tavolo-e-interazione-carte.md:227` ammette gia' "in portrait piccolo NON ci sta tutto" — decisione aperta da chiudere. |
| `agente_test` | Fixture a 4 giocatori e scenari di chiusura di coppia. I 40 file esistenti vanno dichiarati **suite di non-regressione 1v1**: devono restare verdi a ogni passo 0-3. |
| `agente_security` | Superficie nuova: `redactFor` passa da 1 a 3 altri giocatori, di cui **1 alleato**. Il leak da evitare e' la **mano del compagno** (la tentazione di mostrarla "per aiutare la coppia"). Va aggiunto un test anti-leak esplicito per il posto del compagno. |

---

## 5. Regole mancanti — DECISIONI RICHIESTE prima di implementare

La skill documenta il 2v2 ma non copre questi casi. Nessun agente deve improvvisarli.

1. Un giocatore puo' **ampliare** un gioco calato dal compagno? (atteso: si', "giochi condivisi")
2. Puo' **sostituire una pinella** calata dal compagno?
3. Il malus **-100 pozzetto non preso** e' per giocatore o per coppia? (la skill dice solo che
   "basta UN pozzetto per la chiusura della coppia")
4. Il bonus **chiusura +100** va al giocatore che chiude o alla coppia una volta sola?
5. Le **carte in mano del compagno** che non ha chiuso si sottraggono al totale di coppia?
6. **Ordine dei posti** e rotazione del mazziere a 4 (senso orario: 0→1→2→3, coppie 0/2 e 1/3?)
7. Il **secondo pozzetto** puo' essere preso dalla stessa coppia che ha gia' preso il primo?
8. **Abbandono di un giocatore su 4** a partita in corso: la coppia perde? si prosegue in 3?
   si annulla? (decisione di prodotto, non di gioco — vedi B7)

---

## 6. Sintesi per la decisione

- **Si puo' iniziare lo studio adesso:** si'.
- **Ci sono blocchi che impediscono il 2v2:** no.
- **C'e' lavoro preparatorio che conviene fare subito:** si', i passi 0-3, a comportamento
  invariato e coperti dai test esistenti.
- **Skill e agenti vanno aggiornati:** si', e la skill e' **bloccante** (oggi vieta l'implementazione).
- **Il rischio maggiore:** la copia manuale del contratto FE/BE, non il motore di gioco.
