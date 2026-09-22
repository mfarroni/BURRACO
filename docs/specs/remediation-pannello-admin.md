# PIANO DI REMEDIATION — PANNELLO ADMIN + NOTIFICHE EMAIL

**Autore:** agente_analista (lead)
**Fase:** REMEDIATION (in attesa di approvazione DIRETTA dell'utente)
**Branch:** `claude/pannello-admin-email-v2`
**Input:** report di `agente_security` (nessun CRITICO/ALTO; 1 MEDIO, 2 BASSO, 1 INFO)
**Data:** 2026-09-22

> Dopo l'approvazione, il ciclo di remediation è: `agente_develop` → `agente_test` →
> `agente_security` → ritorno al lead. **NON** ripassa da `agente_ui_ux` (nessun impatto UI).

---

## Quadro dei rilievi

| ID | Sev | Sintesi | Proposta |
|---|---|---|---|
| SEC-ADM-01 | **MEDIO** | Dispatcher email senza guardia di re-entrancy: tick sovrapposti → invii duplicati + sforo del cap locale | **FIX (R1)** |
| SEC-ADM-02 | BASSO | Welcome a email arbitraria con `displayName` controllato dall'attaccante (amplificazione phishing) | **Decisione: mitigazione leggera vs accettazione** |
| SEC-ADM-03 | BASSO | `withTimeout` non annulla il `SELECT 1`: connessione trattenuta oltre il timeout | **Decisione: fix leggero vs accettazione** |
| SEC-ADM-04 | INFO | Assunzione single-instance (rate-limit RAM, scheduler per-processo) | **Documentazione (R4)** |
| SEC-ADM-05 | — | User-enumeration su `/auth/register` (409) | Già accettato (SEC-A2), nessuna azione |

---

## R1 — SEC-ADM-01 (MEDIO): re-entrancy del dispatcher email  ⭐ priorità
**Perché è il fix reale:** se un tick del dispatcher supera i 60s (ogni `sendEmail` può arrivare a
~9s tra timeout e retry; batch da 40), il `setInterval` fa partire un secondo tick in parallelo. Due
runner leggono lo stesso `remaining` e drenano gli stessi record → **stessa email inviata due volte** e
**sforo del cap giornaliero locale** (`BREVO_DAILY_CAP`). L'idempotenza `UNIQUE(broadcast_id,user_id)`
protegge solo dall'inserimento doppio, non dal doppio invio.

**Intervento (minimo e sufficiente per l'architettura single-instance attuale):**
1. **Guardia di re-entrancy** nel dispatcher (`mail/dispatcher.ts`): flag `dispatching` a livello di
   modulo (o self-scheduling con `setTimeout` ri-armato solo nel `finally`). Se un tick è in corso, il
   successivo viene saltato. **Elimina alla radice** la sovrapposizione su singola istanza.
2. **UPDATE di successo con guardia di stato** (difesa in profondità, costo nullo):
   - `mail/queue.ts`: il ramo `sent` → `.set({stato:"inviata"}).where(and(eq(id), eq(stato,"in_attesa")))`;
   - `broadcast/service.ts`: → `.set({stato:"inviato"}).where(and(eq(rid), eq(stato,"in_coda")))`;
   - incrementare il contatore quota **solo se** l'UPDATE ha inciso su 1 riga (claim effettivo).
3. **Rinvio consapevole:** `SELECT ... FOR UPDATE SKIP LOCKED` + claim-prima-dell'invio servono solo
   per il caso **multi-processo** (scaling >1 istanza), che oggi non esiste. Si rimanda insieme a R4
   (nota di deploy): non introdurre complessità non necessaria ora.

**Rischio del fix:** basso; nessun impatto su UI/contratti. Test dedicati (vedi sotto).

---

## R2 — SEC-ADM-02 (BASSO): welcome a email arbitraria  → DECISIONE RICHIESTA
**Contesto vincolante:** Massimo ha deciso welcome = *solo notifica, nome + link al sito, **nessun
link di verifica/attivazione**, login mai bloccato*. Un doppio opt-in/verifica **contraddirebbe** quella
decisione. Il vettore residuo: registrando un'email altrui non ancora registrata, la vittima riceve una
welcome col saluto "Ciao <displayName>," dove `displayName` (≤40 char) è scelto dall'attaccante.
Header injection **non** applicabile (email validata, `stripCtl`, corpo `textContent` puro): è iniettabile
solo il breve testo del saluto. Mitigato da rate-limit 50/15min per IP e cap 300/gg.

**Due strade (scegli tu):**
- **(a) Mitigazione leggera (consigliata):** sanificazione più stretta del `displayName` reso nel corpo
  welcome (whitelist di caratteri, rimozione di URL/`http`), mantenendo "nessuna verifica". Riduce il
  payload di phishing senza toccare la decisione sul login. Costo minimo.
- **(b) Accettazione formale:** documentare il rischio come residuo accettato (coerente con SEC-A2 e
  con la scelta "nessuna verifica"), nessuna modifica.

*(Non propongo il doppio opt-in: violerebbe una tua decisione esplicita.)*

---

## R3 — SEC-ADM-03 (BASSO): la probe `SELECT 1` non annulla la query  → DECISIONE RICHIESTA
**Contesto vincolante:** hai deciso *timeout controlli BE/DB = 1 minuto*. Il `withTimeout` fa race col
timer ma non annulla la query: con DB lento la connessione resta occupata fino a 60s. Superficie
**solo admin** (adminLimiter 60/min); `agente_security` la definisce "trascurabile".

**Due strade (scegli tu):**
- **(a) Fix leggero (consigliato):** impostare uno `statement_timeout` sulla query di probe così il DB
  **annulla davvero** la query e libera la connessione, **mantenendo** la soglia "rosso dopo 1 minuto"
  a livello applicativo. Rispetta la tua decisione sul minuto e chiude il trattenimento connessione.
- **(b) Accettazione:** documentare come marginale (accesso solo admin, `SELECT 1`), nessuna modifica.

---

## R4 — SEC-ADM-04 (INFO): nota di deploy single-instance
Nessun codice. **Documentare** (nel README/deploy) che l'architettura assume **una sola istanza**:
rate-limit in RAM e scheduler per-processo. Prima di attivare l'autoscaling (>1 istanza su Render) va
introdotto un coordinamento (rate-limit condiviso + lock distribuito / `FOR UPDATE SKIP LOCKED` sul
dispatcher, cfr. rinvio in R1.3). Finché resta single-instance, R1 è sufficiente.

## SEC-ADM-05: nessuna azione (rischio SEC-A2 già accettato dal lead in un ciclo precedente).

---

## Piano di test della remediation (per `agente_test`)
- **R1:** simulare `sendEmail` lento (>tick) e verificare che (i) un solo runner del dispatcher sia
  attivo (nessuna sovrapposizione), (ii) nessun record venga inviato due volte, (iii) il contatore non
  superi `remaining` di partenza. Test dell'UPDATE guardato (una seconda UPDATE sullo stesso record già
  `inviata`/`inviato` non incrementa il contatore).
- **R2 (se scelta (a)):** un `displayName` con URL/caratteri speciali non compare integralmente nel
  corpo welcome accodato.
- **R3 (se scelta (a)):** la probe imposta lo `statement_timeout` e ritorna comunque `db:red` con testo
  entro la soglia; il caso sano resta `db:green`.
- **Non-regressione:** suite attuale **387/387** deve restare verde.

---

## Ordine di dipendenza (dopo approvazione)
`agente_develop` (R1 + R2/R3 secondo le tue scelte + R4 doc) → `agente_test` (test remediation +
non-regressione) → `agente_security` (verifica chiusura SEC-ADM-01/02/03) → ritorno al lead.

---

## DECISIONI DEL LEAD (2026-09-22) — APPROVATO
- **R1 — APPROVATO:** fix re-entrancy del dispatcher (+ UPDATE guardate di stato). Da implementare.
- **R2 — ACCETTATO (rischio residuo):** nessuna modifica. Coerente con "welcome = solo notifica,
  nessuna verifica" e con SEC-A2. Da documentare come accettato.
- **R3 — ACCETTATO (rischio residuo):** nessuna modifica. Impatto marginale (solo admin, `SELECT 1`).
  Da documentare come accettato.
- **R4 — documentazione:** nota di deploy single-instance.

**Ciclo di remediation:** `agente_develop` (R1 + doc R2/R3/R4) → `agente_test` → `agente_security` →
ritorno al lead. **Senza** `agente_ui_ux`.
