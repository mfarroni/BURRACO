# Spec — Interazione carte in mano + ridisegno tavolo (predisposto 2v2)

> **Stato:** ANALISI/DESIGN consolidata dal lead (agente_analista) al termine del
> co-design develop ↔ ui_ux (3 round, convergenza raggiunta). **Nessun codice
> scritto.** Questo documento è il piano da approvare PRIMA di qualsiasi
> implementazione.
>
> **Ambito:** due workstream — **A) selezione stabile delle carte in mano**;
> **B) ridisegno del tavolo come tavolo da gioco, predisposto al 2v2 (solo
> LAYOUT, nessuna regola 2v2).**
>
> **Piattaforme target:** desktop **e** smartphone (touch non secondario).
> **Mano oltre 20 carte** = caso normale. **Selezione multipla** = requisito già
> attuale. In caso di conflitto: **la precisione del tocco vince sull'estetica.**
>
> **Vincoli architetturali invariati:** server autoritativo; motore regole
> server-only; il client NON valida regole; ordine e selezione restano stato
> LOCALE mai inviato al server; contratto BE (tipi + eventi WebSocket)
> immutato; separabilità FE/BE. `v1` = 1v1; il 2v2 qui è **solo predisposizione
> di layout**.

---

## 1. A1 — Diagnosi read-only dello stato attuale (con `file:riga`)

Diagnosi condivisa da agente_develop (round 1, verificata sui sorgenti). Tutte
le righe sotto sono state lette, non modificate.

### 1.1 Meccanismi di interazione oggi
- **Riordino** = HTML5 Drag-and-Drop nativo: `draggable` + `onDragStart /
  onDragOver / onDrop / onDragEnd` su ogni `<li>` della mano
  (`FE_Burraco/src/components/BottomHand.tsx:117-143`). Il drop chiama
  `doMoveTo(dragId, index)` (`BottomHand.tsx:136`).
- **Selezione** = `onClick` separato sul `CardView`
  (`BottomHand.tsx:149`), che invoca `toggleCard`
  (`FE_Burraco/src/app/page.tsx:54-58`). Accumula più id in
  `selectedCards[]` (`page.tsx:39`).
- **I due meccanismi NON sono unificati**: nessun Pointer/Touch event; il
  riordino è desktop-drag + tastiera, la selezione è click/tap. Superfici
  distinte sullo stesso elemento.

### 1.2 Difetto centrale del Workstream A: overflow del ventaglio
- Il contenitore `.fan` è `flex-wrap: nowrap`, `justify-content: center`,
  **senza `overflow-x`** (`FE_Burraco/src/app/globals.css`, blocco `.fan`
  ~:1490-1498). Carte a larghezza fissa (mobile ~46px, avanzamento tra carte
  ~26px; desktop ~56px).
- A ~20 carte il ventaglio misura ~540px contro ~288–318px disponibili in
  portrait → **~126–256px di spill per lato** → **~5–10 carte per lato fuori
  schermo e IRRAGGIUNGIBILI** (nessuno scroll orizzontale che le recuperi).
- L'avanzamento ~26px < 44px minimo raccomandato (WCAG 2.5.5): **target di
  tocco troppo piccoli**, causa diretta del "le carte si muovono mentre
  seleziono".

### 1.3 Altri difetti diagnosticati
- **Riordino su touch: impossibile.** La DnD HTML5 non si attiva in modo
  affidabile da tocco; l'unica alternativa esistente è la tastiera
  `Ctrl/⌘ + frecce` (`BottomHand.tsx:60-69`), assente su mobile.
- **Selezione azzerata a ogni stato server.** `page.tsx:45-48`: un `useEffect`
  su `[g.state]` fa `setSelectedCards([])` + `setSelectedMeldId(null)` a
  **ogni** messaggio, quindi anche una mossa dell'avversario cancella la
  pre-selezione in corso. (Intenzionale in origine: le carte possono lasciare
  la mano; ma la granularità è troppo grossa — vedi §2 e §9.)
- **Ordine locale: già corretto.** L'ordine personalizzato vive in
  `sessionStorage` e viene RICONCILIATO, non resettato, alle pescate
  (`FE_Burraco/src/lib/useHandOrder.ts:26-42`, `reconcile` :48-54, firma
  `serverSig` :74-91). È il pattern-modello da estendere alla selezione.
