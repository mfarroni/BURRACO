"use client";

import { useEffect, useState } from "react";
import { AuthClientError } from "@/lib/auth";
import { fetchPreferences, savePreferences } from "@/lib/profile";

/**
 * AVVISI DELLE SERATE (solo registrati) — Audit lancio R02/R19, Ciclo 3. Consenso
 * esplicito, spento di default, revocabile qui o dal link in fondo a ogni email.
 * Il client riflette ciò che il server ha registrato: nessuno stato inventato.
 */
export function SerateOptIn() {
  const [value, setValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPreferences()
      .then((p) => alive && setValue(p.avvisiSerate))
      .catch(() => alive && setError("Impossibile leggere le preferenze. Riprova più tardi."));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    const prev = value;
    // Aggiornamento immediato della casella; se il salvataggio fallisce si torna indietro.
    setValue(next);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const p = await savePreferences({ avvisiSerate: next });
      setValue(p.avvisiSerate);
      setSaved(true);
    } catch (err) {
      setValue(prev);
      setError(err instanceof AuthClientError ? err.message : "Impossibile salvare. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile-serate" aria-label="Avvisi delle serate">
      <label className="profile-serate-label">
        <input
          type="checkbox"
          checked={value ?? false}
          disabled={value === null || busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          <strong>Avvisami via email delle serate del circolo</strong>
          <span className="profile-serate-hint">
            Ti scriviamo quando fissiamo una serata di gioco, così trovi qualcuno al tavolo. Puoi
            disattivarlo quando vuoi.
          </span>
        </span>
      </label>
      <p className="profile-serate-status" role="status" aria-live="polite">
        {error ? (
          <span className="profile-password-error">{error}</span>
        ) : saved ? (
          value ? "Avvisi attivati." : "Avvisi disattivati."
        ) : null}
      </p>
    </section>
  );
}
