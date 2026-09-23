"use client";

import { useEffect, useState } from "react";
import "./ShareButton.css";

/**
 * PULSANTE "INVITA UN AMICO" (proposta-donazione-condivisione.md §5).
 *
 * - Dove esiste la Web Share API (quasi tutti i telefoni) apre il menu nativo
 *   (WhatsApp, SMS, …) con messaggio e link già pronti.
 * - Altrimenti (desktop) offre "Copia link" e un link diretto a WhatsApp (`wa.me`):
 *   è una semplice navigazione, nessuno script di terze parti, CSP invariata.
 *
 * L'URL condiviso è l'origine della pagina corrente (letta al clic), così resta
 * corretto su qualunque dominio senza configurazione. Il messaggio non contiene
 * MAI dati di gioco (carte, punteggi, nomi di altri giocatori).
 */

export const INVITE_TEXT =
  "Gioco a burraco online al Circolo Nettuno: è gratis e senza pubblicità. Facciamo una partita?";

interface ShareButtonProps {
  label?: string;
  text?: string;
  /** Percorso relativo all'origine (default "/"). */
  path?: string;
  className?: string;
  /** Chiamata dopo un'azione di condivisione avviata (menu nativo, copia o WhatsApp). */
  onShared?: () => void;
}

type CopyState = "idle" | "copied" | "error";

function shareUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function whatsappHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function ShareButton({
  label = "Invita un amico a giocare",
  text = INVITE_TEXT,
  path = "/",
  className = "btn-primary",
  onShared,
}: ShareButtonProps) {
  // Rilevata DOPO il montaggio: sul server `navigator` non esiste (niente mismatch di idratazione).
  const [canShare, setCanShare] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // URL completo, noto solo nel browser: al primo render (anche SSR) è vuoto.
  const [url, setUrl] = useState("");

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    setUrl(shareUrl(path));
  }, [path]);

  const nativeShare = async () => {
    try {
      await navigator.share({ title: "Circolo Nettuno — Burraco", text, url: url || shareUrl(path) });
      onShared?.();
    } catch {
      // Annullato dall'utente (AbortError) o non consentito: nessun messaggio d'errore.
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text} ${url || shareUrl(path)}`);
      setCopyState("copied");
      onShared?.();
    } catch {
      setCopyState("error");
    }
  };

  if (canShare) {
    return (
      <button type="button" className={`share-btn ${className}`} onClick={nativeShare}>
        {label}
      </button>
    );
  }

  return (
    <div className="share-fallback">
      <span className="share-fallback-label">{label}</span>
      <div className="share-fallback-actions">
        <a
          className={`share-btn ${className}`}
          href={whatsappHref(url ? `${text} ${url}` : text)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onShared?.()}
        >
          Invia su WhatsApp
        </a>
        <button type="button" className="share-btn btn-ghost" onClick={copy}>
          Copia link
        </button>
      </div>
      <p className="share-status" role="status" aria-live="polite">
        {copyState === "copied" ? "Link copiato: incollalo dove vuoi." : copyState === "error" ? "Copia non riuscita: copia l'indirizzo dalla barra del browser." : ""}
      </p>
    </div>
  );
}
