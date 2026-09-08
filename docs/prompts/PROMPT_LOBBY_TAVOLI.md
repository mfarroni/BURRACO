# FEATURE: APERTURA TAVOLI, ATTESA VISIBILE E ANTI-STALLO IN LOBBY

**Destinatario:** agente_analista (capo)
**File di destinazione nel repository:** `docs/prompts/PROMPT_LOBBY_TAVOLI.md`
**Fase:** analisi — nessuna riga di codice applicativo in questo passaggio
**Output finale:** `OUTPUT PER: agente_develop`

> Documento di brief archiviato come fonte di verità del task. Il contenuto qui
> sotto è il prompt ricevuto dall'utente (lead), riprodotto integralmente. La
> ricognizione §4 e le successive iterazioni di analisi sono tracciate a parte.

---

## 0. Regola d'oro di questo task

Questo task riguarda la lobby e il ciclo di vita di un tavolo **prima** dell'inizio della partita. Non tocca il motore di gioco, le regole del burraco, il punteggio, la fine partita, lo storico né l'autenticazione.

Se durante l'analisi emerge la necessità di modificare regole di gioco o il flusso di autenticazione, **fermati e chiedi al lead** invece di procedere.

Le tre iterazioni interne si applicano alla **qualità dell'analisi** (completezza degli stati, tenuta delle race condition, chiarezza delle specifiche), non a ridiscutere le decisioni già prese al §3.

---

## 1. Contesto di progetto

- **Piattaforma:** Burraco Online, gioco di carte multiplayer.
- **Frontend:** Next.js 15, App Router, React 19, TypeScript → Vercel, root `FE_Burraco/`
- **Backend:** Node.js/Express + WebSocket (`ws`), TypeScript → Render, root `BE_Burraco/`
- **Database:** PostgreSQL su Neon
- **Architettura non negoziabile:** server-authoritative. Tutta la logica di stato del tavolo vive esclusivamente nel backend.

**Vincoli operativi:**
- Nessuna nuova dipendenza senza approvazione esplicita del lead.
- Content-Security-Policy in enforce (`default-src 'self'`): nessun asset o libreria da CDN.
- Nessuna modifica di stile o design system oltre a quanto previsto qui.
- L'app non è eseguibile in locale: collaudo su URL di deployment di branch (Vercel).
- Perimetro di gioco: burraco italiano, 2 giocatori individuale, chiusura italiana, due canaste (pulito 200 / sporco 100). Il modello degli stati deve restare estendibile a 4 posti (§5.1).

---

## 2. Il problema da risolvere

Due sessioni ospite autenticate contemporaneamente vedono entrambe una lista tavoli vuota e non riescono a raggiungersi: stallo permanente.

Causa reale: manca lo stato intermedio "ho aperto un tavolo e sto aspettando". Oggi un tavolo esiste solo nell'istante in cui qualcuno fa `join()` con un codice.

Doppio intervento richiesto:
- **informativo** — la lista vuota deve spiegare cosa significa e cosa fare;
- **funzionale** — l'attesa deve diventare un atto visibile agli altri.

---

## 3. Decisioni già prese dall'utente — non ridiscuterle

1. **"Gioca subito"** (quick match): sì.
2. **Fusione automatica lato server:** sì, variante (A) del §5.4.
3. **Codice tavolo:** precompilato dal server, modificabile dall'utente.
4. **Tavoli privati:** sì (sostituisce la regola "tutti i tavoli sono pubblici").
5. **Contatore giocatori in lobby:** sì, visibile in lista.
6. **Grace period alla disconnessione:** 60 secondi.
7. **Auto-seduta al proprio tavolo da seconda sessione stesso browser:** permessa, con avviso non bloccante.

---

## 4. GATE DI RICOGNIZIONE — fermati e riferisci

Prima di produrre qualunque specifica, ispeziona il codice reale e riferisci al lead, con riferimento a file e riga:

