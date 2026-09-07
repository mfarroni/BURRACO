# PIANO DI REMEDIATION — Feature "Lobby tavoli"

**Autore:** agente_analista (lead) · **Stato:** ✅ APPROVATO DALL'UTENTE (2026-09-07)
**Decisioni recepite:** piano approvato; intervento su `handleJoin` (R1b) AUTORIZZATO; **R2b (limite connessioni WS per IP) RINVIATO** — resta solo R2a (cap globale `MAX_ROOMS`).
**Input:** report di `agente_security` (`OUTPUT PER: agente_analista`) + anomalia emersa in fase test.
**Ciclo previsto dopo approvazione:** agente_develop → agente_test → agente_security → ritorno a me (NON ripassa da ui_ux).

## Quadro
La security ha promosso gli invarianti forti (anti-leak, autorità/identità, SEC-04/08/10/11, WSS/CSP/CORS/SSL, nessun segreto). I 4 bug sono **tutti di disponibilità/risorse** (DoS/esaurimento RAM) o hardening, nessuno di riservatezza o autorità. Due sono ALTA e vanno chiusi; uno MEDIA è difesa in profondità; uno BASSA è un rischio residuo accettabile.

| ID | Gravità | In una riga | Azione proposta |
|---|---|---|---|
| SEC-LOBBY-01 | ALTA | `open_table` senza cap per-sessione → spam tavoli pubblici + RAM | **FIX** |
| SEC-LOBBY-02 | ALTA | `join_room` ripetuto su stesso socket → room private orfane mai GC (leak permanente) | **FIX** |
| SEC-LOBBY-03 | MEDIA | Nessun tetto globale su room/connessioni; rate-limit solo per-socket | **FIX (rete di sicurezza)** |
| SEC-LOBBY-04 | BASSA | `CODE_IN_USE` come oracolo di esistenza codice | **ACCETTA** (coerente con S6) |

---

## R1 — Invariante "una room viva per socket, un tavolo in attesa per sessione" (chiude 01 e 02)
Intervento coordinato in `BE_Burraco/src/room/RoomManager.ts`, stessa area dei due bug.

**R1a — `handleOpenTable` (`:336-353`): aggiungi la guardia di idempotenza per-sessione** già presente in `handleQuickMatch` (`:368`). Prima di creare:
```ts
const own = this.waitingForSession(this.sessionKey(id));
if (own) { this.socketRoom.set(ws, own); own.join(ws, id.playerToken, id.name, id.clientId, id.userId); return; }
```
→ tetto "1 tavolo in attesa per sessione" (§6.1) valido anche per `open_table`. Chiude **SEC-LOBBY-01**.

**R1b — `handleJoin` (`:319-330`): impedisci che un socket sia legato a più room.** Se il socket è già associato a una room VIVA, non ripuntarlo su un'altra:
```ts
const prev = this.socketRoom.get(ws);
if (prev && !prev.isDisposed()) return; // un socket = una room; niente room orfane
```
→ elimina le room private orfane mai sottoposte a GC. Chiude **SEC-LOBBY-02**.
**Cautela (importante):** la guardia deve scattare SOLO se la room precedente è ancora viva (`!isDisposed()`), così un socket che ha concluso una partita (room smaltita) non resta bloccato. Il client reale apre sempre un NUOVO socket per join/riconnessione, quindi il flusso legittimo non è toccato — ma va verificato contro la suite (vedi R4).

## R2 — Tetti globali di sicurezza (chiude 03)
**R2a — Cap globale sul numero di Room** in `RoomManager` (`rooms`, `:53`): oltre una soglia (proposta env `MAX_ROOMS`, default es. 500) rifiutare la creazione con errore tipizzato (es. `SERVER_BUSY`) invece di crescere illimitatamente. Vale per open_table/quick_match/join_room-che-crea.
**R2b — [RINVIATO su decisione del lead]** Limite di connessioni WS concorrenti per IP in `BE_Burraco/src/ws/server.ts`. NON implementare in questa remediation. Dopo R1 + R2a i vettori principali (01/02) sono già chiusi; R2b resta come possibile hardening futuro.
→ R2a chiude SEC-LOBBY-03 nella parte a basso costo/alto valore; il residuo (flood multi-socket puro) è consapevolmente rinviato.

