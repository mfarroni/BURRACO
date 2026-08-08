"use client";

import { useEffect, useId, useRef } from "react";
import type { GameConfig } from "@/lib/contract";

interface Props {
  config: GameConfig | null;
  onClose: () => void;
}

export function RulesOverlay({ config, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Focus sul pulsante di chiusura all'apertura, gestione Esc e trap del Tab
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
          'button, [tabindex="0"]'
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      prevFocus?.focus?.();
    };
  }, [onClose]);

  // Se la config non è ancora arrivata dal server, usiamo dei default sicuri
  const targetScore = config?.punteggioObiettivo ?? 2005;
  const isChiusuraItaliana = (config?.varianteChiusura ?? "italiana") === "italiana";
  const isPozzettoMisto = (config?.presaPozzetto ?? "in_diretta_e_differita") === "in_diretta_e_differita";
  const capCalate = config?.limiteCalatePrimaDelPozzetto ?? null;

  return (
    <div
      className="overlay rules-overlay-bg"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="overlay-card rules-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={cardRef}
      >
        <div className="rules-header">
          <h2 id={titleId}>Regolamento del Tavolo</h2>
          <button
            type="button"
            className="toast-close rules-close-btn"
            onClick={onClose}
            ref={closeBtnRef}
            aria-label="Chiudi regolamento"
          >
            ×
          </button>
        </div>

        <div className="rules-content">
          {/* Sezione Configurazione Corrente */}
          <section className="rules-section config-highlight">
            <h3>Impostazioni Attive del Match</h3>
            <div className="config-grid">
              <div className="config-item">
                <span className="config-label">Punteggio Obiettivo</span>
                <span className="config-value">{targetScore} punti</span>
              </div>
              <div className="config-item">
                <span className="config-label">Variante Chiusura</span>
                <span className="config-value">
                  {isChiusuraItaliana ? "Italiana (Qualsiasi Burraco)" : "Internazionale (Burraco Pulito)"}
                </span>
              </div>
              <div className="config-item">
                <span className="config-label">Presa Pozzetto</span>
                <span className="config-value">
                  {isPozzettoMisto ? "In Diretta e Differita" : "Solo Differita"}
                </span>
              </div>
              <div className="config-item">
                <span className="config-label">Limite Calate (Pre-Pozzetto)</span>
                <span className="config-value">
                  {capCalate !== null ? `${capCalate} calate max` : "Nessun limite"}
                </span>
              </div>
            </div>
          </section>

          {/* Sezione Regole Generali */}
          <section className="rules-section">
            <h3>Materiali di Gioco</h3>
            <p>
              Si gioca con <strong>due mazzi di carte francesi</strong> (108 carte totali). 
              Le matte includono i <strong>4 Jolly</strong> (30 punti) e gli <strong>8 2 (Pinelle)</strong> (20 punti).
            </p>
          </section>

          <section className="rules-section">
            <h3>Il Turno</h3>
            <p>Nel tuo turno puoi compiere in ordine le seguenti azioni:</p>
            <ol>
              <li>
                <strong>Pescare</strong> una carta coperta dal mazzo <em>oppure</em> raccogliere 
                l'<strong>intero monte degli scarti</strong>.
              </li>
              <li>
                <strong>Calare</strong> nuove combinazioni (almeno 3 carte) o <strong>ampliare</strong> giochi esistenti.
              </li>
              <li>
                Terminare il turno effettuando uno <strong>scarto</strong>. Nota: l'ultimo scarto 
                per chiudere non può essere un Jolly o una Pinella.
              </li>
            </ol>
          </section>

          <section className="rules-section">
            <h3>Giochi Validi (Combinazioni)</h3>
            <ul>
              <li>
                <strong>Sequenza (Scala):</strong> Almeno 3 carte dello stesso seme in ordine (es. 3, 4, 5 di cuori). 
                L'Asso può essere posizionato in basso (A-2-3) o in alto (Q-K-A), ma non può girare. 
                È consentita al massimo <strong>una matta</strong> per scala (Jolly o Pinella), tranne se una Pinella del seme corretto è usata nella sua posizione naturale (es. 2 di picche, 3 di picche, Jolly, 5 di picche).
              </li>
              <li>
                <strong>Gruppo (Tris o Poker):</strong> Almeno 3 carte dello stesso valore. Essendo presenti due mazzi, 
                sono ammessi semi duplicati. È consentita al massimo <strong>una matta</strong> per gruppo.
              </li>
              <li>
                <strong>Sostituzione Pinella:</strong> Se hai in mano la carta naturale sostituita da una Pinella calata, 
                puoi giocarla nel tuo turno per riprendere la Pinella in mano e riutilizzarla.
              </li>
            </ul>
          </section>

          <section className="rules-section">
            <h3>Burraco</h3>
            <p>Un Burraco è una combinazione o scala di <strong>almeno 7 carte</strong>:</p>
            <ul>
              <li>
                <strong>Burraco Pulito (✦):</strong> Non contiene alcuna matta (tranne la Pinella al proprio posto naturale). Vale <strong>200 punti</strong>.
              </li>
              <li>
                <strong>Burraco Sporco (✧):</strong> Contiene un Jolly o una Pinella usati come matta. Vale <strong>100 punti</strong>.
              </li>
            </ul>
          </section>

          <section className="rules-section">
            <h3>Andare a Pozzetto</h3>
            <p>
              I due pozzetti contengono 11 carte ciascuno. Quando esaurisci le carte in mano vai a pozzetto:
            </p>
            <ul>
              <li>
                <strong>In diretta:</strong> Se finisci le carte calando combinazioni senza scartare, prendi il pozzetto 
                e continui a giocare immediatamente nello stesso turno.
              </li>
              <li>
                <strong>In differita:</strong> Se finisci le carte scartandone una, prendi il pozzetto 
                ma potrai giocarlo solo a partire dal turno successivo.
              </li>
            </ul>
          </section>

          <section className="rules-section">
            <h3>Chiusura</h3>
            <p>Per poter chiudere la smazzata, devi soddisfare le seguenti condizioni:</p>
            <ul>
              <li>Aver preso il pozzetto e giocato almeno una carta di esso.</li>
              <li>Aver realizzato almeno un Burraco.</li>
              <li>
                Variante attiva: <strong>{isChiusuraItaliana ? "Chiusura Italiana" : "Chiusura Internazionale"}</strong>. 
                {isChiusuraItaliana 
                  ? " Puoi chiudere con qualsiasi tipo di Burraco (pulito o sporco)." 
                  : " Puoi chiudere SOLO se hai realizzato almeno un Burraco PULITO."}
              </li>
              <li>Esaurire le carte in mano e scartare una carta non-matta nel monte scarti.</li>
            </ul>
          </section>

          <section className="rules-section">
            <h3>Calcolo Punti</h3>
            <div className="points-table-container">
              <table className="rules-points-table">
                <thead>
                  <tr>
                    <th>Voce / Carta</th>
                    <th>Valore positivo (Calate)</th>
                    <th>Valore negativo (In Mano)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Bonus Chiusura</td>
                    <td>+100 punti</td>
                    <td>—</td>
                  </tr>
                  <tr>
                    <td>Burraco Pulito</td>
                    <td>+200 punti</td>
                    <td>—</td>
                  </tr>
                  <tr>
                    <td>Burraco Sporco</td>
                    <td>+100 punti</td>
                    <td>—</td>
                  </tr>
                  <tr>
                    <td>Pozzetto non preso</td>
                    <td>—</td>
                    <td>-100 punti (malus)</td>
                  </tr>
                  <tr>
                    <td>Jolly</td>
                    <td>+30 punti</td>
                    <td>-30 punti</td>
                  </tr>
                  <tr>
                    <td>Pinella (2)</td>
                    <td>+20 punti</td>
                    <td>-20 punti</td>
                  </tr>
                  <tr>
                    <td>Asso (A)</td>
                    <td>+15 punti</td>
                    <td>-15 punti</td>
                  </tr>
                  <tr>
                    <td>K, Q, J, 10, 9, 8</td>
                    <td>+10 punti</td>
                    <td>-10 punti</td>
                  </tr>
                  <tr>
                    <td>7, 6, 5, 4, 3</td>
                    <td>+5 punti</td>
                    <td>-5 punti</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="dialog-actions single rules-footer">
          <button type="button" className="cta btn-primary" onClick={onClose}>
            Chiudi e torna al tavolo
          </button>
        </div>
      </div>
    </div>
  );
}
