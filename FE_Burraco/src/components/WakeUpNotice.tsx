"use client";

/**
 * AVVISO DI RISVEGLIO DEL SERVER (Audit lancio, decisione del lead: si accettano i
 * limiti del piano gratuito e si avvisa l'utente). Il backend su Render free si
 * spegne dopo un po' di inattività e al primo accesso impiega circa mezzo minuto a
 * ripartire: invece di un errore "Tempo scaduto" l'utente vede che il tavolo si sta
 * preparando, con un conto alla rovescia indicativo. Si chiude da solo appena
 * /health risponde (useServiceHealth), senza pulsanti da premere.
 *
 * `WakeUpMessage` è il testo, riusato dalla schermata di connessione di chi ha già
 * una sessione; `WakeUpDialog` è la finestra sopra il pannello d'accesso.
 */

/** Durata indicativa del risveglio mostrata all'utente (secondi). */
const EXPECTED_WAKE_S = 30;

export function WakeUpMessage({ elapsedMs }: { elapsedMs: number }) {
  const elapsedS = Math.floor(elapsedMs / 1000);
  const remaining = Math.max(0, EXPECTED_WAKE_S - elapsedS);
  return (
    <>
      <h2 id="wake-title">Stiamo preparando il tavolo</h2>
      <p className="wake-lede">
        Il server del circolo si stava riposando: tra circa {EXPECTED_WAKE_S} secondi sarà pronto.
      </p>
      <p className="wake-count" role="status" aria-live="polite" aria-atomic="true">
        <span className="spinner-inline" aria-hidden="true" />{" "}
        {remaining > 0
          ? `Ancora circa ${remaining} second${remaining === 1 ? "o" : "i"}…`
          : elapsedS < 60
            ? "Ci siamo quasi: ancora qualche istante…"
            : "Ci mette più del solito, ma appena è pronto entri da solo."}
      </p>
      <div
        className="wake-bar"
        role="progressbar"
        aria-label="Preparazione del tavolo"
        aria-valuemin={0}
        aria-valuemax={EXPECTED_WAKE_S}
        aria-valuenow={Math.min(elapsedS, EXPECTED_WAKE_S)}
      >
        <span style={{ width: `${Math.min(100, (elapsedS / EXPECTED_WAKE_S) * 100)}%` }} />
      </div>
      <p className="wake-note">Non serve fare nulla: la pagina prosegue da sola.</p>
    </>
  );
}

export function WakeUpDialog({ elapsedMs }: { elapsedMs: number }) {
  return (
    <div className="overlay wake-overlay">
      <section className="overlay-card wake-card" role="dialog" aria-modal="true" aria-labelledby="wake-title">
        <WakeUpMessage elapsedMs={elapsedMs} />
      </section>
    </div>
  );
}
