import argon2 from "argon2";

/**
 * Hashing password con argon2id (decisione C del PIANO).
 *
 * Perché argon2id: è la scelta OWASP raccomandata per l'hashing di password,
 * resistente sia agli attacchi GPU sia a quelli side-channel (ibrido i+d).
 * La libreria `argon2` espone binding nativi con parametri di default robusti
 * (memoryCost/timeCost/parallelism) e salt casuale per hash; l'hash prodotto è
 * self-describing (`$argon2id$v=19$m=...$...`), quindi non serve gestire il salt
 * a parte. In caso di problemi di build native, il PIANO ammette bcrypt: qui
 * argon2 compila e verifica correttamente, quindi restiamo su argon2id.
 */

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/**
 * Verifica una password contro l'hash. NON lancia: un hash malformato o un
 * errore interno del verificatore ritornano `false` (nessun oracolo, nessuna
 * eccezione che risalga fino all'handler HTTP).
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Hash "civetta" per equalizzare i TEMPI del login (difesa contro timing oracle):
 * quando l'email non esiste (o l'utente è un ospite senza hash) il servizio
 * esegue comunque una verifica argon2id fittizia, così la durata della risposta
 * non rivela se l'email è registrata. Calcolato UNA volta e memoizzato.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = argon2.hash("dummy-password-for-timing-equalization", { type: argon2.argon2id });
  return dummyHash;
}

/** Esegue una verifica fittizia (esito ignorato): serve solo a bruciare tempo CPU. */
export async function verifyDummy(plain: string): Promise<void> {
  try {
    await argon2.verify(await getDummyHash(), plain);
  } catch {
    /* esito irrilevante: l'unico scopo è equalizzare i tempi */
  }
}
