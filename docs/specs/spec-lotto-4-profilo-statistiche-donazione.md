# Spec Lotto 4 — Donazione ×3 (R6) + delta statistiche profilo (R7)

> **Branch:** `claude/profilo-statistiche-donazione`. FE (componente + 3 punti) + BE (nuove
> statistiche, contratto). **Nessuna migrazione** (i dati esistono già). **Cambia il contratto**
> (`UserStats`): allineare `contract/types.ts` e la copia `FE_Burraco/src/lib/contract.ts` **nello
> stesso commit** (vincolo P2). Verifica su URL di deploy Vercel + log Render.
> **Dipendenze:** poggia su quanto già consegnato (persistenza + statistiche live).

---

# R6 — Pulsante di donazione "Buy Me a Coffee" (3 punti)

### Stato di partenza (già pronto)
- Immagini presenti e **git-tracked** (nomi minuscoli): `FE_Burraco/public/images/donazione/`
  → `buymeacoffee-button.png` (217×60), `buymeacoffee-button@2x.png` (434×120),
  `buymeacoffee-logo.png` (di riserva, **non** usata dal pulsante).
- CSP compatibile: `img-src 'self' data:` (`next.config.mjs`) → PNG locali OK; **nessun** CDN,
  **nessuno** script del marchio (entrambi vietati e comunque bloccati). **La CSP non si tocca.**

### Componente unico
`FE_Burraco/src/components/DonationButton.tsx` + `FE_Burraco/src/components/DonationButton.css`.
- `<a href="https://www.buymeacoffee.com/granmasterchess" target="_blank" rel="noopener noreferrer">`
  contenente un `<img>` **nativo** (NON `next/image`) con:
  - `src="/images/donazione/buymeacoffee-button.png"`,
    `srcSet="/images/donazione/buymeacoffee-button.png 1x, /images/donazione/buymeacoffee-button@2x.png 2x"`;
  - `width="217" height="60"` (evita layout shift);
  - `alt="Offrimi un caffè su Buy Me a Coffee"`;
  - warning ESLint `@next/next/no-img-element` atteso → `// eslint-disable-next-line
    @next/next/no-img-element` sulla **singola riga**, mai a livello di file.
- Prop `size?: "normale" | "compatto"` (default `normale`); `compatto` per la lobby se serve minor
  ingombro. **Una sola prop, non due componenti.**
- **CSS:** dimensioni in foglio (non `style` inline: JSX non supporta `!important`). Servono almeno
  `max-width: 100%` e `height: auto` così a 375px il pulsante non sfora. **Tutte le classi
  prefissate `bmc-`.** Verificare che nessuna `bmc-` collida con `globals.css` o `LandingPage.css`
  (`Landing.css`). Una riga di testo discreta ammessa accanto (IT, senza enfasi, es.
  "Il circolo è gratuito. Se ti fa piacere, offrici un caffè."). Nessun conteggio/obiettivo/banner.
- **Nota Landing:** `Landing.css` impone che ogni selettore discenda da `.landing-root`; questo
  componente porta il proprio foglio con classi `bmc-` → è un'**eccezione dichiarata** a quella
  regola.

### Collocazioni (esatte)
| Punto | File | Dove | Visibile a ospiti? |
|---|---|---|---|
| Landing | `components/Landing.tsx` | dopo `section#contatti` (`:458-476`), nel piè `footer.site-footer` (`:479-485`) | sì (pubblica) |
| Lobby | `components/Lobby.tsx` | in fondo a `.lobby-body`, **dopo** `.join-by-code` (`:337-364`) | **sì** |
| Profilo | `components/ProfilePanel.tsx` | in fondo al pannello, **dopo** le sezioni statistiche/andamento/partite | solo utente registrato |

**Tre divieti:** mai al tavolo durante la partita; mai elemento fisso/sticky/overlay; mai nei flussi
di autenticazione (login/registrazione restano puliti).

### Whitelist R6
- `FE_Burraco/src/components/DonationButton.tsx` (nuovo), `DonationButton.css` (nuovo).
- `FE_Burraco/src/components/Landing.tsx`, `Lobby.tsx`, `ProfilePanel.tsx` — solo l'inserimento del
  componente nei 3 punti.
