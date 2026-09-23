/**
 * LINK DIRETTO AL TAVOLO `/?tavolo=CODICE` (proposta-donazione-condivisione.md §5, §8).
 *
 * Chi riceve l'invito apre il link: il codice viene letto UNA volta, messo da parte
 * in `sessionStorage` (sopravvive a login/registrazione/ospite nella stessa scheda) e
 * TOLTO subito dalla barra degli indirizzi (`history.replaceState`), così non resta
 * nella cronologia né viaggia nel Referer. In lobby precompila il campo codice:
 * l'ingresso resta MANUALE ("Entra") e validato dal server come oggi.
 *
 * Formato accettato: lettere/cifre, 4–8 caratteri (i codici attuali sono 5, alfabeto
 * senza ambigui). Qualsiasi altro valore è ignorato: niente testo arbitrario in UI.
 */

export const INVITE_PARAM = "tavolo";
const STORAGE_KEY = "circolo.inviteCode";
const CODE_RE = /^[A-Z0-9]{4,8}$/;

export function normalizeInviteCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Percorso d'invito per un tavolo (relativo all'origine). */
export function inviteLinkPath(code: string): string {
  return `/?${INVITE_PARAM}=${encodeURIComponent(code)}`;
}

/**
 * Legge `?tavolo=` dall'URL corrente, lo conserva e lo rimuove dall'indirizzo.
 * Restituisce il codice in attesa (appena letto o già conservato), oppure null.
 */
export function captureInviteCode(): string | null {
  let fromUrl: string | null = null;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has(INVITE_PARAM)) {
      fromUrl = normalizeInviteCode(url.searchParams.get(INVITE_PARAM));
      url.searchParams.delete(INVITE_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // URL/History non disponibili: si prosegue senza invito.
  }
  try {
    if (fromUrl) window.sessionStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl ?? normalizeInviteCode(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return fromUrl;
  }
}

/** Dimentica l'invito (usato una volta mostrato in lobby, o scartato). */
export function clearInviteCode(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nulla da fare.
  }
}