- **z-index incoerente**: slot attivo 3–4 vs carte 10, senza scala
  dichiarata (globals.css).

**Conclusione diagnosi:** il "muoversi delle carte" non nasce da un
`pointerdown→drag immediato` (ipotesi iniziale, **smentita**: è DnD nativa), ma
dalla combinazione **overflow senza scroll + target sotto-dimensionati +
selezione azzerata**. Il fix va fatto su questi tre assi.

---

## 2. A2 — Matrice dei gesti (mouse × touch × selezionare/deselezionare/riordinare)

Principio: **selezione = azione primaria e frequente → gesto più leggero
(tap/click).** **Riordino = azione deliberata e secondaria → impegno esplicito
(long-press su touch, soglia di movimento su mouse).** Nessuna casella vuota.

| Azione | MOUSE | TOUCH |
|---|---|---|
| **Selezionare** (toggle) | Click = `pointerdown→up` con spostamento **< 5px** e durata **< 400ms** → aggiunge la carta a `selectedCards[]` (accumulo). | Tap = `touchstart→end` con spostamento **< 10px** e durata **< 400ms** → toggle; tap successivi accumulano. |
| **Deselezionare** | Click di nuovo sulla carta selezionata (toggle). `Ctrl/⌘+click` = toggle mirato senza toccare le altre. | Tap di nuovo sulla carta selezionata (toggle). |
| **Selezione a intervallo** | `Shift+click`: seleziona il run contiguo dall'ancora (ultima carta toccata) alla corrente, in ordine VISIVO. | **Non su touch** (nessun modificatore affidabile; il long-press è già speso per il riordino). Compensata da accumulo di tap + **ordinamento assistito** che rende adiacenti le carte omogenee. |
| **Riordinare** | Press + spostamento **> 5px** → drag immediato (nessun long-press). Rilascio nel gap di destinazione. | **Long-press ≥ 400ms** con movimento **< 10px** durante l'attesa → entra in modalità riordino, poi trascina, rilascia per posare. |
| **Azzerare selezione ampia** | `Esc`, oppure click sul fondo della zona-mano/feltro, oppure chip "Deseleziona (N)". | Chip "**N selezionate ✕**" (una toccata), oppure tap sul fondo della zona-mano. |

### 2.1 Soglie (motivazione percettiva)
- **Drag mouse: 5px.** Standard de-facto; sotto è click. Evita riordini
  accidentali da micro-tremolii.
- **Tolleranza tap touch: 10px.** Il dito trema più del mouse; 10px assorbe il
  jitter senza confondere tap e trascinamento.
- **Long-press: 400ms.** Sotto ~300ms si attiva per sbaglio; sopra ~500ms
  sembra "lento/rotto". 400ms coincide col tetto del tap (< 400ms): confine
  netto — rilascio prima di 400ms = selezione; dito ancora giù a 400ms =
  riordino.

### 2.2 Feedback d'ingresso in modalità riordino (requisito esplicito)
Allo scadere dei 400ms, contemporaneamente:
1. **Haptic** `navigator.vibrate(15)` dove supportato (feature-detected).
2. La carta **si stacca**: scala 1.06, si raddrizza a 0°, sale ~14px, ombra di
   sollevamento, z sopra tutta la mano.
3. Nel ventaglio **si apre un varco** (~mezza carta) nella posizione d'origine.
4. Il resto della mano **si attenua** (~0.7 opacità / lieve desaturazione).
5. Compare il **filo d'oro di inserimento** sul gap più vicino, che segue il
   dito/puntatore.
6. **Annuncio screen-reader** (`aria-live`): "Modalità riordino: [carta].
   Trascina per spostare." Al rilascio: assestamento animato + `vibrate(10)` +
   annuncio della posizione finale.

Con **`prefers-reduced-motion`**: niente lift/scala/dim animati — la modalità è
comunicata da **bordo d'oro statico + varco aperto + annuncio SR**. Il percorso
da **tastiera** (`Ctrl/⌘ + ←/→`, già esistente) resta l'alternativa
non-puntatore WCAG e non viene rimosso.

