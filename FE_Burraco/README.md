# FE_Burraco — Frontend (Vercel)

App Next.js/React (App Router) del Burraco 2p. **Client muto sulle regole**:
nessun motore di gioco, nessuna validazione locale. Invia intenzioni via
WebSocket e riflette lo stato **redatto** ricevuto dal server autoritativo.

Questa è la versione **essenziale** dal punto di vista grafico: la direzione
artistica e gli stati visivi definitivi sono in co-design con agente_ui_ux.

## Struttura
```
src/
  app/
    layout.tsx          # shell HTML
    page.tsx            # orchestratore: lobby / attesa / partita
    globals.css         # stile essenziale e neutro (hook via className/data-*)
  lib/
    contract.ts         # COPIA allineata a mano del contratto BE (no import dal BE)
    useGameSocket.ts    # hook: connessione WS, stato client, "attendo conferma", reconnect
  components/
    CardView.tsx        # una carta (selezionabile)
    Melds.tsx           # giochi in tavola, per proprietario
    ActionBar.tsx       # pulsanti azione (gating banale turno/fase, NON regole)
    Overlays.tsx        # toast rifiuto, badge attesa, fine mano, fine partita
```

## Avvio in locale
```bash
cd FE_Burraco
cp .env.example .env.local      # NEXT_PUBLIC_WS_URL=ws://localhost:8080
npm install
npm run dev                     # http://localhost:3000
```
Serve il backend attivo (vedi `BE_Burraco`). Apri due schede con lo stesso
codice room per giocare 1v1.

## Variabili d'ambiente
| Nome | Obbligatoria | Default | Note |
|------|-------------|---------|------|
| `NEXT_PUBLIC_WS_URL` | sì (in prod) | `ws://localhost:8080` | In prod: `wss://<servizio>.onrender.com` |

## Deploy su Vercel
- **Root Directory**: `FE_Burraco`
- **Framework preset**: Next.js (build `next build`, output gestito da Vercel)
- **Environment**: `NEXT_PUBLIC_WS_URL = wss://<tuo-backend>.onrender.com`
- Vercel ospita SOLO il frontend: nessuna logica WebSocket qui (decisione #1).
- Nessuna dipendenza dal backend a livello di codice: il repository FE è
  deployabile da solo. La sincronizzazione col contratto avviene aggiornando a
  mano `src/lib/contract.ts`.
