"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthMode } from "@/components/AuthPanel";
import "./Landing.css";

/**
 * VETRINA (landing marketing) — v2, direzione "Circolo Nettuno" vintage-lusso.
 *
 * Differenze rispetto alla v1:
 *  · l'hero porta promessa + CTA (primario "Gioca come ospite"), non un badge;
 *  · nuova sezione "Come si gioca in 30 secondi";
 *  · le REGOLE sono TESTO REALE su pergamena in CSS (prima: immagine con testo
 *    alternativo nascosto → illeggibile a zoom, non selezionabile);
 *  · Tornei e Shop diventano una roadmap onesta, senza montepremi in denaro;
 *  · nuove sezioni "Perché registrarsi" e "Sostieni" (Ko-fi);
 *  · Contatti senza form disabilitato: un solo CTA mail.
 *
 * Il client resta MUTO sul dominio: qui non c'è logica di gioco, i testi delle
 * regole sono contenuto statico. I CTA NON navigano a route: aprono AuthPanel
 * sul percorso scelto tramite `onOpenAuth`.
 *
 * Isolamento totale: ogni stile discende da `.landing-root` (vedi Landing.css);
 * nessuna regola tocca body/html, così la vetrina non contamina il design
 * system del gioco.
 */

interface Props {
  /** Apre AuthPanel sul percorso scelto (login, register, guest). */
  onOpenAuth: (mode: AuthMode) => void;
}

/** Ko-fi da env: se manca, la sezione "Sostieni" non viene resa (vedi sotto). */
const KOFI_URL = process.env.NEXT_PUBLIC_KOFI_URL ?? "";
/** Mail contatti da env, con fallback neutro. */
const CONTACT_MAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";

const LOGO_CARDS = [
  { src: "/images/landing/asso-picche.png", alt: "Asso di Picche" },
  { src: "/images/landing/asso-cuori.png", alt: "Asso di Cuori" },
  { src: "/images/landing/asso-quadri.png", alt: "Asso di Quadri" },
  { src: "/images/landing/asso-fiori.png", alt: "Asso di Fiori" },
] as const;

const NAV_ITEMS = [
  { id: "home", label: "Home" },
  { id: "come-si-gioca", label: "Come si gioca" },
  { id: "chi-siamo", label: "Chi Siamo" },
  { id: "regole", label: "Regole" },
  { id: "tornei", label: "Tornei" },
  { id: "sostieni", label: "Sostieni" },
  { id: "contatti", label: "Contatti" },
] as const;

const HERO_SLIDES = [
  { src: "/images/landing/tavolo.png", alt: "Tavolo da gioco" },
  { src: "/images/landing/tavolo2.png", alt: "Mani del giocatore sul tavolo verde" },
  { src: "/images/landing/tavolo3.png", alt: "Tavolo da gioco con fiches" },
] as const;

const STEPS = [
  { n: "I", title: "Pesca", body: "Una carta dal mazzo, o tutto il monte degli scarti." },
  { n: "II", title: "Cala", body: "Tris e scale sul tavolo. Jolly e pinelle fanno da carta mancante." },
  { n: "III", title: "Pozzetto", body: "Finite le carte in mano, il mazzetto riservato diventa tuo." },
  { n: "IV", title: "Chiudi", body: "Due burraco in tavola e la mano vuota. Poi si contano i punti." },
] as const;

/** Regole: contenuto STATICO di vetrina. La fonte di verità del gioco resta
 *  il server; questa è una sintesi divulgativa, non una specifica. */
const RULES = [
  {
    n: "I",
    title: "Introduzione",
    body: "Due mazzi da 54 carte, jolly compresi. Obiettivo: comporre combinazioni, prendere il pozzetto e chiudere.",
  },
  {
    n: "II",
    title: "Preparazione",
    body: "Undici carte a testa, due pozzetti da undici messi da parte, il resto a mazzo coperto e la prima carta scoperta.",
  },
  {
    n: "III",
    title: "Svolgimento",
    body: "Al proprio turno: si pesca una carta dal mazzo o tutto il monte degli scarti, si cala o si attacca, si scarta.",
  },
  {
    n: "IV",
    title: "Burraco pulito e sporco",
    body: "Sette carte nella stessa combinazione. Senza jolly né pinelle è pulito e vale 200 punti; con una matta è sporco e vale 100.",
  },
  {
    n: "V",
    title: "Punteggi",
    body: "Le carte calate si sommano, quelle rimaste in mano si sottraggono. La chiusura porta il suo bonus.",
  },
  {
    n: "VI",
    title: "Durante la partita",
    body: "Le regole complete restano a portata di mano, dal pannello al tavolo. Nessuno deve ricordarle a memoria.",
  },
] as const;

