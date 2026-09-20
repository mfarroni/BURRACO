"use client";

import { useRef, useState } from "react";
import { sendContact, ContactError } from "@/lib/contact";

/**
 * FORM CONTATTI (FASE 2) — competenza develop: struttura, stato client, stati di
 * attesa/successo/errore, campi anti-spam. La PRESENTAZIONE fine (layout, copy,
 * gerarchia visiva) è di agente_ui_ux e vive qui + Landing.css.
 *
 * Il client è muto: non valida nulla di sostanziale, invia l'intenzione e riflette
 * la risposta (sempre generica) del server, unica autorità. Campi anti-spam:
 *  - honeypot `website` (nascosto, fuori tab-order): un umano lo lascia vuoto;
 *  - `renderedAt` (istante di montaggio del form): soglia di tempo minima lato server.
 *
 * Stati coerenti con le modali esistenti: invio (aria-busy, bottone disabilitato),
 * successo (role="alert", messaggio generico), errore di RETE (role="alert", solo
 * per fallimento HTTP del POST — mai per l'esito email).
 */

type FormState = "idle" | "sending" | "success" | "error";

export function ContactForm() {
  // Istante di render del form: catturato una sola volta al montaggio.
  const renderedAtRef = useRef<number>(Date.now());

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [messaggio, setMessaggio] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);

  const sending = state === "sending";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setState("sending");
    setError(null);
    try {
      await sendContact({
        nome,
        email,
        oggetto,
        messaggio,
        website,
        renderedAt: renderedAtRef.current,
      });
      setState("success");
      // Ripulisce i campi: un eventuale nuovo messaggio riparte pulito.
      setNome("");
      setEmail("");
      setOggetto("");
      setMessaggio("");
    } catch (err) {
      setError(err instanceof ContactError ? err.message : "Non è stato possibile inviare il messaggio.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="contact-form-status" role="alert">
        <p className="contact-success">
          Grazie, abbiamo ricevuto il tuo messaggio: ti risponderemo appena possibile.
        </p>
        <button type="button" className="btn btn-ghost-gold" onClick={() => setState("idle")}>
          Scrivi un altro messaggio
        </button>
      </div>
    );
  }

  return (
    <form className="contact-form" onSubmit={onSubmit} aria-busy={sending} noValidate>
      <div className="contact-field">
        <label htmlFor="contact-nome">Nome</label>
        <input
          id="contact-nome"
          name="nome"
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          maxLength={80}
          autoComplete="name"
          disabled={sending}
        />
      </div>

      <div className="contact-field">
        <label htmlFor="contact-email">Email</label>
        <input
          id="contact-email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
          autoComplete="email"
          disabled={sending}
        />
      </div>

      <div className="contact-field">
        <label htmlFor="contact-oggetto">Oggetto</label>
        <input
          id="contact-oggetto"
          name="oggetto"
          type="text"
          value={oggetto}
          onChange={(e) => setOggetto(e.target.value)}
          required
          maxLength={120}
          disabled={sending}
        />
      </div>

      <div className="contact-field">
        <label htmlFor="contact-messaggio">Messaggio</label>
        <textarea
          id="contact-messaggio"
          name="messaggio"
          value={messaggio}
          onChange={(e) => setMessaggio(e.target.value)}
          required
          maxLength={2000}
          rows={5}
          disabled={sending}
        />
      </div>

      {/* HONEYPOT: nascosto ai fini visivi e fuori dal tab-order. Un umano non lo
          vede né lo compila; i bot sì → il server lo scarta in silenzio. */}
      <div className="contact-hp" aria-hidden="true">
        <label htmlFor="contact-website">Non compilare questo campo</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {state === "error" && error && (
        <p className="contact-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary-gold" disabled={sending}>
        {sending ? "Invio in corso…" : "Invia messaggio"}
      </button>
    </form>
  );
}
