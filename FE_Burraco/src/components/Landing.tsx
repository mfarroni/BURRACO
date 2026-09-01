"use client";

import type { AuthMode } from "@/components/AuthPanel";

interface Props {
  /** Apre AuthPanel sul percorso scelto (login, register, guest). */
  onOpenAuth: (mode: AuthMode) => void;
}

const NAV_ITEMS = ["HOME", "CHI SIAMO", "REGOLE", "TORNEI", "SHOP", "CONTATTI"] as const;

function ChandelierSVG() {
  return (
    <svg className="lamp-svg" viewBox="0 0 120 150" aria-hidden="true">
      <line x1="60" y1="0" x2="60" y2="34" stroke="#c8a24a" strokeWidth="2" />
      <ellipse cx="60" cy="40" rx="9" ry="5" fill="#a9853a" />
      <path
        d="M60 42 C30 52 22 74 22 92 M60 42 C90 52 98 74 98 92 M60 44 L60 96"
        fill="none"
        stroke="#c8a24a"
        strokeWidth="2.5"
      />
      {[22, 60, 98].map((x) => (
        <g key={x}>
          <rect x={x - 3} y={x === 60 ? 90 : 86} width="6" height="14" rx="2" fill="#efe9d6" />
          <ellipse cx={x} cy={x === 60 ? 84 : 80} rx="4.5" ry="8" fill="#ecd190" opacity="0.95" />
          <circle cx={x} cy={x === 60 ? 84 : 80} r="2.4" fill="#f7f3e7" />
        </g>
      ))}
      {[34, 48, 60, 72, 86].map((x, i) => (
        <path key={x} d={`M${x} ${104 + (i % 2) * 6} l4 10 l-4 8 l-4 -8 z`} fill="#ecd190" opacity="0.55" />
      ))}
    </svg>
  );
}

function CrownCrestSVG() {
  return (
    <svg className="crest-svg" viewBox="0 0 96 96" aria-hidden="true">
      <g transform="translate(48 60)">
        {[-22, -8, 8, 22].map((r, i) => (
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
            strokeWidth="1"
            opacity={0.85 + i * 0.03}
          />
        ))}
      </g>
      <path
        d="M28 34 L34 18 L42 30 L48 14 L54 30 L62 18 L68 34 Z"
        fill="#e0c07a"
        stroke="#a9853a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <rect x="28" y="34" width="40" height="7" rx="2" fill="#c8a24a" />
      {[34, 48, 62].map((x) => (
        <circle key={x} cx={x} cy="24" r="2.4" fill="#b01b2e" />
      ))}
    </svg>
  );
}

function WhiskyGlassSVG() {
  return (
    <svg className="whisky-svg" viewBox="0 0 70 70" aria-hidden="true">
      <path d="M14 30 H56 L52 60 Q52 64 48 64 H22 Q18 64 18 60 Z" fill="rgba(169,133,58,0.65)" />
      <path
        d="M12 26 H58 L53 61 Q52 66 47 66 H23 Q18 66 17 61 Z"
        fill="rgba(247,243,231,0.08)"
        stroke="#e3dcc4"
        strokeWidth="1.5"
      />
      <rect x="24" y="34" width="14" height="12" rx="3" fill="rgba(247,243,231,0.4)" />
      <rect x="34" y="40" width="12" height="11" rx="3" fill="rgba(247,243,231,0.32)" />
      <path d="M20 30 L23 60" stroke="rgba(247,243,231,0.4)" strokeWidth="2" fill="none" />
    </svg>
  );
}

export function Landing({ onOpenAuth }: Props) {
  return (
    <div className="landing-club-root">
      {/* ── LAYER 0 (Fisso) - Sfondo Boiserie + 4 Angoli ───────────────── */}
      <div className="layer-0-fixed" aria-hidden="true">
        <div className="corner-decor lamp-top-left">
          <ChandelierSVG />
        </div>
        <div className="corner-decor lamp-top-right">
          <ChandelierSVG />
        </div>
        <div className="corner-decor whisky-bottom-left">
          <WhiskyGlassSVG />
        </div>
        <div className="corner-decor whisky-bottom-right">
          <WhiskyGlassSVG />
        </div>
      </div>

      {/* ── LAYER 1 (Fisso) - Cornice Dorata Perimetrale Fullscreen ───── */}
      <div className="layer-1-frame-fixed" aria-hidden="true">
        <span className="frame-corner-bracket brk-tl" />
        <span className="frame-corner-bracket brk-tr" />
        <span className="frame-corner-bracket brk-bl" />
        <span className="frame-corner-bracket brk-br" />
      </div>

      {/* ── LAYER 2 (Fisso) - Header & Barra di Navigazione ───────────── */}
      <header className="layer-2-header-fixed">
        <div className="header-inner">
          <div className="header-logo-group">
            <h1 className="logo-text">Burraco</h1>
            <CrownCrestSVG />
            <span className="logo-subtext">Circolo Nettuno</span>
          </div>

          <nav className="header-nav-menu" aria-label="Navigazione Principale">
            {NAV_ITEMS.map((item) => (
              <a
                key={item}
                href="#"
                className={`nav-link-btn ${item === "HOME" ? "active" : ""}`}
                onClick={(e) => e.preventDefault()}
              >
                {item}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {/* ── LAYER 3 (Scroll Reale) - Flusso Contenuto Centrale ────────── */}
      <main className="layer-3-scroll-stream">
        <div className="stream-content-container">
          {/* BLOCCO 1: Tavolo da Gioco (Hero Card) */}
          <section className="block-hero-table" aria-label="Tavolo da gioco Burraco">
            <div className="hero-table-card">
              <img
                src="/images/hero-tavolo.png"
                alt="Tavolo verde Burraco Club"
                className="hero-table-img"
              />
            </div>
          </section>

          {/* BLOCCO 2: Pannello Azioni (Barra CTA in Pelle) */}
          <section className="block-leather-cta" aria-label="Pannello azioni d'accesso">
            <div className="leather-panel-inner">
              {/* ACCEDI */}
              <button
                type="button"
                className="btn-action-wrapper btn-accedi"
                onClick={() => onOpenAuth("login")}
                title="Accedi al tuo account Burraco"
              >
                <img
                  src="/images/btn-accedi.png"
                  alt="ACCEDI"
                  className="btn-action-img"
                />
              </button>

              {/* REGISTRATI (Pulsante Primario in Evidenza) */}
              <button
                type="button"
                className="btn-action-wrapper btn-registrati"
                onClick={() => onOpenAuth("register")}
                title="Crea un nuovo account Burraco"
              >
                <img
                  src="/images/btn-registrati.png"
                  alt="REGISTRATI"
                  className="btn-action-img"
                />
              </button>

              {/* GIOCA COME OSPITE */}
              <button
                type="button"
                className="btn-action-wrapper btn-ospite"
                onClick={() => onOpenAuth("guest")}
                title="Gioca subito come ospite"
              >
                <img
                  src="/images/btn-ospite.png"
                  alt="GIOCA COME OSPITE"
                  className="btn-action-img"
                />
              </button>
            </div>
          </section>

          {/* BLOCCO 3: Regolamento (Pergamena Antica Srotolata) */}
          <section className="block-scroll-rules" aria-label="Regolamento Burraco">
            <div className="scroll-pergamena-card">
              <img
                src="/images/scroll-rules.png"
                alt="Regole del Gioco Burraco"
                className="scroll-pergamena-img"
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
