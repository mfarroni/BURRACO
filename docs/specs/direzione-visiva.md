# Spec — Direzione visiva: vetrina d'accesso e tavolo da torneo

> **Stato:** DIREZIONE/DESIGN consolidata dal lead (agente_analista) al termine del
> co-design ui_ux ↔ develop (convergenza in 2 round). **Nessuna modifica all'app:**
> questo ciclo produce SOLO documentazione di design e mockup statici.
>
> **Deliverable collegati:** i mockup navigabili in `FE_Burraco/public/mockups/`
> (indice: `/mockups/index.html`). Questo documento è la fonte di verità del
> sistema di design; i mockup ne sono l'incarnazione visiva.
>
> **Registro:** circolo di carte reale / sala da torneo — **non** casinò d'azzardo.
> **Vincolo dominante:** la leggibilità della carta e la precisione del tocco non si
> negoziano; dove estetica e usabilità confliggono, vince l'usabilità.
> **2v2:** solo predisposizione di *layout* (nessuna regola 2v2).

---

## 1. Direzione artistica

**Aggettivi:** *sobrio, caldo, artigianale, saldo, analogico.*

**Cosa deve sentire il giocatore entrando:** «Mi siedo a un tavolo vero, in un
circolo dove si gioca sul serio ma senza intimidazione. La luce è calda e puntata
sulle carte, il legno e il feltro sono consumati dall'uso, tutto è al suo posto. So
dove guardare e mi sento il benvenuto.»

### 1.1 Da includere (registro circolo/torneo)
- Feltro verde **caldo** (virato oliva/muschio), non nero-verde da bisca.
- Cornice del tavolo a **doghe di legno** consumato, opaco (non lucido a specchio).
- **Luce calda radiale** unica al centro + vignettatura morbida ai bordi.
- **Ottone spazzolato discreto** (targhette, filetti, turno). Mai oro a specchio.
- Carte **avorio matte**, inchiostro classico, indici da mazzo reale.
- Micro-imperfezioni analogiche: bordo carta caldo, ombre morbide da oggetto fisico.

### 1.2 Da evitare (anti-pattern casinò/slot — fuori registro)
- Oro saturo/metallizzato, gradienti "lingotto", cromature riflettenti.
- Luci lampeggianti, glow pulsanti ad alta frequenza, neon.
- Rosso acceso d'ambiente, fiches, "jackpot", coriandoli.
- Verde tavolo troppo scuro/notturno che vira al "sala giochi".
- Animazioni che "vibrano" per attirare senza informare.

