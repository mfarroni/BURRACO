import Link from "next/link";
import type { ReactNode } from "react";
import "./LegalPage.css";

/**
 * Impaginazione comune delle pagine legali (privacy, cookie, termini) — Audit
 * lancio R01/R08. Pagine STATICHE, senza JavaScript di gioco: testo reale, leggibile
 * a zoom 200%, con i link di ritorno alla vetrina e tra le tre pagine.
 */

/** Titolare del trattamento e recapito, da env pubbliche di build (Vercel). */
export const TITOLARE = process.env.NEXT_PUBLIC_TITOLARE?.trim() || "";
export const CONTACT_MAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "";

/** Data dell'ultima revisione dei testi (aggiornarla a ogni modifica sostanziale). */
export const LEGAL_UPDATED = "25 settembre 2026";

const LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/cookie", label: "Cookie e memoria del browser" },
  { href: "/termini", label: "Termini d'uso" },
] as const;

/** Recapito del titolare: email se configurata, sempre anche il modulo Contatti. */
export function Recapito() {
  return (
    <>
      {TITOLARE ? <strong>{TITOLARE}</strong> : <strong>il gestore del Circolo Nettuno</strong>}
      {CONTACT_MAIL ? (
        <>
          , raggiungibile all&apos;indirizzo <a href={`mailto:${CONTACT_MAIL}`}>{CONTACT_MAIL}</a> oppure
          con il <Link href="/#contatti">modulo Contatti</Link> del sito
        </>
      ) : (
        <>
          , raggiungibile con il <Link href="/#contatti">modulo Contatti</Link> del sito
        </>
      )}
    </>
  );
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="legal-root">
      <main className="legal-sheet">
        <p className="legal-eyebrow">
          <Link href="/">← Burraco · Circolo Nettuno</Link>
        </p>
        <h1>{title}</h1>
        <p className="legal-updated">Ultimo aggiornamento: {LEGAL_UPDATED}</p>
        {children}
        <nav className="legal-nav" aria-label="Documenti legali">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
          <Link href="/">Torna al circolo</Link>
        </nav>
      </main>
    </div>
  );
}