### 2.3 Regole di selezione multipla
- **Nessun tetto UI** al numero di carte selezionabili (il server è l'unica
  autorità; una calata può contenere molte carte).
- **Contatore visibile necessario**: chip "**N selezionate ✕**" nell'header
  della mano (appare solo con N ≥ 1) + eco accanto alla ActionBar (lega
  "selezione → azione"). Con 20+ carte su due file l'utente perde il conto.
- **Aggiornamento server durante una selezione attiva → RICONCILIAZIONE, non
  azzeramento** (miglioramento rispetto a `page.tsx:45-48`): si conservano gli
  id selezionati ancora in mano, si scartano solo quelli usciti. Dopo una TUA
  mossa la selezione si riduce alle carte rimaste; durante il turno avversario
  la pre-selezione sopravvive. **Confermato fattibile da develop** (round 3):
  dettagli e casi limite in §7.1.

---

## 3. A3 — Layout della mano per 20+ carte

**Scelta: DUE FILE (griglia con wrap), non scroll orizzontale.**

Motivazione rispetto al requisito non negoziabile (*selezionare carte non
adiacenti senza perdere la selezione già fatta*):
- **Scroll-x — bocciato come primario:** (a) il pan orizzontale collide col
  drag di riordino orizzontale; (b) non vedi tutta la mano insieme → pianificare
  una multi-selezione sparsa è faticoso.
- **Fisheye — bocciato:** su touch il dito copre la carta ingrandita e non
  risolve la raggiungibilità delle carte fuori campo.
- **Raggruppamento automatico permanente — bocciato come layout:** confligge col
  riordino manuale libero (requisito). L'ordinamento resta un'**azione
  on-demand** (§ ordinamento assistito), non un layout imposto.
- **Due file — scelto:** dimezza il conteggio orizzontale (~10/fila), entrambe
  le file visibili insieme in portrait, tutte le carte raggiungibili, nessuna
  collisione gesto↔scroll. Il drag di riordino funziona dentro e tra le file. È
  la più forte per la **precisione del tocco** (priorità).
- Oltre le due file (mano molto grande, > ~20): la zona-mano ha **max-height con
  scroll VERTICALE** (mai orizzontale) e cresce a una terza fila. Lo scroll
  verticale non collide col drag orizzontale.
- Su desktop largo con ≤ ~15 carte il layout può ricadere in **un'unica fila ad
  arco** (l'estetica "ventaglio" sopravvive dove ha senso).

### 3.1 Dimensione minima leggibile su smartphone
- **Carta (faccia): 44 × 64 px, mai sotto.**
- Overlap tale da lasciare una **striscia esposta ≥ 30px** per carta (su schermi
  < 340px CSS si scende a 28px, mai meno) + altezza piena 64px.
- **Hit-target = intera carta 44×64**, con risoluzione per z-index (la carta in
  primo piano vince in un punto); l'ultima carta della fila è interamente
  scoperta.
- **Press-preview obbligatorio su touch:** al `touchstart` la carta bersaglio si
  solleva/evidenzia PRIMA del commit; l'utente può **far scorrere il dito per
  correggere** prima di rilasciare; il toggle avviene al rilascio, non al
  contatto. È la chiave della precisione tattile.
- Verifica geometria: 10 carte/fila = 44 + 9×30 = **314px** → entra in portrait
  ≥ 320px. A 44px l'indice ~0.72rem ≈ 11.5px resta leggibile.
- Il **riordino manuale libero resta pieno**: long-press→drag verso qualunque
  slot di qualunque fila; il filo d'oro indica il gap di destinazione.

---

## 4. B2 — Modello parametrico delle postazioni (2 / 4)

**Scelta: GRIGLIA CSS a aree nominate, commutata da `data-seats=2|4`**, locale
sempre a Sud. (Il layout polare è più difficile da rendere responsive in
portrait e complica la stabilità della zona centrale.)

### 4.1 Struttura
- **Isola centrale fissa** (area `board-center`): mazzo, monte scarti, pozzetti.
  **NON si sposta** tra 2 e 4 postazioni; sono le postazioni a disporsi attorno.
- **Postazioni**: la tua è sempre a **Sud**. `data-seats` cambia solo il
  `grid-template-areas`, non l'isola centrale.
- **Aree combinazioni per SQUADRA** (owner→team): "**I nostri giochi**" e "**I
  loro giochi**". In 1v1 coincide con l'attuale split `mine`/`theirs` di
  `Melds.tsx`; la generalizzazione (raggruppa per team invece che per seat)
  **ospita il 2v2 senza riscrittura**.

### 4.2 Leggibilità compagno vs avversario (2v2) — TRE canali ridondanti
Mai il solo colore:
1. **Posizione:** la tua squadra sull'asse **Nord-Sud** (tu a Sud, compagno a
   Nord, di fronte); avversari sull'asse **Est-Ovest**.
