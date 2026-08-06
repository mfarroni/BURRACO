# BE_Burraco — Backend autoritativo (Render)

Web service Node.js + TypeScript **persistente** (NON serverless) che possiede il
motore di regole del Burraco 2p, lo stato di gioco in RAM e il server WebSocket.
Il frontend è muto sulle regole: invia solo intenzioni, il server valida e
ridistribuisce lo stato **redatto**.

## Stack
- TypeScript, Node ≥ 20
- WebSocket: `ws`
- ORM: Drizzle → PostgreSQL su Neon (endpoint **pooled**)
- Persistenza minimale: solo checkpoint fine mano/partita + log eventi (audit).
  Se `DATABASE_URL` non è impostata, la persistenza si disattiva e il gioco
  resta pienamente funzionante in RAM.

## Struttura
```
src/
  index.ts              # entry: avvia http + ws, gestisce shutdown
  config.ts             # env + config di partita di default (2005, italiana, …)
  contract/types.ts     # CONTRATTO (tipi + eventi WS) — proprietà del backend
  engine/
    cards.ts            # mazzo (108), valori, shuffle
    meld.ts             # solver giochi (gruppi/sequenze, matte, 2 al naturale)
    scoring.ts          # punteggio di fine smazzata
    game.ts             # GameEngine: stato, turni, tutte le mosse
  room/
    Room.ts             # una partita: engine + connessioni + broadcast redatto
    RoomManager.ts      # mappa socket→room, join/reconnect/close
    redact.ts           # ANTI-LEAK: costruisce lo stato pubblico per destinatario
  ws/server.ts          # trasporto ws: parsing, heartbeat, instradamento
  db/
    schema.ts           # tabelle Drizzle (matches, hands, scores, events, checkpoints)
    client.ts           # pool node-postgres + drizzle (o no-op se senza DB)
    persistence.ts      # scritture best-effort, mai bloccanti
```

## Avvio in locale
```bash
cd BE_Burraco
cp .env.example .env            # opzionale: senza DATABASE_URL gira comunque
npm install
npm run dev                     # tsx watch → ws://localhost:8080
```
Health check: `GET http://localhost:8080/health` → `{"status":"ok"}`.

## Variabili d'ambiente
| Nome | Obbligatoria | Default | Note |
|------|-------------|---------|------|
| `PORT` | no | 8080 | Render la inietta |
| `DATABASE_URL` | no | — | Neon **pooled** (`…-pooler.neon.tech`). Assente ⇒ persistenza off |
| `ALLOWED_ORIGINS` | no | `*` | In prod: URL Vercel del FE, separati da virgola |
| `RECONNECT_GRACE_MS` | no | 120000 | Finestra di riconnessione |
| `TURN_TIMEOUT_MS` | no | 90000 | Definito, **non enforced** in v1 |

## Migrazioni DB (Drizzle)
```bash
export DATABASE_URL=postgresql://…-pooler.neon.tech/db?sslmode=require
npm run db:generate    # genera SQL da schema.ts
npm run db:migrate     # applica su Neon
```

## Deploy su Render
- **Root Directory**: `BE_Burraco`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Environment**: imposta `DATABASE_URL` (Neon pooled) e `ALLOWED_ORIGINS`
  (l'URL del FE su Vercel).
- Attenzione al piano free (sleep): chiude le connessioni WS. La logica NON
  dipende dallo sleep, ma per partite live usare un piano always-on.
- Nessuna dipendenza dal frontend: il repository BE è deployabile da solo.
