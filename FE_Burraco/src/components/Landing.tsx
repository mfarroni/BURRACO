"use client";

import type { Card, Rank, Suit } from "@/lib/contract";
import type { AuthMode } from "@/components/AuthPanel";
import { CardView } from "@/components/CardView";

/**
 * VETRINA D'ACCESSO (Macro-ciclo 2) — prima vista dell'utente anonimo.
 *
 * Pura PRESENTAZIONE, fedele al mockup "vintage-lusso" (cornice dorata, boiserie,
 * lampadari, emblema corona+carte, hero a feltro verde, pannello CTA, pergamena
 * regole, bicchieri whisky). Nessuna route: i tre bottoni pilotano lo stato React
 * del ramo anonimo di `page.tsx`, che apre `<AuthPanel>` sul percorso scelto.
 *
 * Il client è muto sulle regole: qui non c'è alcuna logica di gioco, solo carte
 * statiche d'esempio rese col vero `CardView` (R5: riuso, non nuova arte carta).
 *
 * Confini di competenza: develop possiede struttura, wiring dei controlli e
 * fattibilità; l'aspetto grafico fine (valori d'oro, resa dei lampadari, ritmo
 * tipografico) è di agente_ui_ux. I PUNTI DI DECISIONE UX sono marcati "CO-DESIGN".
 */

interface Props {
  /** Apre l'AuthPanel sul percorso scelto (stato locale in page.tsx). */
  onOpenAuth: (mode: AuthMode) => void;
}

/* ── Carte statiche d'esempio per il ventaglio dell'hero (decorative) ─────── */
function demoCard(rank: Rank, suit: Suit | null): Card {
  return { id: `demo-${rank}-${suit ?? "x"}`, rank, suit, isWild: false, wildKind: null };
}
const HERO_FAN: { card: Card; rot: number }[] = [
  { card: demoCard("10", "clubs"), rot: -22 },
  { card: demoCard("J", "diamonds"), rot: -11 },
  { card: demoCard("Q", "diamonds"), rot: 0 },
  { card: demoCard("K", "spades"), rot: 11 },
  { card: demoCard("A", "hearts"), rot: 22 },
];

/* ── Voci di navigazione (SOLO resa visiva; link inerti tranne HOME) ──────── */
const NAV_ITEMS = ["HOME", "CHI SIAMO", "REGOLE", "TORNEI", "SHOP", "CONTATTI"] as const;

/* ── Pergamena: 5 sezioni, testo sintetico e corretto (fonte: skill-burraco) ─ */
const RULES: { title: string; body: string }[] = [
  {
    title: "INTRODUZIONE",
    body: "Burraco a due, uno contro uno. Con due mazzi di carte francesi e le matte (jolly e pinelle) si compongono giochi e si punta a chiudere prima dell'avversario.",
  },
  {
    title: "PREPARAZIONE",
    body: "Si formano due pozzetti da 11 carte e si distribuiscono 11 carte a testa; le restanti restano nel mazzo coperto. In due, il primo turno spetta al non-mazziere.",
  },
  {
    title: "SVOLGIMENTO DEL GIOCO",
    body: "Nel proprio turno peschi una carta dal mazzo oppure l'intero monte degli scarti, cali o amplii i tuoi giochi, e concludi scartando una carta.",
  },
  {
    title: "BURRACO PULITO E SPORCO",
    body: "Un burraco è un gioco di almeno 7 carte. Pulito (senza matte): 200 punti. Sporco (con una matta): 100 punti.",
  },
  {
    title: "PUNTEGGI",
    body: "Chiusura +100; le carte calate valgono a punteggio pieno; pozzetto non preso −100; le carte rimaste in mano si sottraggono.",
  },
];

/* ── Ornamenti SVG decorativi (aria-hidden) ───────────────────────────────────
 * NOTA: i colori dentro gli SVG sono hex LETTERALI (var() non è risolto in modo
 * affidabile negli attributi di presentazione SVG in Chrome — stesso motivo per
 * cui i mockup usano hex). Calibrazione ui_ux — famiglia oro "vintage-lusso"
 * coerente con le variabili locali di `.landing`:
 *   luce/highlight #ecd190 (= --gold-hi) · oro emblema #e0c07a · oro mid #c8a24a ·
 *   bronzo #a9853a · ivory-50 #f7f3e7 · ivory-100 #efe9d6 · ivory-200 #e3dcc4 ·
 *   ink-900 #1a1712 · card-red #b01b2e · felt 600/700/900 #1e5a44/#174a38/#0e2a22 ·
 *   dorso #7c1f2b/#5c141d. Ornamenti aria-hidden: contrasto non vincolante, ma
 *   tenuti caldi e leggibili per coerenza col resto della scena. */

