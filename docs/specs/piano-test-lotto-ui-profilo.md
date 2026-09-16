# Piano di test e verifica — lotto UI/profilo/donazione/login (R1–R8)

> **Iterazione 3.** Tutti i casi sono eseguibili su **URL di deploy di branch (Vercel)** e **log
> Render**: nessun caso richiede `npm run dev` in locale (l'utente non può eseguire l'app
> localmente). Include non-regressione visiva dopo i Lotti 2 e 3.

---

## A. Test FUNZIONALI (un caso per requisito + non-regressione + sotto-casi R6)

| # | Req / Lotto | Precondizione | Passi | Esito atteso |
|---|---|---|---|---|
| F1 | R1 / L1 | Partita 1v1 in corso, fase `may_meld` | Osservare la barra azioni; selezionare un gioco con matta + una carta | **Nessun** pulsante "Sostituisci matta"; nessun controllo Cima/Fondo; le altre azioni funzionano |
| F2 | R2 / L1 | 1v1 con due nomi distinti (uno lungo ~40 char) | Entrare al tavolo; osservare le due postazioni | Ogni postazione mostra il `displayName` reale; il nome lungo è troncato con ellissi e leggibile via tooltip (`title`); nessuno sforo a 375px |
| F3 | R3 / L2 | Tavolo con un **burraco (7)** e una sequenza da 10 calate | Vedere l'area calate a 1920, 1366, 768, 375px | Il burraco non va **mai** a capo; le sequenze lunghe entrano o scorrono orizzontalmente, mai run spezzata illeggibile |
| F4 | R4 / L2 | Tavolo con calate visibili | Scrollare la pagina di gioco a 1366px e 375px | Le calate passano **dietro** la zona-mano sticky; nessuna carta calata traspare attraverso il contenitore della mano |
| F5 | R5 / L3 | — | Aprire Login, Registrazione, Lobby | Le 3 schermate mostrano lo sfondo verde-tavolo; contrasto testi leggibile |
| F6 | R6 / L4 | (sotto-casi F6a-F6f) | vedi sotto | vedi sotto |
| F7 | R7 / L4 | Utente registrato con ≥ qualche partita | Aprire il profilo | Compaiono: data iscrizione, miglior punteggio, vs registrati/ospiti, avversari frequenti, ultime 5 a pallini (con parola/icona) |
| F8 | R7 / L4 | Utente registrato **senza** partite | Aprire il profilo | Placeholder gentili (niente zeri/NaN fuorvianti); data iscrizione comunque mostrata |
| F9 | R8 / L5 | Account di test | Login con password corretta | Accesso riuscito (il successo azzera il contatore tentativi) |
| **F-NR1** | Non-regressione (dopo L2) | Screenshot "prima" del tavolo | Confronto before/after del **tavolo di gioco** | Aspetto invariato salvo le modifiche volute di R3/R4 |
| **F-NR2** | Non-regressione (dopo L3) | Screenshot "prima" di profilo e tavolo | Confronto before/after di **profilo** e **tavolo** | **Identici a prima** (lo sfondo verde NON è colato nel profilo) |
| **F-NR3** | Non-regressione (dopo L3) | — | Aprire la **landing** | Estetica legno invariata |

### Sotto-casi R6 (donazione)
| # | Caso | Esito atteso |
|---|---|---|
| F6a | Presenza landing | Badge nel piè, **dopo** la sezione Contatti |
| F6b | Presenza lobby | Badge in fondo, **dopo** il box codice tavolo; visibile anche da ospite |
| F6c | Presenza profilo | Badge in fondo al pannello, **dopo** le statistiche (utente registrato) |
| F6d | **Assenza al tavolo** | Durante la partita il badge **non** compare da nessuna parte |
| F6e | CSP + Network | **Nessuna** violazione CSP in console; **nessun 404** in Network |
| F6f | Hi-dpi | Su schermo ad alta densità è servita la variante **`@2x`** (badge nitido) |
| F6g | Link | Il click apre `buymeacoffee.com/granmasterchess` in **nuova scheda** |
| F6h | 375px | Il badge **non sfora** e resta leggibile; nessun elemento fisso/overlay |

---

## B. Test di SICUREZZA

| # | Area | Passi | Esito atteso |
|---|---|---|---|
| S1 | R7 / IDOR statistiche | Da sessione utente-A, tentare di leggere le statistiche di un **altro** utente | Impossibile: `/users/me/stats` deriva l'utente **dal token**, nessun id nel client → nessuna via per l'IDOR |
| S2 | R7 / dettaglio partita altrui | `GET /users/me/matches/:id` con id di una partita a cui A **non** ha partecipato | **404** (mai 403): l'esistenza di partite altrui non è osservabile |
| S3 | R7 / gate ospite | Chiamare `/users/me/stats` e `/users/me/matches` da sessione **ospite** | **403** `GUEST_NO_PROFILE` (negato) |
| S4 | R2 / anti-leak nomi | Ispezionare lo stato ridotto ricevuto dal client (WS `state`) | I posti espongono solo `seat/team/handCount/connectionStatus/displayName`; **mai** userId o email |
| S5 | R7 / privacy avversari | Ispezionare il payload di `/users/me/stats` (`topOpponents`) | Solo `name/isGuest/count`; **nessun** userId/email |
| S6 | R8 / messaggio uniforme | Login con: email inesistente, password errata, account rallentato | **Stesso** `401 INVALID_CREDENTIALS`, testo identico in tutti i casi |
| S7 | R8 / no weaponization | Da IP-X fallire N volte su account-A; poi accedere ad A **da IP-Y** con password corretta | A entra da IP-Y: nessun blocco dell'account; nessun blocco definitivo |
| S8 | R8 / persistenza | Provocare il rallentamento, poi attendere il **risveglio** del servizio Render; riprovare | Il contatore **non** riparte da zero (letto dal DB): il rallentamento persiste finché nella finestra |
| S9 | R8 / honeypot | Inviare al login il campo honeypot valorizzato | **401** immediato, stesso messaggio, senza verifica password (log Render) |
| S10 | R6 / link sicuro | Ispezionare l'anchor di donazione nei 3 punti | Presenti `target="_blank"` **e** `rel="noopener noreferrer"` |
| S11 | R6 / CSP | Console e Network durante la navigazione dei 3 punti | Nessuna violazione CSP; immagini servite da `'self'`; nessuno script di terze parti |

---

## C. Verifiche trasversali (ogni lotto)
- `next lint` e `typecheck` verdi (BE: `tsc`); se la toolchain non è disponibile nell'ambiente
  dell'agente (Node non su PATH), **dichiararlo** anziché darlo per riuscito.
- Suite BE di **non-regressione** verde per i lotti che toccano il BE (L4 statistiche, L5 auth): i
  test esistenti non devono rompersi; i soli test nuovi sono quelli dichiarati.
- `git status`: solo i file in whitelist del lotto.
- Contratto FE/BE (L4): verifica **campo per campo** che `contract/types.ts` e
  `FE_Burraco/src/lib/contract.ts` siano allineati (vincolo P2).

---

## D. Note operative
- L'utente verifica su **URL di deploy del branch** e **log Render**; nessun passo richiede
  esecuzione locale.
- Le migrazioni (solo L5, `0004`) vanno applicate a Neon dall'utente/CI; il test S8 dipende da
  quell'applicazione.
- I confronti di non-regressione visiva (F-NR*) usano screenshot "prima" acquisiti sul deploy di
  `main` prima del merge del lotto.
