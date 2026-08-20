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
 * IP del client. Dietro il proxy di Render, `X-Forwarded-For` contiene l'IP reale
 * (il primo elemento). Con `app.set("trust proxy", ...)` Express popola `req.ip`
 * coerentemente; qui ripieghiamo su `req.ip`/socket per robustezza in locale.
 */
function clientKey(req: Request, name: string): string {
  const fwd = req.headers["x-forwarded-for"];
  const ipFromFwd = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0]?.trim();
  const ip = ipFromFwd || req.ip || req.socket.remoteAddress || "unknown";
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
