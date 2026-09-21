"use client";

import { useState } from "react";
import type { UseAuth } from "@/lib/useAuth";
import { SideFlank } from "@/components/SideFlanks";
import { VetrinaBrandHeader } from "@/components/VetrinaBrandHeader";

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
  /**
   * Ingresso diretto al tavolo dopo un accesso Ospite riuscito. Riceve il codice
   * tavolo digitato (già normalizzato) oppure `null` se lasciato vuoto (in tal
   * caso resta il flusso normale dalla lobby). Chiamato SOLO su ospite andato a
   * buon fine; login/register non lo usano.
   */
  onRequestTable?: (roomCode: string | null) => void;
}

const MODES: { id: Mode; label: string }[] = [
  { id: "login", label: "Accedi" },
  { id: "register", label: "Registrati" },
  { id: "guest", label: "Ospite" },
];

export function AuthPanel({ auth, initialMode = "login", onBack, onRequestTable }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  // Codice tavolo facoltativo per l'ingresso diretto da Ospite (vuoto = lobby).
  const [table, setTable] = useState("");
  // R8 — HONEYPOT: campo-trappola del solo form di login. Invisibile e non focalizzabile
  // per gli umani (di norma resta ""), i bot lo compilano → il backend risponde 401. Il
  // client NON prende decisioni: si limita a inoltrarne il valore.
  const [website, setWebsite] = useState("");

  const busy = auth.busy;

  // Controlli UX minimi (NON regole di dominio): solo per abilitare il submit.
  const emailOk = email.trim().length > 3 && email.includes("@");
  const passwordOk = password.length >= 8;
  const canSubmit =
    mode === "guest"
      ? name.trim().length > 0
      : mode === "login"
        ? emailOk && password.length > 0
        : emailOk && passwordOk;

  const switchMode = (m: Mode) => {
    if (busy) return; // niente cambio percorso a richiesta in volo
    setMode(m);
    setTable(""); // il codice tavolo è pertinente solo al percorso Ospite
    auth.clearError();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !canSubmit) return;
    if (mode === "login") await auth.login(email, password, website);
    else if (mode === "register") await auth.register(email, password, name.trim() || undefined);
    else {
      const ok = await auth.guest(name.trim() || undefined);
      if (ok) onRequestTable?.(table.trim().toUpperCase() || null);
    }
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
    <div className="page-3col-wrapper auth-3col-wrapper">
      <SideFlank side="left" />
      <main className="central-column-card lobby auth-panel">
        {onBack && (
          <button type="button" className="btn-ghost auth-back" onClick={onBack} disabled={busy}>
            <span aria-hidden="true">&larr;</span> Torna alla vetrina
          </button>
        )}
        <VetrinaBrandHeader
          title="Burraco"
          subtitle="Circolo Nettuno — Siediti al tavolo in pochi secondi."
        />

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

        {mode === "login" && (
          // R8 — HONEYPOT: fuori dal flusso visivo, di tastiera e degli screen reader.
          // Nessun testo mostrato, nessun impatto UX; solo i bot lo compilano.
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-9999px",
              width: 1,
              height: 1,
              overflow: "hidden",
              opacity: 0,
              pointerEvents: "none",
            }}
          >
            <label htmlFor="auth-website">Non compilare questo campo</label>
            <input
              id="auth-website"
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
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

        {mode === "guest" && (
          <>
            <label htmlFor="auth-table">Codice tavolo (facoltativo)</label>
            <input
              id="auth-table"
              type="text"
              value={table}
              onChange={(e) => setTable(e.target.value.toUpperCase())}
              placeholder="es. TAVOLO1"
              maxLength={12}
              autoComplete="off"
              disabled={busy}
              aria-describedby="auth-table-hint"
            />
            <p id="auth-table-hint" className="field-hint">
              Se lo hai già, ti siedi subito a quel tavolo. Lascia vuoto per sceglierlo dopo.
            </p>
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
      </main>
      <SideFlank side="right" />
    </div>
  );
}
