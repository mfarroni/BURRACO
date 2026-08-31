"use client";

import { useState } from "react";
import type { UseAuth } from "@/lib/useAuth";

/**
 * SCHERMATA D'INGRESSO — tre percorsi FUNZIONALI: Accedi / Registrati / Ospite.
 * Competenza develop: struttura, stato dei campi, collegamento alle azioni auth,
 * stati di attesa/errore. La PRESENTAZIONE (copy definitiva, gerarchia, markup,
 * micro-interazioni, accessibilità) è di agente_ui_ux e vive qui + in globals.css.
 *
 * Il client è muto sulle regole: la validazione forte (email, policy password,
 * duplicati, credenziali) è del backend. Qui solo controlli banali di UX (campi
 * non vuoti, lunghezza minima) per abilitare i pulsanti ed evitare invii a vuoto.
 *
 * Gerarchia visiva: il selettore di percorso è un "segmented control" a tre voci
 * di pari peso (scelte peer, oneste); l'AZIONE del momento (submit) porta l'oro,
 * coerente col design system ("l'azione più importante del momento in oro").
 * Accessibilità: NON è un pattern a tab ARIA (che richiederebbe frecce + tabpanel);
 * sono pulsanti con `aria-pressed`, pienamente operabili da tastiera nativamente.
 */

export type AuthMode = "login" | "register" | "guest";
type Mode = AuthMode;

interface Props {
  auth: UseAuth;
  /**
   * Percorso su cui aprire il pannello (default "login", retro-compatibile).
   * La vetrina lo usa per pilotare Accedi/Registrati/Ospite senza route.
   */
  initialMode?: AuthMode;
  /** Se fornito, mostra un ritorno alla vetrina (stato locale in page.tsx). */
  onBack?: () => void;
}

const MODES: { id: Mode; label: string }[] = [
  { id: "login", label: "Accedi" },
  { id: "register", label: "Registrati" },
  { id: "guest", label: "Ospite" },
];

export function AuthPanel({ auth, initialMode = "login", onBack }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const busy = auth.busy;

  // Controlli UX minimi (NON regole di dominio): solo per abilitare il submit.
  const emailOk = email.trim().length > 3 && email.includes("@");
  const passwordOk = password.length >= 8;
  const canSubmit =
    mode === "guest" ? true : mode === "login" ? emailOk && password.length > 0 : emailOk && passwordOk;

  const switchMode = (m: Mode) => {
    if (busy) return; // niente cambio percorso a richiesta in volo
    setMode(m);
    auth.clearError();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !canSubmit) return;
    if (mode === "login") await auth.login(email, password);
    else if (mode === "register") await auth.register(email, password, name.trim() || undefined);
    else await auth.guest(name.trim() || undefined);
  };

  const submitLabel =
    mode === "login" ? "Accedi" : mode === "register" ? "Crea account" : "Entra come ospite";

  const hint =
    mode === "guest"
      ? "Da ospite giochi subito; quando vuoi crei un account per salvare partite e statistiche."
      : mode === "login"
        ? "Prima volta qui? Registrati, oppure siediti al volo come Ospite."
        : "Hai già un account? Torna ad Accedi.";

  return (
    <div className="lobby auth-panel">
      {onBack && (
        <button type="button" className="btn-ghost auth-back" onClick={onBack} disabled={busy}>
          <span aria-hidden="true">&larr;</span> Torna alla vetrina
        </button>
      )}
      <div className="brand">
        <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <h1>Burraco</h1>
        <p className="tagline">Il circolo del Burraco. Siediti al tavolo in pochi secondi.</p>
      </div>

      {/* Selettore di percorso: segmented control a tre voci di pari peso. */}
      <div className="auth-tabs" role="group" aria-label="Come vuoi entrare">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="auth-tab"
            data-active={mode === m.id}
            aria-pressed={mode === m.id}
            disabled={busy}
            onClick={() => switchMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} noValidate aria-label={submitLabel} aria-busy={busy}>
        {mode !== "guest" && (
          <>
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              inputMode="email"
              autoComplete={mode === "login" ? "username" : "email"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@esempio.it"
              maxLength={254}
              disabled={busy}
            />
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "Almeno 8 caratteri" : "La tua password"}
              maxLength={200}
              disabled={busy}
            />
          </>
        )}

        {mode !== "login" && (
          <>
            <label htmlFor="auth-name">
              {mode === "guest" ? "Nome al tavolo" : "Nome al tavolo (facoltativo)"}
            </label>
            <input
              id="auth-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "guest" ? "es. Marco" : "come ti vedranno gli avversari"}
              maxLength={40}
              autoComplete="off"
              disabled={busy}
            />
          </>
        )}

        {auth.error && (
          <p role="alert" className="auth-error">
            <span className="auth-error-icon" aria-hidden="true">!</span>
            <span>{auth.error}</span>
          </p>
        )}

        <button type="submit" className="cta btn-primary" disabled={!canSubmit || busy}>
          {busy ? (
            <>
              <span className="cta-spinner" aria-hidden="true" />
              Un attimo…
            </>
          ) : (
            submitLabel
          )}
        </button>
      </form>

      <p className="muted auth-hint">{hint}</p>
    </div>
  );
}
