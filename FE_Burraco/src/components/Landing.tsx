"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthMode } from "@/components/AuthPanel";
import "./Landing.css";

/**
 * VETRINA (landing marketing) — riproduzione fedele del mockup approvato
 * ("Circolo Nettuno", vintage-lusso) dentro l'architettura React esistente.
 *
 * Il client è muto sulle regole: qui non c'è dominio di gioco. I tre pulsanti
 * azione NON navigano a route: aprono l'AuthPanel sul percorso scelto
 * (login/register/guest) tramite `onOpenAuth`. L'autenticazione vera vive in
 * AuthPanel, perciò i modali login/register del mockup NON sono riprodotti.
 *
 * Isolamento totale: ogni stile discende da `.landing-root` (vedi Landing.css);
 * nessuna regola tocca body/html, così la vetrina non contamina il design
 * system del gioco.
 */

interface Props {
  /** Apre AuthPanel sul percorso scelto (login, register, guest). */
  onOpenAuth: (mode: AuthMode) => void;
}

const LOGO_CARDS = [
  { src: "/images/landing/asso-picche.png", alt: "Asso di Picche" },
  { src: "/images/landing/asso-cuori.png", alt: "Asso di Cuori" },
  { src: "/images/landing/asso-quadri.png", alt: "Asso di Quadri" },
  { src: "/images/landing/asso-fiori.png", alt: "Asso di Fiori" },
] as const;

const NAV_ITEMS = [
  { id: "home", label: "Home" },
  { id: "chi-siamo", label: "Chi Siamo" },
  { id: "regole", label: "Regole" },
  { id: "tornei", label: "Tornei" },
  { id: "shop", label: "Shop" },
  { id: "contatti", label: "Contatti" },
] as const;

const HERO_SLIDES = [
  { src: "/images/landing/tavolo.png", alt: "Tavolo da gioco" },
  { src: "/images/landing/tavolo2.png", alt: "Mani del giocatore sul tavolo verde" },
  { src: "/images/landing/tavolo3.png", alt: "Tavolo da gioco con fiches" },
] as const;

const SHOP_ITEMS = [
  { icon: "", title: "Mazzo Carte Premium", desc: "Carte francesi professionali" },
  { icon: "🎴", title: "Tappetino da Gioco", desc: "Feltro verde premium 120x80cm" },
  { icon: "", title: "Guida Completa Burraco", desc: "Manuale illustrato 200 pagine" },
  { icon: "", title: "Set Torneo Completo", desc: "2 mazzi + tappetino + segnapunti" },
] as const;

const TOURNAMENTS = [
  { title: "Torneo Settimanale", lines: ["Ogni venerdì sera dalle 21:00", "Formula: 2 giocatori individuale", "Montepremi: €500"] },
  { title: "Campionato Mensile", lines: ["Ultimo sabato del mese", "Formula: 4 giocatori a coppie", "Montepremi: €2000"] },
  { title: "Torneo Speciale Estate", lines: ["Serata esclusiva con cena", "Formula: 6 giocatori", "Montepremi: €5000"] },
] as const;

