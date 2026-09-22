import type { Request, Response, NextFunction } from "express";

/**
 * Rate limiter IN-MEMORY per gli endpoint auth sensibili (login/register/guest).
 * Coerente con la scelta v1 single-instance (stato in RAM, nessun Redis): un
 * contatore a FINESTRA FISSA per chiave (IP + nome del limiter). Non introduce
 * dipendenze native né coordinamento multi-istanza.
 *
 * Difesa in profondità: protegge da brute-force sulle credenziali e da creazione
 * massiva di ospiti. NON è l'unico controllo (le password sono argon2id e gli
 * errori di login sono generici), ma alza il costo dell'abuso.
 *
 * Nessun segreto transita qui: la chiave è derivata solo dall'IP del client.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Ampiezza della finestra in ms. */
  windowMs: number;
  /** Numero massimo di richieste per finestra e per chiave. */
  max: number;
  /** Etichetta del limiter (namespacing della chiave: limiter diversi non si sommano). */
  name: string;
}

/**
 * Chiave del rate-limiter = IP reale del client + nome del limiter.
 *
 * SEC-A1: NON leggiamo `X-Forwarded-For` a mano. Il PRIMO elemento di quell'header
 * è controllato dal client e ruotarlo a ogni richiesta creerebbe un bucket nuovo
 * ogni volta, annullando il rate-limit. Con `app.set("trust proxy", 1)` (impostato
 * in createHttpApp) Express calcola `req.ip` fidandosi di UN solo hop (il proxy di
 * Render, che riscrive XFF): `req.ip` è quindi l'IP reale a valle del proxy e NON
 * è falsificabile dal client. Usiamo esclusivamente `req.ip`.
 *
 * Fallback prudente solo se `req.ip` fosse undefined (es. contesti senza socket):
 * si ripiega sull'IP del socket, mai sull'header controllabile dal client.
 */
function clientKey(req: Request, name: string): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return `${name}:${ip}`;
}

export function rateLimit(opts: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  // GC periodico dei bucket scaduti per evitare crescita illimitata della mappa.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }, opts.windowMs);
  sweep.unref?.();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = clientKey(req, opts.name);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    if (bucket.count >= opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: "RATE_LIMITED", message: "Troppe richieste, riprova più tardi." });
      return;
    }

    bucket.count += 1;
    next();
  };
}

/**
 * CICLO Pannello Admin — rate limiter a FINESTRA FISSA con CHIAVE ESPLICITA (non l'IP).
 * Serve dove la chiave dev'essere l'identità già autenticata (es. l'id dell'admin per
 * `POST /admin/broadcasts/:id/send`, 10/30s), che è nota SOLO dopo `requireAdmin`, cioè
 * dentro l'handler e non in un middleware pre-routing. Stessa struttura in-RAM del
 * `rateLimit()` classico (v1 single-instance, nessun Redis). Nessun segreto memorizzato:
 * la chiave è un id opaco fornito dal chiamante.
 */
export function createKeyedRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }, opts.windowMs);
  sweep.unref?.();

  return {
    /**
     * Registra un tentativo per `key`. Ritorna `{ limited:false }` se ammesso, oppure
     * `{ limited:true, retryAfterSec }` se la finestra è satura (nessun incremento in
     * quel caso: la finestra non si estende oltre `resetAt`).
     */
    hit(key: string): { limited: boolean; retryAfterSec: number } {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
        return { limited: false, retryAfterSec: 0 };
      }
      if (bucket.count >= opts.max) {
        return { limited: true, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
      }
      bucket.count += 1;
      return { limited: false, retryAfterSec: 0 };
    },
  };
}
