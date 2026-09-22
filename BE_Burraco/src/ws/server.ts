import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { RoomManager } from "../room/RoomManager.js";
import { env } from "../config.js";
import { parseClientMessage } from "./validate.js";
import { isOriginAllowed } from "../net/originPolicy.js";
import { AuthService } from "../auth/service.js";
import { createAuthStore } from "../auth/store.js";
import { createStatsStore } from "../stats/store.js";
import { createHttpApp } from "../http/app.js";
import type { StatsStore } from "../stats/types.js";
import { db } from "../db/client.js";
import { reconcileTotals } from "../stats/totals.js";
import { runRetentionSweep } from "../retention/service.js";
import { runEmailDispatch } from "../mail/dispatcher.js";

/**
 * Layer di trasporto WebSocket (lib `ws`). NESSUNA logica di regole qui: solo
 * hardening del bordo (dimensione payload, rate limiting, validazione di forma),
 * heartbeat/liveness e instradamento al RoomManager.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * SEC-A3b: intervallo dello sweep di manutenzione auth (pruning sessioni
 * scadute/revocate + ospiti inattivi). 6h è un compromesso tra prontezza e costo:
 * i dati potati sono comunque inerti (token già inutilizzabili), quindi non serve
 * frequenza alta. Coerente v1 single-instance (nessun coordinamento multi-istanza).
 */
const AUTH_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * FASE 4 — cadenza dei job di manutenzione dati. La riconciliazione dei totali e il
 * giro di retention (dry-run di default) sono operazioni pesanti e non urgenti: 24h
 * è ampiamente sufficiente. Aggancio allo stesso pattern setInterval().unref().
 */
const DATA_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * FASE 5.3 / Ciclo Pannello Admin — cadenza del DISPATCHER email quota-aware. Un tick
 * svuota PRIMA la coda transazionale (email_queue, priorità benvenuto) e POI i
 * broadcast (broadcast_recipients), entrambi entro la quota giornaliera residua Brevo
 * (BREVO_DAILY_CAP). Mai in linea con la risposta HTTP. Con code vuote è un no-op
 * leggero; con quota esaurita esce subito (carry-over: gli item restano in coda).
 */
const EMAIL_DISPATCH_INTERVAL_MS = 60 * 1000;

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
 * SEC-09: policy origin fail-closed condivisa (WS + CORS). Vedi net/originPolicy.
 */
function originAllowed(origin: string | undefined): boolean {
  return isOriginAllowed(origin);
}

/**
 * Opzioni di composizione del server. In produzione (`index.ts`) si passano un
 * AuthService reale e `requireAuthOnJoin=true`; i test possono iniettare uno
 * store in-memory o disattivare il gating per esercitare la sola meccanica room.
 */
export interface CreateServerOptions {
  authService?: AuthService;
  requireAuthOnJoin?: boolean;
  /** StatsStore per gli endpoint /users/me/* (macro-ciclo 3). Default: factory su DATABASE_URL. */
  statsStore?: StatsStore;
}

export function createServer(opts: CreateServerOptions = {}): http.Server {
  // AuthService: iniettato dai test o costruito qui (store Neon/in-memory secondo
  // DATABASE_URL). È l'unica autorità su registrazione/sessioni.
  const authService = opts.authService ?? new AuthService(createAuthStore(), { sessionTtlMs: env.sessionTtlMs });
  const requireAuthOnJoin = opts.requireAuthOnJoin ?? env.requireAuthOnJoin;

  const manager = new RoomManager({ authService, requireAuth: requireAuthOnJoin });

  // StatsStore: Drizzle/Neon con DATABASE_URL, altrimenti in-memory (macro-ciclo 3).
  const statsStore = opts.statsStore ?? createStatsStore();

  // App Express: /health + /auth/* + /users/me/* (stats/storico) + /tables* e
  // /session/leave (lobby) con CORS allowlist, rate-limit e validazione zod. Vive
  // sullo STESSO http.Server del WS. Il RoomManager è wire-ato così le rotte lobby
  // leggono lo stato in RAM (la lista è solo informativa: l'avvio partita è via WS).
  const app = createHttpApp(authService, statsStore, manager);
  const httpServer = http.createServer(app);

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

  // SEC-A3b: sweep periodico di manutenzione auth. Best-effort e non bloccante:
  // un errore viene loggato ma non propaga (nessun impatto sul gioco). `unref` per
  // non tenere vivo il processo solo per lo sweep.
  const authSweep = setInterval(() => {
    authService
      .runMaintenance()
      .then(({ sessions, guests }) => {
        if (sessions > 0 || guests > 0) {
          console.log(`[auth] pruning: sessioni=${sessions}, ospiti=${guests}`);
        }
      })
      .catch((err) => console.error("[auth] pruning fallito:", (err as Error).message));
  }, AUTH_SWEEP_INTERVAL_MS);
  authSweep.unref?.();

  // FASE 4: manutenzione dati (solo con DB attivo). Riconciliazione dei totali
  // (rete di sicurezza contro derive del consolidamento incrementale) + giro di
  // retention. La retention gira in DRY-RUN salvo RETENTION_MODE="live" (§4.4:
  // nessuna cancellazione reale prima di una simulazione mostrata al lead), e
  // l'anonimizzazione di account registrati resta comunque solo-detection (Gate 4).
  const dataMaintenance = setInterval(() => {
    if (!db) return;
    reconcileTotals(db)
      .then(({ users, matches }) => {
        if (matches > 0) console.log(`[stats] riconciliazione totali: utenti=${users}, partite=${matches}`);
      })
      .catch((err) => console.error("[stats] riconciliazione fallita:", (err as Error).message));
    runRetentionSweep()
      .then((reports) => {
        const summary = reports.map((r) => `${r.step}=${r.dryRun ? r.matched : r.removed}`).join(" ");
        if (summary) console.log(`[retention] sweep: ${summary}`);
      })
      .catch((err) => console.error("[retention] sweep fallito:", (err as Error).message));
  }, DATA_MAINTENANCE_INTERVAL_MS);
  dataMaintenance.unref?.();

  // Ciclo Pannello Admin: DISPATCHER email quota-aware (solo con DB). Un tick per
  // volta, best-effort: transazionali (benvenuto) prima, broadcast poi, entro la quota.
  const emailDispatcher = setInterval(() => {
    if (!db) return;
    runEmailDispatch()
      .then(({ welcomeSent, broadcastSent }) => {
        if (welcomeSent > 0 || broadcastSent > 0) {
          console.log(`[mail] dispatch: benvenuto=${welcomeSent}, broadcast=${broadcastSent}`);
        }
      })
      .catch((err) => console.error("[mail] dispatch fallito:", (err as Error).message));
  }, EMAIL_DISPATCH_INTERVAL_MS);
  emailDispatcher.unref?.();

  // A4: ferma gli intervalli sia alla chiusura del WSS sia dell'http server, così
  // lo shutdown termina pulito senza handle attivi che impediscano l'uscita.
  const stopTimers = () => {
    clearInterval(heartbeat);
    clearInterval(authSweep);
    clearInterval(dataMaintenance);
    clearInterval(emailDispatcher);
  };
  wss.on("close", stopTimers);
  httpServer.on("close", stopTimers);

  return httpServer;
}
