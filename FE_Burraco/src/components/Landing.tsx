"use client";

import React, { useState } from "react";
import type { AuthMode } from "@/components/AuthPanel";

interface Props {
  /** Abre AuthPanel sul percorso scelto (login, register, guest). */
  onOpenAuth: (mode: AuthMode) => void;
}

const NAV_ITEMS = ["HOME", "CHI SIAMO", "REGOLE", "TORNEI", "SHOP", "CONTATTI"] as const;

export function Landing({ onOpenAuth }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogin = () => onOpenAuth("login");
  const handleSignup = () => onOpenAuth("register");
  const handleGuest = () => onOpenAuth("guest");

  return (
    <div className="landing-container">
      {/* Cornice Decorativa Fissa */}
      <img
        src="/images/cornice-grandeo.png"
        alt="Decorative Frame"
        className="frame-border"
      />

      {/* Bicchieri Fissi */}
      <img
        src="/images/bicchiere.png"
        alt="Whisky Glass"
        className="whisky-glass whisky-left"
      />
      <img
        src="/images/bicchiere.png"
        alt="Whisky Glass"
        className="whisky-glass whisky-right"
      />

      {/* Header Fisso */}
      <header className="header-fixed">
        <div className="logo-section">
          <h1>Burraco</h1>
          <p className="logo-subtitle">Circolo Nettuno</p>
        </div>

        <nav className={`navbar ${mobileMenuOpen ? "open" : ""}`}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setMobileMenuOpen(false);
              }}
            >
              {item}
            </a>
          ))}
        </nav>

        <button
          type="button"
          className="hamburger"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle navigation menu"
        >
          ☰
        </button>
      </header>

      {/* Contenuto Scrollabile */}
      <main className="content-wrapper">
        {/* HERO: Tavolo */}
        <section className="hero-section">
          <div className="hero-container">
            <img
              src="/images/Tavolo.png"
              alt="Burraco Table"
              className="hero-image"
            />
          </div>
        </section>

        {/* CTA: Bottoni */}
        <section className="cta-section">
          <div className="cta-bar">
            <button
              type="button"
              className="cta-button cta-accedi"
              onClick={handleLogin}
              title="Accedi al tuo account"
            >
              <img
                src="/images/pulsante-accedi.png"
                alt="Accedi"
                className="btn-image"
              />
            </button>

            <button
              type="button"
              className="cta-button cta-registrati cta-primary"
              onClick={handleSignup}
              title="Crea un nuovo account"
            >
              <img
                src="/images/pulsante-registrati.png"
                alt="Registrati"
                className="btn-image"
              />
            </button>

            <button
              type="button"
              className="cta-button cta-ospite"
              onClick={handleGuest}
              title="Gioca subito senza registrazione"
            >
              <img
                src="/images/pulsante-ospite.png"
                alt="Gioca Come Ospite"
                className="btn-image"
              />
            </button>
          </div>
        </section>

        {/* RULES: Regolamento */}
        <section className="rules-section">
          <div className="parchment">
            <h2>REGOLE DEL GIOCO - BURRACO</h2>
            <div className="rules-content">
              <h3>INTRODUZIONE</h3>
              <p>
                Burraco è un affascinante gioco di carte per 2 o 4 giocatori. L&apos;obiettivo è formare sequenze di carte (scale e tris) e chiudere la mano prima dell&apos;avversario.
              </p>

              <h3>PREPARAZIONE</h3>
              <p>
                Si utilizzano 2 mazzi di carte francesi (104 carte + 4 jolly). Ogni giocatore riceve 13 carte. Il resto forma il mazzo centrale e il pozzetto.
              </p>

              <h3>SVOLGIMENTO DEL GIOCO</h3>
              <p>
                Durante il turno: pesca una carta dal mazzo, organizza la mano, calala se possibile, e scarta una carta. Il gioco procede in senso orario.
              </p>

              <h3>BURRACO PULITO E SPORCO</h3>
              <p>
                PULITO (Canasta): sequenza di 7+ carte dello stesso seme senza jolly. Vale 200 punti. SPORCO: sequenza con jolly o pinelle. Vale 100 punti.
              </p>

              <h3>PUNTEGGI</h3>
              <p>
                Figure (K,Q,J): 10 punti. Assi: 1 o 15 punti. Numeri: valore nominale. Bonus chiusura: 100 punti. Jolly: 50 punti.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
