"use client";

import type { AuthMode } from "@/components/AuthPanel";

interface Props {
  /** Apre AuthPanel sul percorso scelto (login, register, guest). */
  onOpenAuth: (mode: AuthMode) => void;
}

const NAV_ITEMS = ["HOME", "CHI SIAMO", "REGOLE", "TORNEI", "SHOP", "CONTATTI"] as const;

export function Landing({ onOpenAuth }: Props) {
  return (
    <div className="landing-decomposed-wrapper">
      <div className="landing-decomposed-container">
        {/* Frame Principale con Sfondo ed Elementi d'Angolo */}
        <div className="landing-main-frame">
          {/* Header & Navigazione */}
          <header className="landing-header">
            <h1 className="logo-title">Burraco</h1>
            <p className="logo-subtitle">Circolo Notturno</p>
            <nav className="navbar-menu" aria-label="Navigazione Vetrina">
              {NAV_ITEMS.map((item) => (
                <span key={item} className={`nav-link ${item === "HOME" ? "active" : ""}`}>
                  {item}
                </span>
              ))}
            </nav>
          </header>

          {/* Scena Centrale Feltro Verde Fusa col Legno */}
          <section className="hero-fused-section" aria-label="Tavolo da gioco Burraco">
            <div className="hero-fused-container">
              <img
                src="/images/hero-tavolo.png"
                alt="Tavolo verde Burraco"
                className="hero-tavolo-img"
              />
            </div>
          </section>

          {/* Pulsanti Reali con Immagine Dentro ciascun comando <button> */}
          <section className="cta-decomposed-section" aria-label="Modalità d'accesso">
            <div className="cta-buttons-container">
              {/* Pulsante ACCEDI con Immagine dentro il comando <button> */}
              <button
                type="button"
                className="btn-real-action btn-accedi-wrap"
                onClick={() => onOpenAuth("login")}
                title="Accedi al tuo account Burraco"
              >
                <img
                  src="/images/btn-accedi.png"
                  alt="ACCEDI"
                  className="btn-real-img"
                />
              </button>

              {/* Pulsante REGISTRATI con Immagine dentro il comando <button> */}
              <button
                type="button"
                className="btn-real-action btn-registrati-wrap"
                onClick={() => onOpenAuth("register")}
                title="Crea un nuovo account Burraco"
              >
                <img
                  src="/images/btn-registrati.png"
                  alt="REGISTRATI"
                  className="btn-real-img"
                />
              </button>

              {/* Pulsante GIOCA COME OSPITE con Immagine dentro il comando <button> */}
              <button
                type="button"
                className="btn-real-action btn-ospite-wrap"
                onClick={() => onOpenAuth("guest")}
                title="Gioca subito come ospite"
              >
                <img
                  src="/images/btn-ospite.png"
                  alt="GIOCA COME OSPITE"
                  className="btn-real-img"
                />
              </button>
            </div>
          </section>

          {/* Sezione Pergamena Regole */}
          <section className="rules-scroll-section" aria-label="Regole del gioco">
            <div className="scroll-img-wrapper">
              <img
                src="/images/scroll-rules.png"
                alt="Regole del Gioco Burraco"
                className="scroll-rules-img"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
