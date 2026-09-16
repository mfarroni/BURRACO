# Debito tecnico — sostituzione della matta (R1)

> **Origine:** R1 del task `PROMPT_ANALISI_LOTTO_UI_PROFILO_v4.md`. Approvato al Gate 1
> (2026-09-16) di scrivere questo documento **ridefinito**, perché la premessa originale è
> superata. **Nessuna azione correttiva in questo lotto:** solo registrazione del fatto.

---

## 1. Premessa del prompt — SUPERATA

Il prompt R1 assumeva che `pinellaSubstitute` implementasse una **regola sbagliata** (la matta
sostituita torna in mano) e chiedeva, tolto il pulsante, di documentare come debito la *correzione
del motore rinviata a un lotto dedicato*.

**Questa premessa non è più valida.** Il Macro-ciclo 3 (Fasi 0 e 0b, mergiato in `main`) ha **già
corretto** la regola. Riferimenti verificati:
- `docs/specs/fase-0-matta-spec.md` e `docs/specs/fase-0b-jolly-substitute-spec.md`;
- motore: `BE_Burraco/src/engine/game.ts:327-436` — metodo **`wildSubstitute`** (rinominato da
  `pinellaSubstitute`).

**Regola oggi implementata (corretta, da skill "SOSTITUZIONE DELLA MATTA"):**
- la matta **non torna mai in mano**;
- **sequenze:** la matta si sposta a cima/fondo estendendo la scala (rifiuti
  `WILD_NO_LEGAL_POSITION` se nessuna estremità è legale, `WILD_EDGE_REQUIRED` se entrambe legali
  senza `edge`);
- **gruppi:** la matta resta dentro, il gruppo cresce di una carta;
- eccezione 2-naturale→pulito **solo per la pinella**; un jolly lascia sempre il gioco sporco;
- il passaggio 6→7 carte emette `burraco_made` e il gioco resta sporco.

**Conclusione:** non esiste alcun bug di motore da rinviare. Il motore è corretto e
server-authoritative.

---

## 2. Fatto residuo effettivamente registrato

Il Lotto 1 rimuove **solo il pulsante FE** "Sostituisci matta" (decisione utente non
rinegoziabile). Rimane però un fatto, che è ciò che questo documento registra:

> **DT-MATTA-01 — Azione `wild_substitute` raggiungibile a protocollo pur senza controllo UI.**
> Tolto il pulsante (`ActionBar.tsx`) e il flusso Cima/Fondo (`page.tsx`), il messaggio WebSocket
> `wild_substitute` continua a essere accettato e gestito dal server: `ws/validate.ts:108-137`
> (schema zod attivo) → `room/Room.ts:668-669` → `engine.wildSubstitute(...)`. Un client
> modificato può quindi ancora eseguire la sostituzione.

**Valutazione del rischio: BASSO / non un bug.**
- L'azione è **legittima** nel Burraco e la sua esecuzione è **corretta** (il motore applica la
  regola giusta).
- È **server-authoritative** e protetta dai guard esistenti: turno, fase `may_meld`, proprietà di
  **squadra** (`teamOfMeld`), validità del gioco risultante. Non introduce leak né stato incoerente.
- Rimuovere il pulsante è una scelta di **UI/prodotto** (non offrire quell'azione nella UI 1v1),
  non una misura di sicurezza. Non essendoci un difetto, non c'è nulla da "correggere" a valle.

**Nota di trasparenza (non riapre la decisione):** la motivazione originale dell'utente ("la regola
non c'è più") non corrisponde allo stato del codice — la meccanica esiste ed è corretta. La
rimozione del pulsante procede comunque come da R1; questo è annotato solo perché la giustificazione
del requisito differiva dai fatti.

---

## 3. Cosa NON si fa (per decisione)

- Non si tocca il motore (`engine/game.ts`), lo scoring, né i test BE della matta.
- Non si rimuove il dispatch WS né lo schema `wild_substitute` (motore/contratto BE invariati).
- Non si "chiude" DT-MATTA-01: resta un fatto noto e accettato. Se in futuro si volesse anche
  disabilitare l'azione a livello di protocollo per l'1v1, sarebbe un lotto separato e una decisione
  di prodotto esplicita (oggi **non** richiesta).

---

## 4. Ambito FE della rimozione (rimando al Lotto 1)

Il dettaglio operativo della rimozione del pulsante è in
`docs/specs/spec-lotto-1-tavolo-matta-nomi.md`. In sintesi, superficie FE:
`components/ActionBar.tsx` (pulsante + prop `onWildSubstitute`), `app/page.tsx` (blocco
`wild-edge-choice`, stato `wildAttempt`, handler). Facoltativo: `lib/useGameSocket.ts` (metodo
`wildSubstitute` reso inerte). **Motore, contratto BE, `ws/*`, test BE: intoccati.**