### 1.3 Correzione rispetto all'attuale «Circolo Notturno»
Il tema esistente è coerente al ~70% ma va **scaldato e desaturato**: feltro più
caldo, ottone meno giallo-oro e più bronzo/spazzolato, dorsi carta da rosso acceso
(`#7c1f2b`, che sfiora l'anti-pattern) a **bordeaux/cuoio**. Sono ritocchi di
**valore**, non di struttura: i nomi dei token restano invariati.

---

## 2. Sistema di design (design token)

I token sono un'**evoluzione dei valori** di quelli già in `globals.css`: stessi
NOMI (`--felt-*`, `--brass-*`, `--ink-*`, `--z-*`, `--dur-*`), valori più
caldi/desaturati. Il codice React consuma i token **solo per nome** → il
riscaldamento non richiede alcun rename (verificato in §5).

### 2.1 Palette

```css
:root {
  /* AMBIENTE (stanza attorno al tavolo) */
  --room-950:#0f2019; --room-900:#132a21;
  /* FELTRO (superficie tavolo) — verde caldo */
  --felt-900:#14352a; --felt-800:#1a4234; --felt-700:#205039; --felt-600:#2a5f46;
  /* LEGNO (cornice/doghe) — cuoio/noce opaco */
  --wood-900:#2a1a0d; --wood-800:#402813; --wood-700:#5c3b1e; --wood-600:#74502a;
  /* OTTONE SPAZZOLATO (accento discreto) — bronzo, non oro saturo */
  --brass-600:#a07d3e; --brass-500:#c0a052; --brass-400:#d3b76a; --brass-300:#e0c789;
  /* AVORIO (facce carta) */
  --ivory-50:#f6f1e3; --ivory-100:#efe8d6; --ivory-200:#e2dabf;
  /* INCHIOSTRO (testo su avorio) */
  --ink-900:#211b12; --ink-700:#4c4236;
  /* SEMI */
  --card-red:#b3182b; --card-black:var(--ink-900);
  /* TESTO SU FELTRO */
  --text-strong:#f4efe2; --text:#e7e1cf; --text-muted:#bcc7bb; --text-faint:#92a196;
  /* SQUADRE (cieco-safe: oro vs blu) */
  --team-us-300:#e0c789; --team-us-500:#c0a052;
  --team-them-300:#86b8d6; --team-them-500:#5f93b3;
  /* STATI SEMANTICI */
  --success-300:#82d6a6; --danger-500:#d1493c; --danger-300:#f0a79b;
  --warn-500:#d39a35; --warn-300:#eecf8b; --info-300:#a9d0e4;
  /* DORSO CARTA / MAZZO — cuoio bordeaux (non rosso-slot) */
  --card-back-a:#6b2530; --card-back-b:#4c1a22;
}
```

### 2.2 Contrasti calcolati (WCAG 2.1, luminanza relativa)

| Coppia (testo / fondo) | Contrasto | Soglia | Esito |
|---|---|---|---|
| `--text-strong` / `--felt-900` | 11.67:1 | 4.5 | AAA |
| `--text` / `--felt-900` | 10.25:1 | 4.5 | AAA |
| `--text-muted` / `--felt-900` | 7.57:1 | 4.5 | AAA |
| `--text-faint` / `--felt-900` | 4.91:1 | 4.5 | AA (solo label secondarie) |
| `--brass-300` / `--felt-900` (titoli, focus) | 8.02:1 | 4.5/3.0 | AAA |
| `--brass-500` / `--felt-900` (testo/UI) | 5.30:1 | 4.5/3.0 | AA |
| `--text-strong` / pannelli `#183d2f` | 10.55:1 | 4.5 | AAA |
| `--ink-900` / `--ivory-50` (carta nera) | 15.12:1 | 4.5 | AAA |
| `--card-red` / `--ivory-50` (carta rossa) | 6.13:1 | 4.5 | AA |
| `--ink-900` / `--brass-400` (bottone primario) | 8.65:1 | 4.5 | AAA |
| `--team-them-300` / `--felt-900` ("Loro") | 6.20:1 | 4.5/3.0 | AA |
| `--team-us-300` / `--felt-900` ("Noi") | 8.02:1 | 4.5/3.0 | AAA |
| `--success-300` / `--felt-900` | 7.73:1 | 4.5 | AAA |
| `--danger-300` / `--felt-900` | 6.81:1 | 4.5 | AA |
| `--warn-300` / `--felt-900` | 8.89:1 | 4.5 | AAA |

**Regola vincolante:** `--text-faint` (4.91:1) è ammesso **solo** per etichette non
essenziali; ogni testo informativo usa `--text-muted` o superiore.
**Daltonismo:** l'identità di squadra non è mai affidata al solo colore (3 canali,
§3.2). Oro vs blu-acciaio restano distinguibili in deutan/protan/tritan per forte
differenza di luminanza (8.0:1 vs 6.2:1) e direzione caldo/freddo. Errore, attesa,
successo distinti anche da icona + testo, non dal solo colore.

### 2.3 Tipografia (max 2 famiglie)

- **Nei mockup (offline, stack di sistema):**
  `--font-serif: "Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;`
  `--font-sans: ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;`
- **Nell'app reale (coppia Google OFL, licenza libera), con lo stack sopra come fallback:**
  **Fraunces** (display/titoli, serif old-style artigianale) + **Source Sans 3**
  (UI/corpo, sans umanista). Caricamento via `next/font/google` (`display: swap`,
  subset latin, pesi mirati) → **self-hosted a build-time**: nessuna connessione a
  Google in runtime, CSP e privacy intatte.
- **Scala (~1.25, base 16px):** `--fs-display:2rem` · `--fs-h1:1.5rem` ·
  `--fs-h2:1.25rem` · `--fs-body:1rem` · `--fs-sm:.875rem` · `--fs-xs:.75rem`;
  `--lh-tight:1.15` / `--lh-body:1.5`.
- **Uso:** serif solo display/titoli/cifre-punteggio; sans per tutto il resto.
  Punteggi/contatori sempre `font-variant-numeric: tabular-nums lining-nums`.

