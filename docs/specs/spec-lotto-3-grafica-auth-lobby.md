# Spec Lotto 3 — Sfondo "tavolo verde" per accesso / registrazione / lobby (R5)

> **Branch:** `claude/grafica-auth-lobby`. **Solo FE** (`globals.css`, eventuale asset in
> `public/images/`). Nessun contratto, nessuna migrazione. Verifica su URL di deploy Vercel.
> **Dipendenze:** indipendente (fuori dal tavolo di gioco; nessuna interferenza con i Lotti 1-2).

---

## Stato attuale
- Il fondo app è **già** feltro verde: `body { background-color: var(--felt-900) }`
  (`globals.css:159-172`).
- I pannelli auth/lobby/profilo sono **card** con classe base `.lobby` (`:331-336`, sfondo
  `linear-gradient(--surface-raised, --surface)`), su cui si vede il feltro attorno.
- Mappa delle viste (`app/page.tsx`):
  | Stato | Render | Classe contenitore | R5? |
  |---|---|---|---|
  | `initializing` (splash) | `<div className="lobby">` (`:173`) | `.lobby` nuda | no (transitorio) |
  | `anonymous` + AuthPanel | `<AuthPanel>` (`:189`) | `.lobby.auth-panel` (`AuthPanel.tsx:99`) | **sì** (login+registrazione) |
  | `anonymous` landing | `<Landing>` | `.landing-root` | no (resta legno) |
  | profilo | `<ProfilePanel>` (`:202`) | `.lobby.profile-panel` (`ProfilePanel.tsx:158`) | **NO — escluso** |
  | lobby | `<div className="lobby lobby-wide">` (`:210`) | `.lobby-wide` | **sì** |

## ⚠️ Rischio numero uno — regressione del profilo
La classe base `.lobby` è **condivisa** anche dal `ProfilePanel` (`.lobby.profile-panel`). Una
regola `.lobby { background: verde }` **colerebbe nel profilo**, che R5 vuole **identico a prima**.

**Regola vincolante:** lo sfondo verde va applicato **solo** ai selettori delle due schermate target
e **mai** a `.lobby` nuda:
- `.auth-panel` (login/registrazione);
- `.lobby-wide` (lobby autenticata).
- **Esplicitamente escludere** `.profile-panel` e lo splash `.lobby` (initializing).

## Requisiti visivi
- Armonizzare con il design system e l'estetica "sala da torneo, non casinò". Usare i token feltro
  esistenti (`--felt-900/800/700/600`) e/o un gradiente CSS, coerente con la landing.
- **Texture (se serve):** self-hostata in `FE_Burraco/public/images/` (vincolo CSP `img-src 'self'`,
  `next.config.mjs`). In alternativa **gradiente CSS senza asset** (preferibile: zero rischi CSP,
  zero peso). Se si aggiunge un'immagine, nomi minuscoli senza spazi e verifica `git ls-files`.
- **Contrasto WCAG AA reale** su tutti i testi sovrapposti al nuovo sfondo: verificare i rapporti,
  non assumerli. I testi chiari esistenti (`--text-strong #f3eedf`, `--text #e6e2d3`,
  `--text-muted #b9c6bc`) sono annotati ≥8:1 su `--felt-900`: un verde **scuro** (famiglia
  `--felt-900/800`) mantiene l'AA; un verde **medio** (`--felt-600` e più chiaro) sotto testo chiaro
  **non** lo garantisce → evitare o scurire. Verificare in particolare label, placeholder degli input
  e testo secondario/muted.
- I campi input (`.lobby input`, `:367-378`) e i pulsanti devono restare leggibili sul nuovo fondo
  (bordi/contrasto sufficiente); se il fondo scurisce, controllare il focus ring (`--brass-300`).

## Whitelist
- `FE_Burraco/src/app/globals.css` — regole di sfondo scoping su `.auth-panel` e `.lobby-wide`
  (e loro sotto-elementi se serve leggibilità); eventuali nuovi token feltro locali.
- `FE_Burraco/public/images/` — solo se si sceglie una texture self-hostata (PNG/့SVG minuscolo).

## Blacklist
- `FE_Burraco/next.config.mjs` (CSP) — **non si tocca** (nessun asset esterno, nessun allentamento).
- `.profile-panel`, `.lobby` nuda (splash), `.landing-root` e ogni regola del **tavolo di gioco**:
  nessuna deriva stilistica oltre le tre schermate target.
- Contratto, TSX di logica, componenti (la modifica è CSS; se serve una classe extra sul wrapper
  lobby, è ammessa in `page.tsx`/`Lobby.tsx` ma senza cambiare struttura/logica).

## Responsive & accessibilità
- **375px:** lo sfondo (gradiente o texture) non deve introdurre scroll orizzontale né degradare la
  leggibilità dei form; i pannelli restano centrati e leggibili.
- Contrasto AA verificato a tutte le larghezze; focus visibile mantenuto; nessuna informazione
  affidata al solo colore (qui non pertinente: è sfondo decorativo).

## Criteri di accettazione (verificabili su deploy)
1. Login e registrazione (AuthPanel, entrambi i modi) mostrano il nuovo sfondo verde-tavolo.
2. La lobby autenticata mostra lo stesso sfondo verde-tavolo.
3. **Non-regressione:** il **pannello profilo** e il **tavolo di gioco** appaiono **identici a
   prima** (controllo visivo before/after) — è la prova che il CSS è circoscritto.
4. La **landing** resta invariata (estetica legno).
5. Contrasto AA verificato sui testi sovrapposti (label, input, muted): rapporti reali ≥ 4.5:1
   (testo normale) / 3:1 (testo grande).
6. Nessuna violazione CSP in console, nessun 404 in Network (se è stata aggiunta una texture, è
   servita da `'self'`). `next lint`/`typecheck` verdi (o toolchain dichiarata assente).
