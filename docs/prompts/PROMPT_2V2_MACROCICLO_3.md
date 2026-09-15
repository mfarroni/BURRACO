# PROMPT PER CLAUDE CODE — MACRO-CICLO 3 (correzione matta + 2v2)

**Come si usa:** questi prompt vanno incollati nella sessione di Claude Code aperta nella
radice del repository, **uno alla volta e in quest'ordine**. Ogni prompt si ferma a un
cancello e aspetta la tua approvazione: è voluto. Non incollarli tutti insieme.

Ogni prompt è **autosufficiente**: se apri una sessione nuova a metà percorso, funziona lo
stesso senza il contesto dei precedenti.

**Prima di iniziare, verifica di aver fatto:**
1. `.claude\skills\skill-burraco\SKILL.md` aggiornata (contiene la sezione
   "SOSTITUZIONE DELLA MATTA" e "MODALITÀ A COPPIE")
2. i 5 file in `.claude\agents\` sostituiti con quelli di `docs\agents-v3\`
3. `CLAUDE.md` sostituito con quello del Macro-ciclo 3

---
---

## PROMPT 0 — Verifica di partenza (30 secondi, fallo davvero)

```
Prima di iniziare il Macro-ciclo 3, verifica che l'ambiente sia quello giusto e
riportami un esito secco, senza modificare nulla:

1. Leggi CLAUDE.md in radice: conferma che sia il Macro-ciclo 3 (correzione matta + 2v2).
2. Leggi .claude/skills/skill-burraco/SKILL.md: conferma che esistano le sezioni
   "SOSTITUZIONE DELLA MATTA" e "MODALITA' A COPPIE", e che lo stato di implementazione
   dica che le coppie sono IN IMPLEMENTAZIONE e non "NON implementare".
3. Elenca i file in .claude/agents/ e conferma che ognuno abbia la frontmatter YAML
   con name, description e tools.
4. Esegui la suite di test del backend e riportami quanti test passano e quanti falliscono.

Non correggere nulla e non iniziare a sviluppare. Dimmi solo se i quattro punti sono a
posto. Se qualcosa non torna, fermati e spiegami cosa manca.
```

**Cancello:** se un punto non torna, sistemalo prima di proseguire. In particolare, se la
skill dice ancora "NON implementare le coppie", gli agenti si rifiuteranno di lavorare.

---
---

## PROMPT 1 — FASE 0: analisi della correzione della matta

```
Avvia il Macro-ciclo 3, Fase 0: correzione della regola di sostituzione della matta.

CONTESTO
La skill-burraco affermava che la matta sostituita "torna in mano al giocatore".
È SBAGLIATO, ed è stato corretto nella skill. La regola corretta ora è:
la matta NON torna mai in mano; nelle SEQUENZE si sposta in cima o in fondo estendendo
il gioco; nei GRUPPI resta dentro e il gruppo cresce di una carta.

Il codice attuale implementa la regola sbagliata. Questo è un BUG che riguarda l'1v1
già in produzione, non una funzionalità nuova del 2v2.

COSA TI CHIEDO ORA
Delega ad agente_analista la sola ANALISI di questa correzione. Non scrivere codice.

L'analista deve produrre:
1. Diagnosi read-only con riferimenti file:riga di tutto ciò che implementa la vecchia
   semantica: il motore, il contratto, i codici di rifiuto, i test che la verificano.
2. Specifica della nuova meccanica, coprendo esplicitamente questi casi limite:
   - sequenza già arrivata all'Asso alto (una sola destinazione legale)
   - nessuna destinazione legale in cima né in fondo -> l'operazione va RIFIUTATA
     (serve un codice di rifiuto stabile, dimmi quale proponi)
   - gruppo: la matta resta dentro e il gruppo cresce di una carta
   - il gioco resta SPORCO in ogni caso
   - la crescita da 6 a 7 carte fa scattare un burraco: verifica che l'effetto
     "burraco_made" venga emesso
3. Impatto sul contratto: se il client deve poter SCEGLIERE fra cima e fondo, il
   messaggio WebSocket cambia. Dimmi se serve e come, ricordando che la copia in
   FE_Burraco/src/lib/contract.ts va aggiornata nello stesso commit.
4. Elenco dei test esistenti che verificano la vecchia semantica e che quindi vanno
   RISCRITTI (non adattati), con il nome del file.
5. Definition of Done della Fase 0.

Poi FERMATI e presentami il piano. Non passare ad agente_develop senza la mia
approvazione esplicita.
```

**Cancello:** leggi il piano. Verifica soprattutto il punto 3 (serve davvero far scegliere
cima/fondo all'utente?) e il punto 4 (quali test cambiano).

---
---

## PROMPT 2 — FASE 0: implementazione

```
Approvo il piano della Fase 0. Procedi con l'implementazione.

Flusso: agente_develop implementa, poi agente_test verifica.
Salta agente_ui_ux in questa fase, a meno che il piano non abbia identificato un
cambiamento visibile nell'interfaccia: in quel caso dimmelo prima.

