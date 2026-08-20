"use client";

import { useRef, useState } from "react";
import type { Card } from "@/lib/contract";
import { CardView, cardLabel } from "./CardView";
import { useHandOrder } from "@/lib/useHandOrder";

/**
 * BOTTOM HAND — la mano del giocatore, ANCORATA in basso e disposta a VENTAGLIO.
 * Competenza develop: architettura, stato dell'ordine locale, collegamento
 * selezione/riordino, accessibilità di base. L'ESTETICA (curvatura del ventaglio,
 * spaziatura, micro-interazioni, motion) è delegata ad agente_ui_ux.
 *
 * Interazioni (convivenza esplicita):
 *  - TOCCA/clic o Invio/Spazio su una carta = SELEZIONA (per calare/scartare).
 *  - TRASCINA una carta su un'altra = RIORDINA (solo presentazione).
 *  - Da TASTIERA: con la carta a fuoco, Ctrl/⌘ + ← / → la sposta. Alternativa
 *    accessibile al drag (WCAG: nessuna azione solo-puntatore).
 *
 * L'ordine è PURAMENTE VISIVO: persistito in sessionStorage per-tavolo dal hook
 * `useHandOrder`, MAI inviato al server (il client è muto sulle regole).
 */

interface Props {
  room: string | null;
  hand: Card[];
  selectedCards: string[];
  isMyTurn: boolean;
  pending: boolean;
  inFlightCardId: string | null;
  onToggleCard: (card: Card) => void;
}

export function BottomHand({
  room,
  hand,
  selectedCards,
  isMyTurn,
  pending,
  inFlightCardId,
  onToggleCard,
}: Props) {
  const { orderedHand, moveBy, moveTo } = useHandOrder(room, hand);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Annuncio per screen reader dopo un riordino da tastiera/drag.
  const [announce, setAnnounce] = useState("");
  const liveRef = useRef<HTMLDivElement | null>(null);

  const count = orderedHand.length;

  const doMoveTo = (id: string, toIndex: number) => {
    moveTo(id, toIndex);
    const card = orderedHand.find((c) => c.id === id);
    setAnnounce(
      `${card ? cardLabel(card) : "Carta"} spostata in posizione ${toIndex + 1} di ${count}.`,
    );
  };

  const onKeyDownCard = (e: React.KeyboardEvent, card: Card, index: number) => {
    // Riordino accessibile: Ctrl/⌘ + frecce (non interferisce con la selezione).
    if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      moveBy(card.id, delta);
      const to = Math.max(0, Math.min(count - 1, index + delta));
      setAnnounce(`${cardLabel(card)} spostata in posizione ${to + 1} di ${count}.`);
    }
  };

  // Geometria del VENTAGLIO (pura presentazione): ogni carta ruota attorno al
  // proprio bordo inferiore e si abbassa allontanandosi dal centro, disegnando un
  // arco morbido. Angolo e curvatura si riducono con l'aumentare delle carte per
  // non compromettere la leggibilità degli indici. Nessuna regola di gioco qui.
  const mid = (count - 1) / 2;
  const stepDeg = count > 1 ? Math.min(3, 26 / (count - 1)) : 0; // spread contenuto
  const fanStyle = (index: number): React.CSSProperties => {
    const offset = index - mid;
    const rot = offset * stepDeg;
    const lift = Math.abs(offset) ** 2 * (count > 9 ? 0.9 : 1.3); // px verso il basso ai bordi
    return {
      ["--i" as string]: String(index),
      ["--rot" as string]: `${rot.toFixed(2)}deg`,
      ["--ty" as string]: `${lift.toFixed(1)}px`,
    };
  };

  return (
    <section className="bottom-hand" aria-label={`La tua mano, ${count} carte`}>
      <div className="bottom-hand-head">
        <h4>La tua mano · {count} carte</h4>
        <span className="bottom-hand-hint muted">
          Tocca per selezionare · trascina per riordinare · da tastiera Ctrl/⌘ + ← →
        </span>
      </div>

      {count === 0 ? (
        <p className="faint">Mano vuota — sei andato a pozzetto!</p>
      ) : (
        <ul
          className="fan"
          role="list"
          style={{ ["--fan-count" as string]: String(count) }}
        >
          {orderedHand.map((card, index) => {
            const selected = selectedCards.includes(card.id);
            const isDragging = dragId === card.id;
            const isOver = overId === card.id && dragId !== card.id;
            return (
              <li
                key={card.id}
                className="fan-slot"
                style={fanStyle(index)}
                data-dragging={isDragging ? "true" : "false"}
                data-over={isOver ? "true" : "false"}
                data-selected={selected ? "true" : "false"}
                draggable
                onDragStart={(e) => {
                  setDragId(card.id);
                  e.dataTransfer.effectAllowed = "move";
                  // Alcuni browser richiedono dati per avviare il drag.
                  try {
                    e.dataTransfer.setData("text/plain", card.id);
                  } catch {
                    /* ignora: il dragId in stato è la fonte autorevole */
                  }
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overId !== card.id) setOverId(card.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== card.id) doMoveTo(dragId, index);
                  setDragId(null);
                  setOverId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
              >
                <CardView
                  card={card}
                  selected={selected}
                  pending={inFlightCardId === card.id}
                  onClick={isMyTurn && !pending ? onToggleCard : undefined}
                  onKeyDown={(e) => onKeyDownCard(e, card, index)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* Regione live per l'esito dei riordini (screen reader). */}
      <div ref={liveRef} className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </section>
  );
}
