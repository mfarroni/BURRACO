"use client";

import type { AuthMode } from "@/components/AuthPanel";

interface Props {
  /** Apre AuthPanel sul percorso scelto (login, register, guest). */
  onOpenAuth: (mode: AuthMode) => void;
}

const NAV_ITEMS = ["HOME", "CHI SIAMO", "TORNEI", "SHOP", "CONTATTI"] as const;

export function Landing({ onOpenAuth }: Props) {
  return (
    <div className="landing-vintage-wrapper">
      <div className="landing-vintage-container">
        <div className="mockup-bg-frame">
          <img
            src="/images/landing-vintage.png"
            alt="Burraco Circolo Notturno Landing Page"
            className="mockup-bg-image"
          />
        </div>

        <nav className="interactive-nav-overlay" aria-label="Navigazione Vetrina">
          {NAV_ITEMS.map((item) => (
            <span
              key={item}
              className={`nav-link-item ${item === "HOME" ? "active" : ""}`}
            >
              {item}
            </span>
          ))}
        </nav>

        <div className="interactive-cta-overlay" aria-label="Menu d'accesso">
          <button
            type="button"
            className="cta-btn cta-login"
            onClick={() => onOpenAuth("login")}
            title="Accedi al tuo account Burraco"
          >
            ACCEDI
          </button>
          <button
            type="button"
            className="cta-btn cta-register"
            onClick={() => onOpenAuth("register")}
            title="Crea un nuovo account Burraco"
          >
            REGISTRATI
          </button>
          <button
            type="button"
            className="cta-btn cta-guest"
            onClick={() => onOpenAuth("guest")}
            title="Gioca subito come ospite"
          >
            GIOCA COME OSPITE
          </button>
        </div>
      </div>
    </div>
  );
}
