/**
 * Identità di sessione RESILIENTE del client (FE-only, framework-free: nessun
 * import di React, così è testabile in isolamento con storage simulati).
 *
 * PROBLEMA CHE RISOLVE (bug accesso mobile): su Safari mobile in Navigazione
 * privata / con ITP, `localStorage` può lanciare o non persistere. La vecchia
 * implementazione, quando lo storage falliva, rigenerava un clientId NUOVO a
 * ogni connessione: alla riconnessione (le schede in background su mobile
 * vengono sospese) il server non riconosceva più la sessione e apriva slot
 * "fantasma", riempiendo la room e bloccando il secondo giocatore.
 *
 * STRATEGIA: l'identità autorevole vive IN MEMORIA per tutta la vita della
 * scheda e non viene MAI rigenerata a causa di un errore di storage.
 *  - clientId: generato UNA SOLA VOLTA per caricamento pagina, tenuto in una
 *    variabile a livello di modulo. Persistito best-effort su `localStorage`
 *    (continuità cross-refresh, granularità per-browser: va bene che due schede
 *    condividano lo stesso clientId, perché il reclaim lato server vale SOLO su
 *    posti DISCONNESSI — SEC-04 — quindi due schede VIVE ottengono seat distinti).
 *  - token di room: per-scheda su `sessionStorage` (due schede dello stesso
 *    browser non si sovrascrivono; il refresh nella stessa scheda mantiene la
 *    sessione), con fallback IN MEMORIA che sopravvive per la vita della scheda
 *    anche quando `sessionStorage` è indisponibile (Navigazione privata).
 *
 * Ogni accesso a storage è avvolto in try/catch: nessuna eccezione può rompere
 * l'identità o il flusso di join/riconnessione. In caso di errore vince sempre
 * l'in-memory, che è l'unica fonte autorevole garantita per la scheda.
 *
 * NB: nessun package condiviso con il backend; questa è una copia FE del
 * comportamento client, il contratto resta di proprietà del BE.
 */

/** Chiave dell'identità di sessione STABILE per-browser (non per-room). */
const CLIENT_ID_KEY = "burraco_client_id";

/** Chiave del token di AUTENTICAZIONE (account/ospite), per-scheda. */
const AUTH_TOKEN_KEY = "burraco_auth_token";

/** Chiave per-room del token di sessione (per-scheda su sessionStorage). */
function tokenKey(room: string): string {
  return `burraco_token_${room.toUpperCase()}`;
}

/** Genera un id opaco; ripiega su un id non-crypto se `randomUUID` non c'è. */
function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * clientId autorevole per la vita della scheda. Una volta valorizzato NON viene
 * mai rigenerato: è la garanzia di STABILITÀ dell'identità anche se lo storage
 * fallisce (es. Navigazione privata).
 */
let memoryClientId: string | null = null;

/** Fallback in-memory dei token per-room, valido per la vita della scheda. */
const memoryTokens = new Map<string, string>();

/**
 * Ritorna il clientId per-browser, STABILE per l'intero caricamento pagina.
 * All'avvio prova a riusare un id persistito (continuità cross-refresh); se non
 * c'è, ne genera uno e lo fissa in memoria. Persistenza best-effort: un errore
 * di storage NON rigenera l'id — l'in-memory resta autorevole.
 */
export function getClientId(): string {
  if (memoryClientId) return memoryClientId;
  // Best-effort: continuità cross-refresh via localStorage (per-browser).
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) {
      memoryClientId = existing;
      return existing;
    }
  } catch {
    /* storage indisponibile (Safari privata / ITP): si prosegue in-memory */
  }
  const fresh = genId();
  memoryClientId = fresh; // fissato per la vita della scheda: MAI rigenerato
  try {
    localStorage.setItem(CLIENT_ID_KEY, fresh);
  } catch {
    /* scrittura fallita: l'in-memory resta l'unica fonte autorevole */
  }
  return memoryClientId;
}

/**
 * Salva il token di room. Scrive SEMPRE nel fallback in-memory e, best-effort,
 * su `sessionStorage` (per-scheda). Un errore di storage non è fatale: il token
 * corrente sopravvive comunque in memoria per la vita della scheda.
 */
export function saveToken(room: string, token: string): void {
  const key = tokenKey(room);
  memoryTokens.set(key, token);
  try {
    sessionStorage.setItem(key, token);
  } catch {
    /* per-scheda indisponibile: resta il fallback in-memory */
  }
}

/**
 * Legge il token di room. Prova `sessionStorage`; se è indisponibile o vuoto,
 * ripiega sull'in-memory (che ha priorità quando lo storage fallisce).
 */
export function storedToken(room: string): string | undefined {
  const key = tokenKey(room);
  try {
    const v = sessionStorage.getItem(key);
    if (v) return v;
  } catch {
    /* storage indisponibile: usa il fallback in-memory */
  }
  return memoryTokens.get(key);
}

/* ─────────────────────────── token di AUTENTICAZIONE ────────────────────────
 * Token opaco di sessione auth (account/ospite) rilasciato da /auth/*. Stessa
 * strategia resiliente del token di room: autorevole IN MEMORIA per la vita della
 * scheda, persistito best-effort su `sessionStorage` (per-scheda, così due schede
 * dello stesso browser possono avere identità auth distinte e il refresh nella
 * stessa scheda mantiene la sessione). Un errore di storage non è mai fatale.
 *
 * Scelta sessionStorage (non localStorage): il token è un credential; limitarne
 * la persistenza alla scheda riduce la superficie rispetto a una condivisione
 * cross-scheda persistente. In caso di storage indisponibile vince l'in-memory. */
let memoryAuthToken: string | null = null;

/** Legge il token auth: prova sessionStorage, ripiega sull'in-memory. */
export function getAuthToken(): string | null {
  if (memoryAuthToken) return memoryAuthToken;
  try {
    const v = sessionStorage.getItem(AUTH_TOKEN_KEY);
    if (v) {
      memoryAuthToken = v;
      return v;
    }
  } catch {
    /* storage indisponibile: resta null finché non si effettua login */
  }
  return null;
}

/** Salva il token auth (memoria + sessionStorage best-effort). */
export function saveAuthToken(token: string): void {
  memoryAuthToken = token;
  try {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    /* per-scheda indisponibile: resta il fallback in-memory */
  }
}

/** Cancella il token auth (logout): memoria + sessionStorage. */
export function clearAuthToken(): void {
  memoryAuthToken = null;
  try {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* nulla da fare: l'in-memory è già stato azzerato */
  }
}

/** Solo per test: azzera lo stato in-memory tra i casi. Non usato in produzione. */
export function __resetSessionIdentityForTests(): void {
  memoryClientId = null;
  memoryTokens.clear();
  memoryAuthToken = null;
}