### 2.4 Spaziatura, raggi, ombre, profondità

```css
--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:24px;--sp-6:32px;--sp-7:48px;
--r-sm:6px;--r-md:10px;--r-lg:16px;--r-card:9px;--r-pill:999px;
--sh-card:0 2px 4px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,247,230,.22);
--sh-lift:0 10px 22px rgba(0,0,0,.46);           /* carta attiva/selezionata */
--sh-panel:0 6px 18px rgba(0,0,0,.30);
--sh-inset:inset 0 2px 8px rgba(0,0,0,.42);      /* feltro incassato */
--glow-turn:0 0 0 2px var(--brass-300),0 0 16px rgba(224,199,137,.30); /* turno, TENUE */
```

**Scala di elevazione:** feltro incassato < giochi calati < zona-mano flottante <
carta a riposo < carta attiva/selezionata < carta trascinata. Profondità da luce e
ombre, **non** da texture pesanti (panno = gradiente radiale + micro-repeat ≤1.5%).

### 2.5 Anatomia della carta (vincolo dominante)

- Proporzioni ~1:1.45. Faccia **desktop 56×80**, **mobile min 44×64 (mai sotto)**.
- Indici angolari (rank sopra, seme sotto; ripetuti ruotati in basso-destra). Indice
  mobile ~0.72rem ≈ **11.5px** (leggibile, verificato). Pip centrale grande.
- **Matte (cieco-safe):** jolly = simbolo dedicato viola bronzato + "JOLLY";
  pinella (2) = indici "2" sempre leggibili + cornice ottone + gemma. Identità da
  icona/forma, non dal solo colore.
- **Dimensione minima → vincola tutto il resto:** faccia 44×64, **striscia esposta
  ≥30px** (≥28px sotto 340px), hit-target = intera carta. 10 carte/fila = 44+9×30 =
  **314px** → entra in portrait ≥320px. Da qui discende la mano a due file.

### 2.6 Movimento (durate + intenzione)

```css
--ease-out:cubic-bezier(.22,1,.36,1); --ease-in-out:cubic-bezier(.65,0,.35,1);
--dur-fast:120ms; --dur-base:200ms; --dur-deal:300ms; --dur-slow:1000ms;
```

| Momento | Durata / easing | Cosa comunica |
|---|---|---|
| Sollevamento carta (hover/press) | 120ms ease-out | «selezionabile / la sto toccando» |
| Distribuzione (deal) | 300ms ease-out, stagger 40–60ms | «le carte arrivano dal mazzo» (ritmo reale) |
| Pescata | 300ms ease-out, arco mazzo→mano | «ho preso questa carta» |
| Calata (meld) | 300ms ease-out, mano→area squadra | «il gioco è sceso sul tavolo» |
| Cambio turno | 200ms, glow che si sposta | «ora tocca a lui/te» |
| Mossa in volo | spinner 0.8s + micro-oscillazione ~2px | «partita, attendo il server» (non congelato) |
| Mossa rifiutata | shake 200ms + toast | «il server ha detto no, sei di nuovo giocabile» |
| Celebrazione (burraco/pozzetto) | 1000ms pop, non bloccante | momento chiave misurato, niente jackpot |

**`prefers-reduced-motion`:** tutto statico — nessun lift/scala/stagger/pulse.
Feedback via bordo/outline statico, spinner→testo «In attesa…», varco d'inserimento
senza animazione, annunci `aria-live`. La distribuzione appare istantanea.

---

## 3. Modello tavolo parametrico

Un solo set di aree, commutato da `data-seats="2|4"` (griglia CSS a aree nominate,
già presente in `globals.css`):

```
[2]  north / center / melds / south
[4]  north(compagno) / west(avv) center east(avv) / melds / south(tu)
```

### 3.1 Struttura
- **Isola centrale fissa** (`board-center`: mazzo, monte scarti, pozzetti): non si
  sposta tra 2 e 4 — ancoraggio cognitivo. Locale **sempre a Sud**.
- **Aree combinazioni per squadra** ("I nostri giochi" / "I loro giochi"): in 1v1 =
  singolo per lato; in 2v2 raggruppa owner→team senza nuove strutture.

### 3.2 Identità di squadra a colpo d'occhio (3 canali ridondanti)
1. **Posizione** — la tua squadra sull'asse Nord-Sud, avversari Est-Ovest.
2. **Colore** — Noi = ottone (`--team-us-*`), Loro = acciaio/blu (`--team-them-*`),
   coppia cieco-sicura.
