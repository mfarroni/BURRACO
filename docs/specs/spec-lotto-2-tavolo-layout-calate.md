# Spec Lotto 2 — Larghezza colonne calate (R3) + impilamento calate dietro la mano (R4)

> **Branch:** `claude/tavolo-layout-calate`. **Solo CSS/layout** (`globals.css`), nessun TSX di
> logica, nessun contratto, nessuna migrazione. Verifica su URL di deploy Vercel.
> **Dipendenze:** R3 e R4 toccano la STESSA regione di `globals.css` (tavolo) → **un solo lotto**,
> integrati insieme. Con il Lotto 1 non c'è conflitto (là si toccano TSX, qui CSS).
> **Vincolo trasversale:** ogni modifica deve restare compatibile con `[data-seats="4"]`
> (predisposizione 2v2) **senza implementarlo**.

---

## R3 — Colonne centrali più larghe per ospitare le calate

### Quantificazione (misurata sul codice, non a occhio)
- Carta nelle calate: `CardView small` → `.card[data-small="true"]` = **44×62px**
  (`globals.css:766+`). Le carte di una calata **NON si sovrappongono**: `.meld-cards` è
  `display:flex; flex-wrap:wrap; gap:3px` (`:1029-1033`) → una calata troppo larga **va a capo**.
- Larghezza di una calata di N carte (senza andare a capo): `47·N − 3` px.
  | N carte | Larghezza | Caso |
  |---|---|---|
  | 3 | 138px | calata minima |
  | 7 | **326px** | burraco |
  | 10 | 467px | sequenza lunga |
  | 14 | 655px | scala A-basso…A-alto (max) |
- Contenitore tavolo `.game` **cappato a `max-width: 1040px`** (`:389-390`); `.table-grid` padding
  `sp-3` + bordo. Area calate `.melds` = **`1fr 1fr`** (colonne Noi/Loro, `:941-946`), collassa a
  **una colonna a ≤640px** (`:948-950`). `.meld-group` padding `sp-3`, `.meld` padding `sp-2`.
- **Larghezza utile per UNA colonna di calate e carte/riga prima del wrap:**
  | Viewport | Larghezza colonna calate | Carte/riga | Burraco (7)? |
  |---|---|---|---|
  | 1920px | ~458px (tavolo cappato a 1040) | ≤9 | sì |
  | 1366px | ~458px (cappato) | ≤9 | sì |
  | 768px | ~308px (ancora 2 colonne) | ≤6 | **NO, va a capo** |
  | 375px | ~303px (1 colonna) | ≤6 | **NO, va a capo (per ~20px)** |

- **Numero massimo di calate per smazzata:** irrilevante alla larghezza — le calate si impilano
  **verticalmente** in `.meld-list`. Il vincolo binding è la **larghezza della singola calata più
  lunga** (burraco 7, fino a sequenza 14). Quindi R3 = far entrare senza wrap almeno il burraco a
  ogni breakpoint, e gestire le sequenze molto lunghe.

### Obiettivo e "cosa si cede in cambio"
Lo spazio va tolto da qualche parte. Proposta motivata:
1. **Desktop (≥1041px):** il collo di bottiglia è il cap `.game: 1040px` e lo split `1fr 1fr`.
   - Far occupare all'area `melds` una **banda più larga** del resto del tavolo (o alzare il cap del
     solo blocco calate), così una sequenza da 10 (467px) entra. Costo: nessuno percepibile (le
     postazioni Nord/Sud non hanno bisogno di quella larghezza).
2. **Tablet 768px:** oggi `1fr 1fr` lascia ~308px a colonna e il burraco (326px) va a capo.
   - Anticipare il collasso a **una colonna** (portare il breakpoint da 640px a ~820px) così la
     singola colonna riceve l'intera larghezza (~712px → ≤15 carte). Costo: Noi/Loro impilati
     verticalmente su tablet invece che affiancati (accettabile, più leggibile).
3. **Mobile 375px:** una colonna, ~303px, il burraco (326px) sfora di ~23px.
   - Recuperare ~30px riducendo i gutter/il padding del tavolo a 375px **e/oppure** ridurre la carta
     calata a ~40px sotto 400px (`40·7 − 3 = 277px` → entra). Se una singola calata resta più larga
     della colonna (sequenze lunghe), **preferire lo scroll orizzontale della riga** (`overflow-x`)
     al wrap: la scala resta leggibile come un'unica run. Costo: micro-scroll su calate molto lunghe.

