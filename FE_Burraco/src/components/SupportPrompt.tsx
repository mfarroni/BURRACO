"use client";

import { useEffect, useRef, useState } from "react";
import { BMC_URL } from "@/components/DonationButton";
import { ShareButton } from "@/components/ShareButton";
import { registerCompletedMatch, snoozeSupportPrompt } from "@/lib/supportPrompt";
import "./SupportPrompt.css";

/**
 * BLOCCO DI FINE PARTITA "Ti è piaciuta la partita?" (proposta-donazione-condivisione.md §4.1).
 *
 * Vive DENTRO la card di `GameEndedOverlay`, sotto il punteggio: non è una modale,
 * non ruba il focus, non blocca nulla. Due modi di aiutare, sempre insieme:
 * invitare un amico (primario, gratis) e offrire un caffè (secondario).
 *
 * La decisione se mostrarlo è presa UNA volta al montaggio (= una volta per partita
 * conclusa) dal tetto di frequenza in `lib/supportPrompt.ts`. Il ref evita il doppio
 * conteggio del doppio effetto di React StrictMode in sviluppo.
 */

type Phase = "hidden" | "visible" | "thanks";

export function SupportPrompt({ won }: { won: boolean }) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;
    if (registerCompletedMatch()) setPhase("visible");
  }, []);

  if (phase === "hidden") return null;

  if (phase === "thanks") {
    return (
      <section className="support-prompt" aria-label="Sostieni il circolo">
        <p className="support-thanks" role="status">
          Grazie di cuore: il circolo va avanti anche grazie a te.
        </p>
      </section>
    );
  }

  return (
    <section className="support-prompt" aria-labelledby="support-prompt-title">
      <h3 id="support-prompt-title" className="support-title">
        {won ? "Bella partita!" : "Ti è piaciuta la partita?"}
      </h3>
      <p className="support-body">Il circolo va avanti solo grazie alle vostre offerte.</p>
      <div className="support-actions">
        <ShareButton onShared={() => setPhase("thanks")} />
        <a
          className="support-coffee"
          href={BMC_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setPhase("thanks")}
        >
          <span aria-hidden="true">☕</span>Offri un caffè al circolo
        </a>
      </div>
      <button
        type="button"
        className="support-later"
        onClick={() => {
          snoozeSupportPrompt();
          setPhase("hidden");
        }}
      >
        Non ora
      </button>
    </section>
  );
}