2. **Colore semantico di squadra:** **Noi = oro/ottone** (`--brass`), **Loro =
   acciaio/blu** (`--info`) — coppia cieco-sicura (oro vs blu, non rosso/verde),
   ≥ 3:1 sul feltro per gli elementi non-testo; testi sempre `--text-strong`.
3. **Etichetta + crest:** ogni targa-postazione mostra nome + micro-tag
   "**Noi**/**Loro**" + crest (◆ vs ●) — ridondanza per daltonici e SR.

### 4.3 Indicatore di turno "a colpo d'occhio"
- La targa della postazione attiva riceve **glow d'oro** + dot pulsante + un
  marcatore direzionale del senso di giro.
- Quando è il TUO turno, la tua targa a Sud e l'intera **zona-mano si
  accendono** del bordo oro e la mano si schiarisce: **mano + turno DOMINANO**.
- Resta il badge testuale in alto ("Tocca a te / Turno di X") come conferma
  esplicita.

---

## 5. B3 — Budget spaziale, smartphone in portrait (numeri reali)

Base prudente: **~600px** di altezza-contenuto (dopo il chrome del browser su un
device ~667px).

### 5.1 Due postazioni (1v1)
| Fascia | Altezza | Note |
|---|---|---|
| Status/turno (sticky top) | ~48px | badge turno + connessione, compatto |
| Avversario (targa + conteggio dorsi + sunto giochi) | ~90px | plate compatta |
| Isola centrale (mazzo/scarto/pozzetti) + i tuoi giochi | ~200px | giochi in banda scrollabile |
| **La tua mano** | ~160px | due file × 64 + label/padding |
| Action bar (sticky bottom) | ~64px | |
| **Totale** | **~562px** | entra in ~600px ✅ |

### 5.2 Quattro postazioni (2v2) — **onestà: in portrait piccolo NON ci sta tutto**
| Fascia | Altezza | Note |
|---|---|---|
| Status/turno | ~44px | |
| Strip compatta 3 giocatori (compagno Nord + 2 avversari) | ~72px | chip: avatar + nome + conteggio + tag squadra + glow turno |
| Isola centrale | ~150px | |
| Giochi a **schede Noi/Loro** | ~140px | una zona alla volta, scrollabile |
| **La tua mano** | ~150px | due file, mai sacrificata |
| Action bar | ~64px | |
| **Totale** | **~620px** | ok su ≥ 640px; **sopra budget su ~560px (es. iPhone SE)** |

### 5.3 Priorità dello spazio
- **MAI sacrificabile (2 e 4):** usabilità della tua mano (≥44px, due file,
  riordino, multi-selezione); indicatore del turno attivo; i target azionabili
  mazzo+scarto; la action bar; la leggibilità di indici/semi.
- **Si comprime:** dettaglio avversari (→ chip); aree giochi (→
  scrollabili/schede, carte in formato `small`); arco decorativo (→ file
  piatte).
- **Si nasconde/on-demand:** giochi non-attivi dietro schede; espansione dei
  giochi di un giocatore in un **bottom-sheet** al tap sul chip.
- **Se 4-in-portrait-piccolo non entra**, alternative dichiarate (non si finge
  che ci stia): (1) hint gentile "ruota per la vista tavolo completa";
  (2) giochi a schede/collassabili Noi/Loro; (3) avversari come chip + dettaglio
  in sheet; (4) vista compatta avversari (solo conteggi in mano). **La via
  maestra per il 2v2 su telefono è il landscape**; il portrait offre la vista
  compatta.

---

