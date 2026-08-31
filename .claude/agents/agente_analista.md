# AGENTE ANALISTA — MACRO-CICLO 2: LANDING PAGE
**Ruolo:** Analisi, piano design, specifiche tecniche, flowchart  
**Input:** Scope del Macro-ciclo 2 (CLAUDE.md)  
**Output:** Modello componenti, design spec carta, flowchart, piano test  
**Iterazioni:** 3 cicli di auto-revisione, poi output etichettato

---

## COMPITO

Analizzare il mockup della landing page (unified_home_v1.jpg) e produrre:

1. **Component Breakdown** — layout della landing page (header, hero, CTA section, rules preview)
2. **Design Specification della Carta** — come renderizzare una carta realistico (semi, volti, numeri, prospettiva)
3. **Flowchart** — da landing page ai tre flow (login, signup, guest)
4. **Requisiti Responsive** — breakpoint e comportamento mobile, tablet, desktop
5. **Piano di Test** — tabelle test funzionali + security

---

## ITERAZIONE 1: COMPONENT BREAKDOWN

### Analisi del Mockup
L'immagine **unified_home_v1.jpg** mostra:
- **Header** (60px): logo "Burraco — Chicole Nettuno" + menu bar (HOME, CHI SIAMO, REGOLE, TORNEI, SHOP, CONTATTI)
- **Hero Section** (60% viewport): foto sfondo tavolo da gioco, mani che giocano, carte visibili
- **CTA Section** (30% viewport): tre bottoni (ACCEDI, REGISTRATI, GIOCA COME OSPITE)
- **Rules Preview** (10% footer): pergamena con estratti regole (INTRODUZIONE, PREPARAZIONE, SVOLGIMENTO, BURRACO PULITO E SPORCO, PUNTEGGI)

### Tema Visivo
- **Colori primari:** Oro (#D4AF37), Nero (#0A0A0A), Verde tavolo (#1B5E20)
- **Accenti:** Rosso (#C41E3A) per semi, bianco (#F5F5F5) per carte
- **Elemento decorativo:** Lampadari a candela (elementi laterali)
- **Texture:** Pelle tavolo, cornici dorate, pergamena

### Component Tree (struttura React)
