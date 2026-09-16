# Spec Lotto 1 — Rimozione pulsante matta (R1) + nomi al tavolo (R2)

> **Branch:** `claude/tavolo-matta-nomi`. **Solo FE.** Nessun cambio di contratto, nessuna
> migrazione, motore/test BE intoccati. Verifica su URL di deploy Vercel del branch.
> **Dipendenze:** indipendente. Con il Lotto 2 (layout) tocca file diversi (TSX qui, `globals.css`
> là): nessun conflitto reale.

---

## R1 — Rimuovere il pulsante "Sostituisci matta"

### Whitelist (file che il lotto PUÒ toccare)
- `FE_Burraco/src/components/ActionBar.tsx` — rimuovere il pulsante "Sostituisci matta"
  (`:75-81`) e la prop `onWildSubstitute` (`:23`) dall'interfaccia `Props`.
- `FE_Burraco/src/app/page.tsx` — rimuovere:
  - il blocco `wild-edge-choice` Cima/Fondo (`:676-701`);
  - lo stato `wildAttempt` / `setWildAttempt` e ogni suo riferimento;
  - l'handler `onWildSubstitute` passato a `<ActionBar>` (`:713-720`).
- `FE_Burraco/src/lib/useGameSocket.ts` — **facoltativo**: rimuovere il metodo `wildSubstitute`
  (`:217`, `:801-803`) e il suo tipo, se non resta alcun chiamante. Se lasciato, resta codice
  inerte innocuo. Scelta dichiarata dal develop.
- `FE_Burraco/src/lib/rejectMessages.ts` — **facoltativo**: i testi IT di `WILD_NO_LEGAL_POSITION`
  / `WILD_EDGE_REQUIRED` / `NO_WILD_TO_SUBSTITUTE` possono restare (non più raggiungibili da UI, ma
  innocui). Non rimuovere i codici dal tipo del contratto.

### Blacklist (VIETATO toccare)
- `BE_Burraco/src/engine/game.ts` (`wildSubstitute` e ogni logica di gioco).
- `BE_Burraco/src/contract/types.ts` e `FE_Burraco/src/lib/contract.ts` — il messaggio
  `wild_substitute` e i reject code **restano** (il BE continua a gestirli: DT-MATTA-01).
- `BE_Burraco/src/ws/validate.ts`, `BE_Burraco/src/room/Room.ts` — dispatch invariato.
- Qualsiasi file di test BE.

### Criteri di accettazione (verificabili su deploy)
1. Al tavolo 1v1, in fase `may_meld`, **il pulsante "Sostituisci matta" non compare più**.
2. Nessun controllo Cima/Fondo appare in nessuna condizione.
3. Le altre azioni (Pesca, Cala, Amplia, Annulla, Scarta) restano invariate e funzionanti.
4. Nessun errore in console; nessun riferimento rotto a `onWildSubstitute`/`wildAttempt`.
5. `next lint` e `typecheck` verdi (dichiarare se la toolchain non è disponibile nell'ambiente).

### Debito registrato
`docs/specs/debito-tecnico-matta.md` (DT-MATTA-01): l'azione resta raggiungibile via WS ma è
corretta e server-authoritative. Nessuna correzione in questo lotto.

---

## R2 — Nome di ogni giocatore visibile al tavolo

### Stato attuale (già implementato)
- Il contratto porta **già** i nomi per posto senza dati sensibili: `SeatPublic.displayName`
  (`contract/types.ts:139-146`) popolato da `redactFor()` (`room/redact.ts:44-50`) — **niente
  userId né email**. `PlayerPublic.displayName` è in `room_joined`.
- Il FE **già** mostra i nomi: proprio nome (`page.tsx:656`), avversario 1v1
  (`page.tsx:377`, `OpponentStatus` `:523`), targhe per-posto a 4 (`page.tsx:418-422`).
- **Nessun cambio di contratto necessario.**

### Delta effettivo (solo FE/CSS)
1. **Robustezza del nome:** garantire che ogni postazione mostri il `displayName` reale quando
   disponibile, evitando il fallback generico "Avversario"/"Giocatore N" se il nome è presente
   in `players[seat].displayName` o `seats[seat].displayName`.
2. **Troncamento** (oggi assente): `.seat-plate .seat-name` (`globals.css:588+`) non ha regola di
   ellissi. Aggiungere:
   - `max-width` adeguato alla targa, `overflow: hidden`, `text-overflow: ellipsis`,
     `white-space: nowrap`;
   - attributo `title={displayName}` sul nome (tooltip nativo per il nome intero);
   - il `displayName` può arrivare fino a **40 caratteri** (limite backend, `app.ts:38`).
3. **Suffisso "(ospite)":** al tavolo **non** si aggiunge. Il contratto live (`SeatPublic`/
   `PlayerPublic`) **non** porta un flag `isGuest` per posto; il prompt richiede il suffisso
   "dove il contratto lo prevede già" → al tavolo non è previsto. **Nessuna estensione di
   contratto.** (Il suffisso resta nello storico, dove `MatchSummary.opponentIsGuest` esiste.)

### Whitelist
- `FE_Burraco/src/app/page.tsx` — solo se serve rendere robusto il nome per-postazione
  (targhe 1v1 e 4 posti) e passare `title`.
- `FE_Burraco/src/app/globals.css` — regola di troncamento su `.seat-plate .seat-name`
  (e la variante `[data-seats="4"] .seat-plate .seat-name`, `:1098`).
- `FE_Burraco/src/components/*` — se `OpponentStatus`/targhe sono in un componente dedicato,
  la sola aggiunta di `title` + classe di ellissi.

### Blacklist
- `BE_Burraco/src/room/redact.ts`, `contract/types.ts`, copia FE `lib/contract.ts` — **niente
  cambi di contratto** (il nome è già esposto correttamente e senza eccessi).

### Responsive & accessibilità
- **375px:** il nome troncato con ellissi non deve rompere il layout della targa; il nome intero
  resta accessibile via `title` (e resta leggibile nello storico). Verificare nome a 40 caratteri.
- L'informazione "di chi è il posto" non è affidata al solo colore: nome testuale sempre presente
  (i canali colore/crest/etichetta squadra restano come oggi).

### Criteri di accettazione (verificabili su deploy)
1. In una partita di test 1v1, entrambe le postazioni mostrano il `displayName` reale dei due
   giocatori (utile ai test dell'utente).
2. Un `displayName` lungo (fino a 40 caratteri) **non sfora** la targa a 375px: appare troncato con
   ellissi e il nome intero è nel tooltip (`title`).
3. Nessun dato sensibile nel payload: ispezionando lo stato ricevuto dal client (Network/WS), i
   posti portano solo `seat/team/handCount/connectionStatus/displayName` — **mai userId o email**.