## 6. B4 — Direzione visiva (coerente con "Circolo Notturno")

- **Superficie tavolo:** feltro verde profondo con luce radiale calda al centro
  (già presente) + **vignettatura** per profondità; **cornice a doghe di legno**
  (`--wood`) attorno all'area di gioco per incorniciarla come un tavolo da
  circolo reale.
- **Profondità (scala di elevazione, legata ai z-token):** feltro incassato <
  giochi calati sollevati < zona-mano flottante < carta attiva/selezionata (lift
  massimo). L'occhio legge chi sta "sopra".
- **Resa carte:** faccia avorio, indici classici agli angoli (rank+seme), pip
  centrale grande, leggibili a 44×64. Rosso `--card-red` (AA su avorio), nero
  `--ink-900`. Matte invariate (jolly = stella viola; pinella = cornice ottone +
  gemma), già cieco-safe con icona + testo.
- **Gerarchia / attenzione:** la **mano** (in basso, elevazione e luce più
  calde) e il **turno corrente** (glow oro) DOMINANO; avversari e giochi sono di
  supporto; l'isola centrale è a metà. Regola: l'oro è prezioso — solo su turno
  attivo, azione primaria, momenti chiave.
- **Contrasto su fondo scuro/verde:** token già AA/AAA; squadre Noi-oro vs
  Loro-acciaio, ciascuna con secondo canale (crest + etichetta + posizione).

---

## 7. Impatto sul codice (per passo, con `file:riga`)

**Nessun invio al server** di ordine o selezione; **contratto BE, `useGameSocket`,
regole di gioco: invariati.**

| Passo | File / righe | Cosa cambia | Cosa NON cambia |
|---|---|---|---|
| 1. Riconciliazione selezione | `page.tsx:38-48` (effetto), `page.tsx:54-61` (toggle) | Sostituire il wipe con due filtri per-id (carte vs meld); dipendenza sulla firma-mano, non su `g.state` | toggle invariati; selezione resta stato React |
| 2. Unificazione Pointer Events | `BottomHand.tsx:100-155` (rimpiazzo handler DnD/`draggable`), `CardView.tsx:99-129` (pressione/pointer, mantenere `<button>` + `onKeyDown`) | tap=toggle, long-press 400ms→drag, soglie 5px/10px, Shift=range desktop; qui si innestano flag "riordino" e `vibrate` | riordino da tastiera `Ctrl/⌘+frecce`; regione live SR |
| 3. Layout mano due file | `BottomHand.tsx:100-104` (`.fan`→wrap), geometria arco `BottomHand.tsx:71-86` (rivista/disattivata nel layout a file), CSS `.fan`/`.fan-slot` | wrap senza scroll-x, min 44×64, fallback scroll verticale | — |
| 4. Tavolo grid a postazioni | `page.tsx:280-320` (`.tableau`), `Melds` (`page.tsx:322-328`) + CSS grid | aree `data-seats=2|4`, locale a Sud, meld per-squadra | isola centrale ferma; **nessuna regola 2v2** |
| 5. z-index ladder | solo CSS (variabili + assegnazioni) | scala esplicita (vedi §8.z) | nessun TS |
| 6. Ordinamento assistito | `useHandOrder.ts` (nuova API `sortBy('suit'\|'rank')` che fa `setOrder`+`writeOrder`), trigger in `BottomHand.tsx` | riscrive l'ordine locale, puramente visivo | ordine resta in `sessionStorage`; nulla al server |

### 7.1 Dettaglio conferma 1 — selezione riconciliata (develop, round 3)
- `Card.id` è stabile ed è già la chiave di `selectedCards` e `useHandOrder`. La
  riconciliazione è un filtro:
  `selectedCards.filter(id => handIds.has(id))`.
- L'effetto deve dipendere **dalla firma della mano**
  (`s.yourHand.map(c=>c.id).join(",")`), come `serverSig` in
  `useHandOrder.ts:75-76`, **non** da `g.state` (riferimento nuovo a ogni
  messaggio).
- `selectedMeldId` va riconciliato **separatamente** contro
  `s.tableMelds.map(m=>m.id)` (un meld può sparire/rifondersi tra mani).
