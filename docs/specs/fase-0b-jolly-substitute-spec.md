# FASE 0b — Generalizzazione della sostituzione della matta ai JOLLY (analista)

> Estende la Fase 0 (commit `39fa1d8`). **Decisione dell'utente:** la sostituzione vale per QUALSIASI matta.
> **Autorità:** `.claude/skills/skill-burraco/SKILL.md` — "matta" = jolly **e** pinella (riga 47); la sezione "SOSTITUZIONE DELLA MATTA" (76-96) usa il termine generico "matta calata".
> **Branch:** `claude/macrociclo-3-2v2`. Nessun commit da parte dell'agente: lo fa il lead al cancello.
> **Ritorno:** `agente_develop` → `agente_test`.

---

## 1. Difetto (preesistente, non introdotto dalla Fase 0)
Il motore consente la sostituzione **solo delle pinelle**: `game.ts` cerca `before.wilds.find(w => w.isPinella)` e altrimenti rifiuta con `NO_PINELLA_TO_SUBSTITUTE` ("*Solo una PINELLA è sostituibile: i jolly non lo sono*"). La skill invece parla di "matta" generica → anche il naturale di un **jolly** deve poter essere fornito, con lo stesso spostamento cima/fondo.

## 2. Regola corretta (da skill)
La sostituzione vale per l'**unica matta** presente nel gioco (skill riga 71: al massimo UNA matta per gioco), sia essa **jolly** o **pinella**. La meccanica è identica a quella già implementata in Fase 0:
- la carta naturale prende il posto della matta;
- la matta **non torna mai in mano**;
- **sequenze:** la matta (jolly o pinella) si sposta a cima/fondo (scelta del giocatore); regole di legalità e rifiuti invariati (`*_NO_LEGAL_POSITION`, `*_EDGE_REQUIRED`);
- **gruppi:** la matta resta dentro, il gruppo cresce di 1;
- il gioco resta **valido** o rifiuto; +1 carta → può scattare burraco 6→7.

**Differenza jolly vs pinella (importante):** l'eccezione "il `2` che atterra nella sua posizione naturale diventa carta naturale → gioco PULITO" vale **solo per la pinella** (un 2 può essere naturale). Un **jolly non è mai una carta naturale**: la sostituzione di un jolly lascia **sempre** il gioco **SPORCO** (il jolly resta una matta dentro il gioco). Non applicare la logica `pinellaIsNaturalTwo` ai jolly.

## 3. Rinomina (decisa dall'utente: messaggio generico)
Poiché la mossa non è più specifica delle pinelle, rinomina in modo generico, in modo consistente su BE, FE e test:
- **Messaggio WS:** `pinella_substitute` → **`wild_substitute`** (mantieni il campo `edge?: "top"|"bottom"` e `clientMoveId?`).
- **Codice di rifiuto:** `NO_PINELLA_TO_SUBSTITUTE` → **`NO_WILD_TO_SUBSTITUTE`**. (I due codici di Fase 0 `PINELLA_NO_LEGAL_POSITION` / `PINELLA_EDGE_REQUIRED` puoi lasciarli così **o** rinominarli `WILD_*` per coerenza: se li rinomini, aggiornali su entrambi i lati del contratto e nei test. Scegli e dichiaralo.)
- **Metodo del motore:** `pinellaSubstitute` → **`wildSubstitute`** (aggiorna tutti i call site, inclusi i test che lo invocano direttamente).
- Nessun alias di retro-compatibilità: il contratto è interno e la copia FE è manuale.

## 4. Contratto (vincolo P2)
Ogni modifica a `contract/types.ts` (rinomina messaggio + reject code) va replicata in `FE_Burraco/src/lib/contract.ts` **nello stesso commit**, verificata campo per campo. Aggiorna anche `ws/validate.ts` (schema zod: la chiave del messaggio) e il dispatch in `Room.ts`. Sul FE aggiorna `useGameSocket.ts`, `rejectMessages.ts` (testo IT del nuovo codice) e `app/page.tsx`.

## 5. Test
- **Aggiungi** i casi jolly: sequenza con jolly → cima/fondo; gruppo con jolly → cresce; jolly che **resta sporco** anche se atterra su un rank che per una pinella sarebbe "naturale" (verifica esplicita che il jolly NON rende pulito il gioco); `NO_WILD_TO_SUBSTITUTE` quando non c'è alcuna matta.
- **Conserva** tutti i casi pinella di Fase 0 (compreso il 2-naturale→pulito): devono restare verdi, adattati **solo** alla rinomina (metodo/messaggio), non nella semantica.
- **Aggiorna per rinomina** i riferimenti in `security.room.test.ts` (usa la stringa `pinella_substitute`): è un cambiamento dovuto alla rinomina del contratto, dichiaralo. Ogni altro test resta verde e intoccato; se uno non dichiarato diventa rosso, **fermati e segnalalo**.

## 6. Definition of Done
- Un **jolly** è sostituibile esattamente come una pinella (sequenza cima/fondo, gruppo, rifiuti, burraco 6→7), e lascia **sempre** il gioco sporco.
- Il comportamento **pinella** è invariato, inclusa l'eccezione 2-naturale→pulito.
- Rinomina `wild_substitute` / `NO_WILD_TO_SUBSTITUTE` / `wildSubstitute` consistente su BE + FE + test; contratto allineato nello stesso commit.
- Suite verde (i soli test cambiati sono quelli della rinomina + i nuovi casi jolly, dichiarati). `npm run typecheck` e `next lint` senza errori.
- `git status`: solo i file di questa modifica.

## 7. Output
`OUTPUT PER: agente_test` — verifica indipendente: jolly sostituibile in sequenza/gruppo, jolly che resta sporco, rinomina completa e contratto FE/BE allineato, casi pinella di Fase 0 ancora verdi.