VINCOLI CHE DEVI FAR RISPETTARE AL DEVELOP
- I test che il piano NON ha dichiarato come "da riscrivere" devono restare verdi.
  Se uno diventa rosso, fermati e segnalamelo: non adattarlo per farlo passare.
- Se tocchi contract/types.ts, aggiorna FE_Burraco/src/lib/contract.ts nello stesso
  commit e dichiaralo esplicitamente nel riepilogo.
- Un cambiamento per commit.

Al termine riportami: cosa è cambiato con i file toccati, l'esito della suite
(verdi/rossi/riscritti e perché), e conferma che la nuova meccanica della matta si
comporta come da skill in tutti i casi limite del piano.

Poi fermati.
```

**Cancello:** la regola della matta è corretta e la suite è verde. Da qui in poi l'1v1 non
deve più cambiare comportamento fino alla fine del ciclo.

---
---

## PROMPT 3 — FASE 1: refactoring abilitante a comportamento invariato

```
Avvia la Fase 1 del Macro-ciclo 3: refactoring abilitante.

PRINCIPIO GUIDA
Questa fase NON deve cambiare NULLA di osservabile. L'1v1 deve comportarsi esattamente
come adesso. L'idea è modellare l'1v1 come "due squadre da un giocatore", così che il
2v2 diventi poi un'aggiunta e non una riscrittura.

La verifica è semplice e non negoziabile: la suite di test esistente deve restare verde
senza che nessun test venga modificato. Se un test si rompe, il refactoring ha cambiato
il comportamento: fermati e segnalamelo.

I QUATTRO PASSI, IN QUEST'ORDINE
Falli uno alla volta, ciascuno con il suo commit, eseguendo la suite dopo ognuno.

1a. De-duplicazione. Le cartelle .claude/agents/ e subagents/ contengono gli stessi
    file. Verificalo, dimmi quale coppia diverge (se diverge), e proponimi quale
    eliminare. NON cancellare nulla senza la mia conferma.

1b. Introduci il tipo TeamId e la funzione teamOfSeat(seat, config). In modalità
    individuale team === seat. Cambia Seat da tipo letterale 0|1 a numerico.
    Aspettati che il typecheck fallisca in molti punti: è il risultato utile del passo,
    perché ti elenca tutto ciò che assumeva due soli posti. Sistema le occorrenze SENZA
    cambiare la logica.

1c. Aggiungi Meld.ownerTeam e sposta su di esso TUTTI i controlli di proprietà di un
    gioco: condizione di chiusura, ampliamento, sostituzione della matta, limite calate
    prima del pozzetto, calcolo del punteggio, raggruppamento nella UI.
    Regola vincolante: dopo questo passo, nessun controllo di proprietà di un meld usa
    ownerSeat. In 1v1 team e seat coincidono, quindi il comportamento non cambia.

1d. Rendi il motore generico: seats da tupla fissa ad array, cumulative da tupla ad
    array, turno (seat + 1) % n al posto di 1 - seat, mazziere (dealer + 1) % n,
    distribuzione di n mani. In 1v1 (0+1)%2 equivale a 1-0: nessuna differenza.

Alla fine di ogni passo riportami: cosa hai cambiato e l'esito della suite.
Al termine dei quattro passi fermati e aspetta la mia approvazione.
```

**Cancello:** i quattro passi sono fatti, la suite è verde e non hai toccato nessun test.
Questo è il momento in cui l'architettura è pronta per il 2v2.

---
---

## PROMPT 4 — FASE 2: il piano del 2v2

```
Avvia la Fase 2 del Macro-ciclo 3: analisi e piano della modalità 2v2.

Delega ad agente_analista. Non scrivere ancora codice.

Le regole di gioco sono COMPLETE e DECISE nella skill-burraco, sezione
"MODALITA' A COPPIE": non reinterpretarle e non integrarle a memoria. Se trovi un caso
non coperto, fermati e chiedimelo.

L'analista deve produrre:

1. MODELLO DATI E MIGRAZIONE
   Migrazione Drizzle 0003, ADDITIVA, con backfill dei dati esistenti e piano di
   rollback. Aspettati almeno: match_players.team e matches.winner_team.
   Motiva ogni colonna nuova; una migrazione senza rollback non è un piano.

2. PIANO DI ROTTURA DEL CONTRATTO — è il deliverable più importante
   Tabella a due colonne: modifica in BE_Burraco/src/contract/types.ts a sinistra,
   modifica speculare in FE_Burraco/src/lib/contract.ts a destra. Campo per campo.
   Nessun compilatore verifica questo allineamento: se la tabella è incompleta, il bug
   arriva in produzione. Aspettati che cambino almeno: numeroGiocatori, modalita,
   opponentHandCount, scores, cumulative, finalScores, opponent_disconnected e
   opponent_reconnected.