- Casi limite coperti: carta scartata/calata → esce → deselezionata; carta
  pescata → nuovo id, non auto-selezionata; presa pozzetto/cambio mano → mano
  sostituita → selezione si svuota; fine mano/partita → mano vuota → selezione
  azzerata; mossa rifiutata → nessun `g.state`, selezione intatta (invariato);
  `inFlightCardId`/`pending` → nessun conflitto col flusso intenzione→ack.

### 7.2 Dettaglio conferma 2 — toggle "Riordina" + haptic (develop, round 3)
- Flag "modalità riordino" = `useState<boolean>` locale a `BottomHand`; quando
  attivo il tap **non** chiama `onToggleCard` (mutua esclusione col toggle) e
  riusa `moveTo`/`moveBy` esistenti. Affianca, non sostituisce, la tastiera.
- `navigator.vibrate()`: invocato solo dentro event handler (contesto client,
  componenti `"use client"`), **mai in render/module-scope**; feature-detect
  `typeof navigator !== "undefined" && "vibrate" in navigator`; tipi DOM
  standard; no-op silenzioso dove assente (Safari/iOS). Coerente con user
  gesture. Nessuna interferenza con l'attuale DnD.

---

## 8. Rischi e trade-off

- **Effetto legato a `[g.state]` vs firma-mano:** se non si cambia la dipendenza,
  la riconciliazione non porta beneficio. *Mitigazione:* firma stabile degli id
  come in `useHandOrder.ts:76`.
- **Ambiguità tap-vs-drag dopo l'unificazione Pointer:** rischio selezioni
  accidentali durante il riordino. *Mitigazione:* soglie 5/10px + long-press
  400ms + mutua esclusione col flag "riordino".
- **Conflitto selezione ↔ modalità riordino:** uno stesso gesto non deve sia
  selezionare sia riordinare. *Mitigazione:* con flag attivo, `onToggleCard`
  disabilitato.
- **Accessibilità nel passaggio a Pointer Events:** non perdere focus /
  `onKeyDown` (`CardView.tsx:113-128`) né il riordino `Ctrl/⌘+frecce`.
  *Mitigazione:* mantenere `<button>` e la regione live
  (`BottomHand.tsx:158-161`).
- **`sessionStorage` indisponibile (private mode):** già gestito con try/catch
  (`useHandOrder.ts:26-42`); l'ordinamento assistito deve riusare lo stesso
  wrapper.
- **`vibrate` bloccato/assente:** no-op silenzioso via feature-detect, nessun
  throw.
- **Trade-off estetico dichiarato:** su smartphone il ventaglio ad arco lascia
  spazio a due file piatte (meno "scenografiche" ma raggiungibili). Coerente col
  vincolo "tocco > estetica".
- **Trade-off 2v2 in portrait:** non entra comodo sotto ~600px; landscape è la
  via maestra. Non si maschera il limite.

### 8.z Scala z-index proposta (risolve slot 3–4 ↔ carte 10)
`--z-table: 0`, `--z-melds: 5`, `--z-cards: 10` (carte a riposo),
`--z-hand-card-active: 15` (hover/selezione/press-preview), `--z-badges: 20`,
`--z-hand-drag: 30` (carta trascinata: flotta sopra i badge, **mai clippata**),
`--z-banner: 40`, `--z-toast: 60`, `--z-overlay: 80`, `--z-celebration: 90`.
La zona-mano (`.bottom-hand`) è contesto di impilamento locale: riposo=auto,
attiva=15, filo d'inserimento=25, drag=30.

---

## 9. Piano a passi (ordine vincolante — **fix selezione PRIMA del redesign**)

1. **Riconciliazione selezione** (`page.tsx`). Precondizione: rende la selezione
   stabile tra gli stati, così passi successivi e redesign non ereditano il bug
   dell'azzeramento.
2. **Unificazione Pointer Events tap/drag** (`BottomHand.tsx`, `CardView.tsx`).
   Sostituisce HTML5 DnD + onClick con un gestore Pointer unico; qui si innesta
   `vibrate` (feature-detected). **Il toggle "Riordina" è ESCLUSO** da questo
   ciclo (decisione §11.2): riordino via long-press→drag + tastiera.
3. **Layout mano a due file** (`BottomHand.tsx` + CSS). Wrap senza scroll-x, min
   44×64, fallback scroll verticale oltre ~20.