3. **Etichetta + crest** — nome + micro-tag "Noi/Loro" + crest (◆ Noi / ● Loro).

### 3.3 Turno corrente (info più evidente dopo la mano)
Targa attiva con `--glow-turn` (tenue, non lampeggiante) + dot lento (1.4s) +
marcatore del senso di giro; al proprio turno, targa Sud + zona-mano si accendono di
bordo ottone e la mano si schiarisce. Badge testuale di conferma sempre presente.
La griglia regge 2↔4 cambiando solo `grid-template-areas` e il raggruppamento per
team: **stessi componenti**, nessuno stile copiato, nessuna regola 2v2.

---

## 4. Budget spaziale — smartphone portrait (numeri)

Base prudente: **~600px** di altezza-contenuto (device ~667px meno chrome browser).

### 4.1 Due giocatori (1v1) — entra
| Fascia | px | % |
|---|---|---|
| Status/turno (sticky top) | 48 | 8% |
| Avversario (targa + dorsi + sunto giochi) | 90 | 15% |
| Isola centrale + i tuoi giochi (scrollabile) | 200 | 33% |
| **La tua mano** (2 file × 64 + label) | 160 | 27% |
| Action bar (sticky bottom) | 64 | 11% |
| **Totale** | **562** | **~94% ✅** |

### 4.2 Quattro giocatori (2v2) — **in portrait piccolo NON entra**
| Fascia | px | % |
|---|---|---|
| Status/turno | 44 | 7% |
| Strip compatta 3 giocatori | 72 | 12% |
| Isola centrale | 150 | 25% |
| Giochi a schede Noi/Loro | 140 | 23% |
| **La tua mano** (2 file, mai sacrificata) | 150 | 25% |
| Action bar | 64 | 11% |
| **Totale** | **620** | **>100% su 600px** |

**Verdetto onesto:** a 4 giocatori in portrait il conto non torna su device
~560–600px (mancano ~20–60px). Non lo si maschera. **Alternative dichiarate:**
(1) **landscape = via maestra** per il 2v2 su smartphone; (2) portrait = vista
compatta avversari (chip) + giochi a schede collassabili; (3) dettaglio giochi in
bottom-sheet al tap sul chip; (4) hint gentile «ruota per la vista completa».

**Mai sacrificabile (2 e 4):** usabilità della mano (≥44×64, due file, riordino,
multi-selezione), indicatore del turno, target azionabili mazzo+scarto, action bar,
leggibilità indici/semi. **Si comprime:** dettaglio avversari → chip; aree giochi →
schede/scroll. **Dietro interazione:** giochi non-attivi → schede; dettaglio
giocatore → sheet.

---

## 5. Vetrina (schermata d'accesso)

Non un login nudo, una **promessa**. Ordine dello sguardo:
1. **Brand + tagline** (serif ottone su feltro): «Burraco — il tavolo del circolo,
   dal tuo browser».
2. **Hero statico CSS/SVG** del tavolo (scorcio suggestivo, non animato/live):
   identità in 2 secondi, costo di caricamento nullo.
3. **Azione primaria = "Gioca come Ospite"** (minor attrito, bottone ottone, il più
   prominente).
4. **Secondarie:** "Accedi" / "Registrati" (segmented, peso minore).
5. **Motivo per registrarsi comunicato, non imposto:** micro-testo «Registrati per
   ritrovare le tue partite e le statistiche».
6. **Fiducia reale (nessun dato inventato):** «Gratis · Nessuna installazione · Si
   gioca dal browser». Niente numeri utenti/recensioni/statistiche.
7. **Predisposizione modalità:** tessere "1v1" (attivo) e "2v2" con etichetta
   **"In arrivo"** (stato disabilitato leggibile, non finto-cliccabile).

**Smartphone (portrait):** above-the-fold = brand + tagline + hero compatto + CTA
Ospite + segmented; scorre sotto = badge fiducia + tessere modalità.

**Stato d'errore di accesso** (il messaggio generico attuale è un difetto noto):
pannello contenuto sotto il campo, icona neutra, bordo/testo `--danger-300`
(6.81:1 AA), messaggio **specifico e non colpevolizzante** («Email o password non
corrispondono. Riprova o continua come Ospite.»), con l'uscita Ospite sempre
offerta. Mai rosso pieno d'ambiente, mai «accesso negato» secco.

