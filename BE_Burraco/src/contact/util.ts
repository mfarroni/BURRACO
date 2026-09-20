import { createHash } from "node:crypto";
import { env } from "../config.js";

/**
 * Utilità del form contatti: anti-injection di header e hashing dell'IP.
 */

/**
 * ANTI-INJECTION DI INTESTAZIONI (§2.3): rimuove newline e caratteri di controllo
 * dai valori che entrano in campi strutturati dell'email (oggetto interno, nome,
 * reply-to). Un `\r`/`\n` in un header consentirebbe di iniettare intestazioni
 * arbitrarie. Applicato SEMPRE lato server, mai delegato al client.
 */
export function stripHeaderInjection(value: string): string {
  // Sostituisce ogni carattere di controllo (CR/LF/TAB/NUL/…) con uno spazio.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]+/g, " ").trim();
}

/**
 * `sha256(ip + salt)`: nel DB non finisce mai l'IP in chiaro (§2.3). Il sale
 * (config, da env) rende più costoso un attacco a dizionario sullo spazio IP.
 */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}|${env.ipHashSalt}`).digest("hex");
}
