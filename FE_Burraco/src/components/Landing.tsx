"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthMode } from "@/components/AuthPanel";
import { BMC_URL, DonationButton } from "@/components/DonationButton";
import { ShareButton } from "@/components/ShareButton";
import { trackClick } from "@/lib/metrics";
import { ContactForm } from "@/components/ContactForm";
import { formatEventWhen, useCircolo } from "@/lib/circolo";
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
  /** Codice di un link d'invito `/?tavolo=` ancora da usare: mostra un avviso nell'hero. */
  inviteCode?: string | null;
  /** Avviso di servizio da mostrare nell'hero (es. account appena eliminato). */
  notice?: string | null;
}

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
  { n: "IV", title: "Chiudi", body: "Burraco in tavola e la mano vuota. Poi si contano i punti." },
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
    body: "Il tavolo accetta solo le mosse valide e ti dice perché una mossa non è ammessa: nessuno deve ricordare le regole a memoria.",
  },
] as const;

/* Audit lancio (decisione del lead): lo Shop è NASCOSTO dalla vetrina finché non si
   decide cosa vendere; il 2 contro 2 è già giocabile e non è più "in sviluppo". */
const ROADMAP = [
  {
    stage: "Già al tavolo",
    title: "Tavoli a coppie",
    body: "Il 2 contro 2 si gioca già: in lobby scegli «2 contro 2» e aspetta i tre compagni di tavolo.",
    lead: true,
  },
  {
    stage: "Progettato",
    title: "Tornei del circolo",
    body: "Serate a calendario e classifica. Nessun montepremi in denaro.",
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

export function Landing({ onOpenAuth, inviteCode = null, notice = null }: Props) {
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

  // Audit lancio R02 (Ciclo 3): serate pubblicate e presenze, dalla rotta pubblica.
  const circolo = useCircolo(true);
  const players = circolo?.playersOnline ?? 0;

  // La voce "Sostieni" esiste in nav solo se la sezione viene resa.
  const navItems = NAV_ITEMS;

  return (
    <div className="landing-root">
      <div className="room-background" aria-hidden="true" />

      {/* La cornice d'ottone è comune a tutte le pagine: `SiteFrame` in app/layout.tsx. */}

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
              {notice && (
                <p className="invite-notice" role="status">
                  {notice}
                </p>
              )}
              {inviteCode && (
                <p className="invite-notice" role="status">
                  Un amico ti aspetta al tavolo <strong>{inviteCode}</strong>. Entra come ospite o
                  accedi: in lobby troverai il codice già pronto.
                </p>
              )}
              <h2 className="hero-title">Siediti al tavolo. Adesso, senza registrarti.</h2>
              <p className="hero-sub">
                Burraco nel browser, uno contro uno o a coppie. Carte grandi, regole del
                circolo, nessun costo.
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
                {players > 0 && (
                  <li className="hero-live">
                    {players === 1 ? "1 giocatore al circolo adesso" : `${players} giocatori al circolo adesso`}
                  </li>
                )}
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
                  Si gioca con due mazzi da cinquantaquattro carte. Si gioca a più smazzate:
                  vince chi arriva per primo a 2005 punti, e i punti li fanno le carte in tavola.
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
            <h2 className="section-title">Novità e prossimi passi</h2>
            <p className="section-lede">Quello che c&apos;è già e quello in lavorazione, senza date promesse.</p>
            {/* Audit lancio R02 (Ciclo 3): le SERATE sono l'appuntamento per trovare
                qualcuno al tavolo. Solo eventi pubblicati dall'admin, mai bozze. */}
            <div className="serate" aria-labelledby="serate-title">
              <h3 id="serate-title" className="serate-title">Prossime serate al circolo</h3>
              {circolo && circolo.events.length > 0 ? (
                <ul className="serate-list">
                  {circolo.events.map((ev) => (
                    <li key={ev.id} className="serate-item">
                      <p className="serate-when">{formatEventWhen(ev)}</p>
                      <p className="serate-name">{ev.titolo}</p>
                      {ev.luogo && <p className="serate-where">{ev.luogo}</p>}
                      {ev.descrizione && <p className="serate-desc">{ev.descrizione}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="serate-empty">
                  Nessuna serata in calendario per ora. Registrati e, dal tuo profilo, attiva gli
                  avvisi: ti scriviamo quando ne fissiamo una.
                </p>
              )}
            </div>
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

          {/* SOSTIENI (proposta donazione/condivisione §4.3): sezione vera, sempre
              presente. Frase decisa dal lead + trasparenza sull'uso delle offerte +
              due modi di aiutare (caffè / invito gratuito). */}
          <section className="section support-section" id="sostieni">
            <p className="eyebrow">Sostieni il circolo</p>
            <h2 className="section-title">Il circolo va avanti solo grazie alle vostre offerte.</h2>
            <p className="support-body">
              È gratuito e senza pubblicità. Le offerte pagano server, database e dominio:
              nessuno ci guadagna.
            </p>
            <p className="support-body muted">
              Non puoi offrire? Aiuti lo stesso: fai conoscere il circolo a chi gioca a burraco.
            </p>
            <div className="support-actions">
              <a
                className="btn btn-primary-gold"
                href={BMC_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackClick("caffe", "landing")}
              >
                <span className="btn-icon" aria-hidden="true">☕</span>Offri un caffè al circolo
              </a>
              <ShareButton
                label="Invita un amico a giocare"
                className="btn btn-ghost-gold"
                secondaryClassName="btn btn-ghost-gold"
                onShared={() => trackClick("invito", "landing")}
              />
            </div>
            <p className="support-note">Nessuna offerta è richiesta per giocare.</p>
          </section>

          <section className="section" id="contatti">
            <div className="contact-content">
              <div>
                <h2 className="contact-title">Contatti</h2>
                <p>
                  Un errore al tavolo, una regola che non torna, un&apos;idea: scrivere è la
                  cosa più utile che puoi fare.
                </p>
                {/* FASE 2 — form contatti reale (sostituisce il solo CTA mailto).
                    Il messaggio si salva sempre lato server; l'email è un di più. */}
                <ContactForm />
                {CONTACT_MAIL ? (
                  <p className="contact-mailto-fallback">
                    Preferisci la tua casella?{" "}
                    <a href={`mailto:${CONTACT_MAIL}`}>Scrivi al circolo</a>
                  </p>
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
            {/* Audit lancio R01/R08: documenti legali raggiungibili da ogni visita. */}
            <nav className="footer-legal" aria-label="Documenti legali">
              <a href="/privacy">Privacy</a>
              <a href="/cookie">Cookie</a>
              <a href="/termini">Termini d&apos;uso</a>
            </nav>
            {/* Donazione (Lotto 4 — R6): nel piè, dopo Contatti. Mai fissa/overlay. */}
            <DonationButton placement="footer" />
          </footer>
        </div>
      </div>
    </div>
  );
}
