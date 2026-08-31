# Analisi — Landing page (Macro-ciclo 2)

> **Agente:** agente_analista · **Fase:** 1 (Analisi) · **Data:** 2026-08-31
> **Stato:** in attesa di approvazione del lead prima di lanciare `agente_develop`.
> **Fonte di verità design:** `docs/specs/direzione-visiva.md` + mockup `FE_Burraco/public/mockups/01-vetrina-desktop.html` (e `02-vetrina-mobile.html`).
> **Ambito:** SOLO landing/vetrina d'accesso + carte realistiche. Nessuna logica di gioco.

---

## 0. Rettifiche rispetto alla traccia `agente_analista.md`

La traccia dell'agente era stata redatta su ipotesi generiche (mockup `unified_home_v1.jpg`).
Il repository reale racconta una storia diversa: **queste rettifiche sono la parte più
importante dell'analisi**, perché evitano che `agente_develop` costruisca contro un modello
sbagliato.

| # | Ipotesi nella traccia | Realtà nel codice | Conseguenza per develop |
|---|-----------------------|-------------------|-------------------------|
| R1 | Route separate `/auth/login`, `/auth/signup`, `/game/guest-invite`; i bottoni fanno `router.push()` | **Non esistono.** L'app è una *single-page state machine* in `FE_Burraco/src/app/page.tsx`. Da anonimo → `<AuthPanel>` (Accedi/Registrati/Ospite come *segmented control*, non tre pagine). | La landing **non naviga a route**: promuove/attiva i tre percorsi dell'`AuthPanel` (o invoca direttamente `auth.guest()`). Niente redirect verso URL inesistenti. |
| R2 | Mockup di riferimento `unified_home_v1.jpg` | **Assente nel repo.** Il riferimento reale è `public/mockups/01-vetrina-desktop.html` + `02-vetrina-mobile.html`. | Fedeltà misurata contro i mockup HTML già navigabili, non contro un JPG. |
| R3 | Colori: oro `#D4AF37`, verde `#1B5E20`, rosso `#C41E3A`, nero `#0A0A0A` | Design token consolidati: feltro caldo (`--felt-*`), **ottone spazzolato** `--brass-*` (mai oro a specchio), legno `--wood-*`, avorio `--ivory-*`, rosso carta `--card-red:#b3182b`. Vedi `direzione-visiva.md` §1.2 (anti-pattern casinò) e §2. | Usare i **token esistenti** in `globals.css`. Vietato introdurre l'oro saturo `#D4AF37`: è esplicitamente un anti-pattern. |
| R4 | "Header con nav bar HOME/CHI SIAMO/…" + "pergamena rules preview" come sezioni della landing | La nav merceologica **non è in scope** (già detto in CLAUDE.md). Il pannello regole esiste come spec separata (`pannello-regole.md`) e mockup `07-stati-mano.html`. | La landing resta la *vetrina d'accesso*: brand + tagline + CTA + prova visiva (hero). Nessuna nav bar, nessuna pergamena da reimplementare in questo ciclo. |
| R5 | "Carta realistica" da specificare/costruire ex novo in SVG | Esiste già `FE_Burraco/src/components/CardView.tsx` — la "carta firma del Circolo Notturno", avorio, indici classici, pip centrale. | **Riuso**, non riscrittura. La landing mostra carte tramite `CardView` (o l'hero SVG del mockup). La spec carta qui sotto documenta l'esistente + i requisiti di leggibilità. |
| R6 | Tre bottoni CTA di pari peso (ACCEDI / REGISTRATI / OSPITE) | Il mockup e l'`AuthPanel` esprimono una **gerarchia**: azione primaria *"Gioca come Ospite"* (ottone) + *segmented* Accedi/Registrati come scelte peer. | CTA con gerarchia, coerente col design system ("l'azione più importante del momento in ottone"). |

**Sintesi:** l'obiettivo di Macro-ciclo 2 è realizzare una **vetrina d'accesso** che oggi
manca (l'utente anonimo salta diritto al form `AuthPanel`), fedele al mockup `01/02-vetrina`,
riusando design token e `CardView` esistenti, senza introdurre route o logica di gioco.

---

## ITERAZIONE 1 — Component breakdown

### 1.1 Dove vive la landing

Stato attuale di `page.tsx` per l'utente **anonimo**:

```
auth.status === "anonymous"  →  return <AuthPanel auth={auth} />
```

Non c'è vetrina: si atterra direttamente sul form. La landing va inserita **prima**
dell'`AuthPanel`, come primo passo del ramo anonimo, con transizione locale (stato React),
senza cambiare route (SPA, coerente con R1).

**Opzione consigliata (A):** nuovo componente `<Landing>` che, per l'utente anonimo, è la
prima vista; da lì:
- *"Gioca come Ospite"* → può invocare `auth.guest()` direttamente **oppure** aprire
  `AuthPanel` con `mode="guest"` (decisione di UX/develop; consigliata l'apertura di
  `AuthPanel` su "Ospite" così il nome al tavolo resta acquisibile — vedi flowchart It.3);
- *"Accedi"* / *"Registrati"* → aprono `AuthPanel` sul `mode` corrispondente.

Ciò richiede che `AuthPanel` accetti un `initialMode?: Mode` (oggi è hardcoded a `"login"`).
Modifica piccola e retro-compatibile.

### 1.2 Component tree (reale, ancorato ai file)

```
<Page> (src/app/page.tsx, ramo auth.status === "anonymous")
  └── <Landing />                         ← NUOVO (src/components/Landing.tsx)
        ├── <BrandMark />                 crest SVG + "Burraco" + "Il circolo, online"
        ├── <Hero />
        │     ├── tagline (serif) + lead
        │     ├── <CtaRow />
        │     │     ├── primary  "Gioca come Ospite →"   → onGuest()
        │     │     └── <segmented> Accedi | Registrati  → onOpenAuth(mode)
        │     ├── <Badges />              Gratis · Nessuna installazione · Dal browser
        │     └── <Modes />               "1 contro 1" (attivo) + varianti "in arrivo"
        └── <HeroBoard />                 cornice legno + scena tavolo (SVG mockup) / CardView
```

`<Header>` merceologico, `<RulesPreview>` pergamena e `<Footer>` link ricchi **restano fuori
scope** (R4). Un footer minimale (nota/anno) è ammesso ma non richiesto.

### 1.3 Gerarchia e requisiti trasversali

- **Gerarchia visiva:** primaria = *Gioca come Ospite* (ottone); secondarie = segmented
  Accedi/Registrati; terziarie = badge/modes (prova sociale/funzionale).
- **Accessibilità:** i controlli sono `<button>` reali con label esplicite; il segmented usa
  `role="group"` + `aria-label` (come già in `AuthPanel`, che NON è un pattern a tab ARIA);
  focus-visible con outline avorio (token esistente). Contrasto AA sul feltro.
- **Performance:** l'hero è **SVG inline** (nessuna immagine pesante da rete → LCP basso, zero
  layout shift). Nessuna `<img>` da ottimizzare, salvo scelta diversa di ui_ux.
- **Mobile-first:** su < 900px la griglia hero collassa a una colonna (vedi mockup
  `02-vetrina-mobile.html`), CTA a piena larghezza, hero sopra o sotto il blocco testuale.

---

## ITERAZIONE 2 — Design specification della carta realistica

**Riferimento primario:** `FE_Burraco/src/components/CardView.tsx` (già in produzione) e
`docs/specs/direzione-visiva.md` (registro "circolo/torneo", non casinò).

### 2.1 Definizione di "realistica" in questo progetto

Non 3D/fotorealistica: **carta da mazzo reale, leggibile**, coerente col registro artigianale.
Il vincolo non negoziabile (da `direzione-visiva.md`) è **la leggibilità**: dove estetica e
leggibilità confliggono, vince la leggibilità.

### 2.2 Anatomia (come già implementata / da rispettare)

- **Faccia:** avorio matte (`--ivory-50/100`), non bianco puro. Bordo caldo, ombra morbida
  "da oggetto fisico" (`--sh-card`), angoli `--r-card` (~9px).
- **Indici agli angoli:** rank + seme in alto-sx e (ruotato 180°) in basso-dx — indici
  "da mazzo reale".
- **Pip centrale grande** per lettura immediata a distanza di tavolo.
- **Colore per seme:** cuori/quadri → `--card-red` (`#b3182b`, bordeaux, **non** rosso
  acceso); fiori/picche → inchiostro scuro (`--ink-900`). Coerente con anti-pattern §1.2.
- **Matte speciali:** distinzione *jolly* vs *pinella* dal campo reale `card.wildKind`
  (mai dedotta dal rank) — già gestita in `CardView`. La landing mostra carte **normali**;
  se compaiono matte, seguono la stessa regola.
- **Dorso carta:** bordeaux/cuoio (`--card-back-a/b`), non rosso acceso.

### 2.3 Cosa serve alla landing (non alla logica)

La landing usa le carte come **prova visiva statica** (fan di 2–5 carte nell'hero, o la scena
SVG del mockup). Requisiti:
- Nessun dato di partita: carte "decorative" ma coerenti col vero `CardView`.
- Preferire **`CardView` reale** con carte fisse (es. una scala d'esempio) così che la vetrina
  mostri esattamente ciò che il giocatore troverà al tavolo (verità, non finzione).
- In alternativa, l'hero SVG già presente nel mockup `01-vetrina-desktop.html` (scena tavolo
  incorniciata) è accettabile come illustrazione.

### 2.4 Copertura

Il sistema carta copre già le **52 carte** (13 rank × 4 semi) + jolly, in modo coerente e
proporzionato. **Nessuna nuova arte carta è richiesta** per questo ciclo (R5): la landing
riusa il componente esistente.

---

## ITERAZIONE 3 — Flowchart, responsive, piano di test

### 3.1 Flowchart (reale: stato SPA, non route)

```
┌────────────────────────────┐
│  Page (auth = anonymous)   │
│        <Landing/>          │   ← vetrina d'accesso (route: /)
└──────────────┬─────────────┘
               │
   ┌───────────┼─────────────────────────┐
   │           │                         │
[Gioca Ospite] [Accedi]            [Registrati]
   │           │                         │
   ▼           ▼                         ▼
AuthPanel(guest)  AuthPanel(login)   AuthPanel(register)
   │           │                         │
   ▼           ▼                         ▼
auth.guest()   auth.login()          auth.register()   (backend = unica autorità)
   │           │                         │
   └───────────┴───────────┬─────────────┘
                           │  success
                           ▼
              auth.status === "authenticated"
                           ▼
                 Lobby (codice tavolo → Entra)   [già esistente, Macro-ciclo 1]
```

**Dipendenze da Macro-ciclo 1 (verificate nel codice):**
- `useAuth()` con azioni `login / register / guest / logout` — `src/lib/useAuth.ts`.
- `AuthPanel` con i tre percorsi — `src/components/AuthPanel.tsx`.
- Ripristino sessione via `/auth/me` al mount (stato `initializing`).
- La landing **non** introduce chiamate di rete proprie: delega tutto a `useAuth`.

**Interfaccia richiesta a develop:** aggiungere `initialMode?: "login" | "register" | "guest"`
ad `AuthPanel`; la `<Landing>` decide se aprire il pannello (con mode) o invocare
`auth.guest()` direttamente. Il *back* dalla vetrina all'`AuthPanel` e viceversa è stato locale.

### 3.2 Breakpoint responsive (allineati ai mockup)

| Dispositivo | Larghezza | Hero grid | CTA | Note |
|-------------|-----------|-----------|-----|------|
| Mobile | < 640px | 1 colonna, hero sotto il testo | primaria full-width, segmented a piena riga | rif. `02-vetrina-mobile.html`; nessuno scroll orizzontale |
| Tablet | 640–900px | 1 colonna (collasso a 900px come nel mockup) | primaria + segmented in riga se ci stanno | tipografia intermedia |
| Desktop | > 900px | 2 colonne `minmax(0,1fr) minmax(0,1.05fr)` | riga unica: primaria + segmented | rif. `01-vetrina-desktop.html` |

> Nota: il breakpoint **strutturale reale del mockup è 900px** (`@media (max-width:900px)`),
> non 1024px. Develop segua il mockup. I 640px separano il layout "compatto mobile" dal
> "tablet".

### 3.3 Piano di test — funzionali

| ID | Descrizione | Precondizione | Passi | Esito atteso | Prio |
|----|-------------|---------------|-------|--------------|------|
| TC-LP-01 | La vetrina compare per l'utente anonimo | sessione anonima (nessun token) | 1. apri `/` | Si vede `<Landing>` (brand, tagline, CTA, hero), **non** subito il form | ALTA |
| TC-LP-02 | "Gioca come Ospite" avvia il percorso ospite | vetrina visibile | 1. click *Gioca come Ospite* | Si apre `AuthPanel` in `mode="guest"` (o parte `auth.guest()`); nessun errore 404/route | ALTA |
| TC-LP-03 | "Accedi" apre il form login | vetrina visibile | 1. click *Accedi* | `AuthPanel` con `mode="login"` attivo | ALTA |
| TC-LP-04 | "Registrati" apre il form registrazione | vetrina visibile | 1. click *Registrati* | `AuthPanel` con `mode="register"` attivo | ALTA |
| TC-LP-05 | Ritorno alla vetrina dal form | AuthPanel aperto | 1. usa il back/annulla | Torna a `<Landing>` senza perdere stato auth | MEDIA |
| TC-LP-06 | Utente già autenticato NON vede la vetrina | sessione valida ripristinata | 1. apri `/` | Va diritto a Lobby/gioco (la vetrina è solo ramo anonimo) | ALTA |
| TC-LP-07 | Carte dell'hero rese correttamente | vetrina visibile | 1. ispeziona hero | Carte leggibili (indici+pip), avorio, coerenti con `CardView` | MEDIA |
| TC-LP-08 | Responsive mobile 375px | viewport 375px | 1. apri `/` | 1 colonna, CTA full-width, **nessuno** scroll orizzontale | ALTA |
| TC-LP-09 | Responsive desktop ≥ 1200px | viewport 1280px | 1. apri `/` | Griglia 2 colonne, hero incorniciato a destra | MEDIA |
| TC-LP-10 | Tastiera: tutte le CTA raggiungibili e attivabili | vetrina visibile | 1. Tab tra i controlli, Invio/Spazio | Focus-visible evidente; ogni CTA attivabile da tastiera | ALTA |
| TC-LP-11 | `build` + `typecheck` + `lint` puliti | — | `npm run build && npm run typecheck && npm run lint` | 0 errori | ALTA |

### 3.4 Piano di test — security

| ID | Descrizione | Tipo | Passi | Esito atteso | Prio |
|----|-------------|------|-------|--------------|------|
| TS-LP-01 | Nessuna navigazione a URL costruito da input | Open redirect/XSS | ispeziona i click handler | CTA usano handler React verso stato/azioni `useAuth`, **non** `href`/`router.push` con stringhe esterne | ALTA |
| TS-LP-02 | Nessun `dangerouslySetInnerHTML` nella landing | XSS | grep del componente | Assente; testo statico/`children` | ALTA |
| TS-LP-03 | Delega auth al backend (client muto) | AuthZ | rivedi `<Landing>`/`AuthPanel` | La landing non valida credenziali né conserva password oltre lo stato del form; l'autorità è il backend | ALTA |
| TS-LP-04 | SVG hero inline senza contenuto attivo | XSS/SVG | ispeziona SVG | Nessun `<script>`/`<foreignObject>` con HTML attivo; solo forme statiche | MEDIA |
| TS-LP-05 | Nessun segreto/endpoint hardcoded nella landing | Leak config | grep chiavi/URL | Nessun token/URL sensibile; config via `contract.ts`/env esistenti | MEDIA |
| TS-LP-06 | CSP/header non regrediti | CSP | verifica header risposta / config Next | Header coerenti con l'app; nessuna origine nuova richiesta dalla landing (SVG inline) | BASSA |

> CSRF: la landing di per sé non invia form propri; login/register/guest passano da `useAuth`
> → backend, che resta l'unica autorità. La verifica CSRF sostanziale appartiene al canale
> auth del backend (fuori dallo scope di questo ciclo, di competenza `agente_security`).

---

## OUTPUT PER: agente_develop

**Obiettivo:** realizzare la **vetrina d'accesso** (route `/`, ramo anonimo) fedele a
`FE_Burraco/public/mockups/01-vetrina-desktop.html` e `02-vetrina-mobile.html`, riusando design
token e `CardView` esistenti. Nessuna route nuova, nessuna logica di gioco.

**Consegna operativa:**
1. **Nuovo componente** `FE_Burraco/src/components/Landing.tsx` (`<Landing>`): brand, tagline
   serif, lead, `CtaRow` (primaria *Gioca come Ospite* in ottone + segmented Accedi/Registrati),
   badge, modes ("1 contro 1" attivo), hero incorniciato.
2. **Inserimento in `page.tsx`:** nel ramo `auth.status === "anonymous"`, mostrare `<Landing>`
   come prima vista; da lì transizione **locale** (stato React) verso `<AuthPanel>` con il
   `mode` scelto — **niente `router.push` verso route inesistenti** (R1).
3. **Piccola estensione di `AuthPanel`:** prop `initialMode?: "login" | "register" | "guest"`
   (default `"login"`, retro-compatibile) + possibilità di tornare alla vetrina.
4. **Carte:** riusare `CardView` con carte statiche d'esempio, **oppure** l'hero SVG del mockup.
   Nessuna nuova arte carta (R5).
5. **Design token:** usare esclusivamente i token in `globals.css` (`--felt-*`, `--brass-*`,
   `--ivory-*`, `--wood-*`, `--card-red`). **Vietato** l'oro saturo `#D4AF37` (anti-pattern §1.2).
6. **Responsive:** collasso a 1 colonna a 900px (come il mockup); nessuno scroll orizzontale a
   375px.
7. **Accessibilità:** `<button>` reali, `role="group"`+`aria-label` per il segmented,
   focus-visible, contrasto AA.
8. **Qualità:** `npm run build && npm run typecheck && npm run lint` puliti prima del passaggio
   ad `agente_ui_ux`.

**Mapping CTA (corretto):**
- *Gioca come Ospite* → apre `AuthPanel(mode="guest")` (nome al tavolo) o `auth.guest()`.
- *Accedi* → `AuthPanel(mode="login")`.
- *Registrati* → `AuthPanel(mode="register")`.

**Note speciali:**
- "Carta realistica" = SVG/`CardView` avorio leggibile, non 3D. La leggibilità vince
  sull'estetica.
- La landing è pura presentazione: nessun feedback ottimistico di gioco, nessuna chiamata di
  rete propria (delega a `useAuth`).
- Ogni assunzione della vecchia traccia su route/colori/mockup è superata dalle rettifiche §0.

---

*Fine analisi. In attesa di approvazione esplicita del lead prima di lanciare `agente_develop`.*
