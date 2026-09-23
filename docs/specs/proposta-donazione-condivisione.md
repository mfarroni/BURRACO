# Proposta — Donazione "Buy Me a Coffee" efficace + condivisione dell'app

> **Stato:** DECISIONI DEL LEAD RACCOLTE (2026-09-23) — vedi §8. Nessun codice modificato.
> **Ambito:** FE (`FE_Burraco`) + un piccolo endpoint BE per il contatore anonimo (§8.6).
> Nessuna modifica al contratto WS né alla CSP.
> **Richiesta del lead:** (1) rendere efficace il pulsante Buy Me a Coffee; (2) inserire una
> frase che dica chiaramente che **il progetto può continuare solo se ci sono offerte**;
> (3) uno studio sulla comunicazione perché l'esperienza sia ottima e porti l'utente a
> **condividere** l'applicazione.

---

## 1. Diagnosi dello stato attuale

Il componente `FE_Burraco/src/components/DonationButton.tsx` (Lotto 4 — R6) è corretto
tecnicamente (immagine locale, CSP intatta, accessibile), ma è **progettato per non farsi
notare**. Per questo non converte.

| # | Problema | Dove | Effetto |
|---|---|---|---|
| D1 | Il badge sta **solo in fondo** a tre pagine: piè di pagina della landing, fondo della lobby, fondo del profilo | `Landing.tsx:491`, `Lobby.tsx:369`, `ProfilePanel.tsx:441` | Lo vede solo chi scorre fino alla fine: la fascia di attenzione più bassa |
| D2 | La frase "Il circolo è gratuito. Se ti fa piacere, offrici un caffè." comunica che **non c'è bisogno** | `DonationButton.tsx:38` | L'utente deduce che il progetto sta in piedi da solo: nessun motivo per contribuire |
| D3 | Non c'è **nessun momento emotivo**: la richiesta non compare mai dopo una partita | `Overlays.tsx` → `GameEndedOverlay` | Si chiede nel momento sbagliato (navigazione) e mai in quello giusto (soddisfazione) |
| D4 | Non esiste **nessuna funzione di condivisione** dell'app; solo la copia del codice tavolo in sala d'attesa | `WaitingRoom.tsx:57` | La crescita dipende dal passaparola spontaneo |
| D5 | Nessun metadato Open Graph: un link incollato su WhatsApp non mostra immagine né titolo curati | `app/layout.tsx:4` | Anche chi condivide ottiene un'anteprima povera, che non invoglia a cliccare |
| D6 | Il nome è **incoerente**: `layout.tsx` dice "Circolo Notturno" e "1v1", il piè di pagina dice "Circolo Nettuno" | `layout.tsx:5-6`, `Landing.tsx:487` | Un marchio incerto riduce fiducia e riconoscibilità quando circola |
| D7 | Chi non può o non vuole donare **non ha un'alternativa** per aiutare | — | Il "no" alla donazione chiude la relazione invece di aprirne un'altra |

---

## 2. Studio sulla comunicazione

### 2.1 Chi è l'utente
Il giocatore di burraco online è in larga parte **adulto e maturo**, gioca con persone che
conosce (amici, familiari, circolo), usa **WhatsApp** come canale principale e diffida di
tutto ciò che sembra pubblicità, abbonamento o raccolta fondi aggressiva. Apprezza il tono
di un **circolo vero**, non quello di un'app commerciale. Il registro già stabilito in
`direzione-visiva.md` ("circolo di carte reale, non casinò") è quindi quello giusto anche per
la comunicazione: caldo, diretto, onesto, mai insistente.

### 2.2 Sei principi (con il perché)

1. **Prima dare, poi chiedere (reciprocità).** La richiesta funziona quando l'utente ha appena
   ricevuto qualcosa: una partita finita, una vittoria, una serata piacevole. Mai prima di
   aver giocato, mai durante la partita.
2. **Dire la verità sul bisogno (trasparenza).** Le persone donano quando capiscono che
   *senza di loro qualcosa si ferma* e a che cosa serve il denaro: server, database, dominio.
   È esattamente la frase richiesta dal lead (§3). Niente numeri inventati, niente obiettivi
   finti: se si mostra un costo, deve essere reale.
3. **Appartenenza, non beneficenza.** Si parla di **"il nostro circolo"**, di **"chi ci gioca"**:
   chi dona diventa uno di quelli che *tengono aperto il tavolo*. È un'identità, non un'elemosina.