## R3 — SEC-LOBBY-04: accettazione del rischio residuo
Nessuna modifica di codice. L'oracolo `CODE_IN_USE` è marginale e coerente con il rischio S6 già documentato (con il codice esatto si entra comunque in un privato; spazio 31⁵ ≈ 28,6M + rate-limit rendono il brute-force impraticabile). Registrato come rischio accettato. *(Opzione, se lo si volesse ridurre: rate-limit dedicato più stringente su `open_table`; non necessario.)*

## R4 — Verifica (fase test del ciclo di remediation)
- Nuovi test in `BE_Burraco/test/`: (a) `open_table` ripetuto stessa sessione → 1 solo tavolo (idempotenza, come per quick_match); (b) `join_room` multipli su stesso socket → nessuna room orfana, `activeRoomCount` non cresce e `handleClose` smaltisce; (c) cap globale `MAX_ROOMS` → creazione oltre soglia rifiutata con errore tipizzato; (d) [se R2b] oltre N connessioni per IP → handshake chiuso.
- **Non-regressione:** rieseguire l'intera suite BE (attuale 276/276) e verificare che la guardia R1b non rompa join/riconnessione esistenti; re-typecheck/lint/build FE.
- Poi `agente_security` riverifica gli stessi vettori.

## Rischi residui registrati (dal report security, nessuna azione)
- Aggiramento del cap per-`userId` creando più ospiti → mitigato dal guest-limiter (50/15min/IP).
- Collusione con due account registrati distinti per gonfiare le stats → inerente al 1v1, fuori scope (la difesa self-play copre solo stesso browser/utente).
- Spoofing `displayName` solo con `requireAuth` off (dev/test); in prod identità autoritativa dal token.
- Contatore `lobbyPlayers` gonfiabile → cosmetico, limitato da rate-limit `tables` + TTL.

## Whitelist file della remediation (scope approvato)
- `BE_Burraco/src/room/RoomManager.ts` — R1a, R1b, R2a (cap creazione).
- `BE_Burraco/src/config.ts` — nuova env `MAX_ROOMS`.
- `BE_Burraco/src/contract/types.ts` — eventuale nuovo codice errore tipizzato (`SERVER_BUSY`).
- `BE_Burraco/test/*` — nuovi test di regressione (R4).
- FE: nessuna modifica prevista (gli errori nuovi sono già gestibili come `error`/rifiuto; valutare un messaggio leggibile per `SERVER_BUSY` se introdotto).
- ❌ `BE_Burraco/src/ws/server.ts` — FUORI SCOPE (R2b rinviato).

## Consenso registrato
R1b tocca `handleJoin` (macro-ciclo 1): **intervento AUTORIZZATO dal lead** il 2026-09-07.

---

## ESITO DELLA REMEDIATION (chiuso il 2026-09-07)
Implementazione + test eseguiti dal lead; ri-verifica indipendente di `agente_security`.
- **SEC-LOBBY-01 (R1a)** → CHIUSO — `handleOpenTable` idempotente per sessione; la lista pubblica resta ≤1 tavolo in attesa per sessione (nessuno spam).
- **SEC-LOBBY-02 (R1b)** → CHIUSO — un socket = una room viva; niente room private orfane; riconnessione legittima (nuovo socket) non bloccata.
- **SEC-LOBBY-03 (R2a)** → CHIUSO — cap globale `MAX_ROOMS` (default 500) su tutti i percorsi di creazione; seduta/riconnessione a room esistente non bloccata; messaggio d'errore generico (nessun leak).
- **SEC-LOBBY-04** → ACCETTATO come rischio residuo.
- **Verifica:** BE `tsc --noEmit` OK; suite **281/281 pass** (nuovi test `test/remediation.lobby.test.ts`); invarianti forti (anti-leak, SEC-04/08/10/11, redaction) non regrediti.

### Residui noti (tracciati per un ciclo futuro)
- **R2b — limite connessioni/creazioni per IP-utente (MEDIA, disponibilità).** Rinviato su decisione del lead. Con R2b assente, una singola identità autenticata può creare fino a `MAX_ROOMS` partite self-play (via secondo socket vivo) e monopolizzare il tetto globale, negando la creazione ad altri. R1a+R2a MIGLIORANO comunque lo stato precedente (prima: illimitato e listabile; ora: limitato dal cap e non in lista). Candidato naturale a un prossimo hardening.
- **Chiave di sessione null in DEV senza `clientId` (BASSA, solo dev).** In produzione `requireAuth=true` forza `userId` non-null → guardia R1a pienamente efficace. Nessuna azione per la produzione.
