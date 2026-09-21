"use client";

interface VetrinaBrandHeaderProps {
  title?: string;
  subtitle?: string;
}

export function VetrinaBrandHeader({
  title = "Burraco",
  subtitle = "Circolo Nettuno — Il circolo del Burraco",
}: VetrinaBrandHeaderProps) {
  return (
    <div className="vetrina-brand-header">
      <div className="logo-cards-fan" aria-hidden="true">
        <img src="/images/landing/asso-picche.png" alt="" className="fan-card fan-card-1" />
        <img src="/images/landing/asso-cuori.png" alt="" className="fan-card fan-card-2" />
        <img src="/images/landing/asso-quadri.png" alt="" className="fan-card fan-card-3" />
        <img src="/images/landing/asso-fiori.png" alt="" className="fan-card fan-card-4" />
      </div>
      <h1 className="vetrina-brand-title">{title}</h1>
      <p className="vetrina-brand-subtitle">{subtitle}</p>
    </div>
  );
}
