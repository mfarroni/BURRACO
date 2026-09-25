import type { Metadata } from "next";
import Link from "next/link";
import "@/components/LegalPage.css";

export const metadata: Metadata = {
  title: "Pagina non trovata — Burraco, Circolo Nettuno",
};

/** 404 in italiano e nello stile del circolo (Audit lancio R14). */
export default function NotFound() {
  return (
    <div className="legal-root">
      <main className="legal-sheet">
        <h1>Questo tavolo non esiste</h1>
        <p>La pagina che cercavi non c&apos;è, oppure l&apos;indirizzo è stato scritto in modo diverso.</p>
        <p>
          <Link href="/">Torna al circolo</Link>
        </p>
      </main>
    </div>
  );
}
