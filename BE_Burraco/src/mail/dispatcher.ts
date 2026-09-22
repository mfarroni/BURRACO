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
 *
 * SEC-ADM-01 (re-entrancy): lo scheduler è un `setInterval` fisso (ogni 60s) che NON
 * attende il tick precedente. Se un tick sfora l'intervallo (ogni `sendEmail` può
 * arrivare a ~9s tra timeout e retry; batch da 40 → oltre 60s), il timer farebbe
 * partire un secondo tick in parallelo: due runner leggerebbero lo stesso `remaining`
 * e drenerebbero gli stessi record → stessa email inviata due volte e sforo del cap
 * locale. La guardia di modulo `dispatching` garantisce UN SOLO tick per volta su
 * questa istanza (single-instance, cfr. nota di deploy): il tick successivo esce subito
 * se ne trova uno in corso. Il reset vive nel `finally`, così vale anche in caso di
 * errore. NB: assunzione single-instance; per >1 processo servirebbe un lock
 * distribuito / `FOR UPDATE SKIP LOCKED` (rinviato, cfr. R4).
 */
let dispatching = false;

export async function runEmailDispatch(): Promise<{ welcomeSent: number; broadcastSent: number }> {
  const none = { welcomeSent: 0, broadcastSent: 0 };
  if (!db) return none;
  // Interruttore spento: le code restano intatte (le righe ripartono quando riacceso).
  if (!env.mail.enabled) return none;
  // SEC-ADM-01: un tick è già in corso → salta questo (nessuna sovrapposizione).
  if (dispatching) return none;
  dispatching = true;
  try {
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
  } finally {
    dispatching = false;
  }
}
