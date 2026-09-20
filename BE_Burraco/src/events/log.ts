import { db, schema } from "../db/client.js";

/**
 * FASE 5.4 — Scrittura degli EVENTI APPLICATIVI nostri (`app_events`), l'unica
 * fonte di log che controlliamo. Best-effort come `persistence.ts`: se il DB è
 * assente o l'insert fallisce, si logga su console e si prosegue (mai un crash per
 * un log).
 *
 * REDAZIONE A MONTE (§5.4): `messaggio` e `meta` devono già essere privi di segreti
 * (token, indirizzi completi, header di autorizzazione). La vista non fa altro che
 * mostrare come testo ciò che qui viene scritto: qualsiasi segreto scritto qui
 * finirebbe nella pagina coi privilegi più alti. La redazione NON è delegata al render.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogCategory = "auth" | "contact" | "cleanup" | "broadcast" | "admin" | "system";

export async function logAppEvent(
  livello: LogLevel,
  categoria: LogCategory,
  messaggio: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!db) return;
  try {
    await db.insert(schema.appEvents).values({
      livello,
      categoria,
      messaggio,
      meta: meta ?? null,
    });
  } catch (err) {
    console.error("[app_events] scrittura fallita:", (err as Error).message);
  }
}
