import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { RoomManager } from "../room/RoomManager.js";
import { env } from "../config.js";
import { parseClientMessage } from "./validate.js";

/**
 * Layer di trasporto WebSocket (lib `ws`). NESSUNA logica di regole qui: solo
 * hardening del bordo (dimensione payload, rate limiting, validazione di forma),
 * heartbeat/liveness e instradamento al RoomManager.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;

/** SEC-02: tetto massimo di un singolo frame WS (payload oversize → 1009). */
const MAX_PAYLOAD_BYTES = 16 * 1024;

/** SEC-01: parametri del token-bucket per-socket sui messaggi. */
const BUCKET_CAPACITY = 30; // burst massimo
const BUCKET_REFILL_PER_SEC = 15; // regime a lungo termine (~15 msg/s)
/** Oltre questo numero di messaggi consecutivi scartati, si chiude il socket. */
const MAX_CONSECUTIVE_DROPS = 200;

/**
 * Token-bucket minimale per limitare la frequenza dei messaggi di UNA
 * connessione. Non alloca timer: si ricarica su base temporale a ogni `take()`.
 */
class TokenBucket {
  private tokens = BUCKET_CAPACITY;
  private last = Date.now();
  drops = 0;

  take(): boolean {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(BUCKET_CAPACITY, this.tokens + elapsed * BUCKET_REFILL_PER_SEC);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.drops = 0;
      return true;
    }
    this.drops += 1;
    return false;
  }
}

interface LiveSocket extends WebSocket {
  isAlive?: boolean;
  bucket?: TokenBucket;
}

/**
 * SEC-09: policy origin fail-closed in produzione.
 *  - prod: allowlist esplicita obbligatoria; mai "*"; origin mancante = rifiuto.
 *  - dev: permissivo (consente "*" e client non-browser senza origin).
 */
function originAllowed(origin: string | undefined): boolean {
  const list = env.allowedOrigins;
  if (env.isProd) {
    if (list.length === 0 || list.includes("*")) return false; // misconfig → fail-closed
    if (!origin) return false; // in prod un origin mancante non è "consentito"
    return list.includes(origin);
  }
  // Sviluppo locale: comportamento permissivo per test/curl.
  if (list.includes("*")) return true;
  if (!origin) return true;
  return list.includes(origin);
}

export function createServer(): http.Server {
  const manager = new RoomManager();

  const httpServer = http.createServer((req, res) => {
    // Health check per Render (e per il warm-up dal FE).
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "be-burraco" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // SEC-02: `maxPayload` fa sì che `ws` rifiuti (1009) e non bufferizzi né
  // consegni frame oltre il limite: nessun parse di payload oversize.
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });

  wss.on("connection", (ws: LiveSocket, req) => {
    if (!originAllowed(req.headers.origin)) {
      ws.close(1008, "Origin non consentita.");
      return;
    }

    ws.isAlive = true;
    ws.bucket = new TokenBucket();
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data) => {
      // SEC-01: rate limiting per-socket. I messaggi oltre soglia vengono
      // SCARTATI senza risposta (nessun reply-per-messaggio) e, se l'abuso
      // persiste, il socket viene chiuso.
      if (ws.bucket && !ws.bucket.take()) {
        if (ws.bucket.drops > MAX_CONSECUTIVE_DROPS) ws.close(1008, "Rate limit superato.");
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "JSON non valido." }));
        return;
      }

      // SEC-07: validazione di forma PRIMA del motore. Nessuna eccezione interna.
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        ws.send(
          JSON.stringify({ type: "move_rejected", code: "MALFORMED", reason: "Messaggio malformato." }),
        );
        return;
      }

      try {
        manager.handleMessage(ws, parsed.msg);
      } catch (err) {
        console.error("[ws] errore gestione messaggio:", (err as Error).message);
        ws.send(JSON.stringify({ type: "error", message: "Errore interno del server." }));
      }
    });

    ws.on("close", () => manager.handleClose(ws));
    ws.on("error", () => manager.handleClose(ws));
  });

  // Heartbeat: individua e chiude le connessioni morte (base per il timeout).
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const live = client as LiveSocket;
      if (live.isAlive === false) {
        live.terminate();
        continue;
      }
      live.isAlive = false;
      live.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Non tenere vivo il processo solo per l'heartbeat.
  heartbeat.unref?.();

  // A4: ferma l'intervallo sia alla chiusura del WSS sia dell'http server, così
  // lo shutdown termina pulito senza handle attivi che impediscano l'uscita.
  const stopHeartbeat = () => clearInterval(heartbeat);
  wss.on("close", stopHeartbeat);
  httpServer.on("close", stopHeartbeat);

  return httpServer;
}
