AGENTE ANALISTA — MACRO-CICLO 2: LANDING PAGE
Ruolo: Analisi, piano design, specifiche tecniche, flowchart  
Input: Scope del Macro-ciclo 2 (CLAUDE.md)  
Output: Modello componenti, design spec carta, flowchart, piano test  
Iterazioni: 3 cicli di auto-revisione, poi output etichettato
---
COMPITO
Analizzare il mockup della landing page (unified_home_v1.jpg) e produrre:
Component Breakdown — layout della landing page (header, hero, CTA section, rules preview)
Design Specification della Carta — come renderizzare una carta realistico (semi, volti, numeri, prospettiva)
Flowchart — da landing page ai tre flow (login, signup, guest)
Requisiti Responsive — breakpoint e comportamento mobile, tablet, desktop
Piano di Test — tabelle test funzionali + security
---
ITERAZIONE 1: COMPONENT BREAKDOWN
Analisi del Mockup
L'immagine unified_home_v1.jpg mostra:
Header (60px): logo "Burraco — Chicole Nettuno" + menu bar (HOME, CHI SIAMO, REGOLE, TORNEI, SHOP, CONTATTI)
Hero Section (60% viewport): foto sfondo tavolo da gioco, mani che giocano, carte visibili
CTA Section (30% viewport): tre bottoni (ACCEDI, REGISTRATI, GIOCA COME OSPITE)
Rules Preview (10% footer): pergamena con estratti regole (INTRODUZIONE, PREPARAZIONE, SVOLGIMENTO, BURRACO PULITO E SPORCO, PUNTEGGI)
Tema Visivo
Colori primari: Oro (#D4AF37), Nero (#0A0A0A), Verde tavolo (#1B5E20)
Accenti: Rosso (#C41E3A) per semi, bianco (#F5F5F5) per carte
Elemento decorativo: Lampadari a candela (elementi laterali)
Texture: Pelle tavolo, cornici dorate, pergamena
Component Tree (struttura React)
```
<LandingPage>
  ├── <Header />
  │   ├── Logo (Burraco — Chicole Nettuno)
  │   └── NavBar (HOME, CHI SIAMO, REGOLE, TORNEI, SHOP, CONTATTI) *
  ├── <HeroSection />
  │   ├── BackgroundImage (tavolo da gioco)
  │   └── OverlayText (eventuale, minimalista)
  ├── <CTASection />
  │   ├── <Button>ACCEDI</Button>
  │   ├── <Button>REGISTRATI</Button>
  │   └── <Button>GIOCA COME OSPITE</Button>
  ├── <RulesPreview />
  │   └── PergamenaImage (static, da mockup)
  └── <Footer />
      └── Copyright, links minimi
```
*NavBar non implementare in questo ciclo (solo reference visivo)
Considerazioni Design
Hierarchy: CTA section deve essere prominente (contrasto, dimensioni)
Accessibility: bottoni devono avere aria-labels chiare, colore + forma riconoscibile
Performance: immagine hero deve essere ottimizzata (lazy load, responsive srcset)
Mobile-first: su mobile, stack verticale, ridimensione immagini
Breakpoint Responsive (preview)
Dispositivo	Width	Hero Height	CTA Layout	Bottoni
Mobile	< 640px	50vh	Stack verticale	Full-width
Tablet	640-1024px	55vh	Fila, gap 1.5rem	70% width
Desktop	> 1024px	65vh	Fila, gap 2.5rem	Dimensione standard
---
ITERAZIONE 2: DESIGN SPECIFICATION DELLA CARTA REALISTICO
Che cosa significa "carta realistico"?
Non fotorealistico (3D rendering), ma dettagli chiari e riconoscibili
Volti delle figure (Re, Regina, Jack, Asso) stilizzati ma proporzionati
Semi (cuori, quadri, fiori, picche) nitidi e leggibili
Numeri (1-10) e simboli chiari
Prospettiva: vista frontale, leggermente inclinata
Gradazione e ombra: suggerire volume senza 3D
Formato della Carta
Dimensione standard: 2.5" × 3.5" (63mm × 89mm)
Aspect ratio: ~0.71
Rendering: SVG (scalabile, preciso) + CSS (ombre, transizioni)
Anatomia della Carta (SVG)
```
Carta {
  Bordo esterno: rettangolo arrotondato (r=10px)
  Colore fondo: #F5F5F5 (bianco cartaceo)
  
  Zone:
  - Top-left corner: (seme piccolo) + numero
  - Center: volto della figura (Re/Regina/Jack/Asso) O figura numerica (2-10)
  - Bottom-right corner: (seme) + numero (capovolta)
  
  Decorazione bordo: linea sottile oro (#D4AF37) ~1px
  
  Texture: pattern di sfondo lieve (non invasivo)
}
```
Varianti delle Carte
Figure (K, Q, J, A): volti stilizzati (80% centro), semi ai 4 angoli
Numerate (2-10): numero grande + semi (disposizione simmetrica)
Assi (A): particolare, volto centrale + simbolo asso ai 4 angoli
Colore per Seme
Cuori & Diamanti: Rosso (#C41E3A)
Fiori & Picche: Nero (#0A0A0A)
Dettagli Realistici
Volti figure: occhi, naso, bocca semplificati ma riconoscibili
Ombre: sotto il seme e numero per suggerire profondità
Bordo goffrato: sottile effetto oro per eleganza
Anti-aliasing: tutti i tratti lisci, nessun pixelazione
Rendering SVG
```xml
<svg viewBox="0 0 63 89" xmlns="http://www.w3.org/2000/svg">
  <!-- Fondo carta -->
  <rect width="63" height="89" fill="#F5F5F5" rx="4"/>
  <!-- Bordo oro -->
  <rect width="63" height="89" fill="none" stroke="#D4AF37" stroke-width="1" rx="4"/>
  
  <!-- Texture sottile -->
  <defs>
    <pattern id="cardTexture" patternUnits="userSpaceOnUse" width="10" height="10">
      <circle cx="5" cy="5" r="1" fill="#E0E0E0" opacity="0.3" />
    </pattern>
  </defs>
  <rect width="63" height="89" fill="url(#cardTexture)" rx="4" />

  <!-- Top-left: numero e seme -->
  <text x="4" y="10" font-size="8" font-weight="bold" fill={color}>
    {rank}
  </text>
  <text x="4" y="18" font-size="6" fill={color}>{symbol}</text>

  <!-- Centro: figura o numero grande -->
  {isFigure ? (
    <!-- Volto stilizzato: cerchio testa, occhi, naso, bocca -->
  ) : (
    <!-- Numero grande: 24px -->
  )}

  <!-- Bottom-right: numero e seme (capovolta) -->
  <g transform="rotate(180 31.5 44.5)">
    <text x="59" y="79" font-size="8" font-weight="bold" fill={color}>
      {rank}
    </text>
    <text x="59" y="87" font-size="6" fill={color}>{symbol}</text>
  </g>

  <!-- Ombra sottile (effetto 3D minimalista) -->
  <rect width="63" height="89" fill="none" stroke="rgba(0,0,0,0.1)" 
        stroke-width="0.5" rx="4"/>
</svg>
```
Variabilità Carte
52 combinazioni: 13 rank (A, 2-10, J, Q, K) × 4 suit (♥ ♦ ♣ ♠)
Colore dinamico: rosso per cuori/diamanti, nero per fiori/picche
Aspetto coerente: tutte le 52 carte seguono lo stesso sistema, proporzionate e riconoscibili
---
ITERAZIONE 3: FLOWCHART + PIANO TEST
Flowchart: Landing Page → Flow Macro-ciclo 1
```
┌─────────────────┐
│  Landing Page   │ (route: /)
└────────┬────────┘
         │
         ├─→ [ACCEDI]
         │    ↓
         │   /auth/login (già implementato, Macro-ciclo 1)
         │
         ├─→ [REGISTRATI]
         │    ↓
         │   /auth/signup (già implementato, Macro-ciclo 1)
         │
         └─→ [GIOCA COME OSPITE]
              ↓
             /game/guest-invite (già implementato, Macro-ciclo 1)
```
Dipendenze dal Macro-ciclo 1
Pagina login (`/auth/login`) operativa
Pagina signup (`/auth/signup`) operativa
Pagina guest-invite (`/game/guest-invite`) operativa
Bottoni CTA collegano via `router.push()` (Next.js)
Piano di Test
Tabella Test Funzionali (Macro-ciclo 2)
ID	Descrizione	Precondizione	Step	Expected Result	Priorità
TC-LP-001	Landing page carica senza errori	Server online	1. Vai a /	Pagina visibile, CSS caricati, immagini presenti	ALTA
TC-LP-002	Bottone ACCEDI reindirizza a /auth/login	Landing page carica	1. Clicca ACCEDI	Redirect a /auth/login completato	ALTA
TC-LP-003	Bottone REGISTRATI reindirizza a /auth/signup	Landing page carica	1. Clicca REGISTRATI	Redirect a /auth/signup completato	ALTA
TC-LP-004	Bottone GIOCA COME OSPITE reindirizza a /game/guest-invite	Landing page carica	1. Clicca GIOCA COME OSPITE	Redirect a /game/guest-invite completato	ALTA
TC-LP-005	Immagine Hero carica in < 2s	Connessione 3G simulata	1. DevTools Network → Filtra img	hero-table.jpg: 200 status, < 500KB, < 2s	MEDIA
TC-LP-006	Carte realistiche rendono correttamente	Landing page carica	1. Ispeziona SVG nel DOM	Volti proporzionati, semi chiari, numeri visibili	ALTA
TC-LP-007	Layout responsivo: mobile (375px)	Mobile viewport	1. Apri su 375px	Stack verticale, bottoni full-width, no horizontal scroll	ALTA
TC-LP-008	Layout responsivo: tablet (768px)	Tablet viewport	1. Apri su 768px	Layout 2-colonne, bottoni in fila, immagini scalate	MEDIA
TC-LP-009	Layout responsivo: desktop (1920px)	Desktop viewport	1. Apri su 1920px	Layout standard, lampadari visibili, nav bar reference	MEDIA
Tabella Test Security (Macro-ciclo 2)
ID	Descrizione	Tipo	Step	Expected Result	Priorità
TS-LP-001	XSS: script nei href bottoni	Injection	1. Ispeziona DOM bottoni	href puliti, no <script>, link validi	ALTA
TS-LP-002	CSRF: form submission	CSRF	N/A (landing page pura, no form)	N/A	BASSA
TS-LP-003	CSP Header: verifica	CSP	1. Controlla response header	Content-Security-Policy presente e corretto	MEDIA
TS-LP-004	XSS: img src validation	Injection	1. Carica immagini	src validi, no javascript: protocol	ALTA
TS-LP-005	CORS: immagini da CDN	CORS	1. Inspeziona network	Immagini caricate, no CORS error	MEDIA
---
RIEPILOGO ITERAZIONE 3
✅ Component tree definito  
✅ Carta realistico specificato (SVG, dettagli, colori)  
✅ Flowchart: landing → 3 flow Macro-ciclo 1  
✅ Breakpoint responsive definito  
✅ Piano test funzionali: 9 test case  
✅ Piano test security: 5 test case
---
OUTPUT PER: agente_develop
Consegna al Agente_develop:
Component tree completo: LandingPage > Header, HeroSection, CTASection, RulesPreview, Footer
Design spec carta realistico: SVG, volti stilizzati, semi nitidi, numeri leggibili, no 3D, 52 varianti (13 rank × 4 suit)
Colori primari: Oro (#D4AF37), Nero (#0A0A0A), Verde tavolo (#1B5E20), Rosso semi (#C41E3A), Bianco carta (#F5F5F5)
Breakpoint responsive: mobile < 640px, tablet 640-1024px, desktop > 1024px (vedi tabella breakpoint)
Route mapping: ACCEDI → /auth/login, REGISTRATI → /auth/signup, OSPITE → /game/guest-invite (router.push)
Piano test: 9 test funzionali + 5 test security (vedi tabelle)
Mockup fedele a unified_home_v1.jpg: lampadari, tavolo verde, bottoni evidenti, pergamena rules preview
Performance target: image load < 2s, LCP < 2.5s, FID < 100ms, no layout shift
Note speciali: Carte realistiche NON significa 3D/fotorealistico, ma SVG stilizzato con dettagli chiari (volti proporzionati, semi leggibili, numeri nitidi). Nessun feedback ottimistico di gioco sulla landing (è solo marketing).
Nota per develop: La landing page è pura presentazione, nessuna logica di gioco. I tre bottoni sono semplici redirect a rotte già implementate nel Macro-ciclo 1.
