"use client";

/**
 * SCHERMATA DI CONNESSIONE (FASE 3, Livello 2). Sostituisce l'attesa/errore muta
 * quando il backend si sta risvegliando (cold start di Render) o dopo un deploy.
 * L'ingresso è AUTOMATICO: appena /health risponde, il chiamante smette di mostrare
 * questa schermata (nessun pulsante "riprova" come unica via d'uscita).
 *
 * Competenza develop: struttura, stati, aggancio al probe. La rifinitura di copy e
 * stile (tono "circolo") è di agente_ui_ux; qui si riusano le classi della lobby
 * per coerenza visiva immediata.
 */

interface Props {
  /** Attesa oltre la soglia: messaggio diverso, più rassicurante. */
  longWait: boolean;
}

export function ConnectionScreen({ longWait }: Props) {
  return (
    <div className="lobby">
      <div className="brand">
        <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <h1>Burraco</h1>
        <p className="tagline" role="status" aria-live="polite" aria-busy="true">
          <span className="spinner-inline" aria-hidden="true" />{" "}
          {longWait
            ? "Il tavolo ci mette più del solito… ancora un istante, ti facciamo entrare da solo."
            : "Stiamo apparecchiando il tavolo…"}
        </p>
      </div>
    </div>
  );
}