---

## 6. Subordinazione all'usabilità (rinunce documentate)

| Conflitto estetica ↔ uso | Vince l'usabilità così | Rinuncia estetica |
|---|---|---|
| Ventaglio ad arco vs raggiungibilità 25 carte | Due file piatte su mobile; arco solo desktop ≤~15 | Meno scenografico su telefono |
| Sovrapposizione fitta vs precisione tocco | Striscia ≥30px, hit-target 44×64 | Mano più larga |
| Ottone ovunque vs sobrietà/leggibilità | Ottone solo su turno/azione primaria/momenti chiave | Meno «luccicante» |
| 2v2 tutto in portrait vs spazio reale | Landscape via maestra + vista compatta | Niente vista completa in portrait piccolo |
| Glow/pulse d'atmosfera vs reduced-motion / anti-slot | Pulse lenti/tenui, disattivabili, mai lampeggianti | Meno «vivo» a moto disattivato |
| Dorso carta rosso acceso vs anti-casinò | Bordeaux/cuoio desaturato | Meno «acceso» |

Regola trasversale: dove estetica e usabilità confliggono, l'usabilità vince e la
rinuncia è dichiarata (coerente con «tocco > estetica» dello spec precedente).

---

## 7. Piano di adozione (dai mockup all'app reale — **non implementato ora**)

Ordine vincolante: prima le fondamenta (token, font), poi le superfici (vetrina,
tavolo). Ogni passo deve restare `npm run build` + `tsc --noEmit` verde prima del
successivo. **Base di partenza verificata verde** (build/typecheck exit 0).

### Passo 1 — Valori dei token in `globals.css` (+ hex "compagni" + themeColor)
- **File/area:** `FE_Burraco/src/app/globals.css` `:root` → nuovi VALORI (stessi
  nomi). **Allineare anche i colori hardcoded fuori da `:root`** che non seguono i
  token: dorsi/mazzo/pozzetti (`#7c1f2b`, `#5c141d`, `#4a1017`, `#3a0d13` — ~:708–733,
  911–912), badge "tocca a te" (`#06251a`, `#2c7d51` — ~:471–477), matte jolly
  (`#7a3fb0` — ~:864–876; joker che duplica gli avori invece di usare `--ivory-*`),
  conferma distruttiva (`#a83226/#8a291f`, `#b83a2c/#9a2f24` — ~:307–312), icona
  errore (`#2a0d0a` — ~:1575), e le `rgba()` letterali di glow/scrim. Aggiornare
  `FE_Burraco/src/app/layout.tsx:10` `themeColor` = nuovo `--felt-900`.
- **Rischia:** contrasti AA/AAA (il riscaldamento può abbassare `--brass-500` su
  feltro, `--card-red` su avorio, `--text-muted/-faint`); coerenza cromatica dei
  colori non-token.
- **Verifica:** build + typecheck; **ricalcolo dei rapporti** per ogni token ≥ AA;
  ispezione visiva degli stati chiave (turno, danger, matte).

### Passo 2 — Font via `next/font`
- **File/area:** `FE_Burraco/src/app/layout.tsx` (istanzia Fraunces + Source Sans 3,
  `display:swap`, subset latin, pesi mirati, espone le `variable`); `globals.css`
  mappa `--font-serif`/`--font-sans` alle variabili next/font, **mantenendo** lo
  stack di sistema come fallback.
- **Rischia:** micro-riflussi da metriche diverse (scoreboard, indici 44×64, altezze
  `.fan`); peso bundle se Fraunces (variabile) non è ridotta a pesi mirati.
- **Verifica:** build (dimensione First Load JS + asset in `/_next/static`);
  controllo visivo carta 44×64 e cifre tabellari.

### Passo 3 — Rifiniture vetrina (hero) + AuthPanel
- **File/area:** `FE_Burraco/src/app/page.tsx` (rami lobby/hero), `AuthPanel.tsx`,
  eventuale nuovo componente `Hero` statico (SVG inline), classi `.lobby`/`.auth-*`
  in `globals.css`. Nessun impatto sul flusso auth (solo presentazione).
- **Rischia:** layout responsive della lobby; preservare focus-visible/aria/stati
  d'errore.