3. REDAZIONE DELLO STATO A 4 POSTI
   Specifica di redactFor: da opponentHandCount a una lista di posti con seat,
   conteggio carte, squadra e stato di connessione.
   VINCOLO ASSOLUTO: la mano del COMPAGNO è privata esattamente come quella degli
   avversari. Di ogni altro giocatore si espone solo il conteggio. Nessuna eccezione
   "per aiutare la coppia".

4. PUNTEGGIO DI COPPIA
   hand_scores è una riga per seat, ma il bonus chiusura +100 e il malus pozzetto -100
   sono di COPPIA e valgono una volta sola. Proponi come registrarli senza doppi
   conteggi e senza rompere le statistiche esistenti, che oggi leggono per seat.

5. POZZETTI RISERVATI
   Un pozzetto per coppia, riservato. Specifica la struttura dati e il comportamento
   quando un giocatore svuota la mano ma la sua coppia ha già usato il proprio pozzetto.

6. LOBBY A 4 POSTI
   Sala d'attesa, assegnazione dei posti, formazione delle coppie sui posti opposti
   (0+2 contro 1+3), avvio a tavolo pieno. Oggi Room.isFull() è la costante 2.

7. ABBANDONO
   Oltre la grazia, la coppia del disconnesso perde a forfait; la partita NON viene
   annullata agli altri tre.

8. IMPATTO SU STORICO E STATISTICHE
   MatchSummary, MatchDeal e MatchDetail sono binari (you/opponent). Definisci come
   diventano di coppia e cosa succede ai dati storici già registrati.

9. PIANO DI TEST (funzionale + sicurezza) e DEFINITION OF DONE.

Ancora ogni affermazione a riferimenti file:riga. Puoi partire dall'audit già fatto in
docs/specs/analisi-2v2-readiness.md, ma VERIFICA sul codice: l'audit può essere
invecchiato dopo le Fasi 0 e 1.

Poi fermati e presentami il piano.
```

**Cancello:** leggi il piano con attenzione, soprattutto i punti 2 e 4. Sono i due dove un
errore si paga caro e tardi.

---
---

## PROMPT 5 — FASI 3-6: implementazione del 2v2

```
Approvo il piano della Fase 2. Avvia il flusso completo del 2v2:
agente_develop -> agente_ui_ux -> agente_test -> agente_security -> ritorno a te.

ORDINE DI IMPLEMENTAZIONE (non anticipare, un commit per passo)
1. Migrazione DB 0003 additiva
2. Motore: pozzetti riservati per coppia, chiusura di coppia, punteggio di squadra
3. redactFor a N posti + contratto + copia FE nello STESSO commit
4. Room: isFull() da seatsTotal(), notifica a tutti gli altri posti, snapshot a N mani,
   forfait di coppia
5. Lobby a 4 posti
6. Frontend: data-seats="4", teamOf reale passato a Melds, postazioni generalizzate

VINCOLI CHE DEVI FAR RISPETTARE
- La suite di non-regressione 1v1 deve restare verde a ogni passo. Se si rompe, fermati.
- Ogni modifica al contratto o a redact.ts aggiorna la copia FE nello stesso commit.
- Nessun controllo di proprietà di un meld usa ownerSeat.
- La mano del compagno non compare mai nel payload di nessun altro giocatore.

Per agente_ui_ux: la direzione visiva esiste già (docs/specs/direzione-visiva.md), i
mockup 2v2 sono in FE_Burraco/public/mockups/ e il CSS [data-seats="4"] è già scritto.
Non ripartire da zero. La decisione da chiudere è il portrait mobile a 4 postazioni:
docs/specs/tavolo-e-interazione-carte.md §5.2 ammette che non ci sta tutto. Voglio una
proposta motivata con i compromessi espliciti.

Per agente_security: la superficie nuova è la mano del compagno. Voglio un test anti-leak
esplicito su quel posto.

Fermati ai cancelli previsti da CLAUDE.md. Quando ricevi i bug di sicurezza, preparami il
PIANO DI REMEDIATION e aspetta la mia approvazione prima di applicarlo.
```

---
---

## Se qualcosa va storto

**Claude Code non usa i subagenti** → controlla la frontmatter YAML dei file in
`.claude\agents\`. Senza `name` e `description` non vengono registrati.

**Un agente dice che le coppie non vanno implementate** → sta leggendo la vecchia skill.
Verifica quale delle due copie è attiva (quella del repo o quella dell'account).

**La suite si rompe nella Fase 1** → non proseguire e non far adattare i test. Quel
refactoring doveva essere invariato: se un test è rosso, ha cambiato il comportamento.
Fai tornare indietro il passo e chiedi il perché prima di riprovare.

**Il piano della Fase 2 è vago sul punto 2 (contratto)** → rimandalo indietro. La tabella
campo-per-campo è l'unica difesa che hai contro il disallineamento FE/BE, e un piano
generico su quel punto produce un bug che scoprirai in produzione.
