"use client";

import { useState } from "react";
import type { AuthMode } from "@/components/AuthPanel";

interface Props {
  /** Abre AuthPanel sul percorso scelto (login, register, guest). */
  onOpenAuth: (mode: AuthMode) => void;
}

const NAV_ITEMS = ["HOME", "CHI SIAMO", "REGOLE", "TORNEI", "SHOP", "CONTATTI"] as const;

const RULES_DATA = [
  {
    title: "INTRODUZIONE",
    body: "Burraco è un gioco di carte della famiglia della Canasta. Si gioca in due giocatori (uno contro uno) oppure a coppie, utilizzando due mazzi di carte francesi comprese le quattro matte (jolly e pinelle). L'obiettivo principale è comporre combinazioni e sequenze di carte valide per calarle sul tavolo e chiudere prima dell'avversario.",
  },
  {
    title: "PREPARAZIONE",
    body: "Il mazziere distribuisce 11 carte ciascuno e compone a parte due mazzetti da 11 carte detti 'pozzetti', riposti ai lati del tavolo. Le carte rimanenti formano il mazzo di pesca centrale, dal quale viene scoperta la prima carta per iniziare il monte degli scarti.",
  },
  {
    title: "SVOLGIMENTO DEL GIOCO",
    body: "Ogni turno di gioco si articola in tre fasi fondamentali: 1) Pesca dal mazzo coperto o raccolta di tutte le carte dal monte degli scarti; 2) Calata di nuove combinazioni (tris/quartetti) o sequenze (scale) oppure integrazione di carte su giochi già esistenti; 3) Scarto di una carta della propria mano sul monte degli scarti.",
  },
  {
    title: "BURRACO PULITO E SPORCO",
    body: "Un Burraco è una combinazione o sequenza composta da almeno 7 carte. Si definisce 'Pulito' (o puro) se non contiene alcuna matta o pinella (valore: 200 punti). Si definisce 'Sporco' (o impuro) se contiene un jolly o una pinella utilizzata come jolly (valore: 100 punti). Il Burraco 'Reale' è una scala da Asso a Re senza matte del medesimo seme (valore: 300 punti).",
  },
  {
    title: "PUNTEGGI",
    body: "La partita termina quando un giocatore effettua la 'Chiusura' (rimanendo senza carte in mano dopo aver preso il pozzetto ed effettuato almeno un burraco). Punteggi: Chiusura +100 Punti; Burraco Pulito +200; Burraco Sporco +100; Carte calate sul tavolo: somma dei singoli valori; Pozzetto non preso −100; Carte rimaste in mano: valore sottratto dal totale.",
  },
];

function ChandelierSVG() {
  return (
    <svg className="lamp-svg" viewBox="0 0 140 180" aria-hidden="true">
      <line x1="70" y1="0" x2="70" y2="40" stroke="#c8a24a" strokeWidth="2.5" />
      <ellipse cx="70" cy="46" rx="12" ry="6" fill="#a9853a" />
      <path
        d="M70 48 C30 60 20 90 20 115 M70 48 C110 60 120 90 120 115 M70 50 L70 122 M70 48 C45 65 38 95 38 118 M70 48 C95 65 102 95 102 118"
        fill="none"
        stroke="#c8a24a"
        strokeWidth="2.5"
      />
      {[20, 38, 70, 102, 120].map((x, i) => (
        <g key={x}>
          <rect x={x - 3.5} y={i === 2 ? 116 : 109} width="7" height="16" rx="2" fill="#efe9d6" />
          <ellipse cx={x} cy={i === 2 ? 110 : 103} rx="5.5" ry="9.5" fill="#ecd190" opacity="0.95" />
          <circle cx={x} cy={i === 2 ? 110 : 103} r="3" fill="#ffffff" />
        </g>
      ))}
      {[30, 48, 70, 92, 110].map((x, i) => (
        <path key={x} d={`M${x} ${132 + (i % 2) * 8} l5 12 l-5 10 l-5 -10 z`} fill="#f5d77f" opacity="0.65" />
      ))}
    </svg>
  );
}