### Blacklist R6
- `next.config.mjs` (CSP). Le immagini in `public/images/donazione/` (già presenti; non rigenerare,
  non rinominare, non alterare i colori del marchio). Nessun `next/image`.

### Responsive & accessibilità R6
- **375px:** il badge non sfora (`max-width:100%`, `height:auto`), resta nitido su hi-dpi (variante
  `@2x` effettivamente servita), tocco ≥ ~44px d'altezza (il badge è 60px: ok).
- `alt` descrittivo IT; il link apre in nuova scheda con `rel="noopener noreferrer"`; focus visibile.

---

# R7 — Delta statistiche profilo (5 voci scelte al Gate 1)

### Già implementato (nessun lavoro, non riprogettare)
Rotte `/users/me/stats|matches|:id` (`http/app.ts:254-330`), DTO completi (`contract/types.ts`),
UI (`ProfilePanel.tsx`): % vittorie, punti totali, giocate/vinte/perse/abbandonate, punteggio medio,
blocco "Come giochi" (puliti/sporchi per smazzata, rapporto, pozzetto %, in diretta %, chiusure %,
penalità media, malus), andamento (sparkline SVG), storico paginato, soglie di significatività.

### Voci NUOVE approvate (le sole da aggiungere)
1. **Esito ultime 5 partite** — a pallini, con parola/icona (mai solo colore).
2. **Data di iscrizione**.
3. **Partite vs registrati / vs ospiti** (distinte).
4. **Avversari più frequenti** (top 3).
5. **Miglior punteggio in una singola partita**.
*(La "serie di vittorie" NON è stata selezionata: fuori scope.)*

### Contratto — aggiunte a `UserStats` (additive; allineare BE+FE nello stesso commit)
`BE_Burraco/src/contract/types.ts` **e** `FE_Burraco/src/lib/contract.ts`:
```
// nuova interfaccia
export interface TopOpponent { name: string; isGuest: boolean; count: number }

// nuovi campi su UserStats:
memberSince: number | null;          // epoch ms iscrizione (users.created_at)
bestMatchScore: number | null;       // max punteggio finale dell'utente in una partita completed
lastFive: ("won" | "lost")[];        // ultime 5 partite completed, ordine CRONOLOGICO (vecchia→nuova), 0..5 voci
vsRegistered: number;                // # partite completed con avversario REGISTRATO
vsGuest: number;                     // # partite completed con avversario OSPITE
topOpponents: TopOpponent[];         // max 3, per frequenza desc; solo name+isGuest+count (mai userId/email)
```
Tutti additivi: nessun campo esistente cambia. **Privacy:** `topOpponents` espone solo il
`displayName` e il flag ospite, **mai** userId/email (coerente con gli altri DTO).

### BE — calcolo (in `StatsStore.getStats`, ENTRAMBE le implementazioni)
`BE_Burraco/src/stats/store.drizzle.ts` **e** `store.memory.ts` (parità numerica, come già fanno via
`analysis.ts`). Tutto ON-THE-FLY, nessuna tabella nuova, tutte parametrizzate:
- `memberSince`: `users.created_at` del principale (epoch ms). Non dipende dal periodo.
- `bestMatchScore`: **derivabile dall'aggregato già calcolato** `perMatch` (`store.drizzle.ts:131-155`)
  = `max(perMatch.matchTotal)`; `null` se nessuna partita. Rispetta il periodo (come il resto).
- `lastFive`: le ultime 5 partite `completed` dell'utente per `matches.ended_at desc`, mappate a
  `won/lost` (squadra utente vs `winner_team ?? winner_seat`), poi **invertite** in ordine
  cronologico. Riusa il pattern di `rows` (`:42-57`) aggiungendo `ended_at` + `order by … limit 5`.
  Rispetta il periodo.