### Whitelist
- `FE_Burraco/src/app/globals.css` — solo la regione tavolo: `.game` (`:389`), `.table-grid`
  (`:540-575`), `.melds` + relativo breakpoint (`:941-950`), `.meld-group`/`.meld`/`.meld-cards`
  (`:955-1033`), `.card[data-small]` (`:766+`). Ammesse variabili/breakpoint nuovi purché scoped.

### Blacklist
- Qualsiasi TSX (nessuna modifica al markup/logica: solo CSS).
- Le regole `[data-seats="4"]` esistenti: **non alterarle**, solo restare compatibili.
- Tutto ciò fuori dalla regione tavolo (nessuna deriva su lobby/profilo/landing).

---

## R4 — Le calate devono scorrere *dietro* il contenitore della mano

### Diagnosi (misurata)
- Scala z-index esplicita (`globals.css:136-145`): `--z-melds:5` < `--z-cards:10` <
  `--z-hand-card-active:15`.
- `.bottom-hand` (`:1811-1828`) è `position:sticky; bottom:88px`, con **`isolation:isolate`**
  (contesto di impilamento locale) e **sfondo OPACO** di base `--surface-sunken:#0b241d` (`:77`) più
  un velo dorato translucido sopra.
- **Il problema NON è la trasparenza** (lo sfondo è opaco): è l'**ordine di stacking** tra il
  contesto di `.bottom-hand` e i `.meld` (`--z-melds:5`) durante lo scroll. Le calate devono restare
  **dietro** la zona-mano quando questa, sticky, scorre sopra l'area calate.

### Cosa verificare e correggere
1. **Contesto di impilamento della zona-mano:** `.bottom-hand` deve stare stabilmente **sopra**
   `.meld`/`.melds` nell'ordine globale. Assegnare a `.bottom-hand` uno z-index esplicito coerente
   con la ladder (≥ `--z-cards`, comunque > `--z-melds`), così che, essendo `position:sticky`, resti
   sempre davanti alle calate durante lo scroll.
2. **Sfondo opaco confermato:** mantenere `--surface-sunken` come base opaca; se qualche stato lo
   rende translucido, ripristinare l'opacità (le calate non devono trasparire).
3. **Antenati che annullano l'ordinamento:** verificare che nessun antenato di `.melds`/
   `.bottom-hand` introduca `transform`, `filter`, `opacity < 1` o `will-change` che crei un
   contesto locale competitivo (il `.table-grid` usa `background` radiale, non `transform`: ok — ma
   ricontrollare a valle di R3 se si aggiungono trasformazioni).
4. **375px:** dove la mano occupa gran parte dello schermo, la zona-mano sticky deve coprire
   nettamente le calate (sfondo pieno, nessun bordo trasparente da cui trapelino le carte calate).

### Whitelist
- `FE_Burraco/src/app/globals.css` — `.bottom-hand` (`:1811-1828`), token z-index (`:136-145`) se
  serve un livello dedicato, `.melds`/`.meld` (stessa regione di R3).

### Blacklist
- TSX (solo CSS). Nessun cambio ai token colore/tema oltre allo z-index e all'eventuale opacità.

---

## Interazione R3 ↔ R4 e ordine d'integrazione
Toccano gli stessi selettori (`.melds`, `.meld`, regione tavolo). **Integrarli insieme nello stesso
branch**, applicando prima l'impilamento (R4, correzione puntuale e a rischio basso) e poi la
larghezza (R3, che sposta più spazio): dopo R3 rieseguire il controllo dell'antenato-contesto di R4
(punto 3), perché allargare le colonne può introdurre nuovi wrapper.

---

## Criteri di accettazione (verificabili su deploy)
1. **R3 desktop:** in una partita con un burraco (7) e una sequenza da 10 calate, le calate della
   colonna Noi/Loro **non vanno a capo** a 1920px e 1366px.
2. **R3 mobile/tablet:** a 768px e 375px un **burraco da 7 carte non va a capo**; una sequenza più
   lunga della colonna scorre orizzontalmente (o resta entro la colonna) senza spezzare la run in
   modo illeggibile.
3. **R4:** scrollando la pagina al tavolo, le calate passano **dietro** la zona-mano sticky; nessuna
   carta calata traspare attraverso il contenitore della mano, a 1366px e a 375px.
4. **Non-regressione:** il tavolo `[data-seats="2"]` conserva la disposizione (Nord/centro/calate/
   Sud); `[data-seats="4"]` resta valido (verifica visiva del mockup, nessuna regola 2v2 attivata).
5. Nessun errore in console; `next lint`/`typecheck` verdi (o toolchain dichiarata assente).
