"use client";

import "./SeatPost.css";

/**
 * POST DEL GIOCATORE — sostituisce `.seat-plate`.
 *
 * Una sola scheda per postazione che raccoglie tutto ciò che prima era sparso fra
 * targa, `OpponentStatus` nell'header e pila "mano avversario" nell'isola:
 * avatar (foto per chi è registrato, monogramma per l'ospite), nome, ruolo e
 * posizione, stato (pozzetto/burraco), carte in mano, turno attivo, offline.
 *
 * Il componente è MUTO sulle regole: disegna i dati che riceve. La squadra arriva
 * dal server (`team`), mai dedotta dal posto.
 */

interface Props {
  /** Nome visualizzato. Troncato con ellissi se non entra. */
  name: string;
  /** Squadra, server-driven: "us" (oro) | "them" (acciaio). */
  team: "us" | "them";
  /** Ruolo e posizione: "Compagno · Nord", "Ovest", "Sud · tu". */
  role: string;
  /** Carte in mano (da `state.seats[].handCount`). */
  handCount: number;
  /** Postazione di turno. */
  active?: boolean;
  /** false → etichetta "offline". */
  connected?: boolean;
  /** Ospite (nessun account): monogramma su acciaio, badge "ospite". */
  isGuest?: boolean;
  /**
   * Foto del profilo per gli utenti registrati. Assente finché il backend non
   * espone il campo: il post ripiega sul monogramma senza salti di layout.
   */
  avatarUrl?: string | null;
  /** Badge di stato: pozzetto preso. */
  pozzettoTaken?: boolean;
  /** Badge di stato: burraco realizzati (omesso se undefined). */
  burracoCount?: number;
  /** Classe di area della griglia: seat-north | seat-west | seat-east | seat-south. */
  area: string;
  /** "compact" per portrait stretto; "extended" per il proprio posto. */
  size?: "standard" | "compact" | "extended";
}

export function SeatPost({
  name,
  team,
  role,
  handCount,
  active = false,
  connected = true,
  isGuest = false,
  avatarUrl,
  pozzettoTaken,
  burracoCount,
  area,
  size = "standard",
}: Props) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const crest = team === "us" ? "◆" : "●";

  return (
    <div
      className={`seat-post ${area}`}
      data-team={team}
      data-active={active ? "true" : "false"}
      data-size={size}
      data-off={connected ? "false" : "true"}
    >
      <span className="seat-post-avatar" aria-hidden="true">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="seat-post-photo" />
        ) : (
          <span className="seat-post-mono">{initial}</span>
        )}
      </span>

      <span className="seat-post-body">
        <span className="seat-post-name" title={name}>
          {name}
        </span>
        <span className="seat-post-meta">
          <span className="seat-post-role">
            <span className="seat-post-crest" aria-hidden="true">{crest}</span>
            {role}
          </span>
          {isGuest && <span className="seat-post-badge" data-kind="guest">ospite</span>}
          {burracoCount != null && burracoCount > 0 && (
            <span className="seat-post-badge" data-kind="burraco">
              {burracoCount} burraco
            </span>
          )}
          {pozzettoTaken && (
            <span className="seat-post-badge" data-kind="pozzetto">pozzetto</span>
          )}
          {!connected && <span className="seat-post-badge" data-kind="off">offline</span>}
        </span>
      </span>

      <span className="seat-post-count">
        <span className="seat-post-num">{handCount}</span>
        <span className="seat-post-lbl">carte</span>
      </span>

      {active && <span className="seat-post-turn" aria-hidden="true">gioca</span>}
    </div>
  );
}