/** Lampadario a candele (cristallo/ottone) con alone caldo. */
function Chandelier() {
  return (
    <svg className="lamp-svg" viewBox="0 0 120 150" aria-hidden="true">
      {/* catena di sospensione */}
      <line x1="60" y1="0" x2="60" y2="34" stroke="#c8a24a" strokeWidth="2" />
      {/* corona centrale */}
      <ellipse cx="60" cy="40" rx="9" ry="5" fill="#a9853a" />
      {/* bracci */}
      <path
        d="M60 42 C30 52 22 74 22 92 M60 42 C90 52 98 74 98 92 M60 44 L60 96"
        fill="none"
        stroke="#c8a24a"
        strokeWidth="2.5"
      />
      {/* candele + fiamme */}
      {[22, 60, 98].map((x) => (
        <g key={x}>
          <rect x={x - 3} y={x === 60 ? 90 : 86} width="6" height="14" rx="2" fill="#efe9d6" />
          <ellipse cx={x} cy={x === 60 ? 84 : 80} rx="4.5" ry="8" fill="#ecd190" opacity="0.95" />
          <circle cx={x} cy={x === 60 ? 84 : 80} r="2.4" fill="#f7f3e7" />
        </g>
      ))}
      {/* gocce di cristallo */}
      {[34, 48, 60, 72, 86].map((x, i) => (
        <path key={x} d={`M${x} ${104 + (i % 2) * 6} l4 10 l-4 8 l-4 -8 z`} fill="#ecd190" opacity="0.55" />
      ))}
    </svg>
  );
}