function CrownCrestSVG() {
  return (
    <svg className="crest-svg" viewBox="0 0 96 96" aria-hidden="true">
      <g transform="translate(48 60)">
        {[-24, -9, 9, 24].map((r, i) => (
          <rect
            key={r}
            x="-10"
            y="-30"
            width="20"
            height="30"
            rx="3"
            transform={`rotate(${r}) translate(0 6)`}
            fill="#f7f3e7"
            stroke="#a9853a"
            strokeWidth="1.2"
            opacity={0.88 + i * 0.03}
          />
        ))}
      </g>
      <path
        d="M26 34 L33 16 L42 28 L48 12 L54 28 L63 16 L70 34 Z"
        fill="#e0c07a"
        stroke="#a9853a"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <rect x="26" y="34" width="44" height="8" rx="2" fill="#c8a24a" stroke="#8a6721" strokeWidth="1" />
      {[33, 48, 63].map((x) => (
        <circle key={x} cx={x} cy="22" r="2.8" fill="#b01b2e" />
      ))}
    </svg>
  );
}

function WhiskyGlassSVG() {
  return (
    <svg className="whisky-svg" viewBox="0 0 80 80" aria-hidden="true">
      {/* Piano del tavolo in legno scuro sotto il bicchiere */}
      <ellipse cx="40" cy="72" rx="36" ry="7" fill="rgba(15, 9, 5, 0.85)" />
      {/* Liquido whisky ambrato */}
      <path d="M16 34 H64 L59 68 Q58 73 53 73 H27 Q22 73 21 68 Z" fill="url(#whisky-amber-grad)" />
      {/* Struttura bicchiere in cristallo */}
      <path
        d="M14 28 H66 L60 69 Q58 75 52 75 H28 Q22 75 20 69 Z"
        fill="rgba(247, 243, 231, 0.07)"
        stroke="#e3dcc4"
        strokeWidth="1.8"
      />
      {/* Cubetti di ghiaccio */}
      <rect x="26" y="38" width="16" height="14" rx="3" fill="rgba(255, 255, 255, 0.45)" stroke="rgba(255, 255, 255, 0.7)" strokeWidth="1" transform="rotate(-8 34 45)" />
      <rect x="40" y="44" width="14" height="13" rx="3" fill="rgba(255, 255, 255, 0.38)" stroke="rgba(255, 255, 255, 0.6)" strokeWidth="1" transform="rotate(12 47 50)" />
      {/* Riflessi di luce sul vetro */}
      <path d="M22 32 L25 68" stroke="rgba(255, 255, 255, 0.5)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M60 36 L57 64" stroke="rgba(255, 255, 255, 0.3)" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      <defs>
        <linearGradient id="whisky-amber-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d48c28" />
          <stop offset="60%" stopColor="#b36214" />
          <stop offset="100%" stopColor="#6e3104" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Landing({ onOpenAuth }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="landing-club-root">
      {/* ── LAYER A (Fisso, z-index: 1) - Sfondo Boiserie + 4 Oggetti Angoli ── */}
      <div className="layer-a-bg-fixed" aria-hidden="true">
        {/* Lampadari di Cristallo in Alto */}
        <div className="corner-object lamp-top-left">
          <ChandelierSVG />
        </div>
        <div className="corner-object lamp-top-right">
          <ChandelierSVG />
        </div>
        {/* Bicchieri di Whisky in Basso */}
        <div className="corner-object whisky-bottom-left">
          <WhiskyGlassSVG />
        </div>
        <div className="corner-object whisky-bottom-right">
          <WhiskyGlassSVG />
        </div>
      </div>

      {/* ── LAYER B (Fisso, z-index: 40) - Cornice Dorata Perimetrale Fullscreen ── */}
      <div className="layer-b-frame-fixed" aria-hidden="true">
        <span className="frame-bracket brk-tl" />
        <span className="frame-bracket brk-tr" />
        <span className="frame-bracket brk-bl" />
        <span className="frame-bracket brk-br" />
      </div>

      {/* ── LAYER C (Fisso, z-index: 50) - Header & Navigazione ── */}
      <header className="layer-c-header-fixed">
        <div className="header-container">
          <div className="header-logo-row">
            <h1 className="logo-gold-title">Burraco</h1>
            <CrownCrestSVG />
            <span className="logo-gold-subtitle">Circolo Nettuno</span>
          </div>

          {/* Navigazione Desktop */}
          <nav className="desktop-navbar" aria-label="Navigazione Principale">
            {NAV_ITEMS.map((item) => (
              <a
                key={item}
                href="#"
                className={`nav-button-link ${item === "HOME" ? "active" : ""}`}
                onClick={(e) => e.preventDefault()}
              >
                {item}
              </a>
            ))}
          </nav>

          {/* Pulsante Hamburger Mobile */}
          <button
            type="button"
            className="mobile-hamburger-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            <span className={`hamburger-bar ${mobileMenuOpen ? "open" : ""}`} />
            <span className={`hamburger-bar ${mobileMenuOpen ? "open" : ""}`} />
            <span className={`hamburger-bar ${mobileMenuOpen ? "open" : ""}`} />
          </button>
        </div>

        {/* Menu Overlay Mobile */}
        {mobileMenuOpen && (
          <nav className="mobile-nav-overlay" aria-label="Navigazione Mobile">
            {NAV_ITEMS.map((item) => (
              <a
                key={item}
                href="#"
                className={`mobile-nav-link ${item === "HOME" ? "active" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  setMobileMenuOpen(false);
                }}
              >
                {item}
              </a>
            ))}
          </nav>
        )}
      </header>

      {/* ── LAYER D (Scroll Reale, z-index: 20) - Flusso Contenuto Centrale ── */}
      <main className="layer-d-scroll-container">
        <div className="central-stream-wrapper">
          {/* BLOCCO 1: Tavolo da Gioco (Hero Card) Nativo in SVG/CSS */}
          <section className="hero-table-block" aria-label="Tavolo da gioco Burraco">
            <div className="hero-felt-card">
              <svg className="hero-felt-svg" viewBox="0 0 720 400" preserveAspectRatio="xMidYMid slice">
                <defs>
                  <radialGradient id="felt-radial-bg" cx="50%" cy="50%" r="65%">
                    <stop offset="0%" stopColor="#145737" />
                    <stop offset="55%" stopColor="#0d4a2b" />
                    <stop offset="85%" stopColor="#072a18" />
                    <stop offset="100%" stopColor="#04140b" stopOpacity="0.9" />
                  </radialGradient>

                  <linearGradient id="card-back-pattern" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#8b1e2b" />
                    <stop offset="100%" stopColor="#5c101b" />
                  </linearGradient>

                  <linearGradient id="gold-ribbon-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a32835" />
                    <stop offset="50%" stopColor="#7c1a24" />
                    <stop offset="100%" stopColor="#4a0f16" />
                  </linearGradient>

                  <filter id="felt-shadow" x="-10%" y="-10%" width="120%" height="120%">
                    <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000000" floodOpacity="0.6" />
                  </filter>
                </defs>

                {/* Sfondo Tavolo Verde feltro */}
                <rect width="720" height="400" fill="url(#felt-radial-bg)" />
                <rect x="6" y="6" width="708" height="388" rx="24" fill="none" stroke="#c8a24a" strokeWidth="2" strokeDasharray="8 4" opacity="0.6" />

                {/* Mani del Croupier con Fede Nuziale che distribuiscono il mazzo */}
                <g filter="url(#felt-shadow)">
                  {/* Maniche giacca scura e polsini bianchi */}
                  <path d="M120 -20 L240 110 L210 130 L90 0 Z" fill="#18151a" />
                  <path d="M600 -20 L480 110 L510 130 L630 0 Z" fill="#18151a" />
                  <path d="M225 100 L242 112 L228 124 L211 112 Z" fill="#f7f3e7" />
                  <path d="M495 100 L512 112 L498 124 L481 112 Z" fill="#f7f3e7" />

                  {/* Mani color pelle reale */}
                  <path d="M228 112 Q270 125 310 120 Q330 140 315 155 Q270 160 228 130 Z" fill="#e6b89c" stroke="#c49377" strokeWidth="1" />
                  <path d="M492 112 Q450 125 410 120 Q390 140 405 155 Q450 160 492 130 Z" fill="#e6b89c" stroke="#c49377" strokeWidth="1" />

                  {/* Fede nuziale dorata sulla mano sinistra */}
                  <ellipse cx="275" cy="132" rx="4" ry="7" fill="#f5d77f" stroke="#c8a24a" strokeWidth="1.5" transform="rotate(-15 275 132)" />
                </g>

                {/* Mazzo di Pesca Coperto al centro */}
                <g transform="translate(325 115)" filter="url(#felt-shadow)">
                  <rect x="-4" y="-4" width="70" height="96" rx="6" fill="url(#card-back-pattern)" stroke="#c8a24a" strokeWidth="1.5" />
                  <rect x="-2" y="-2" width="70" height="96" rx="6" fill="url(#card-back-pattern)" stroke="#c8a24a" strokeWidth="1.5" />
                  <rect x="0" y="0" width="70" height="96" rx="6" fill="url(#card-back-pattern)" stroke="#f5d77f" strokeWidth="1.5" />
                  <rect x="4" y="4" width="62" height="88" rx="4" fill="none" stroke="#e0c07a" strokeWidth="1" strokeDasharray="4 2" />
                </g>

                {/* Carte aperte a sinistra */}
                <g transform="translate(140 220)" filter="url(#felt-shadow)">
                  <rect x="0" y="0" width="64" height="90" rx="6" fill="#f7f3e7" stroke="#c9c0a4" strokeWidth="1" transform="rotate(-12)" />
                  <text x="8" y="22" fontFamily="Georgia, serif" fontSize="16" fill="#18151a" fontWeight="700" transform="rotate(-12)">8</text>
                  <text x="18" y="42" fontFamily="Georgia, serif" fontSize="22" fill="#18151a" transform="rotate(-12)">♠</text>
                </g>

                {/* Ventaglio di Carte in basso a destra */}
                <g transform="translate(390 240)" filter="url(#felt-shadow)">
                  {/* Carta 1: 10♣ */}
                  <g transform="rotate(-18 30 80)">
                    <rect x="0" y="0" width="60" height="86" rx="6" fill="#f7f3e7" stroke="#c9c0a4" strokeWidth="1" />
                    <text x="6" y="20" fontFamily="Georgia, serif" fontSize="14" fill="#18151a" fontWeight="700">10</text>
                    <text x="10" y="38" fontFamily="Georgia, serif" fontSize="18" fill="#18151a">♣</text>
                  </g>
                  {/* Carta 2: J♦ */}
                  <g transform="rotate(-9 30 80)">
                    <rect x="0" y="0" width="60" height="86" rx="6" fill="#f7f3e7" stroke="#c9c0a4" strokeWidth="1" />
                    <text x="6" y="20" fontFamily="Georgia, serif" fontSize="14" fill="#b01b2e" fontWeight="700">J</text>
                    <text x="10" y="38" fontFamily="Georgia, serif" fontSize="18" fill="#b01b2e">♦</text>
                  </g>
                  {/* Carta 3: Q♦ */}
                  <g transform="rotate(0 30 80)">
                    <rect x="0" y="0" width="60" height="86" rx="6" fill="#f7f3e7" stroke="#c9c0a4" strokeWidth="1" />
                    <text x="6" y="20" fontFamily="Georgia, serif" fontSize="14" fill="#b01b2e" fontWeight="700">Q</text>
                    <text x="10" y="38" fontFamily="Georgia, serif" fontSize="18" fill="#b01b2e">♦</text>
                  </g>
                  {/* Carta 4: K♠ */}
                  <g transform="rotate(9 30 80)">
                    <rect x="0" y="0" width="60" height="86" rx="6" fill="#f7f3e7" stroke="#c9c0a4" strokeWidth="1" />
                    <text x="6" y="20" fontFamily="Georgia, serif" fontSize="14" fill="#18151a" fontWeight="700">K</text>
                    <text x="10" y="38" fontFamily="Georgia, serif" fontSize="18" fill="#18151a">♠</text>
                  </g>
                  {/* Carta 5: A♥ */}
                  <g transform="rotate(18 30 80)">
                    <rect x="0" y="0" width="60" height="86" rx="6" fill="#f7f3e7" stroke="#c9c0a4" strokeWidth="1" />
                    <text x="6" y="20" fontFamily="Georgia, serif" fontSize="14" fill="#b01b2e" fontWeight="700">A</text>
                    <text x="10" y="38" fontFamily="Georgia, serif" fontSize="18" fill="#b01b2e">♥</text>
                  </g>
                </g>

                {/* Badge / Nastro Tridimensionale BURRACO */}
                <g transform="translate(360 215)" filter="url(#felt-shadow)">
                  <path d="M-130 -16 H130 L115 0 L130 16 H-130 L-115 0 Z" fill="url(#gold-ribbon-grad)" stroke="#f5d77f" strokeWidth="2" />
                  <text x="0" y="6" textAnchor="middle" fontFamily="Georgia, serif" fontSize="19" letterSpacing="5" fill="#f7e2a3" fontWeight="700">BURRACO</text>
                </g>

                {/* Gettone Rotondo Bianco DEALER */}
                <g transform="translate(590 280)" filter="url(#felt-shadow)">
                  <ellipse cx="0" cy="0" rx="30" ry="24" fill="#f7f3e7" stroke="#c8a24a" strokeWidth="3" />
                  <ellipse cx="0" cy="0" rx="25" ry="19" fill="#ffffff" stroke="#e0c07a" strokeWidth="1" />
                  <text x="0" y="5" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="11" letterSpacing="2" fill="#18151a" fontWeight="800">DEALER</text>
                </g>
              </svg>
            </div>
          </section>

          {/* BLOCCO 2: Barra Azioni in Pelle (CTA Bar) Nativa in CSS/HTML */}
          <section className="cta-leather-block" aria-label="Pannello azioni d'accesso">
            <div className="stitched-leather-panel">
              {/* ACCEDI */}
              <button
                type="button"
                className="cta-action-btn btn-accedi-satin"
                onClick={() => onOpenAuth("login")}
              >
                <span className="btn-label-text">ACCEDI</span>
              </button>

              {/* REGISTRATI (Pulsante Primario Dorato con Glow) */}
              <button
                type="button"
                className="cta-action-btn btn-registrati-gold"
                onClick={() => onOpenAuth("register")}
              >
                <span className="btn-label-text">REGISTRATI</span>
              </button>

              {/* GIOCA COME OSPITE */}
              <button
                type="button"
                className="cta-action-btn btn-ospite-satin"
                onClick={() => onOpenAuth("guest")}
              >
                <span className="btn-label-text">GIOCA COME OSPITE</span>
              </button>
            </div>
          </section>

          {/* BLOCCO 3: Pergamena del Regolamento Nativa in CSS/HTML */}
          <section className="rules-pergamena-block" aria-labelledby="rules-main-title">
            <div className="ancient-scroll-container">
              <div className="scroll-wooden-roller roller-top" />
              
              <div className="scroll-paper-body">
                <h2 id="rules-main-title" className="scroll-paper-title">
                  REGOLE DEL GIOCO — BURRACO
                </h2>

                <div className="scroll-rules-grid">
                  {RULES_DATA.map((rule) => (
                    <article key={rule.title} className="rule-section-item">
                      <h3 className="rule-section-head">{rule.title}</h3>
                      <p className="rule-section-body">{rule.body}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="scroll-wooden-roller roller-bottom" />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