- `vsRegistered` / `vsGuest`: per ogni partita `completed` dell'utente, l'avversario è il posto
  dell'altra squadra (in 1v1: l'altro `match_players`); `join users` per `is_guest`. Conta
  registrati vs ospiti. Rispetta il periodo. (Le partite self-play hanno `userId=null` sul posto →
  non entrano nel filtro dell'utente: nessun conteggio spurio.)
- `topOpponents`: raggruppa le partecipazioni avversarie per identità (userId; nome se null),
  conta, ordina desc, `limit 3`. Emette `{ name, isGuest, count }`. Rispetta il periodo.

**Regole da rispettare:** soglia di significatività già presente per le medie (invariata); conteggi
e date non hanno soglia; `lastFive` mostra ciò che esiste (0..5). Nessuna libreria di grafici
(pallini in SVG/CSS in linea).

### FE — rendering (`ProfilePanel.tsx` + `globals.css`)
- **Data iscrizione**: riga nell'intestazione profilo o nel blocco "Contesto" (formato IT).
- **Miglior punteggio**: una `StatCard` accanto a "Punteggio medio".
- **vs registrati / vs ospiti**: due contatori (blocco "Contesto").
- **Avversari più frequenti**: piccola lista (nome + "(ospite)" se `isGuest` + conteggio).
- **Ultime 5 a pallini**: sequenza di 5 pallini; **esito mai affidato al solo colore** → ogni
  pallino porta anche icona/lettera (es. ▲/▼ o V/S) e `aria-label` ("Vinta"/"Persa"). Ordine
  cronologico da sinistra (più vecchia) a destra (più recente).
- Stati: se `matchesPlayed === 0` → `lastFive` vuoto, `vs*`=0, `topOpponents`=[] , `bestMatchScore`
  null: mostrare placeholder gentile (coerente con `.profile-empty` esistente), non zeri fuorvianti.
  `memberSince` si mostra sempre (esiste per ogni registrato).
- **Posizione invariata:** tutto resta **dentro** il pannello profilo (decisione utente); non
  spostare la sezione statistiche.

### Whitelist R7
- `BE_Burraco/src/contract/types.ts` + `FE_Burraco/src/lib/contract.ts` (allineati stesso commit).
- `BE_Burraco/src/stats/store.drizzle.ts`, `store.memory.ts` (nuove query/campi).
- `FE_Burraco/src/components/ProfilePanel.tsx`, `FE_Burraco/src/app/globals.css` (rendering nuove voci).
### Blacklist R7
- `BE_Burraco/src/db/schema.ts` e `drizzle/` — **nessuna migrazione** (dati già presenti).
- Le rotte HTTP (`http/app.ts`) — firma invariata (`GET /users/me/stats` restituisce lo stesso
  `UserStats`, arricchito). Il gate ospite→403 e la derivazione da token restano invariati.
- `stats/analysis.ts` — solo se una nuova metrica richiede una soglia condivisa; le 5 voci scelte
  non ne hanno bisogno.

### Criteri di accettazione R7 (verificabili su deploy)
1. `GET /users/me/stats` (utente registrato con partite) restituisce i 6 nuovi campi con valori
   coerenti; `topOpponents` **non** contiene userId/email (ispezione payload).
2. Nel profilo compaiono: data iscrizione, miglior punteggio, vs registrati/ospiti, avversari
   frequenti, ultime 5 a pallini con parola/icona (leggibile anche in scala di grigi).
3. Un utente **nuovo** (0 partite) vede placeholder gentili, nessun NaN/zero fuorviante; la data di
   iscrizione è comunque mostrata.
4. Un **ospite** su `/users/me/stats` riceve **403** (invariato).
5. Non-regressione: le statistiche già presenti e lo storico restano invariati.

---

## Criteri di accettazione R6 (verificabili su deploy)
1. Il badge compare in **landing** (piè dopo Contatti), **lobby** (dopo il codice tavolo) e
   **profilo** (in fondo), e **non** compare al tavolo in partita.
2. Nessuna violazione CSP in console; nessun 404 in Network; variante `@2x` servita su schermo
   hi-dpi (badge nitido).
3. Il link apre `buymeacoffee.com/granmasterchess` in **nuova scheda**, con
   `rel="noopener noreferrer"` presente.
4. A 375px il pulsante non sfora e resta leggibile; nessun elemento fisso/overlay.
