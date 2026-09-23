import "./DonationButton.css";

/**
 * PULSANTE DONAZIONE "Buy Me a Coffee" (Lotto 4 — R6).
 *
 * Componente unico, riusato in tre punti (landing, lobby, profilo). NON è mai
 * fisso/sticky/overlay e NON compare al tavolo in partita né nei flussi di auth.
 *
 * Il badge è un'IMMAGINE LOCALE (PNG già presenti in /public/images/donazione),
 * servita come `<img>` NATIVO — non `next/image` — con variante @2x per gli schermi
 * hi-dpi. Nessun CDN, nessuno script del marchio (coerente con la CSP `img-src 'self'`,
 * che non viene toccata). Le dimensioni stanno nel foglio `DonationButton.css`
 * (max-width:100% / height:auto), così a 375px il badge non sfora.
 */

const BMC_URL = "https://www.buymeacoffee.com/granmasterchess";

interface DonationButtonProps {
  /** `compatto` riduce l'ingombro (es. lobby); default `normale`. Una sola prop. */
  size?: "normale" | "compatto";
}

export function DonationButton({ size = "normale" }: DonationButtonProps) {
  return (
    <div className="bmc-wrap" data-size={size}>
      <a className="bmc-link" href={BMC_URL} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="bmc-img"
          src="/images/donazione/buymeacoffee-button.png"
          srcSet="/images/donazione/buymeacoffee-button.png 1x, /images/donazione/buymeacoffee-button@2x.png 2x"
          width={217}
          height={60}
          alt="Offrimi un caffè su Buy Me a Coffee"
        />
      </a>
      {/* Frase decisa dal lead (proposta-donazione-condivisione.md §3/§8): dice il BISOGNO,
          non solo la gratuità. Nessuna cifra, nessun conteggio. */}
      <p className="bmc-note">Il circolo va avanti solo grazie alle vostre offerte.</p>
    </div>
  );
}
