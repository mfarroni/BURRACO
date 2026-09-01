"use client";

import type { AuthMode } from "@/components/AuthPanel";

interface Props {
  /** Apre AuthPanel sul percorso scelto (login, register, guest). */
  onOpenAuth: (mode: AuthMode) => void;
}

export function Landing({ onOpenAuth }: Props) {
  return (
    <div className="landing-121-wrapper">
      <div className="landing-121-container">
        {/* Immagine Mockup Ufficiale 1:1 */}
        <div className="mockup-frame">
          <img
            src="/images/landing-vintage.png"
            alt="Burraco Circolo Notturno Landing Page"
            className="mockup-img"
          />

          {/* Overlay Cliccabile Trasparente sui Pulsanti del Mockup */}
          <div className="cta-overlay" aria-label="Seleziona modalitÀ d'accesso">
            <button
              type="button"
              className="cta-hitbox"
              onClick={() => onOpenAuth("login")}
              title="Accedi al tuo account Burrico"
              aria-label="Accedi"
            />
            <button
              type="button"
              className="cta-hitbox"
              onClick={() => onOpenAuth("register")}
              title="Crea un nuovo account Burraco"
              aria-label="Registrati"
            />
            <button
              type="button"
              className="cta-hitbox"
              onClick={() => onOpenAuth("guest")}
              title="Gioca subito come ospite"
              aria-label="Gioca come Ospite"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
