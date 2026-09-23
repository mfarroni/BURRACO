# Verifica accessibilità — versione mobile (2026-09-23)

> **Ambito:** schermate toccate dalla proposta donazione/condivisione (Lotti A–D) e dalla
> cornice comune, in versione mobile. **Riferimento:** WCAG 2.1 AA + regola di progetto
> "bersaglio di tocco ≥ 44px".
> **Metodo:** Chromium (Playwright) a 375×740 e 320×640, backend locale in memoria, due ospiti
> e un registrato reali; axe-core 4 con tag `wcag2a, wcag2aa, wcag21a, wcag21aa`; misura dei
> bersagli di tocco; scroll orizzontale; ordine di tabulazione e focus visibile.

## Schermate verificate
Vetrina (con link d'invito `?tavolo=`), accesso ospite, lobby (codice precompilato), sala
d'attesa, tavolo di gioco, profilo (utente registrato), fine partita con blocco
"Ti è piaciuta la partita?".

## Esito

| Controllo | Prima | Dopo |
|---|---|---|
| Violazioni axe (WCAG 2.1 A/AA) | 1 (sala d'attesa) | **0** su tutte le schermate |
| Contrasto testo (1.4.3) | nessuna violazione | nessuna violazione |
| Scroll orizzontale a 375 e 320px (1.4.10) | assente | assente |
| Card di fine partita più alta dello schermo (1.4.10) | **tagliata, non scorreva** | l'overlay scorre; centrata quando entra |
| Bersagli di tocco < 44px | 17 (lobby, sala, tavolo, profilo, vetrina) | 0 tra i controlli visibili (vedi eccezioni) |
| Ordine di tabulazione e focus visibile (2.4.3, 2.4.7) | — | fine partita: WhatsApp → Copia link → Caffè → Non ora, contorno 2px su ognuno |

## Correzioni applicate
1. **Sala d'attesa** — `aria-label` su uno `<span>` senza ruolo (axe `aria-prohibited-attr`,
   serio): sostituito da testo reale per screen reader (`sr-only`), letto carattere per carattere.
2. **Overlay** (fine mano, fine partita, conferme) — `overflow-y: auto` e centratura con
   `margin-block: auto`: su schermi piccoli o con zoom il contenuto non viene più tagliato.
3. **Bersagli di tocco** — sotto i 600px ogni pulsante è alto almeno 44px (prima 34–42px:
   Profilo, Esci, Torna alla vetrina, Annulla partita, pulsanti della barra azioni, filtri
   periodo, Annulla e torna alla lobby). Su desktop nulla cambia.
4. **Pallini dello slider della vetrina** — il pallino resta di 11px, l'area di tocco
   trasparente sale a 35px, con spaziatura maggiore su mobile.
5. **Cornice ridotta su mobile** — fascia da 20 a 10px, angoli da 80 a 36px, spazio riservato
   (`--frame-inset`) da 24 a 12px: circa 24px di larghezza restituiti al contenuto.

## Eccezioni motivate (non sono difetti)
- Campo anti-bot del form contatti: nascosto di proposito, `aria-hidden`, fuori dal tab-order.
- Input file della foto profilo (1×1px): nascosto, si attiva dalla sua etichetta visibile.
- Pallini dello slider: misurati 11px come elemento, ma l'area di tocco reale è 35px.

## Non verificato qui
- Lettori di schermo reali (VoiceOver/TalkBack): axe e l'albero di accessibilità non
  sostituiscono una prova manuale su dispositivo.
- Pannello admin su mobile (accesso solo con database e ruolo admin).
