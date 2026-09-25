"use client";

import Link from "next/link";
import "@/components/LegalPage.css";

/**
 * Errore imprevisto dell'interfaccia, in italiano e nello stile del circolo (Audit
 * lancio R14). Nessun dettaglio tecnico mostrato all'utente.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="legal-root">
      <main className="legal-sheet" role="alert">
        <h1>Qualcosa è andato storto</h1>
        <p>Si è verificato un errore imprevisto. Puoi riprovare subito oppure tornare alla pagina iniziale.</p>
        <p>
          <button type="button" className="btn-primary" onClick={() => reset()}>
            Riprova
          </button>{" "}
          <Link href="/">Torna al circolo</Link>
        </p>
      </main>
    </div>
  );
}
