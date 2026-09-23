/**
 * TETTO DI FREQUENZA del blocco "Ti è piaciuta la partita?" a fine partita
 * (docs/specs/proposta-donazione-condivisione.md §4.1 e §8, decisioni del lead):
 *
 *  - mai alla PRIMA partita conclusa in assoluto (prima si dà valore);
 *  - al massimo una volta ogni 2 partite concluse;
 *  - al massimo una volta al GIORNO (giorno di calendario locale);
 *  - "Non ora" lo sospende per 14 giorni.
 *
 * Lo stato vive nel `localStorage` di QUESTO browser: è una cortesia per chi gioca,
 * non un dato affidabile. Ogni accesso è protetto: se lo storage non è disponibile
 * (navigazione privata, dati bloccati) il blocco NON compare — meglio perdere una
 * richiesta che insistere.
 *
 * Le funzioni `decide`/`snooze` sono PURE (stato in → stato out) per poterle verificare
 * senza browser; `registerCompletedMatch`/`snoozeSupportPrompt` le collegano allo storage.
 */

const STORAGE_KEY = "circolo.supportPrompt.v1";
export const MATCHES_BETWEEN_PROMPTS = 2;
export const SNOOZE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SupportPromptState {
  /** Partite concluse dall'ultima volta che il blocco è comparso (o dall'inizio). */
  matchesSinceShown: number;
  /** Giorno locale (YYYY-MM-DD) dell'ultima comparsa. */
  lastShownDay: string | null;
  /** Epoch ms fino a cui il blocco resta sospeso per "Non ora". */
  snoozeUntil: number | null;
}

export const INITIAL_STATE: SupportPromptState = { matchesSinceShown: 0, lastShownDay: null, snoozeUntil: null };

export function localDay(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Registra una partita conclusa e decide se mostrare il blocco. */
export function decide(prev: SupportPromptState, now: Date): { show: boolean; next: SupportPromptState } {
  const matchesSinceShown = prev.matchesSinceShown + 1;
  const show =
    matchesSinceShown >= MATCHES_BETWEEN_PROMPTS &&
    prev.lastShownDay !== localDay(now) &&
    (prev.snoozeUntil === null || now.getTime() >= prev.snoozeUntil);
  const next: SupportPromptState = show
    ? { ...prev, matchesSinceShown: 0, lastShownDay: localDay(now) }
    : { ...prev, matchesSinceShown };
  return { show, next };
}

export function snooze(prev: SupportPromptState, now: Date): SupportPromptState {
  return { ...prev, snoozeUntil: now.getTime() + SNOOZE_DAYS * DAY_MS };
}

function parse(raw: string | null): SupportPromptState {
  if (!raw) return INITIAL_STATE;
  try {
    const v = JSON.parse(raw) as Partial<SupportPromptState>;
    return {
      matchesSinceShown: Number.isFinite(v.matchesSinceShown) ? Math.max(0, Number(v.matchesSinceShown)) : 0,
      lastShownDay: typeof v.lastShownDay === "string" ? v.lastShownDay : null,
      snoozeUntil: Number.isFinite(v.snoozeUntil) ? Number(v.snoozeUntil) : null,
    };
  } catch {
    return INITIAL_STATE;
  }
}

/** Da chiamare UNA volta per partita conclusa normalmente. `true` = mostra il blocco. */
export function registerCompletedMatch(now: Date = new Date()): boolean {
  try {
    const { show, next } = decide(parse(window.localStorage.getItem(STORAGE_KEY)), now);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return show;
  } catch {
    return false;
  }
}

export function snoozeSupportPrompt(now: Date = new Date()): void {
  try {
    const next = snooze(parse(window.localStorage.getItem(STORAGE_KEY)), now);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage non disponibile: il blocco comunque non ricomparirebbe (vedi sopra).
  }
}
