import { ImageResponse } from "next/og";

/*
 * Immagine Open Graph (1200×630) mostrata nell'anteprima dei link condivisi.
 * Generata al build con i colori di `direzione-visiva.md` (feltro, ottone, avorio):
 * nessun file binario da mantenere, nessun font o asset esterno.
 */
export const alt = "Burraco — Circolo Nettuno: burraco online gratuito e senza pubblicità";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at 50% 40%, #205039 0%, #14352a 55%, #0f2019 100%)",
          border: "14px solid #a07d3e",
          color: "#f6f1e3",
          fontFamily: "serif",
        }}
      >
        {/* Filetto d'ottone: i simboli dei semi (♠♥) non esistono nel font di default. */}
        <div style={{ display: "flex", width: 220, height: 3, background: "#c0a052" }} />
        <div style={{ display: "flex", fontSize: 148, marginTop: 12 }}>Burraco</div>
        <div style={{ display: "flex", fontSize: 52, color: "#e0c789", letterSpacing: 6 }}>
          CIRCOLO NETTUNO
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#e7e1cf", marginTop: 40 }}>
          Gratuito e senza pubblicità · Invita un amico al tavolo
        </div>
      </div>
    ),
    size,
  );
}
