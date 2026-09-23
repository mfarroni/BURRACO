import "./SiteFrame.css";

/**
 * CORNICE D'OTTONE del circolo, la stessa della vetrina, su TUTTE le pagine
 * (montata una volta sola in `app/layout.tsx`). Puramente decorativa: fissa sopra
 * al contenuto, `pointer-events: none` (non intercetta clic né tocchi) e nascosta
 * agli screen reader. Lo spazio che occupa ai bordi è riservato dal `body` tramite
 * `--frame-inset` (globals.css), così non copre testi né pulsanti.
 */
export function SiteFrame() {
  return (
    <div className="site-frame" aria-hidden="true">
      <div className="site-frame-decorative" />
      <div className="site-frame-corner tl" />
      <div className="site-frame-corner tr" />
      <div className="site-frame-corner bl" />
      <div className="site-frame-corner br" />
    </div>
  );
}
