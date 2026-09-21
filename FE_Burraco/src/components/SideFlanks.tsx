"use client";

interface SideFlankProps {
  side: "left" | "right";
}

export function SideFlank({ side }: SideFlankProps) {
  if (side === "left") {
    return (
      <aside className="side-flank left" aria-label="Galleria Circolo Nettuno - Lato Sinistro">
        <div className="side-image-card">
          <img src="/images/landing/club-hall.jpg" alt="Sala del Circolo Burraco" />
          <div className="card-caption">Sala del Circolo</div>
        </div>
        <div className="side-image-card">
          <img src="/images/landing/tavolo.png" alt="Tavolo da gioco in feltro verde" />
          <div className="card-caption">Tavolo in Feltro Verde</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="side-flank right" aria-label="Galleria Circolo Nettuno - Lato Destro">
      <div className="side-image-card">
        <img src="/images/landing/club-lounge.webp" alt="Lounge Club Burraco" />
        <div className="card-caption">Lounge & Club</div>
      </div>
      <div className="side-image-card">
        <img src="/images/landing/tavolo2.png" alt="Carte e carte da gioco" />
        <div className="card-caption">Atmosfera da Gioco</div>
      </div>
    </aside>
  );
}
