/**
 * MAPPA TESTI DI RIFIUTO — proprietà del FRONTEND (competenza ui_ux).
 *
 * Il client è muto sulle regole: NON deduce perché una mossa è illegale, si
 * limita a TRADURRE il `code` che il server restituisce in una frase italiana
 * chiara e non colpevolizzante. Il campo `reason` del server NON va mai mostrato
 * verbatim (può essere tecnico/inglese): serve solo per log/debug.
 *
 * Ogni testo:
 *  - spiega COSA è successo in modo neutro;
 *  - quando utile, suggerisce l'azione corretta ("…: pesca dal mazzo");
 *  - riporta l'utente allo stato giocabile senza confonderlo.
 *
 * Nota di dominio (dalla skill-burraco, solo per i testi, non per validare):
 * jolly/pinella = matte; burraco = gioco di 7+ carte; pozzetto = 11 carte.
 */

import type { RejectCode } from "./contract";

export const REJECT_MESSAGES: Record<RejectCode, string> = {
  NOT_YOUR_TURN: "Non è il tuo turno: attendi la mossa dell'avversario.",
  WRONG_PHASE: "Non ora: in questa fase del turno l'azione non è disponibile.",
  CARD_NOT_IN_HAND: "Quella carta non è più nella tua mano.",
  EMPTY_DISCARD: "Il monte scarti è vuoto: pesca dal mazzo.",
  DECK_EMPTY: "Il mazzo è esaurito: puoi pescare dal monte scarti.",
  INVALID_MELD: "Queste carte non formano un gioco valido.",
  MELD_NOT_FOUND: "Il gioco selezionato non esiste più.",
  NOT_MELD_OWNER: "Puoi ampliare solo i tuoi giochi.",
  MELD_LIMIT_REACHED: "Hai raggiunto il limite di calate prima del pozzetto.",
  MUST_KEEP_CARD_TO_DISCARD: "Devi tenere una carta da scartare per chiudere il turno.",
  CANNOT_CLOSE_NO_BURRACO: "Per chiudere ti serve almeno un burraco.",
  ILLEGAL_LAST_DISCARD: "L'ultima carta scartata non può essere una matta.",
  NO_PINELLA_TO_SUBSTITUTE: "In quel gioco non c'è una pinella da sostituire con questa carta.",
  GAME_NOT_ACTIVE: "La partita non è in corso in questo momento.",
  MALFORMED: "Qualcosa non ha funzionato: riprova.",
};

/** Titolo breve mostrato in cima al toast di rifiuto. */
export const REJECT_TITLE = "Mossa non valida";

/**
 * Traduce un code in testo. Fallback prudente per code sconosciuti (mai il
 * `reason` grezzo): un code non mappato indica solo che il contratto FE è
 * indietro rispetto al server.
 */
export function rejectText(code: RejectCode | string): string {
  return REJECT_MESSAGES[code as RejectCode] ?? "Mossa non consentita: riprova.";
}
