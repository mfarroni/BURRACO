import { randomBytes, createHash } from "node:crypto";

/**
 * Token di sessione OPACO ad alta entropia (decisione B del PIANO).
 *
 * - `generateSessionToken`: 32 byte casuali (256 bit) in base64url → stringa di
 *   ~43 caratteri url-safe. Non è un JWT: non contiene claim, è un puntatore
 *   opaco a una riga di `sessions`. Solo il client lo detiene in chiaro.
 * - `hashToken`: nel DB si salva SOLO lo sha256 del token. Un dump del DB non
 *   rivela i token utilizzabili (come per le password, mai il segreto in chiaro).
 *   sha256 è adeguato qui perché il token ha già 256 bit di entropia: non serve
 *   un KDF lento (a differenza delle password, che sono a bassa entropia).
 */

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
