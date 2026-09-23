/**
 * CONTATORE ANONIMO dei clic su "caffè" e "invito" (proposta donazione/condivisione
 * §8.6, Lotto D). Invia SOLO tipo e punto della UI: nessun token, nessun dato
 * dell'utente. Fuoco-e-dimentica: `keepalive` fa arrivare la richiesta anche se il
 * clic apre un'altra scheda o lascia la pagina; ogni errore è ignorato (un contatore
 * non deve mai disturbare chi gioca). Il BE risponde 204 e limita per IP.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type ClickKind = "caffe" | "invito";
export type ClickPlacement = "fine_partita" | "landing" | "lobby" | "sala_attesa" | "profilo" | "footer";

export function trackClick(kind: ClickKind, placement: ClickPlacement): void {
  try {
    void fetch(`${API_URL}/metrics/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, placement }),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // fetch assente o bloccata: nessun conteggio, nessun problema.
  }
}
