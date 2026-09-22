import { pool } from "../db/client.js";
import type { Light, StatusCheckResponse } from "./types.js";

/**
 * CICLO Pannello Admin — semaforo di monitoraggio ON-DEMAND (§2.2). Nessun polling:
 * gira solo su richiesta ("Aggiorna adesso"). Binario (verde/rosso), sempre con testo.
 *
 *  - FE: verde per definizione (se il pannello chiama, il frontend è caricato).
 *  - BE: verde perché questo handler sta rispondendo (se il BE fosse giù, la fetch
 *        fallirebbe e il FE renderebbe BE rosso da sé).
 *  - DB: verde se un `SELECT 1` (leggero, non pg_stat_*) torna entro il timeout.
 */

/** Tempo massimo del controllo DB (§2.2): oltre → rosso con testo di timeout. */
const DB_CHECK_TIMEOUT_MS = 60_000;

/** Race con un timer: rigetta con "TIMEOUT" se `p` non risolve entro `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function runStatusCheck(): Promise<StatusCheckResponse> {
  const checkedAt = Date.now();
  const beDetail = "Backend raggiungibile: la richiesta di controllo ha ricevuto risposta.";

  let db: Light = "red";
  let dbDetail: string;

  if (!pool) {
    dbDetail = "Database non configurato (DATABASE_URL assente): controllo non applicabile.";
  } else {
    try {
      await withTimeout(pool.query("SELECT 1"), DB_CHECK_TIMEOUT_MS);
      db = "green";
      dbDetail = "SELECT 1 eseguita entro il tempo previsto.";
    } catch (err) {
      db = "red";
      dbDetail =
        err instanceof Error && err.message === "TIMEOUT"
          ? "Timeout: il database non ha risposto entro 60 secondi."
          : "Il database non ha risposto (errore di connessione).";
    }
  }

  return { fe: "green", be: "green", db, checkedAt, detail: { be: beDetail, db: dbDetail } };
}