4. **Due modi di aiutare, sempre insieme (scala dell'impegno).** Ogni volta che si chiede un
   caffè si offre anche un'alternativa gratuita: **invitare un amico**. Chi non dona resta
   comunque coinvolto, e la condivisione porta nuovi giocatori — alcuni dei quali doneranno.
5. **Condividere deve essere utile, non un favore.** La leva più forte non è "condividi
   l'app", è "**invita qualcuno a giocare con te**": il burraco si gioca in due o in quattro,
   quindi l'utente *ha già un motivo suo* per mandare il link. Il 2v2 (Macro-ciclo 3)
   rafforza questa leva: servono **tre** persone al tavolo.
6. **Rispetto assoluto (niente dark pattern).** Mai pop-up che bloccano, mai senso di colpa,
   mai conteggi manipolatori, mai la stessa richiesta a ogni partita. Un "Non ora" sempre
   visibile e rispettato. È la condizione perché la richiesta resti simpatica nel tempo.

### 2.3 Il percorso emotivo dell'utente (dove chiedere cosa)

```
Landing ──► Lobby ──► Sala d'attesa ──► Partita ──► Fine partita ──► Profilo
  scopre     sceglie    aspetta un        gioca       SODDISFAZIONE    riflette
                        avversario                    (picco)          (legame)
  ───────   ────────   ──────────────   ─────────   ──────────────    ─────────
  sostegno  discreto   INVITA (utile)   NIENTE      INVITA + CAFFÈ    CAFFÈ +
  spiegato                                          (con tetto)       INVITA
```

- **Partita:** zona protetta. Nessuna richiesta, mai (resta il vincolo già in R6).
- **Fine partita:** il momento di massimo valore percepito. È il punto con la resa maggiore.
- **Sala d'attesa:** l'utente *vuole* che qualcuno arrivi: l'invito qui è un servizio, non
  una richiesta.

---

## 3. La frase sul bisogno delle offerte (richiesta del lead)

Deve dire tre cose: **gratuito**, **costa tenerlo acceso**, **continua solo grazie alle offerte**.

### Versione principale (landing, profilo, fine partita)
> **Il circolo è gratuito e senza pubblicità, ma tenerlo aperto ha dei costi.
> Il progetto può continuare solo grazie alle offerte di chi ci gioca:
> anche un caffè fa la differenza.**

### Versione breve (lobby, spazi stretti, mobile)
> **Il circolo va avanti solo grazie alle vostre offerte.**

### Alternative di tono (a scelta del lead)
- *Più calda:* "Nessuno ci paga per tenere acceso questo tavolo: lo tengono acceso i giocatori.
  Se il circolo ti piace, aiutaci a farlo continuare."
- *Più concreta:* "Server, database e dominio costano ogni mese. Senza offerte il circolo
  non può continuare: se giochi volentieri, offrici un caffè."
- *Con cifra reale (solo se il lead fornisce il dato):* "Tenere aperto il circolo costa circa
  **[X] € al mese**. Il progetto continua solo se le offerte li coprono."

**Decisione del lead:** versione breve ovunque (§8). ~~Raccomandazione: versione principale + versione breve.~~ La cifra reale aumenta molto la
fiducia, ma va inserita solo con un numero vero e aggiornato (decisione del lead, §8).

---

## 4. Proposta per punto di contatto

### 4.1 Fine partita — NUOVO blocco "Ti è piaciuta la partita?" (priorità massima)
In `GameEndedOverlay` (`Overlays.tsx:323`), sotto il punteggio finale, un blocco sobrio:

```
┌──────────────────────────────────────────────────┐
│  Hai vinto la partita  ♛                         │
│  Punteggio finale …                              │
│ ──────────────────────────────────────────────── │
│  Ti è piaciuta la partita?                       │
│  Il circolo va avanti solo grazie alle vostre    │
│  offerte.                                        │
│                                                  │
│  [ Invita un amico a giocare ]   ← primario       │
│  [ ☕ Offri un caffè al circolo ] ← secondario     │
│                          Non ora                 │
└──────────────────────────────────────────────────┘
```

- **Tetto di frequenza:** il blocco compare al massimo **una volta ogni 2 partite concluse**
  e **mai più di una volta al giorno**; "Non ora" lo sospende per 14 giorni. Stato in
  `localStorage` (lettura/scrittura in `try/catch`; se non disponibile, il blocco non compare:
  meglio perdere una richiesta che insistere).
- **Mai alla prima partita** in assoluto: prima si dà valore.
- **Titolo diverso per esito:** vittoria → "Bella partita!"; sconfitta → "Ti è piaciuta la
  partita?" (mai "Peccato, ma…"). Solo a partita **conclusa normalmente**: non in
  `RoomClosedOverlay` (abbandono/interruzione = momento negativo).

### 4.2 Sala d'attesa — "Invita" come servizio
In `WaitingRoom.tsx`, accanto alla copia del codice già esistente, un pulsante
**"Invita su WhatsApp / Condividi"** con messaggio precompilato (§5). Qui non si chiede
nessun caffè: l'utente sta aspettando, l'invito lo aiuta a riempire il tavolo. In 2v2
il testo diventa "Mancano ancora N giocatori".

### 4.3 Landing — da piè di pagina a sezione vera
Nuova sezione **"Sostieni il circolo"** prima dei Contatti (non solo nel footer):
titolo, frase principale (§3), le due azioni affiancate (caffè + condividi), una riga di
trasparenza "A cosa servono le offerte: server, database, dominio. Nessuno ci guadagna."
Il badge nel footer resta come richiamo secondario.

### 4.4 Lobby — discreto
Resta la variante compatta in fondo, con la **frase breve** (§3) al posto di quella attuale.
Aggiungere un link testuale "Invita un amico" accanto al campo "Hai un codice da un amico?".

### 4.5 Profilo — legame personale
In fondo alle statistiche, frase personalizzata con dati **già presenti** nel profilo:
> "Hai giocato **N partite** al circolo. Se vuoi che continui, offrici un caffè o invita
> qualcuno a giocare con te."

Nessun nuovo dato dal BE: `N` è già nelle statistiche caricate.

### 4.6 Dopo la donazione — il "grazie" che fa condividere
Configurare (lato Buy Me a Coffee, non nel codice) il **messaggio di ringraziamento**:
> "Grazie! Grazie a te il circolo resta aperto. Se vuoi aiutarci ancora, gratis:
> manda il link a un amico che gioca a burraco → [URL del circolo]"

Chi ha appena donato è il più propenso a condividere: è il momento di chiederlo.

---

## 5. Meccanica della condivisione

1. **Web Share API** (`navigator.share`) su mobile: apre il menu nativo (WhatsApp, SMS…).
2. **Fallback desktop:** pulsante "Copia link" (clipboard, come già fatto in `WaitingRoom`)
   + link diretto `https://wa.me/?text=…` (navigazione, **nessuna modifica alla CSP**).
3. **Nessuno script di terze parti**, nessun pixel, nessun SDK social.

### Messaggi precompilati
- **Invito generico:** "Gioco a burraco online al Circolo Nettuno: è gratis e senza
  pubblicità. Facciamo una partita? [URL]"
- **Invito al tavolo:** "Ti aspetto al tavolo per una partita a burraco! Codice: **[CODICE]** —
  entra da qui: [URL]"
- **Dopo una vittoria (facoltativo, con orgoglio ma senza vanto):** "Ho appena vinto una
  partita a burraco al Circolo Nettuno. Mi sfidi? [URL]"

### Anteprima del link (D5)
Aggiungere a `app/layout.tsx` i metadati **Open Graph** (titolo, descrizione, immagine
1200×630 locale in `public/`) così che su WhatsApp il link appaia con immagine e titolo
curati. È la differenza tra un link ignorato e uno cliccato.

### Da verificare
- **Link diretto al tavolo** (`/?tavolo=CODICE` che precompila il campo codice): oggi non
  esiste. Proposto come miglioria opzionale (solo FE: lettura del parametro e
  precompilazione del campo, **l'ingresso resta manuale e validato dal server**).

---

## 6. Componenti e file (proposta tecnica)

| Cosa | File | Tipo |
|---|---|---|
| `DonationButton`: nuova prop `variant` (`completo` / `breve`) con le frasi del §3 | `components/DonationButton.tsx/.css` | modifica |
| `ShareButton` nuovo: Web Share → fallback copia + WhatsApp | `components/ShareButton.tsx/.css` | nuovo |
| `SupportPrompt` nuovo: blocco fine partita con tetto di frequenza | `components/SupportPrompt.tsx` | nuovo |
| Frequenza (localStorage protetto) | `lib/supportPrompt.ts` | nuovo |
| Inserimento a fine partita | `components/Overlays.tsx` (`GameEndedOverlay`) | modifica |
| Invito in sala d'attesa | `components/WaitingRoom.tsx` | modifica |
| Sezione "Sostieni il circolo" | `components/Landing.tsx/.css` | modifica |
| Frase breve + link invito | `components/Lobby.tsx` | modifica |
| Frase personalizzata | `components/ProfilePanel.tsx` | modifica |
| Open Graph + nome coerente (D6) | `app/layout.tsx`, `public/og-circolo.png` | modifica/nuovo |

**Invariati:** contratto FE/BE (P2 non toccato), BE, DB, CSP in `next.config.mjs`, immagini
del marchio BMC. Nessuna richiesta in partita (vincolo R6 confermato).

### Accessibilità (WCAG 2.1 AA)
- Pulsanti testuali veri (non solo immagini), bersaglio ≥ 44px, focus visibile.
- Il blocco di fine partita **non ruba il focus** al pulsante principale dell'overlay e
  non è un dialogo modale separato; "Non ora" raggiungibile da tastiera.
- Esito della copia annunciato con `aria-live="polite"` ("Link copiato").
- Contrasto dei testi ≥ 4.5:1 sui colori già definiti in `direzione-visiva.md`.

---

## 7. Come misurare (senza tracciamento invasivo)

- **Donazioni:** cruscotto Buy Me a Coffee, confronto 30 giorni prima/dopo il rilascio.
- **Condivisione:** crescita di nuovi utenti/ospiti e di tavoli privati nel pannello admin
  già esistente.
- **Facoltativo:** contatore anonimo lato BE dei clic "Invita"/"Caffè" (nessun dato
  personale). Richiede una piccola modifica BE: da decidere (§8).

---

## 8. Decisioni del lead (2026-09-23)

| # | Tema | Decisione |
|---|---|---|
| 1 | Frase | **Versione breve ovunque:** "Il circolo va avanti solo grazie alle vostre offerte." |
| 2 | Costo mensile reale | **No**, non si mostra alcuna cifra |
| 3 | Nome ufficiale | **"Circolo Nettuno"** — da unificare in `app/layout.tsx` (oggi "Circolo Notturno") |
| 4 | Tetto a fine partita | **Una volta ogni 2 partite concluse** (restano: mai alla prima partita, "Non ora" = 14 giorni; massimo **1 al giorno**, deciso il 2026-09-23) |
| 5 | Link diretto al tavolo | **Sì**, incluso nel Lotto C (motivazione sotto) |
| 6 | Contatore anonimo dei clic | **Sì** — richiede una piccola modifica BE (endpoint senza dati personali) |

### Perché il link diretto al tavolo (`?tavolo=CODICE`)
Oggi chi riceve l'invito deve: aprire il sito → entrare (login o ospite) → arrivare in lobby →
**trascrivere a mano** il codice. Ogni passaggio fa perdere persone, soprattutto su telefono.
Con il link basta un tocco: il codice è già inserito nel campo e l'utente preme solo "Entra".
È ciò che trasforma un invito in un giocatore seduto al tavolo.

- **Costo:** solo FE, piccolo (lettura del parametro e precompilazione del campo).
- **Sicurezza:** il server continua a validare l'ingresso come oggi; il codice è già nel
  messaggio d'invito, quindi non si espone nulla di nuovo. Il parametro viene tolto dalla
  barra degli indirizzi appena letto (`history.replaceState`), così non resta nella cronologia
  né passa ad altri siti.
- **Decisione:** incluso nel Lotto C, insieme all'invito dalla sala d'attesa.

### Contatore anonimo — vincoli
Endpoint BE di sola scrittura (es. `POST /metrics/click` con `{ tipo: "caffe" | "invito", punto }`),
nessun identificativo utente, nessun IP salvato, limitazione di frequenza, lettura dei totali
solo dal pannello admin. **Non** tocca il contratto WS (`contract/types.ts`): vincolo P2 non coinvolto.

## 9. Piano in lotti (dopo approvazione)

1. **Lotto A — Messaggio (rapido, alto impatto):** nuove frasi nel `DonationButton`, nome
   coerente, Open Graph.
2. **Lotto B — Fine partita:** `SupportPrompt` con tetto di frequenza + `ShareButton`.
3. **Lotto C — Condivisione ovunque:** invito in sala d'attesa, lobby, sezione landing,
   frase personalizzata nel profilo.
   Include il **link diretto al tavolo** (`?tavolo=CODICE`).
4. **Lotto D:** contatore anonimo dei clic (endpoint BE + lettura nel pannello admin).

Flusso: `agente_develop` → `agente_ui_ux` (rifinitura tono e grafica) → `agente_test`
(nessuna regressione, tetto di frequenza, fallback share, 375px) → `agente_security`
(nessun leak nel testo condiviso: **mai** carte, punteggi altrui o dati di altri giocatori
nei messaggi precompilati; nessuno script esterno).

## 10. Stato di avanzamento
- **Lotto A — completato:** frase breve nel `DonationButton`, nome "Circolo Nettuno", Open Graph
  (`app/opengraph-image.tsx`). `NEXT_PUBLIC_SITE_URL` su Vercel **in sospeso** (dominio da acquistare).
- **Lotto B — completato:** `SupportPrompt` in `GameEndedOverlay` (non dopo un forfait), tetto di
  frequenza in `lib/supportPrompt.ts` (2 partite / 1 al giorno / "Non ora" 14 giorni / mai alla
  prima), `ShareButton` (Web Share → WhatsApp + Copia link). Messaggio di ringraziamento dopo il clic.
  Limite noto: se il client si ricollega e riceve di nuovo `game_ended` per la stessa partita,
  questa conta due volte (effetto trascurabile: al più anticipa la comparsa di una partita).

OUTPUT PER: agente_develop (Lotto C)
