"use client";

import { useState } from "react";
import type { UseAuth } from "@/lib/useAuth";

/**
 * SCHERMATA D'INGRESSO — tre percorsi FUNZIONALI: Accedi / Registrati / Ospite.
 * Competenza develop: struttura, stato dei campi, collegamento alle azioni auth,
 * stati di attesa/errore. L'ASPETTO (copy definitiva, layout, micro-interazioni)
 * è delegato ad agente_ui_ux: qui i testi sono PLACEHOLDER marcati come tali.
 *
 * Il client è muto sulle regole: la validazione forte (email, policy password,
 * duplicati, credenziali) è del backend. Qui solo controlli banali di UX (campi
 * non vuoti, lunghezza minima) per abilitare i pulsanti ed evitare invii a vuoto.
 */

type Mode = "login" | "register" | "guest";

interface Props {
  auth: UseAuth;
}

export function AuthPanel({ auth }: Props) {
  const [mode, setMode] = useState<Mode>("login");
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

  return (
    <div className="lobby auth-panel">
      <div className="brand">
        <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <h1>Burraco</h1>
        {/* PLACEHOLDER copy → ui_ux */}
        <p className="tagline">Accedi o entra come ospite per sederti al tavolo.</p>
      </div>

      {/* Selettore di percorso: tre schede FUNZIONALI. */}
      <div className="auth-tabs" role="tablist" aria-label="Modalità di accesso">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          className="auth-tab"
          data-active={mode === "login"}
          onClick={() => switchMode("login")}
        >
          Accedi
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          className="auth-tab"
          data-active={mode === "register"}
          onClick={() => switchMode("register")}
        >
          Registrati
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "guest"}
          className="auth-tab"
          data-active={mode === "guest"}
          onClick={() => switchMode("guest")}
        >
          Ospite
        </button>
      </div>

      <form onSubmit={onSubmit} noValidate>
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
            />
          </>
        )}

        {mode !== "login" && (
          <>
            <label htmlFor="auth-name">
              {mode === "guest" ? "Nome da mostrare" : "Nome da mostrare (opzionale)"}
            </label>
            <input
              id="auth-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "guest" ? "es. Marco" : "come ti vedranno al tavolo"}
              maxLength={40}
              autoComplete="off"
            />
          </>
        )}

        {auth.error && (
          <p role="alert" className="auth-error">
            {auth.error}
          </p>
        )}

        <button type="submit" className="cta btn-primary" disabled={!canSubmit || busy}>
          {busy
            ? "Attendere…"
            : mode === "login"
              ? "Accedi"
              : mode === "register"
                ? "Crea account"
                : "Entra come ospite"}
        </button>
      </form>

      {/* PLACEHOLDER copy → ui_ux */}
      <p className="muted auth-hint">
        {mode === "guest"
          ? "Come ospite giochi subito, ma senza salvare i progressi tra le sessioni."
          : mode === "login"
            ? "Non hai un account? Passa a Registrati o entra come Ospite."
            : "Hai già un account? Torna ad Accedi."}
      </p>
    </div>
  );
}
