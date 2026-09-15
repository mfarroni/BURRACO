Avviamo il Macro-ciclo 3. Questa è la FASE 0: correzione della regola di sostituzione
della matta. Procedi nell'ordine indicato e FERMATI ai due punti di stop.

═══════════════════════════════════════════════════════════════════════
PASSO A — VERIFICA DI INGRESSO (non modificare nulla)
═══════════════════════════════════════════════════════════════════════

Prima di qualunque altra cosa, verificami che l'ambiente sia quello giusto:

1. Leggi CLAUDE.md in radice e confermami che è il Macro-ciclo 3
   (correzione matta + 2v2), non il Macro-ciclo 2 (landing page).

2. Leggi .claude/skills/skill-burraco/SKILL.md e confermami che:
   - esiste la sezione "SOSTITUZIONE DELLA MATTA";
   - esiste la sezione "MODALITA' A COPPIE";
   - lo stato di implementazione dice che le coppie sono IN IMPLEMENTAZIONE
     e NON "NON implementare senza richiesta esplicita".

3. Elenca i file in .claude/agents/ e per ciascuno dimmi se ha la frontmatter YAML
   con name, description e tools. Poi dimmi quali subagenti risultano effettivamente
   registrati e disponibili in questa sessione.
   ATTENZIONE: agente_analista deve essere un prompt di RUOLO. Se il suo contenuto
   parla di landing page, mockup o carte SVG, è il file sbagliato: fermati e dimmelo.

4. Esegui la suite di test del backend e riportami quanti test passano e quanti
   falliscono.

Se uno di questi quattro punti non torna, FERMATI e spiegami cosa manca.
Non correggere nulla di tua iniziativa.

⏸ STOP 1 — aspetta la mia conferma prima di procedere al passo B.

═══════════════════════════════════════════════════════════════════════
PASSO B — ANALISI DELLA CORREZIONE (delega ad agente_analista, nessun codice)
═══════════════════════════════════════════════════════════════════════

CONTESTO DEL BUG
La skill-burraco affermava che una matta calata, quando il giocatore fornisce la carta
naturale, "torna in mano al giocatore, che può riusarla". È SBAGLIATO. La skill è già
stata corretta. La regola giusta è:

  - la carta naturale prende il posto occupato dalla matta;
  - la matta NON torna MAI in mano: resta sul tavolo, dentro lo stesso gioco;
  - SEQUENZE: la matta si sposta in cima o in fondo alla sequenza, estendendola di una
    posizione;
  - GRUPPI: non esistono cima e fondo, la matta resta nel gruppo come carta in più
    (un tris con matta diventa un poker di 4 carte, di cui una matta);
  - il gioco risultante deve restare valido, altrimenti l'operazione è rifiutata;
  - il gioco resta SPORCO, perché la matta è ancora dentro.

Questo NON è una funzionalità nuova del 2v2: è un BUG che riguarda l'1v1 già in
produzione. Va corretto prima di costruirci sopra qualsiasi cosa.

COSA DEVE PRODURRE L'ANALISTA
Delega ad agente_analista la sola ANALISI. Non scrivere codice in questo passo.

1. DIAGNOSI READ-ONLY, con riferimenti file:riga, di tutto ciò che implementa oggi la
   vecchia semantica: il motore di gioco, il contratto, i codici di rifiuto, i test.

2. SPECIFICA DELLA NUOVA MECCANICA, che copra esplicitamente questi casi limite:
   - sequenza già arrivata all'Asso alto: una sola destinazione legale;
   - nessuna destinazione legale né in cima né in fondo: l'operazione va RIFIUTATA
     (proponimi il codice di rifiuto stabile da usare);
   - gruppo: la matta resta dentro e il gruppo cresce di una carta;
   - il gioco resta SPORCO in ogni caso;
   - la crescita da 6 a 7 carte fa scattare un BURRACO: verifica che l'effetto
     "burraco_made" venga emesso, perché con la vecchia meccanica (scambio 1:1) questa
     transizione non poteva avvenire.

3. IMPATTO SUL CONTRATTO. Se il client deve poter SCEGLIERE fra cima e fondo, il
   messaggio WebSocket cambia. Dimmi se serve davvero e come.
   Ricorda il vincolo: FE_Burraco/src/lib/contract.ts è una COPIA MANUALE di
   BE_Burraco/src/contract/types.ts e va aggiornata nello STESSO commit. Nessun
   compilatore verifica quell'allineamento.

4. ELENCO DEI TEST ESISTENTI che verificano la vecchia semantica e che quindi vanno
   RISCRITTI sulla nuova regola (non "aggiustati"), con il nome di ciascun file.
   Tutti gli altri test devono restare verdi e intoccati.

5. DEFINITION OF DONE della Fase 0, con criteri verificabili.

⏸ STOP 2 — presentami il piano e aspetta la mia approvazione esplicita.
   Non passare ad agente_develop senza il mio ok.

═══════════════════════════════════════════════════════════════════════
PASSO C — IMPLEMENTAZIONE (solo dopo la mia approvazione del passo B)
═══════════════════════════════════════════════════════════════════════

Quando ti avrò approvato il piano, procedi con:
agente_develop implementa → agente_test verifica.

Salta agente_ui_ux, a meno che il piano non abbia individuato un cambiamento visibile
nell'interfaccia (per esempio la scelta cima/fondo da parte dell'utente): in quel caso
dimmelo prima di procedere.

VINCOLI CHE DEVI FAR RISPETTARE
- I test che il piano NON ha dichiarato "da riscrivere" devono restare VERDI. Se uno
  diventa rosso, FERMATI e segnalamelo: non adattarlo per farlo passare. Un test
  modificato per compiacere il codice nuovo è una regressione nascosta.
- Se tocchi contract/types.ts o room/redact.ts, aggiorna FE_Burraco/src/lib/contract.ts
  nello stesso commit e dichiaralo esplicitamente nel riepilogo.
- Un cambiamento per commit.
- La skill-burraco è l'unica autorità sulle regole. Se trovi un caso che la skill non
  copre, fermati e chiedimelo: non improvvisare.

AL TERMINE RIPORTAMI
- cosa è cambiato, con l'elenco dei file toccati;
- l'esito della suite: quanti verdi, quanti rossi, quali riscritti e in base a quale
  punto del piano;
- la conferma che la nuova meccanica si comporta come da skill in TUTTI i casi limite
  elencati al punto 2, incluso il burraco che scatta a 7 carte;
- se il contratto è cambiato, la conferma esplicita che la copia FE è allineata.

Poi fermati: la Fase 1 la avvieremo con un prompt separato.
