# DIAGNOSI — GATE 1 — "Due ospiti non si incontrano" (stallo lobby)

**Autore:** agente_analista (lead) · **Brief:** [../prompts/PROMPT_FIX_STALLO_LOBBY.md](../prompts/PROMPT_FIX_STALLO_LOBBY.md)
**Esito:** la causa è FUORI dal perimetro del codice lobby → per §0 mi fermo e riferisco al lead.

## Catena causale (in prosa)
Il frontend deployato (branch Vercel) parla il **protocollo lobby** (`open_table`, `quick_match`, `GET /tables`, `GET /tables/new-code`). Il backend che sta effettivamente rispondendo **non implementa quel protocollo**: è una versione precedente al commit lobby. Da questo **sfasamento di versione FE↔BE** discendono, uno per uno, tutti i sintomi del verbale:

- **"Apri un tavolo" → pulsante grigiato.** La modale precompila il codice con `GET /tables/new-code`. Su un backend senza quella rotta → **404** → `fetchNewCode()` fallisce → il campo codice resta vuoto → `canConfirm=false` → pulsante disabilitato. (La casella "privato" non c'entra: confermato, non entra nella condizione.)
- **Lista sempre vuota / nessun giocatore visibile.** `GET /tables` su un backend senza quella rotta → **404** → il polling va in errore, la lista resta vuota.
- **"Apri un tavolo"/"Gioca subito" → schermata appesa + "Non sei in nessun room. Invia join_room".** Il FE apre il WS e invia `open_table`/`quick_match`. Il backend vecchio **non li riconosce**: il messaggio non aggancia il socket ad alcuna stanza. Nessun `room_joined` arriva → la modale resta in "Apertura…" (appesa). Dopo ~25s parte l'heartbeat del client → sul backend vecchio è un messaggio room-scoped su un socket senza stanza → **"Non sei in nessuna room. Invia join_room"** (il sintomo è corretto: stato incoerente da versione sbagliata).
- **Le due sessioni non si incontrano.** Nessun tavolo viene mai creato lato server, quindi non c'è nulla da elencare né a cui sedersi.

## Prova che il CODICE è corretto (implementato, non difettoso)
- **Backend end-to-end, socket reale, `requireAuth=true` (come produzione):** avviato il server vero e guidato con un WebSocket client → `open_table` restituisce `room_joined{code}`, `GET /tables` elenca il tavolo, l'heartbeat NON produce alcun errore, due ospiti **stesso `clientId`** si siedono allo stesso tavolo (`self_play_notice` + `state`, partita avviata), `quick_match` apre un tavolo. Tutto verde.
- **Revisione statica FE:** `page.tsx` cabla correttamente Lobby/OpenTableModal/WaitingRoom; la modale usa `value={code}` legato allo stato (non `defaultValue`); il token è coerente (`getAuthToken` unico, via `sessionIdentity`); `useGameSocket` invia `open_table`/`quick_match` come primo frame e apprende il codice da `room_joined.code`.
- **Backend statico:** HTTP e WS condividono lo **stesso** `RoomManager` ([server.ts:92,101]); `open_table`/`quick_match` sono validati ([ws/validate.ts:53-70]) e instradati **prima** del controllo stanza ([RoomManager.ts:502-509]); `room_joined` include `code`; le rotte `/tables*` ammettono gli ospiti (solo `!principal` → 401).

## Fatto git determinante
Il commit lobby **`d7dc942` è solo sul branch** `feature/ui-landing-page-vintage`, **NON su `main`** (`git log origin/main..HEAD` = solo d7dc942). Se il backend su Render deploya `main` (o un branch privo di questo commit), sta girando codice **senza** la lobby. Il frontend di branch, invece, ha la lobby.

## Distinzione richiesta (§3.6)
- **Implementato e corretto:** tutto il codice lobby (BE+FE). Nessun difetto di codice individuato.
- **Mai implementato / mancante:** nulla nel codice. Ciò che "manca" è a livello di **deployment**: il backend deployato non contiene ancora il codice lobby.

## Piano di correzione (ordine motivato) — NON è una patch di codice
1. **Confermare lo sfasamento** (2 minuti, dal browser + dashboard, vedi sotto).
2. **Allineare i deployment:** far girare al backend (Render) una versione che includa il commit lobby — cioè mergiare `feature/ui-landing-page-vintage` (o il commit d7dc942) sul branch che Render deploya (verosimilmente `main`), oppure puntare Render al branch corretto. Verificare anche che le env `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` del FE puntino a quel backend e che l'origin del branch sia in allowlist (CORS/WS) su Render.
3. **Ri-collaudare** il percorso "due ospiti si incontrano" sul deploy allineato. Se qualcosa resta rotto DOPO l'allineamento, allora si apre una diagnosi di un eventuale difetto FE residuo.

## Verifiche che il lead può fare in 2 minuti (browser + Render)
- **DevTools → Network** sul branch deploy: `GET /tables/new-code` risponde **404** (rotta assente sul BE deployato → conferma lo sfasamento) oppure 200/401?
- **DevTools → Console/Network**: il WS si connette in `wss://`? Alla pressione di "Apri un tavolo", il server risponde a `open_table` con `move_rejected{MALFORMED}` / nulla (BE vecchio) oppure `room_joined` (BE aggiornato)?
- **Dashboard Render:** quale branch/commit sta deployando il backend? Include il commit lobby `d7dc942`?

## Perché i test non l'hanno intercettato (nota di processo)
I test lobby chiamano `RoomManager.handleMessage` in isolamento (socket finti) e le rotte HTTP con un server in-process: verificano il **codice**, non la **coerenza dei deployment**. Nessun test può cogliere uno sfasamento di versione fra FE (Vercel) e BE (Render). Un test end-to-end contro l'URL di deploy sarebbe l'unico a coglierlo.

---
**STOP al GATE 1.** Nessuna riga di codice lobby va modificata: non c'è un difetto di codice. Attendo il via libera del lead sul piano di allineamento dei deployment (o l'esito delle 2 verifiche, se emerge invece un difetto FE residuo).
