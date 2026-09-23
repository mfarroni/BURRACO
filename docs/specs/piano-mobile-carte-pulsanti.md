# Piano — Mobile: carte disallineate e pulsanti bloccati

> **Data:** 2026-09-23 · **Stato:** DA APPROVARE (nessun codice modificato)
> **Segnalazione del lead:** su mobile (1) il disegno dei semi non è allineato alla carta
> bianca; (2) dopo un po' i pulsanti non sono più attivi per **entrambi** i giocatori.
> **Vincoli:** P1 (suite 1v1 verde a ogni passo), P2 (se cambia `contract/types.ts`, copia FE
> nello stesso commit).

---

## Problema 1 — Semi che escono dalla carta

### Causa (verificata nel codice e negli screenshot a 375px)
- Sotto i 640px la mano passa al layout **a file** (`BottomHand.tsx:104`), che rimpicciolisce
  la carta a **44×64** (`globals.css`, `.fan[data-layout="rows"] .card`).
- `CardView` però disegna ancora la faccia **grande**: per le carte 2–10 tre colonne di semi
  da 17px con margini di 16px per lato (`CardFace.css`, `.card .pips`). Servono ~51px in uno
  spazio utile di **12px** → i semi escono a destra della carta bianca. Le figure (J/Q/K)
  usano un seme da 2.3rem in uno spazio di ~28px.
- Le carte piccole dei giochi calati e dello scarto **non** hanno il problema: con `small`
  mostrano un solo seme centrale (formato già validato).
- Il difetto compare anche su **desktop** quando la mano supera 15 carte (stesso layout a
  file, es. dopo aver raccolto il monte scarti).

### Intervento proposto
1. In layout a file, `BottomHand` disegna la carta con la **faccia compatta**: indice
   d'angolo + un solo seme grande al centro, come per giochi calati e scarto.
2. Rifinitura CSS delle figure e del jolly a 44×64, perché restino centrati.
3. Nessun cambiamento su desktop con ≤15 carte (layout ad arco invariato).

**File:** `FE_Burraco/src/components/BottomHand.tsx`, `CardView.tsx` (eventuale prop),
`CardFace.css` / `globals.css`.
**Verifica:** screenshot di tutte le carte (A, 2–10, J/Q/K, jolly, pinella, rosse e nere) a
375px, 320px e desktop con 16+ carte; carte selezionate e in trascinamento.

---

## Problema 2 — Pulsanti non più attivi per entrambi

### Riproduzione (backend locale, due ospiti su mobile)
Il giocatore di turno perde la rete (come succede con **standby del telefono, passaggio a
WhatsApp, cambio di cella**) e tocca "Pesca dal mazzo":

| Istante | Giocatore di turno | Avversario |
|---|---|---|
| dopo 3 s | tutti i pulsanti **disattivati** (mossa "in attesa di conferma") | disattivati (non è il suo turno), vede "L'avversario sta pensando…" |
| dopo 73 s | ancora **bloccato** | ancora "sta pensando…", nessun avviso |
| ~90 s | — | il server gioca il turno d'ufficio (timeout turno 90 s), poi sblocca |

Per circa un minuto e mezzo **nessuno dei due può giocare**, e nessuno dei due capisce perché.
È il sintomo segnalato.

### Cause
1. **Il client non si accorge di una connessione morta.** Su mobile il WebSocket può restare
   "aperto" per il browser anche quando non passa più nulla. Il client manda un heartbeat
   ogni 25 s ma **non si aspetta risposta** (`useGameSocket.ts:584`), quindi non se ne accorge.
2. **L'attesa di conferma non ha scadenza.** Una mossa inviata nel vuoto lascia `pending`
   attivo per sempre, e `pending` disattiva **tutti** i pulsanti (`ActionBar.tsx:32`).
3. **Nessuna ripresa al ritorno in primo piano.** Quando si riapre il telefono o si torna
   all'app, non si verifica la connessione e non si riallinea lo stato.
4. **L'avversario resta al buio.** Il server rileva il socket morto solo dopo 30–60 s (ping
   ogni 30 s); fino ad allora l'altro vede "sta pensando…". Il conto alla rovescia del turno
   esiste nello stato (`turnEndsAt`) ma è mostrato **solo** a chi è di turno.

### Intervento proposto
| # | Cosa | Dove | Contratto |
|---|---|---|---|
| 2a | **Scadenza dell'attesa di conferma** (proposta: 8 s). Se la conferma non arriva, la connessione è considerata morta: si chiude e si riapre con la riconnessione già esistente (reclaim del posto), che rimanda lo stato aggiornato. Messaggio: "Connessione persa, mi ricollego…" | FE `useGameSocket.ts` | invariato |
| 2b | **Ripresa al ritorno**: su `visibilitychange` → visibile, `online` e `pageshow`, se l'app è rimasta in background più di ~10 s si forza la riconnessione e il riallineamento | FE `useGameSocket.ts` | invariato |
| 2c | **Risposta all'heartbeat** (`heartbeat_ack` dal server): se non arriva entro ~10 s, riconnessione. Rileva la connessione morta **anche senza mosse in volo** | BE `Room.ts`/`ws`, FE | **cambia** (aggiunta) — copia FE nello stesso commit (P2) |
| 2d | **Rilevamento più rapido lato server**: ping ogni 15 s invece di 30 s (connessione morta scoperta in ≤30 s) | BE `ws/server.ts` | invariato |
| 2e | **Avversario informato**: conto alla rovescia del turno visibile a **entrambi**; quando il server segnala la disconnessione, avviso chiaro "Aldo ha perso la connessione: se non rientra, il turno verrà giocato d'ufficio" | FE `page.tsx`, `StateBanners.tsx` | invariato |

### Verifica
- Suite BE di non-regressione verde (405 test) + test nuovi per `heartbeat_ack` (se approvato).
- Scenario ripetibile con due browser mobili (Playwright): rete persa durante il turno,
  scheda in background, ritorno dopo 20 s e dopo 2 minuti, ricarica pagina.
  **Criterio:** nessuno dei due resta con i pulsanti bloccati per più di ~10 s senza un
  messaggio che spieghi cosa succede; alla ripresa lo stato è corretto.
- Prova finale su telefoni reali (iPhone Safari e Android Chrome) dopo il deploy.

---

## Decisioni richieste al lead
1. **Carte:** faccia compatta (un seme centrale, come giochi calati) **oppure** semi
   miniaturizzati su tre colonne (più fedele ma meno leggibile a 44px)? *Consiglio: compatta.*
2. **2c — `heartbeat_ack`:** accetti la piccola aggiunta al contratto WS? Senza, 2a e 2b
   coprono il caso segnalato ma non una connessione morta mentre nessuno fa mosse.
3. **2e:** mostrare il conto alla rovescia del turno anche all'avversario?
4. **Tempi:** scadenza conferma 8 s, ripresa dopo 10 s in background, ping server 15 s: ok?

## Da chiarire (aiuta a confermare la causa)
- Su quali telefoni/browser è successo? Il telefono era andato in standby o si era passati a
  un'altra app? Ricaricando la pagina si sbloccava?

## Ordine di lavoro proposto (dopo l'approvazione)
1. Problema 1 (solo FE, basso rischio) → verifica visiva.
2. Problema 2: 2a + 2b (solo FE) → 2d → 2c (contratto) → 2e.
3. `agente_test` (scenari sopra + non-regressione) → `agente_security` (il nuovo messaggio non
   espone dati; nessun impatto su reclaim del posto e SEC-04/10/11).

OUTPUT PER: lead (approvazione)
