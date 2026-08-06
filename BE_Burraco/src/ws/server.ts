import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage } from "../contract/types.js";
import { RoomManager } from "../room/RoomManager.js";
import { env } from "../config.js";

/**
 * Layer di trasporto WebSocket (lib `ws`). NESSUNA logica di regole qui: solo
 * parsing dei messaggi, heartbeat/liveness e instradamento al RoomManager.
 */

interface LiveSocket extends WebSocket {
  isAlive?: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

function originAllowed(origin: string | undefined): boolean {
  if (env.allowedOrigins.includes("*")) return true;
  if (!origin) return true; // client non-browser (test, curl)
  return env.allowedOrigins.includes(origin);
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

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: LiveSocket, req) => {
    if (!originAllowed(req.headers.origin)) {
      ws.close(1008, "Origin non consentita.");
      return;
    }

    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "JSON non valido." }));
        return;
      }
      if (!msg || typeof (msg as { type?: unknown }).type !== "string") {
        ws.send(JSON.stringify({ type: "move_rejected", code: "MALFORMED", reason: "Messaggio malformato." }));
        return;
      }
      try {
        manager.handleMessage(ws, msg);
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

  wss.on("close", () => clearInterval(heartbeat));

  return httpServer;
}
