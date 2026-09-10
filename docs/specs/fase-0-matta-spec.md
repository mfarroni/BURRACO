# FASE 0 — Specifica correzione "sostituzione della matta" (analista)

> **Macro-ciclo 3, Fase 0.** Bug di regola sull'1v1 in produzione. Va corretto prima del 2v2.
> **Autorità di dominio:** `.claude/skills/skill-burraco/SKILL.md`, sezione "SOSTITUZIONE DELLA MATTA" (righe 76-96).
> **Branch di lavoro:** `claude/macrociclo-3-2v2` (nessun nuovo branch, nessun merge, nessuna cancellazione).
> **Ritorno:** `agente_develop` → `agente_test` (si salta `agente_ui_ux`).

---

## 1. Diagnosi (read-only, con riferimenti)

- **Motore — origine del bug:** `BE_Burraco/src/engine/game.ts:283-323` `pinellaSubstitute`. Il difetto è alle righe `309-314`: la logica fa uno **scambio 1:1** (accetta solo se `after.wildCount === before.wildCount - 1`) e poi esegue `this.seats[seat].hand.push(pinellaCard)` → **la matta torna in mano**. È la vecchia semantica, ora dichiarata errata dalla skill.
- **Contratto:** `BE_Burraco/src/contract/types.ts:342` — messaggio `{ type: "pinella_substitute"; meldId: string; cardInHand: string; clientMoveId?: string }`. Non prevede la scelta cima/fondo.
- **Copia FE del contratto:** `FE_Burraco/src/lib/contract.ts` (copia manuale, decisione #8).
- **Codici di rifiuto attuali del motore:** `MELD_NOT_FOUND`, `NOT_MELD_OWNER`, `CARD_NOT_IN_HAND`, `INVALID_MELD`, `NO_PINELLA_TO_SUBSTITUTE`.
- **Test che asseriscono la vecchia semantica:** `BE_Burraco/test/game.test.ts:340-359` ("pinella_substitute: recupera la pinella…", commento a riga 352 "la pinella e' tornata in mano"). → **DA RISCRIVERE.**
- **Test da verificare senza romperli:** `undo.test.ts:111` (l'undo è a snapshot: dovrebbe reggere, ma le sue asserzioni sullo stato post-mossa vanno controllate), `engine.test.ts`, `meld.allwilds.test.ts`, `game.flow.test.ts`. `security.room.test.ts` (righe 268/286/304) è validazione-messaggio: deve restare verde con il nuovo campo opzionale.

## 2. Nuova meccanica (da skill 76-96)

Quando il giocatore fornisce la carta naturale di cui una matta calata fa le veci:
1. la carta naturale prende il posto occupato dalla matta;
2. **la matta NON torna mai in mano**: resta nel gioco;
3. **SEQUENZE (scale):** la matta si sposta a **cima** o **fondo**, estendendo la sequenza di una posizione. La destinazione è **scelta del giocatore**; se una sola è legale (es. sequenza già all'Asso alto) si usa quella; se **nessuna** è legale → **rifiuto**;
4. **GRUPPI (tris/poker):** niente cima/fondo, la matta resta dentro, il gruppo **cresce di una carta** (tris→poker di 4, di cui una matta);
5. il gioco risultante deve restare **valido**, altrimenti rifiuto e nulla cambia;
6. il numero di carte del gioco **aumenta di 1** → questa mossa può far scattare un **burraco** (transizione 6→7): va emesso l'effetto `burraco_made`. Il gioco resta **SPORCO** (la matta è ancora dentro).

## 3. Casi limite (da coprire nei test)

| Caso | Atteso |
|---|---|
| Sequenza con entrambe le estremità libere, `edge` fornito | matta all'estremità scelta, sequenza +1, valida |
| Sequenza già all'Asso alto | solo "fondo" legale; se `edge:"top"` → rifiuto |
| Sequenza satura ad entrambe le estremità | **rifiuto** `PINELLA_NO_LEGAL_POSITION` |
| Entrambe legali ma `edge` mancante | **rifiuto** `PINELLA_EDGE_REQUIRED` |
| Gruppo (tris con matta) | matta resta, diventa poker di 4; `edge` ignorato |
| Transizione 6→7 carte | `burraco_made` emesso; gioco SPORCO |
| Nessuna pinella nel gioco | `NO_PINELLA_TO_SUBSTITUTE` (invariato) |
| Carta non in mano / non è la naturale della pinella | rifiuto come oggi |

## 4. Impatto sul contratto (vincolo P2 — stesso commit BE+FE)

- Aggiungere al messaggio `pinella_substitute` il campo opzionale **`edge?: "top" | "bottom"`** (cima = "top", fondo = "bottom").
- Aggiungere i due codici di rifiuto **`PINELLA_NO_LEGAL_POSITION`** e **`PINELLA_EDGE_REQUIRED`** (se esiste un'unione tipizzata dei codici, aggiornarla su entrambi i lati).
- **Aggiornare `FE_Burraco/src/lib/contract.ts` nello STESSO commit** e dichiararlo nel riepilogo.

## 5. Frontend — controllo minimo (decisione dell'utente)

- Quando, per una sequenza, **entrambe** le estremità sono legali, il FE mostra due controlli **Cima / Fondo** (semplici, funzionali) e invia `edge` di conseguenza. Quando una sola è legale, il FE può inviare senza scelta (o inviare quella legale). Per i gruppi nessun controllo.
- **Niente passaggio di `agente_ui_ux` in questa fase**: la rifinitura estetica è rinviata alla Fase 4 (rilavorazione del tavolo). Il controllo qui deve essere solo corretto e usabile, non curato.

## 6. Definition of Done

- `pinellaSubstitute`: la matta non finisce **mai** in mano; sequenza estesa all'estremità scelta; gruppo +1; rifiuti `PINELLA_NO_LEGAL_POSITION` / `PINELLA_EDGE_REQUIRED` corretti; `burraco_made` emesso sulla transizione 6→7; il gioco resta sporco.
- Contratto `types.ts` e copia `contract.ts` allineati nello stesso commit.
- `game.test.ts` riscritto sulla nuova semantica + nuovi casi limite del §3. Tutti gli altri test **verdi e intoccati**; se un test non dichiarato diventa rosso, **fermarsi e segnalarlo** al lead.
- `npm run typecheck` e `npm run lint` senza errori. Se la toolchain non è disponibile nell'ambiente dell'agente (Node non su PATH), **dichiararlo** invece di darlo per riuscito.
- `git status`: solo i file di questa correzione.

## 7. Output

`OUTPUT PER: agente_test` — verifica indipendente dei casi limite del §3, con attenzione a: matta mai in mano, scelta cima/fondo, gruppo che cresce, i due rifiuti, e il burraco che scatta a 7 carte.
