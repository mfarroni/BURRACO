"use client";

import { useState, type FormEvent } from "react";
import { AuthClientError, changePassword } from "@/lib/auth";

/**
 * CAMBIO PASSWORD (solo registrati), nel profilo. Chiede la password attuale — dopo
 * un reset del webmaster è quella temporanea ricevuta — e la nuova due volte. Il
 * client fa solo controlli di UX (lunghezza, coincidenza); policy e verifica sono del
 * backend. Al successo le altre sessioni sono chiuse, questo dispositivo resta dentro.
 */
export function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !busy;

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      reset();
      setOpen(false);
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthClientError ? err.message : "Impossibile cambiare la password. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile-password" aria-label="Password dell'account">
      {done && (
        <p className="profile-password-ok" role="status" aria-live="polite">
          Password aggiornata. Per sicurezza le sessioni aperte su altri dispositivi sono state chiuse.
        </p>
      )}
      {!open ? (
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
        >
          Cambia password
        </button>
      ) : (
        <form className="profile-password-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <h2 className="profile-section-title">Cambia password</h2>
          <label htmlFor="pw-current">Password attuale</label>
          <input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            maxLength={200}
            disabled={busy}
          />
          <label htmlFor="pw-new">Nuova password</label>
          <input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            maxLength={200}
            placeholder="Almeno 8 caratteri"
            disabled={busy}
          />
          <label htmlFor="pw-confirm">Ripeti la nuova password</label>
          <input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            maxLength={200}
            disabled={busy}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? "pw-mismatch" : undefined}
          />
          {mismatch && (
            <p id="pw-mismatch" className="profile-password-error">
              Le due password non coincidono.
            </p>
          )}
          {error && (
            <p className="profile-password-error" role="alert">
              {error}
            </p>
          )}
          <div className="profile-password-actions">
            <button type="submit" className="btn-primary" disabled={!canSubmit} aria-busy={busy}>
              {busy ? "Salvataggio…" : "Salva nuova password"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                reset();
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
