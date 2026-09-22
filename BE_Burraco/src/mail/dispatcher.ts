import { db } from "../db/client.js";
import { env } from "../config.js";
import { getQuotaStatus, processEmailQueue } from "./queue.js";
import { processPendingBroadcasts } from "../broadcast/service.js";

/**
 * CICLO Pannello Admin — DISPATCHER UNICO delle email (§1.3). Un solo tick coordina
 * i due percorsi che condividono la quota giornaliera Brevo:
 *  1) la coda transazionale `email_queue` (priorità: benvenuto prima di tutto);
 *  2) i broadcast `broadcast_recipients` (dopo, con il residuo di quota).
 *
 * Regole:
 *  - `remaining = CAP − inviato_oggi`. Se ≤ 0 → nulla oggi (stop).
 *  - le transazionali drenano PER PRIME (priorità benvenuto>broadcast).
 *  - i broadcast usano SOLO il residuo dopo le transazionali.
 *  - su quota esaurita a metà (429 Brevo) → stop per oggi; gli item restano in coda e
 *    ripartono l'indomani (carry-over, decisione D1). Mai perdita silenziosa.
 *  - `BREVO_ENABLED=false` → no-op: le code restano popolate, nessun errore.
 *
 * Agganciato allo scheduler `ws/server.ts` (setInterval().unref()). Best-effort.
 */
export async function runEmailDispatch(): Promise<{ welcomeSent: number; broadcastSent: number }> {
  const none = { welcomeSent: 0, broadcastSent: 0 };
  if (!db) return none;
  // Interruttore spento: le code restano intatte (le righe ripartono quando riacceso).
  if (!env.mail.enabled) return none;

  const { remaining } = await getQuotaStatus();
  if (remaining <= 0) return none; // quota del giorno esaurita: nulla da inviare oggi

  // 1) Coda transazionale (priorità). Consuma parte del residuo.
  const q = await processEmailQueue(remaining);
  const afterQueue = remaining - q.sent;
  if (q.quotaHit || afterQueue <= 0) {
    return { welcomeSent: q.sent, broadcastSent: 0 };
  }

  // 2) Broadcast entro il residuo. Anche l'housekeeping (promozione a 'completato' dei
  //    broadcast senza pendenti) vive nel worker: gli passiamo il budget residuo.
  const b = await processPendingBroadcasts(afterQueue);
  return { welcomeSent: q.sent, broadcastSent: b.sent };
}
