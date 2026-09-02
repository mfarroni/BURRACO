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
      {/* ===== LAYER 1: SFONDO BOISERIE (z:1) ===== */}
      <div className="background-boiserie" />

      {/* ===== LAYER 2: LAMPADARI E BICCHIERI (z:10) ===== */}
      <img
        src="/images/cornice-grandeo.png"
        alt="Chandelier Top Left"
        className="decorative-chandelier chandelier-tl"
      />
      <img
        src="/images/cornice-grandeo.png"
        alt="Chandelier Top Right"
        className="decorative-chandelier chandelier-tr"
      />

      <img
        src="/images/bicchiere.png"
        alt="Whisky Glass Left"
        className="whisky-glass whisky-left"
      />
      <img
        src="/images/bicchiere.png"
        alt="Whisky Glass Right"
        className="whisky-glass whisky-right"
      />

      {/* ===== LAYER 3: CORNICE DECORATIVA (z:40) ===== */}
      <div className="frame-border" aria-hidden="true" />

      {/* ===== LAYER 4: HEADER FISSO (z:50) ===== */}
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

      {/* ===== LAYER 5: CONTENUTO SCROLLABILE (z:30) ===== */}
      <main className="content-wrapper">
        {/* === BLOCCO 1: HERO === */}
        <section className="hero-section">
          <div className="hero-container">
            <img
              src="/images/Tavolo.png"
              alt="Burraco Table"
              className="hero-image"
            />
          </div>
        </section>

        {/* === BLOCCO 2: CTA === */}
        <section className="cta-section">
          <div className="cta-bar">
            <button
              type="button"
              className="cta-button"
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
              className="cta-button cta-primary"
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
              className="cta-button"
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

        {/* === BLOCCO 3: RULES === */}
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
