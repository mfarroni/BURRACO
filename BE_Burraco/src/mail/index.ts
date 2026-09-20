import { sendViaBrevo } from "./brevo.js";
import type { SendEmailInput, SendEmailResult } from "./types.js";

export type { SendEmailInput, SendEmailResult, EmailAddress } from "./types.js";

/**
 * PUNTO UNICO d'invio email del backend (§1.3). Sia il form contatti (§2) sia le
 * comunicazioni webmaster (§5.3) passano di qui: due implementazioni divergerebbero
 * nel comportamento d'errore. Oggi delega a Brevo; domani un cambio di provider
 * tocca SOLO `brevo.ts`, non i chiamanti.
 *
 * Best-effort per contratto: non solleva mai. Ritorna sempre un `SendEmailResult`.
 */
export function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  return sendViaBrevo(input);
}
