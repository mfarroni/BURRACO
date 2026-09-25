"use client";

import { useState, type FormEvent } from "react";
import { AuthClientError, deleteAccount } from "@/lib/auth";

interface Props {
  /** Chiamata a cancellazione riuscita: il chiamante azzera la sessione locale. */
  onDeleted: () => void;
}

/**
 * ELIMINA ACCOUNT (solo registrati), in fondo al profilo — Audit lancio R05.
 * Due passi: il primo pulsante apre la conferma, che spiega cosa succede e chiede la
 * password. Il client non decide nulla: verifica e cancellazione sono del backend.
 */
export function DeleteAccountForm({ onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.length > 0 && !busy;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
      onDeleted();
    } catch (err) {
      setError(err instanceof AuthClientError ? err.message : "Impossibile eliminare l'account. Riprova.");
      setBusy(false);
    }
  };

  return (
    <section className="profile-delete" aria-label="Eliminazione dell'account">
      {!open ? (
        <button type="button" className="btn-ghost profile-delete-open" onClick={() => setOpen(true)}>
          Elimina il mio account
        </button>
      ) : (
        <form className="profile-password-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <h2 className="profile-section-title">Elimina il mio account</h2>
          <p className="profile-delete-text">
            L&apos;operazione è definitiva. Cancelliamo email, nome, foto, statistiche e messaggi
            inviati al circolo. Le partite già giocate restano nello storico degli avversari
            come «Utente eliminato».
          </p>
          <label htmlFor="del-password">Per confermare, scrivi la tua password</label>
          <input
            id="del-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={200}
            disabled={busy}
          />
          {error && (
            <p className="profile-password-error" role="alert">
              {error}
            </p>
          )}
          <div className="profile-password-actions">
            <button type="submit" className="btn-primary profile-delete-confirm" disabled={!canSubmit} aria-busy={busy}>
              {busy ? "Eliminazione…" : "Elimina definitivamente"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setPassword("");
                setError(null);
                setOpen(false);
              }}
              disabled={busy}
            >
              Annulla
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