4. **Tavolo a griglia con postazioni** (`page.tsx` `.tableau` + CSS). Aree
   `data-seats=2|4`, locale a Sud, meld per-squadra; **predispone** il 2v2 senza
   attivarlo.
5. **z-index ladder** (solo CSS).
6. ~~**Ordinamento assistito per seme/valore**~~ — **RIMANDATO** (decisione
   §11.1): fuori dallo scope di questo ciclo.

I passi 1–3 chiudono il **Workstream A**; i passi 4–5 il **Workstream B**.
(Il passo 6 e il toggle "Riordina" sono rinviati per decisione dell'utente.)

---

## 10. Criteri di accettazione

### 10.1 Workstream A — selezione stabile
- Con **20+ carte** su smartphone portrait (≥ 320px), **tutte** le carte sono
  raggiungibili e selezionabili; nessuna carta fuori schermo/irraggiungibile.
- Ogni carta ha hit-target ≥ 44×64px; l'indice resta leggibile.
- **Selezionare non sposta le carte**: tap = toggle affidabile con press-preview
  e possibilità di correggere prima del rilascio.
- **Multi-selezione persistente**: una pre-selezione sopravvive a un
  aggiornamento server che non tocca la composizione della mano (turno
  avversario, countdown, cambio scarto); si riduce alle sole carte rimaste dopo
  una propria mossa.
- **Riordino su touch funzionante**: long-press 400ms → drag → posa, con feedback
  chiaro d'ingresso (haptic/lift/varco/filo d'oro/annuncio SR).
- **Contatore** "N selezionate ✕" visibile con N ≥ 1; azzeramento in una toccata.
- Alternativa **tastiera** (`Ctrl/⌘+frecce`) e **`prefers-reduced-motion`**
  rispettate; nulla di ciò che riguarda ordine/selezione viene inviato al
  server.

### 10.2 Workstream B — tavolo predisposto 2v2 (solo layout)
- Il tavolo è una **griglia `data-seats=2|4`** con **isola centrale ferma** tra 2
  e 4 postazioni; locale sempre a Sud.
- Aree combinazioni **per squadra**; in 1v1 il comportamento visivo attuale è
  preservato (nessuna regressione).
- Passare da 2 a 4 postazioni **non richiede riscrittura** delle strutture (solo
  `grid-template-areas` + raggruppamento owner→team); **nessuna regola 2v2
  implementata**.
- Compagno vs avversario leggibili su **tre canali** (posizione + colore +
  etichetta/crest); indicatore di turno "a colpo d'occhio".
- Budget portrait rispettato per 2 postazioni; per 4 postazioni, degradazione
  dichiarata (chip + schede + hint landscape) senza sacrificare mano/turno/target
  azionabili/action bar.
- Responsive verificato su desktop / tablet / smartphone portrait e landscape.

---

## 11. Decisioni dell'utente — APPROVATE

Il co-design ha converso su tutto quanto sopra; queste erano le scelte di
prodotto rimesse al lead. **Decise da Massimo (approvazione del 2026-08-30):**

1. **Ordinamento assistito (passo 6): RIMANDATO.** Non entra in questo ciclo; i
   passi 1–5 sono sufficienti a risolvere il Workstream A. → **passo 6 fuori
   scope.**
2. **Toggle "Riordina" opzionale: ESCLUSO** in questo ciclo. Il riordino resta
   coperto da **long-press→drag** (touch/mouse) + **tastiera `Ctrl/⌘+frecce`**.
   → nel passo 2 NON si aggiunge il flag/pulsante "modalità riordino".
3. **Ambito del ciclo: A + B INSIEME.** Si implementano entrambi i workstream
   nello stesso macro-ciclo.
4. **2v2 in portrait piccolo (~560px): APPROVATA** la strategia "hint landscape +
   vista compatta".
5. **Palette squadre Noi-oro / Loro-acciaio: CONFERMATA.**

**Ambito implementativo effettivo di questo ciclo = passi 1–5 del §9, senza il
toggle "Riordina".** `navigator.vibrate()` resta (feedback del long-press, non è
il toggle escluso).

---

OUTPUT PER: agente_develop
