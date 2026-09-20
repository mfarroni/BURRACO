/**
 * CONTRATTO INTERNO del modulo email (BE-only). Nessun tipo qui è esposto ai
 * client: è l'interfaccia con cui il form contatti (§2) e le comunicazioni
 * webmaster (§5.3) chiedono un invio. La copia FE (decisione #8) non esiste:
 * questi tipi non attraversano mai il confine col frontend.
 *
 * Motivazione della collocazione (solo BE, §1.1): il FE è interamente
 * "use client" — qualunque variabile lo raggiunga è leggibile dall'utente — e la
 * CSP ha `connect-src 'self' + API/WS`, quindi il browser NON può contattare
 * api.brevo.com. L'unica via è il backend come proxy: la API key vive solo su Render.
 */

/** Indirizzo email con nome opzionale (il nome è sanificato dal chiamante). */
export interface EmailAddress {
  email: string;
  name?: string;
}

/** Intenzione d'invio verso il trasporto (Brevo). */
export interface SendEmailInput {
  to: EmailAddress;
  /** Oggetto GIÀ sanificato dal chiamante (§2 anti-injection): niente newline/CTL. */
  subject: string;
  /** SOLO testo semplice (§2.4): nessun HTML. Il client di posta rende gli URL. */
  text: string;
  /** Reply-To opzionale (es. l'email dell'utente del form contatti, validata). */
  replyTo?: EmailAddress;
  /** Etichette diagnostiche (es. ["contact"] | ["broadcast:<id>"]). Mai segreti. */
  tags?: string[];
}

/**
 * Esito UNIFORME di un invio. `skipped` NON è un errore: copre l'interruttore
 * spento (`disabled`) e la quota esaurita (`quota`), casi in cui l'email è un
 * di più e il chiamante prosegue senza fallire (§2.1). `error` distingue le cause
 * transitorie (rete/timeout/provider) per l'eventuale ritentativo/diagnostica.
 */
export type SendEmailResult =
  | { status: "sent"; providerId?: string }
  | { status: "skipped"; reason: "disabled" | "quota" }
  | { status: "error"; reason: "network" | "timeout" | "provider"; httpStatus?: number };