- Come `RoomManager` rappresenta una stanza (struttura, persistenza, creazione/distruzione).
- Se esiste un concetto di stanza con un solo giocatore.
- Endpoint attuale di elenco tavoli (polling HTTP a 5s: rotta, payload, filtro).
- Prenotazione posto (`seat`): esistono `await` fra controllo e assegnazione?
- `POST /session/leave` (beacon): cosa ripulisce.
- Chiusura WebSocket lato server e timer di grace.
- Generazione codice stanza lato server o dal client.
- Normalizzazione `roomCode` (`.trim().toUpperCase()`, max 12).

Poi **fermati** e attendi il via libera del lead.

---

## 5. Iterazione 1 — Modello degli stati e logica anti-stallo

### 5.1 I tre stati
`in_lobby` (invisibile, polling 5s) · `waiting` (visibile se pubblico, WS aperto) · `playing` (WS).
Chi apre un tavolo entra subito in `waiting` con WS connesso. Il polling NON fa mai partire la partita. Predisporre `posti_totali`/`posti_occupati` (oggi sempre 2). Diagramma stati Mermaid con transizioni di errore/uscita.

### 5.2 Attributi tavolo `waiting`
codice, `visibilita`, identità/nome creatore, istante apertura, posti totali/occupati, origine (`quick_match` | `apertura_manuale`). Memoria vs PostgreSQL: motivare rispetto a Render free (riavvii/sleep) e definire cosa accade ai tavoli in attesa al riavvio.

### 5.3 Le tre porte d'ingresso
(a) "Apri un tavolo" — codice precompilato server, modificabile, casella privato; gestire codice già in uso.
(b) "Gioca subito" — il server cerca/crea; decisione tutta server-side.
(c) "Entra con codice" — invariato, unico accesso ai privati.
Identico per registrati e ospiti.

### 5.4 Anti-stallo
- **A (simmetria):** fusione lato server (`room_merged`), solo tavoli pubblici `quick_match`; mai privati/manuali.
- **B (fantasma):** permanenza legata al WS vivo; grace 60s; beacon `POST /session/leave` per la chiusura pulita. Evitare la reintroduzione dello "stale slot lockout".
- **C (stessa sedia):** riserva atomica, nessun `await` nel percorso critico; errore `ROOM_JUST_TAKEN`.
- **D (seconda sessione stesso browser):** permessa, avviso non bloccante; valutare marcatura per escludere dalle statistiche.

---

## 6. Iterazione 2 — API e specifiche UI

- **6.1** Endpoint e messaggi socket: metodo, payload, errori tipizzati, auth, rate-limit. HTTP vs WS coerente col §5.1. Identità sempre dal token, mai dal client. Nessun leak di tavoli privati o campi interni.
- **6.2** Contatore giocatori in lobby: definire cosa conta, viaggia col polling, comportamento a zero.
- **6.3** Stato vuoto della lista — testo esatto approvato dall'utente (riprodotto alla lettera nell'analisi) + due pulsanti "Gioca subito"/"Apri un tavolo".
- **6.4** Schermate: Lobby, modale "Apri un tavolo", schermata tavolo in attesa. Accessibilità WCAG AA, mai solo colore, responsive 375px.

---

## 7. Iterazione 3 — Flow diagram e piano di test

Flow diagram Mermaid dei tre percorsi + fusione. Tabelle di test funzionali e di sicurezza (vedi elenco completo nel prompt originale).

---

## 8. GATE DI VERIFICA — prima di consegnare

Ogni transizione ha evento+esito; nessuna decisione §3 modificata senza segnalazione; fusione esclude privati/manuali; server-authoritative; avvio partita da WS mai da polling; stale slot lockout documentato; comportamento post-riavvio definito; ogni endpoint con rate-limit/auth/errori tipizzati; whitelist file BE/FE.

---

## 9. Regole di consegna

Tre iterazioni interne. Nessun codice applicativo (solo modello stati, API, UI, diagrammi, test). Ogni scelta non ovvia motivata. Chiedere al lead se manca un'informazione. Nessuna dipendenza nuova senza approvazione.

Chiudere con: `OUTPUT PER: agente_develop`.
