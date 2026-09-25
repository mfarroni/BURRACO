"use client";

import { WakeUpMessage } from "@/components/WakeUpNotice";

/**
 * SCHERMATA DI CONNESSIONE (FASE 3, Livello 2). Sostituisce l'attesa/errore muta
 * quando il backend si sta risvegliando (cold start di Render) o dopo un deploy.
 * L'ingresso è AUTOMATICO: appena /health risponde, il chiamante smette di mostrare
 * questa schermata (nessun pulsante "riprova" come unica via d'uscita). Il testo è
 * lo stesso della finestra di risveglio sul pannello d'accesso (WakeUpNotice).
 */

interface Props {
  /** Durata dell'attesa corrente (ms), per il conto alla rovescia. */
  elapsedMs: number;
}

export function ConnectionScreen({ elapsedMs }: Props) {
  return (
    <div className="lobby">
      <div className="brand">
        <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <h1>Burraco</h1>
      </div>
      <section className="overlay-card wake-card" aria-labelledby="wake-title">
        <WakeUpMessage elapsedMs={elapsedMs} />
      </section>
    </div>
  );
}