- **Verifica:** build + typecheck + lint; tastiera/focus e stati errore.

### Passo 4 — Token squadra/tavolo (già presenti → verifica + tuning)
- **File/area:** `globals.css` (`.table-grid`/`data-seats`, `.seat-plate[data-team]`,
  `.meld-group[data-team]`), `Melds.tsx`, `page.tsx`. **Nessun cambio strutturale:**
  la griglia a postazioni e il raggruppamento per squadra esistono già; solo
  rifinitura coerente con la palette riscaldata.
- **Rischia:** regressione visiva 1v1; leggibilità Noi-oro/Loro-acciaio dopo il
  riscaldamento; coerenza glow-turno.
- **Verifica:** build + typecheck; responsive desktop/tablet/portrait; tre canali di
  distinzione squadra ancora ≥3:1.

### Passo 5 — Mockup in `public/mockups/` (deliverable di QUESTO ciclo)
- **File/area:** creare `FE_Burraco/public/mockups/*.html` (7 mockup + index),
  statici/self-contained/offline, **non** importati da `src/`.
- **Rischia:** nulla nell'app (asset isolati); verificare solo che gli URL
  `/mockups/*.html` rispondano e passino la CSP.
- **Verifica:** build (i file in `public/` non entrano nel bundle); apertura diretta
  degli URL.

### Cosa NON cambia (in nessun passo)
Contratto BE (`GameState/Card/Meld/Move`, `contract.ts`) ed eventi WebSocket;
motore di regole (server-only, il client non valida nulla); `useGameSocket`/
`useAuth`/`useHandOrder`; separabilità FE/BE; ordine/selezione carte come stato
locale mai inviato al server.

### Rete di sicurezza (nessun test runner FE)
Il FE non ha un runner di test: la verifica per ogni passo è **build + typecheck +
lint + revisione dei contrasti + ispezione visiva** degli stati di gioco
(turno proprio/altrui, attendo conferma, rifiuto, riconnessione, timeout, fine
mano/partita, punteggio).

---

## 8. Note tecniche di fattibilità (da develop)

- **Token → app:** i componenti consumano i token solo per nome (nessun hex nei
  `.tsx`, salvo `layout.tsx:10 themeColor`) → il riscaldamento non richiede rename.
- **next/font self-hosted:** i woff2 sono serviti da `/_next/static` → `font-src
  'self'` resta valido, **CSP intatta**, nessuna connessione a Google in runtime.
- **`public/mockups/`:** Next serve `public/` staticamente senza build step;
  `/mockups/xxx.html` raggiungibile; nessun conflitto di routing con `app/`. La CSP
  (`style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, SVG inline non
  soggetto a CSP, nessuno `<script>`) è **passata by design** dai mockup
  self-contained. Nota: `X-Frame-Options: DENY` → i mockup non sono incorporabili in
  iframe, si aprono in navigazione diretta.
- **Costi di rendering:** ombre multiple, gradienti radiali e glow statici sono
  sostenibili; **non** animare in loop `box-shadow`/`filter` su superfici grandi
  (preferire transform/opacity); lo stagger di distribuzione va in CSS
  (`animation-delay`), non in JS per-frame; evitare `backdrop-filter` (costoso su
  low-end); valutare in adozione `background-attachment: fixed` sul body (possibile
  jank in scroll su mobile).

---

## 9. Decisioni rimandate a Massimo

1. **Coppia di font dell'app reale:** Fraunces (display) + Source Sans 3 (UI) è la
   raccomandazione. Confermi, o preferisci una coppia più leggera (es. Source Sans 3
   per la UI + un solo peso statico di Fraunces per i titoli)?
2. **Ampiezza dell'adozione:** questo ciclo si ferma ai mockup + doc. Il passaggio
   nell'app (passi 1–4 del §7) è un ciclo **successivo** da aprire con approvazione:
   lo vuoi tutto insieme o incrementale (prima token+font, poi vetrina, poi tavolo)?
3. **`background-attachment: fixed`:** manteniamo il parallax fisso del fondo (bello
   ma con possibile jank su mobile) o passiamo a un layer `position: fixed`
   equivalente / rinuncia al parallax?
4. **2v2 su smartphone:** confermato landscape come vista principale (portrait =
   vista compatta) — te lo ricordo perché guida i mockup 5–6.

---

OUTPUT PER: agente_analista