const ROADMAP = [
  {
    stage: "In sviluppo",
    title: "Tavoli a coppie",
    body: "Il 2 contro 2. Il layout del tavolo è già predisposto.",
    lead: true,
  },
  {
    stage: "Progettato",
    title: "Tornei del circolo",
    body: "Serate a calendario e classifica. Nessun montepremi in denaro.",
    lead: false,
  },
  {
    stage: "Idea",
    title: "Shop del circolo",
    body: "Mazzi, tappetini, la guida stampata. Da valutare.",
    lead: false,
  },
] as const;

/** Card profilo della sezione "Perché registrarsi": numeri di ESEMPIO, mai
 *  dati reali (la dicitura in chiaro accanto è parte del contratto con l'utente). */
const PROFILE_SAMPLE = [
  { value: "24", label: "Partite" },
  { value: "13", label: "Vittorie" },
  { value: "7", label: "Burraco puliti" },
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

  // La voce "Sostieni" esiste in nav solo se la sezione viene resa.
  const navItems = KOFI_URL ? NAV_ITEMS : NAV_ITEMS.filter((i) => i.id !== "sostieni");

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
            {navItems.map((item) => (
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
            aria-label="Presentazione"
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

            <div className="hero-content">
              <h2 className="hero-title">Siediti al tavolo. Adesso, senza registrarti.</h2>
              <p className="hero-sub">
                Burraco a due giocatori nel browser. Carte grandi, regole del circolo,
                nessun costo.
              </p>

              <div className="action-buttons">
                <button
                  type="button"
                  className="btn btn-primary-gold"
                  onClick={() => onOpenAuth("guest")}
                >
                  Gioca come ospite
                </button>
                <button
                  type="button"
                  className="btn btn-ghost-gold"
                  onClick={() => onOpenAuth("login")}
                >
                  Accedi
                </button>
                <button
                  type="button"
                  className="btn btn-ghost-gold"
                  onClick={() => onOpenAuth("register")}
                >
                  Registrati
                </button>
              </div>

              <ul className="hero-trust">
                <li>Gratis</li>
                <li>Nessuna installazione</li>
                <li>Si gioca dal browser</li>
              </ul>
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

          <section className="section" id="come-si-gioca">
            <h2 className="section-title">Come si gioca, in 30 secondi</h2>
            <p className="section-lede">
              Il tavolo te lo ricorda mentre giochi. Non serve studiare prima.
            </p>
            <ol className="steps-grid">
              {STEPS.map((s) => (
                <li className="step-card" key={s.n}>
                  <span className="step-num" aria-hidden="true">
                    {s.n}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="section" id="chi-siamo">
            <h2 className="section-title">Chi Siamo</h2>
            <div className="about-content">
              <div className="about-text">
                <p>
                  Il <strong>Circolo Nettuno</strong> nasce nel 2026 per portare online
                  il Burraco come si gioca al circolo: carte grandi, regole rispettate,
                  nessuna fretta.
                </p>
                <p>Non è una sala da gioco d&apos;azzardo. Non ci sono soldi in ballo, mai.</p>
              </div>
              <div className="about-image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/landing/sala.png" alt="Sala del circolo" />
              </div>
            </div>
          </section>

          {/* REGOLE — il rotolo è un'IMMAGINE DECORATIVA a 9 slice
              (border-image, vedi Landing.css): i due rulli restano intatti e
              si stira solo la texture centrale, così il rotolo si adatta a
              qualsiasi altezza del testo. Il testo è REALE: selezionabile,
              traducibile, leggibile a zoom 200%. */}
          <section className="section rules-section" id="regole">
            <div className="parchment">
              <div className="parchment-sheet">
                <header className="parchment-head">
                  <p className="parchment-eyebrow">Circolo Nettuno</p>
                  <h2 className="parchment-title">Regole del gioco</h2>
                  <div className="parchment-flourish" aria-hidden="true">
                    <span className="rule-line" />
                    <span className="ornament">&#10086;</span>
                    <span className="rule-line" />
                  </div>
                </header>

                <p className="parchment-lede">
                  Si gioca con due mazzi da cinquantaquattro carte. Vince chi chiude per
                  primo, ma i punti li fanno le carte in tavola.
                </p>

                <div className="parchment-grid">
                  {RULES.map((r) => (
                    <article key={r.n}>
                      <h3>
                        {r.n} &middot; {r.title}
                      </h3>
                      <p>{r.body}</p>
                    </article>
                  ))}
                </div>

                <footer className="parchment-seal">
                  <div className="seal" aria-hidden="true">
                    N
                  </div>
                  <p>
                    Le regole valgono al tavolo come al circolo: sul dubbio decide il
                    regolamento, non il più insistente.
                  </p>
                </footer>
              </div>
            </div>
          </section>

          <section className="section" id="registrati" aria-label="Perché registrarsi">
            <div className="signup-content">
              <div className="signup-text">
                <p className="eyebrow">Perché registrarsi</p>
                <h2 className="signup-title">Le tue partite restano</h2>
                <p>
                  Da ospite giochi subito, ma quando chiudi la finestra non resta niente.
                  Con un account ritrovi storico, statistiche e il tuo nome al tavolo.
                </p>
                <button
                  type="button"
                  className="btn btn-primary-gold"
                  onClick={() => onOpenAuth("register")}
                >
                  Crea un account
                </button>
              </div>

              <div className="profile-card">
                <div className="profile-head">
                  <div className="profile-avatar" aria-hidden="true">
                    M
                  </div>
                  <div>
                    <p className="profile-name">Il tuo profilo</p>
                    <p className="profile-note">Esempio — non sono dati reali</p>
                  </div>
                </div>
                <dl className="profile-stats">
                  {PROFILE_SAMPLE.map((s) => (
                    <div key={s.label}>
                      <dd className="num">{s.value}</dd>
                      <dt>{s.label}</dt>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </section>

          <section className="section" id="tornei">
            <h2 className="section-title">Cosa arriva dopo</h2>
            <p className="section-lede">In lavorazione, senza date promesse.</p>
            <ul className="roadmap-grid">
              {ROADMAP.map((r) => (
                <li className={`roadmap-card${r.lead ? " lead" : ""}`} key={r.title}>
                  <p className="roadmap-stage">{r.stage}</p>
                  <h3>{r.title}</h3>
                  <p>{r.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* La sezione esiste solo con NEXT_PUBLIC_KOFI_URL configurata:
              meglio nessuna sezione che un CTA che punta al vuoto. */}
          {KOFI_URL ? (
            <section className="section support-section" id="sostieni">
              <p className="eyebrow">Sostieni il progetto</p>
              <h2 className="section-title">Gratis, e resterà gratis</h2>
              <p className="support-body">
                Questo tavolo lo sviluppa una persona sola, nel tempo libero. Non c&apos;è un
                abbonamento e non è previsto: chi vuole giocare, gioca.
              </p>
              <p className="support-body muted">
                Se ti fa compagnia, puoi offrire un caffè su Ko-fi. Serve a tenere le luci
                accese, niente di più.
              </p>
              <a
                className="btn btn-primary-gold"
                href={KOFI_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Offri un caffè su Ko-fi
              </a>
              <p className="support-note">Nessuna donazione è richiesta per giocare.</p>
            </section>
          ) : null}

          <section className="section" id="contatti">
            <div className="contact-content">
              <div>
                <h2 className="contact-title">Contatti</h2>
                <p>
                  Un errore al tavolo, una regola che non torna, un&apos;idea: scrivere è la
                  cosa più utile che puoi fare.
                </p>
                {CONTACT_MAIL ? (
                  <a className="btn btn-ghost-gold" href={`mailto:${CONTACT_MAIL}`}>
                    Scrivi al circolo
                  </a>
                ) : null}
              </div>
              <div className="contact-aside">
                <p>Risponde una persona, non un servizio clienti. Ci vuole un po&apos;.</p>
                <p>Le segnalazioni di bug hanno la precedenza.</p>
              </div>
            </div>
          </section>

          <footer className="site-footer">
            <p>© 2026 Circolo Nettuno - Burraco. Tutti i diritti riservati.</p>
            <p className="footer-fine-print">
              Si gioca senza denaro. Nessuna scommessa, nessun premio in denaro.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