/** Emblema: corona sopra un ventaglio di carte. */
function CrownCrest() {
  return (
    <svg className="crest-svg" viewBox="0 0 96 96" aria-hidden="true">
      {/* ventaglio di carte */}
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
      {/* corona */}
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

/** Bicchiere di whisky con ghiaccio. */
function WhiskyGlass() {
  return (
    <svg className="whisky-svg" viewBox="0 0 70 70" aria-hidden="true">
      {/* liquido */}
      <path d="M14 30 H56 L52 60 Q52 64 48 64 H22 Q18 64 18 60 Z" fill="rgba(169,133,58,0.55)" />
      {/* vetro */}
      <path
        d="M12 26 H58 L53 61 Q52 66 47 66 H23 Q18 66 17 61 Z"
        fill="rgba(247,243,231,0.06)"
        stroke="#e3dcc4"
        strokeWidth="1.5"
      />
      {/* cubetti di ghiaccio */}
      <rect x="24" y="34" width="14" height="12" rx="3" fill="rgba(247,243,231,0.35)" />
      <rect x="34" y="40" width="12" height="11" rx="3" fill="rgba(247,243,231,0.28)" />
      {/* riflesso */}
      <path d="M20 30 L23 60" stroke="rgba(247,243,231,0.35)" strokeWidth="2" fill="none" />
    </svg>
  );
}

export function Landing({ onOpenAuth }: Props) {
  return (
    <div className="landing">
      {/* SLOT IMMAGINE (opzionale): per una boiserie/parete raster fedele, il lead
          può fornire un JPG in public/mockups/ e impostarlo come background di
          `.landing` in globals.css (var --lp-boiserie), mantenendo il gradiente
          attuale come fallback. Default: resa CSS self-contained. */}
      <div className="landing-frame">
        {/* Ornamenti d'angolo (decorativi). */}
        <span className="frame-corner c-tl" aria-hidden="true" />
        <span className="frame-corner c-tr" aria-hidden="true" />
        <span className="frame-corner c-bl" aria-hidden="true" />
        <span className="frame-corner c-br" aria-hidden="true" />

        {/* Lampadari negli angoli alti. */}
        <div className="lamp lamp-left" aria-hidden="true">
          <Chandelier />
        </div>
        <div className="lamp lamp-right" aria-hidden="true">
          <Chandelier />
        </div>

        {/* ── Testata: logo + emblema + navbar ─────────────────────────── */}
        <header className="landing-head">
          <div className="landing-logo">
            <h1 className="logo-word">Burraco</h1>
            <CrownCrest />
          </div>
          <p className="logo-sub">Circolo Notturno</p>

          <nav className="landing-nav" aria-label="Navigazione (anteprima)">
            {NAV_ITEMS.map((item) =>
              item === "HOME" ? (
                <span key={item} className="nav-item" aria-current="page">
                  {item}
                </span>
              ) : (
                <span
                  key={item}
                  className="nav-item"
                  aria-disabled="true"
                  title="Anteprima — sezione non attiva in questa versione"
                >
                  {item}
                </span>
              ),
            )}
          </nav>
        </header>

        {/* ── Hero: scena del tavolo (decorativa, role=img) ────────────── */}
        <section
          className="landing-hero"
          role="img"
          aria-label="Illustrazione di un tavolo da Burraco: feltro verde, due mani che giocano, mazzo coperto e monte scarti al centro, un ventaglio di carte avorio in primo piano, il nastro BURRACO e il gettone DEALER."
        >
          <div className="hero-felt" aria-hidden="true">
            {/* SLOT IMMAGINE (opzionale): se il lead fornisce una foto raster del
                tavolo, sostituire l'<svg> sottostante con:
                  <img src="/mockups/hero-tavolo.jpg" alt="" className="hero-scene" />
                (la resa SVG resta il default self-contained). */}
            <svg className="hero-scene" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice">
              <defs>
                <radialGradient id="lp-felt" cx="50%" cy="40%" r="75%">
                  <stop offset="0%" stopColor="#1e5a44" />
                  <stop offset="60%" stopColor="#174a38" />
                  <stop offset="100%" stopColor="#0e2a22" />
                </radialGradient>
                <radialGradient id="lp-warm" cx="50%" cy="26%" r="55%">
                  <stop offset="0%" stopColor="rgba(240,214,150,0.3)" />
                  <stop offset="100%" stopColor="rgba(240,214,150,0)" />
                </radialGradient>
                <linearGradient id="lp-back" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#7c1f2b" />
                  <stop offset="100%" stopColor="#5c141d" />
                </linearGradient>
              </defs>

              {/* feltro + luce calda + vignettatura */}
              <rect x="0" y="0" width="640" height="360" fill="url(#lp-felt)" />
              <rect x="0" y="0" width="640" height="360" fill="url(#lp-warm)" />
              <ellipse
                cx="320"
                cy="185"
                rx="330"
                ry="210"
                fill="none"
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="70"
                opacity="0.35"
              />

              {/* mani stilizzate (giacca scura + polsino) ai lati */}
              <g fill="#1c1c22" stroke="rgba(0,0,0,0.4)" strokeWidth="1">
                <path d="M-10 360 L-10 250 Q60 250 96 300 Q120 334 96 360 Z" />
                <path d="M650 360 L650 250 Q580 250 544 300 Q520 334 544 360 Z" />
              </g>
              <g fill="#e3dcc4" opacity="0.9">
                <ellipse cx="96" cy="300" rx="30" ry="20" />
                <ellipse cx="544" cy="300" rx="30" ry="20" />
              </g>

              {/* mazzo coperto + monte scarti al centro */}
              <g transform="translate(250 120)">
                <rect x="-3" y="-3" width="60" height="86" rx="9" fill="url(#lp-back)" stroke="#a9853a" strokeWidth="1.5" />
                <rect x="0" y="0" width="60" height="86" rx="9" fill="url(#lp-back)" stroke="#a9853a" strokeWidth="1.5" />
              </g>
              <g transform="translate(330 120)">
                <rect x="0" y="0" width="60" height="86" rx="9" fill="#f7f3e7" stroke="#c9c0a4" strokeWidth="1" />
                <text x="8" y="22" fontFamily="Georgia, serif" fontSize="16" fill="#b01b2e" fontWeight="700">K</text>
                <text x="26" y="58" fontFamily="Georgia, serif" fontSize="28" fill="#b01b2e">&#9829;</text>
              </g>

              {/* nastro BURRACO */}
              <g transform="translate(320 44)">
                <path d="M-150 -16 H150 L134 0 L150 16 H-150 L-134 0 Z" fill="#7c1f2b" stroke="#c8a24a" strokeWidth="2" />
                <text x="0" y="6" textAnchor="middle" fontFamily="Georgia, serif" fontSize="20" letterSpacing="6" fill="#ecd190" fontWeight="700">BURRACO</text>
              </g>

              {/* gettone DEALER */}
              <g transform="translate(470 250)">
                <circle r="26" fill="#1a1712" stroke="#e0c07a" strokeWidth="3" />
                <text x="0" y="5" textAnchor="middle" fontFamily="system-ui, sans-serif" fontSize="11" letterSpacing="1" fill="#ecd190" fontWeight="700">DEALER</text>
              </g>
            </svg>

            {/* Ventaglio di carte reali (CardView) in primo piano. */}
            <div className="hero-fan" aria-hidden="true">
              {HERO_FAN.map(({ card, rot }) => (
                <span key={card.id} className="hero-fan-card" style={{ transform: `translateX(-50%) rotate(${rot}deg)` }}>
                  <CardView card={card} />
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pannello CTA: tre bottoni a pillola di peso paritario ─────── */}
        <section className="landing-cta" aria-label="Come vuoi entrare">
          <button type="button" className="cta-pill" onClick={() => onOpenAuth("login")}>
            Accedi
          </button>
          <button
            type="button"
            className="cta-pill"
            data-featured="true"
            onClick={() => onOpenAuth("register")}
          >
            Registrati
          </button>
          <button type="button" className="cta-pill" onClick={() => onOpenAuth("guest")}>
            Gioca come Ospite
          </button>
        </section>

        {/* ── Pergamena delle regole ──────────────────────────────────── */}
        <section className="landing-rules" aria-labelledby="rules-title">
          <div className="scroll">
            <h2 id="rules-title" className="scroll-title">
              Regole del gioco — Burraco
            </h2>
            <div className="scroll-body">
              {RULES.map((r) => (
                <article key={r.title} className="rule-block">
                  <h3 className="rule-head">{r.title}</h3>
                  <p className="rule-text">{r.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Bicchieri di whisky negli angoli bassi. */}
        <div className="whisky whisky-left" aria-hidden="true">
          <WhiskyGlass />
        </div>
        <div className="whisky whisky-right" aria-hidden="true">
          <WhiskyGlass />
        </div>
      </div>
    </div>
  );
}
