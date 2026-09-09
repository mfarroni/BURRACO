# BURRACO ONLINE — MACRO-CICLO 2: LANDING PAGE
**Versione:** 2.0  
**Data:** 2026-08-31  
**Macro-ciclo:** 2 di 3  
**Status:** In attesa di approvazione del Piano  

---

## CONTESTO PROGETTO

**Piattaforma:** Burraco Online  
**Stato precedente:** Macro-ciclo 1 (autenticazione, ospiti, bottom hand) ✅ Completato e mergiato  
**Scope Macro-ciclo 2:**
1. Landing page (marketing pura)
2. Tre call-to-action: ACCEDI / REGISTRATI / GIOCA COME OSPITE
3. Design fedele al mockup fornito (vintage-lusso, tavolo da gioco, lampadari)
4. Carte realistiche (stilizzate ma con dettagli realistici: volti, semi, numeri)

**Stack:** Next.js/React (Vercel), API su Render, PostgreSQL (Neon)  
**Dipendenze:** flow auth e ospiti del Macro-ciclo 1 già operative

---

## PIANO DEL MACRO-CICLO 2
*(Da approvare prima di avviare il flusso)*

### Fase 1: Analisi (Agente_analista)
- [ ] Component breakdown: landing page layout, sezioni (header, hero, CTA, rules preview)
- [ ] Specifiche design della carta realistico
- [ ] Flowchart: landing → login/signup/guest flow (collegamento a Macro-ciclo 1)
- [ ] Requisiti responsive (mobile, tablet, desktop)
- [ ] Piano di test (responsive + UX + accessibility)
- [ ] Output → Agente_develop

### Fase 2: Sviluppo (Agente_develop)
- [ ] Setup pagina landing page (route `/` in Next.js)
- [ ] Implementazione layout fedele al mockup (CSS, tailwind o styled-components)
- [ ] Component carta realistico (SVG o canvas con dettagli: volti, semi, numeri)
- [ ] Implementazione dei tre bottoni (ACCEDI / REGISTRATI / OSPITE)
- [ ] Collegamento ai route del Macro-ciclo 1
- [ ] Ottimizzazione immagini hero (lampadari, tavolo)
- [ ] Output → Agente_ui_ux

### Fase 3: UI/UX (Agente_ui_ux)
- [ ] Design system: colori (oro, nero, verde tavolo), typography, spacing
- [ ] Mockup fedelissimo all'immagine fornita
- [ ] Design dettagliato della carta (semi realistici, volti, numerazioni)
- [ ] Accessibility review (contrasto, keyboard nav, screen reader)
- [ ] Responsive design validation (mobile-first)
- [ ] Output → Agente_test

### Fase 4: Test (Agente_test)
- [ ] Test responsive: desktop, tablet, mobile (landscape + portrait)
- [ ] Test UX: bottoni cliccabili, routing, stati hover/active
- [ ] Test accessibility: contrasto WCAG AA, navigazione keyboard
- [ ] Test performance: caricamento immagini, rendering carte
- [ ] Output → Agente_security

### Fase 5: Security (Agente_security)
- [ ] Audit: XSS, CSRF (form submission non necessaria ma validare input routing)
- [ ] Verifica: sanitizzazione href bottoni, CSP headers
- [ ] Validazione: parametri query string (se presenti)
- [ ] Output piano remediation → Agente_analista

### Fase 6: Remediation (se necessaria)
- [ ] Agente_analista riceve report
- [ ] Crea PIANO DI REMEDIATION, sottopone ad approvazione
- [ ] Se approvato: develop → test → security → analista

---

## SCOPE DETTAGLIATO

### ✅ Incluso in Macro-ciclo 2
1. **Landing page** come singola pagina (route `/`)
2. **Design visual:** fedele al mockup (vintage-lusso, lampadari, tavolo verde, cornici dorate)
3. **Tre bottoni CTA:** ACCEDI / REGISTRATI / GIOCA COME OSPITE
4. **Carte realistiche:** stilizzate ma con dettagli realistici (volti, semi, numeri)
5. **Responsive design:** mobile, tablet, desktop
6. **Sezione "Regole del Gioco"** (preview statico, stessa immagine mockup)

### ❌ Escluso
- Nuova logica backend (i bottoni collegano a endpoint/route già esistenti)
- Animazioni avanzate (parallax, scroll effects)
- Chat o notifiche sulla landing page
- SEO avanzato o meta tag dinamici
- Internazionalizzazione (solo italiano per questo ciclo)

---

## MOCKUP DI RIFERIMENTO
L'immagine fornita (unified_home_v1.jpg) mostra:
- **Header:** logo "Burraco — Chicole Nettuno" + nav bar (HOME, CHI SIAMO, REGOLE, TORNEI, SHOP, CONTATTI)
- **Hero:** foto tavolo da gioco con mani e carte
- **CTA Section:** tre bottoni (ACCEDI, REGISTRATI, GIOCA COME OSPITE)
- **Rules Preview:** pergamena con sezioni "INTRODUZIONE", "PREPARAZIONE", "SVOLGIMENTO DEL GIOCO", "BURRACO PULITO E SPORCO", "PUNTEGGI"

**Nota:** Il nav bar (CHI SIAMO, TORNEI, SHOP, CONTATTI) è di riferimento visivo ma NON deve essere implementato in questo ciclo. Focus sui tre bottoni CTA.

---

## NOTE PER GLI AGENTI
- **3 iterazioni interne** per ogni agente prima di passare il testimone
- **Output standardizzato:** ogni agente termina con `OUTPUT PER: <agente successivo>`
- **Comunicazione:** output esplicito, nessuna assunzione
- **Scope:** SOLO questa landing page per il Macro-ciclo 2
- **Carte realistiche:** non 3D/fotorealistiche, ma con dettagli chiari (volti riconoscibili, semi nitidi, numeri leggibili)
- **Verifica dipendenze:** ogni agente assume che auth, ospiti e bottom hand del Macro-ciclo 1 sono operativi

---

## CANCELLI DI APPROVAZIONE
- ✋ **BLOCCO:** Prima di lanciare Agente_develop, il piano deve essere approvato
- ✋ **BLOCCO:** Ricevuti bug di security, l'analista crea PIANO DI REMEDIATION per approvazione
- ✋ **BLOCCO:** Al termine del Macro-ciclo 2/3, presentazione dello stato finale

---

## CHECKLIST OPERATIVA (per te)

- [ ] Leggi questo file
- [ ] Leggi il piano di Agente_analista
- [ ] Approvi il piano?
- [ ] Se sì → lancia Claude Code con il prompt di Agente_analista
- [ ] Attendi output di analista (modello dati, spec design, flowchart)
- [ ] Approvi output analista?
- [ ] Se sì → lancia Agente_develop
- [ ] Continua flusso: develop → ui_ux → test → security → analista

---

## PROBLEMI O CHIARIMENTI?
Se durante il ciclo mancano specifiche, gli agenti chiederanno a te (lead) prima di procedere.

---

*Prossimi passi: Approvazione del Piano, poi attivazione Agente_analista*