export function Landing({ onOpenAuth }: Props) {
  // Slider hero: indice corrente + pausa su hover; l'avanzamento è governato da
  // un solo interval con cleanup (functional update → nessuna dipendenza sfuggente).
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  // Rispetto di prefers-reduced-motion: se l'utente chiede meno movimento
  // fermiamo l'autoplay dello slider (le animazioni CSS sono gate-ate in
  // Landing.css). Lo stato si aggiorna anche se la preferenza cambia a runtime.
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (paused || reduceMotion || HERO_SLIDES.length <= 1) return;
    const id = setInterval(() => {
      setSlide((i) => (i + 1) % HERO_SLIDES.length);
    }, 5000);
    return () => clearInterval(id);
  }, [paused, reduceMotion]);

  // Nav attiva allo scroll: evidenzia la voce della sezione visibile nel
  // contenitore scrollabile (non nella window).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string>("home");

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      let current = "home";
      for (const item of NAV_ITEMS) {
        const section = el.querySelector<HTMLElement>(`#${item.id}`);
        if (section && el.scrollTop >= section.offsetTop - 100) current = item.id;
      }
      setActiveSection(current);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="landing-root">
      <div className="room-background" aria-hidden="true" />

      <div className="frame-overlay" aria-hidden="true">
        <div className="frame-decorative" />
        <div className="frame-corner tl" />
        <div className="frame-corner tr" />
        <div className="frame-corner bl" />
        <div className="frame-corner br" />
      </div>

      <div className="scroll-container" ref={scrollRef}>
        <div className="content-wrapper">
          <header className="site-header" id="home">
            <div className="logo-container">
              <h1 className="logo-title">Burraco</h1>
              <div className="logo-cards">
                {LOGO_CARDS.map((card) => (
                  <div className="logo-card" key={card.alt}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={card.src} alt={card.alt} />
                  </div>
                ))}
              </div>
            </div>
            <p className="logo-subtitle">Circolo Nettuno</p>
          </header>

          <nav className="main-nav" aria-label="Navigazione della vetrina">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`nav-link${activeSection === item.id ? " active" : ""}`}
                aria-current={activeSection === item.id ? "true" : undefined}
                onClick={() => setActiveSection(item.id)}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <section
            className="hero-section"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="hero-slider">
              {HERO_SLIDES.map((s, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={s.src}
                  src={s.src}
                  alt={s.alt}
                  className={`hero-image hero-slide${i === slide ? " active" : ""}`}
                />
              ))}
            </div>
            <div className="hero-overlay">
              <div className="hero-badge">
                <div className="hero-badge-text">BURRACO</div>
              </div>
              <div className="dealer-button">DEALER</div>
            </div>
            <div className="hero-dots">
              {HERO_SLIDES.map((s, i) => (
                <button
                  key={s.src}
                  type="button"
                  className={`hero-dot${i === slide ? " active" : ""}`}
                  aria-label={`Mostra immagine ${i + 1} di ${HERO_SLIDES.length}`}
                  aria-pressed={i === slide}
                  onClick={() => setSlide(i)}
                />
              ))}
            </div>
          </section>

          <div className="action-buttons">
            <button type="button" className="btn btn-access" onClick={() => onOpenAuth("login")}>
              Accedi
            </button>
            <button type="button" className="btn btn-register" onClick={() => onOpenAuth("register")}>
              Registrati
            </button>
            <button type="button" className="btn btn-guest" onClick={() => onOpenAuth("guest")}>
              Gioca come Ospite
            </button>
          </div>

          <section className="section" id="chi-siamo">
            <h2 className="section-title">Chi Siamo</h2>
            <div className="about-content">
              <div className="about-text">
                <p>
                  Benvenuti al <strong>Circolo Nettuno</strong>, il punto di riferimento per gli
                  appassionati di Burraco in Italia. Dal 2010 organizziamo tornei, eventi e serate
                  dedicate a questo affascinante gioco di carte.
                </p>
                <p>
                  Il nostro circolo offre un ambiente elegante e accogliente, dove tradizione e
                  passione si incontrano per creare esperienze di gioco indimenticabili.
                </p>
                <p>
                  Che tu sia un principiante o un giocatore esperto, qui troverai la tua casa.
                  Unisciti alla nostra community e scopri il piacere del Burraco!
                </p>
              </div>
              <div className="about-image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/landing/sala.png" alt="Sala del circolo" />
              </div>
            </div>
          </section>

          <section className="section" id="regole" aria-label="Regole del gioco">
            {/* Le regole sono rese come immagine (pergamena): forniamo heading e
                testo alternativo per screen reader, altrimenti la sezione sarebbe
                muta all'accessibilità (WCAG 1.1.1 / 1.4.5). */}
            <h2 className="lp-visually-hidden">Regole del Gioco</h2>
            <p className="lp-visually-hidden">
              Le regole del Burraco sono illustrate sulla pergamena: introduzione,
              preparazione, svolgimento del gioco, burraco pulito e sporco, punteggi.
            </p>
            <div className="rules-section">
              <div className="parchment-container">
                <div className="whiskey-glass-left">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/landing/bicchiere.png" alt="" />
                </div>
                <div className="whiskey-glass-right">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/landing/bicchiere.png" alt="" />
                </div>
              </div>
            </div>
          </section>

          <section className="section" id="tornei">
            <h2 className="section-title">
              Tornei <span className="soon-badge">Prossimamente</span>
            </h2>
            <div className="tournaments-grid">
              {TOURNAMENTS.map((t) => (
                <div className="tournament-card" key={t.title}>
                  <h3>{t.title}</h3>
                  {t.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  <div className="tournament-date">Prossimamente</div>
                </div>
              ))}
            </div>
          </section>

          <section className="section" id="shop">
            <h2 className="section-title">
              Shop <span className="soon-badge">Prossimamente</span>
            </h2>
            <div className="shop-grid">
              {SHOP_ITEMS.map((item) => (
                <div className="shop-item" key={item.title}>
                  <div className="shop-item-image" aria-hidden="true">{item.icon}</div>
                  <h4>{item.title}</h4>
                  <p>{item.desc}</p>
                  <button type="button" className="btn-buy" disabled>
                    Aggiungi al Carrello
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="section" id="contatti">
            <h2 className="section-title">
              Contatti <span className="soon-badge">Prossimamente</span>
            </h2>
            <div className="contact-container">
              <form className="contact-form" aria-label="Modulo contatti (non attivo)">
                <div className="form-group">
                  <label htmlFor="contact-name">Nome</label>
                  <input id="contact-name" type="text" autoComplete="off" disabled />
                </div>
                <div className="form-group">
                  <label htmlFor="contact-email">Email</label>
                  <input id="contact-email" type="email" autoComplete="off" disabled />
                </div>
                <div className="form-group">
                  <label htmlFor="contact-message">Messaggio</label>
                  <textarea id="contact-message" disabled />
                </div>
                <button type="button" className="btn btn-register contact-submit" disabled>
                  Invia Messaggio
                </button>
                <p className="contact-note">Modulo in arrivo prossimamente</p>
              </form>
            </div>
          </section>

          <footer className="site-footer">
            <p>© 2026 Circolo Nettuno - Burraco. Tutti i diritti riservati.</p>
            <p className="footer-fine-print">
              Il gioco è vietato ai minori di 18 anni. Gioca responsabilmente.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
