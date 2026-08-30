"use client";

import { useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/contract";
import { CardView, cardLabel } from "./CardView";
import { useHandOrder } from "@/lib/useHandOrder";

/**
 * BOTTOM HAND — la mano del giocatore, ANCORATA in basso (postazione Sud).
 * Competenza develop: architettura, stato dell'ordine locale, collegamento
 * selezione/riordino, accessibilità di base. L'ESTETICA (curvatura del ventaglio,
 * spaziatura, micro-interazioni, motion) è delegata ad agente_ui_ux.
 *
 * INTERAZIONE UNIFICATA (Pointer Events) — un solo gesto decide tap vs riordino:
 *  - TAP/clic (spostamento < 5px mouse / < 10px touch, durata < 400ms) = SELEZIONA
 *    (toggle, accumulo). Su touch c'è PRESS-PREVIEW: la carta si evidenzia al down
 *    e il toggle avviene al RILASCIO; si può scorrere il dito per correggere.
 *  - LONG-PRESS ≥ 400ms fermo (touch) → modalità RIORDINO → trascina → posa.
 *  - MOUSE: press + spostamento > 5px → riordino immediato (nessun long-press).
 *  - Shift+clic (desktop) = selezione a INTERVALLO dall'ancora alla carta corrente,
 *    in ordine VISIVO. Ctrl/⌘+clic = toggle mirato (equivalente al tap che accumula).
 *  - Da TASTIERA: Invio/Spazio = selezione; Ctrl/⌘ + ←/→ = riordino (WCAG).
 *
 * L'ordine e la selezione sono PURAMENTE LOCALI (l'ordine è persistito in
 * sessionStorage per-tavolo dal hook `useHandOrder`), MAI inviati al server: il
 * client è muto sulle regole.
 */

interface Props {
  room: string | null;
  hand: Card[];
  selectedCards: string[];
  isMyTurn: boolean;
  pending: boolean;
  inFlightCardId: string | null;
  onToggleCard: (card: Card) => void;
  onSelectRange: (ids: string[]) => void;
  onClearSelection: () => void;
}

// Soglie percettive (vedi §2.1 della spec).
const MOUSE_DRAG_PX = 5;
const TOUCH_TOLERANCE_PX = 10;
const LONG_PRESS_MS = 400;

interface PointerSession {
  pointerId: number;
  cardId: string;
  index: number;
  startX: number;
  startY: number;
  pointerType: string;
  mode: "pending" | "drag";
  longPressTimer: number | null;
}

/** Haptic feature-detected: no-op silenzioso dove assente (iOS/Safari). */
function vibrate(ms: number): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* alcuni browser lo espongono ma lo bloccano: ignora */
    }
  }
}

export function BottomHand({
  room,
  hand,
  selectedCards,
  isMyTurn,
  pending,
  inFlightCardId,
  onToggleCard,
  onSelectRange,
  onClearSelection,
}: Props) {
  const { orderedHand, moveBy, moveTo } = useHandOrder(room, hand);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pressId, setPressId] = useState<string | null>(null); // press-preview touch
  const [announce, setAnnounce] = useState("");
  const liveRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const session = useRef<PointerSession | null>(null);
  // Ancora della selezione a intervallo = ultima carta toccata/selezionata.
  const anchorRef = useRef<string | null>(null);

  const count = orderedHand.length;
  const selectionCount = selectedCards.length;

  // Layout: su schermi stretti SEMPRE a file (target ≥44×64); su desktop l'arco
  // sopravvive fino a ~15 carte, oltre si passa a file (niente overflow).
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const layout: "arc" | "rows" = narrow || count > 15 ? "rows" : "arc";

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

  // Attivazione DA TASTIERA (Invio/Spazio → e.detail === 0): il puntatore è
  // gestito dai Pointer Events, così non c'è doppio toggle. La selezione è
  // consentita solo quando è il tuo turno e non c'è una mossa in volo.
  const onKeyboardActivate = (card: Card, e: React.MouseEvent) => {
    if (e.detail !== 0) return; // click da puntatore: lo gestisce onPointerUp
    if (!(isMyTurn && !pending)) return;
    onToggleCard(card);
    anchorRef.current = card.id;
  };

  // Indice della carta sotto il punto (per drop e press-preview correction).
  // Usa `elementsFromPoint` (stack completo) e SALTA la carta trascinata
  // (`excludeId`): così troviamo la carta SOTTO senza dover impostare
  // `pointer-events:none` sull'elemento che detiene il pointer capture (cosa che
  // su alcuni browser ne interromperebbe la cattura).
  const indexFromPoint = (x: number, y: number, excludeId?: string): number | null => {
    if (typeof document === "undefined") return null;
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      const slot = (el as Element).closest?.("[data-card-id]");
      if (!slot) continue;
      if (listRef.current && !listRef.current.contains(slot)) continue;
      const id = slot.getAttribute("data-card-id");
      if (!id || id === excludeId) continue;
      const idx = orderedHand.findIndex((c) => c.id === id);
      if (idx !== -1) return idx;
    }
    return null;
  };

  const clearSession = () => {
    const s = session.current;
    if (s?.longPressTimer !== null && s?.longPressTimer !== undefined) {
      clearTimeout(s.longPressTimer);
    }
    session.current = null;
  };

  const onPointerDown = (e: React.PointerEvent, card: Card, index: number) => {
    if (e.button > 0) return; // solo pulsante primario
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture non disponibile: si procede comunque */
    }
    const s: PointerSession = {
      pointerId: e.pointerId,
      cardId: card.id,
      index,
      startX: e.clientX,
      startY: e.clientY,
      pointerType: e.pointerType,
      mode: "pending",
      longPressTimer: null,
    };
    session.current = s;
    if (e.pointerType !== "mouse") {
      // Press-preview immediato + armamento del long-press per il riordino.
      setPressId(card.id);
      s.longPressTimer = window.setTimeout(() => {
        const cur = session.current;
        if (!cur || cur.pointerId !== e.pointerId || cur.mode !== "pending") return;
        cur.mode = "drag";
        cur.longPressTimer = null;
        setPressId(null);
        setDragId(cur.cardId);
        setDropIndex(cur.index);
        vibrate(15);
        setAnnounce(`Modalità riordino: ${cardLabel(card)}. Trascina per spostare.`);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = session.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);

    if (s.mode === "drag") {
      const idx = indexFromPoint(e.clientX, e.clientY, s.cardId);
      if (idx !== null && idx !== dropIndex) setDropIndex(idx);
      return;
    }

    if (s.pointerType === "mouse") {
      if (dist > MOUSE_DRAG_PX) {
        s.mode = "drag";
        setDragId(s.cardId);
        setDropIndex(indexFromPoint(e.clientX, e.clientY, s.cardId) ?? s.index);
      }
      return;
    }

    // touch/pen ancora in "pending": oltre la tolleranza il long-press decade
    // (niente riordino accidentale) ma il tap resta vivo come PRESS-PREVIEW che
    // si ri-targa sulla carta sotto il dito (correzione prima del rilascio).
    if (dist > TOUCH_TOLERANCE_PX) {
      if (s.longPressTimer !== null) {
        clearTimeout(s.longPressTimer);
        s.longPressTimer = null;
      }
      const idx = indexFromPoint(e.clientX, e.clientY);
      if (idx !== null) {
        const targetId = orderedHand[idx]?.id ?? s.cardId;
        s.cardId = targetId;
        s.index = idx;
        if (pressId !== targetId) setPressId(targetId);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = session.current;
    if (!s || s.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* già rilasciato */
    }

    if (s.mode === "drag") {
      const target = dropIndex ?? s.index;
      doMoveTo(s.cardId, target);
      vibrate(10);
      setDragId(null);
      setDropIndex(null);
      setPressId(null);
      clearSession();
      return;
    }

    // TAP → selezione (solo al proprio turno). Su touch la carta finale è quella
    // sotto il dito al rilascio (press-preview correction).
    setPressId(null);
    let cardId = s.cardId;
    if (s.pointerType !== "mouse") {
      const idx = indexFromPoint(e.clientX, e.clientY);
      if (idx !== null) cardId = orderedHand[idx]?.id ?? cardId;
    }
    clearSession();
    if (!(isMyTurn && !pending)) return;
    const card = orderedHand.find((c) => c.id === cardId);
    if (!card) return;

    if (e.shiftKey && anchorRef.current) {
      const ai = orderedHand.findIndex((c) => c.id === anchorRef.current);
      const bi = orderedHand.findIndex((c) => c.id === cardId);
      if (ai !== -1 && bi !== -1) {
        const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
        onSelectRange(orderedHand.slice(lo, hi + 1).map((c) => c.id));
        anchorRef.current = cardId;
        return;
      }
    }
    onToggleCard(card);
    anchorRef.current = cardId;
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    const s = session.current;
    if (!s || s.pointerId !== e.pointerId) return;
    setDragId(null);
    setDropIndex(null);
    setPressId(null);
    clearSession();
  };

  const fanStyle = (index: number): React.CSSProperties => {
    if (layout === "rows") return { ["--i" as string]: String(index) };
    // Geometria del VENTAGLIO (solo arco, ≤15 carte su desktop): ogni carta ruota
    // attorno al bordo inferiore e si abbassa allontanandosi dal centro.
    const mid = (count - 1) / 2;
    const stepDeg = count > 1 ? Math.min(3, 26 / (count - 1)) : 0;
    const offset = index - mid;
    const lift = Math.abs(offset) ** 2 * (count > 9 ? 0.9 : 1.3);
    return {
      ["--i" as string]: String(index),
      ["--rot" as string]: `${(offset * stepDeg).toFixed(2)}deg`,
      ["--ty" as string]: `${lift.toFixed(1)}px`,
    };
  };

  return (
    <section
      className="bottom-hand"
      data-active-turn={isMyTurn ? "true" : "false"}
      aria-label={`La tua mano, ${count} carte`}
    >
      <div className="bottom-hand-head">
        <h4>La tua mano · {count} carte</h4>
        <div className="bottom-hand-head-right">
          {selectionCount > 0 && (
            <button
              type="button"
              className="selection-chip"
              onClick={onClearSelection}
              aria-label={`${selectionCount} carte selezionate. Tocca per deselezionare tutte.`}
            >
              {selectionCount} selezionate <span aria-hidden="true">✕</span>
            </button>
          )}
          <span className="bottom-hand-hint muted">
            Tocca per selezionare · tieni premuto/trascina per riordinare · Ctrl/⌘ + ← →
          </span>
        </div>
      </div>

      {count === 0 ? (
        <p className="faint">Mano vuota — sei andato a pozzetto!</p>
      ) : (
        <ul
          ref={listRef}
          className="fan"
          role="list"
          data-layout={layout}
          style={{ ["--fan-count" as string]: String(count) }}
        >
          {orderedHand.map((card, index) => {
            const selected = selectedCards.includes(card.id);
            const isDragging = dragId === card.id;
            const isOver = dropIndex === index && dragId !== null && dragId !== card.id;
            return (
              <li
                key={card.id}
                className="fan-slot"
                data-card-id={card.id}
                style={fanStyle(index)}
                data-dragging={isDragging ? "true" : "false"}
                data-over={isOver ? "true" : "false"}
                data-selected={selected ? "true" : "false"}
              >
                <CardView
                  card={card}
                  selected={selected}
                  pressed={pressId === card.id}
                  pending={inFlightCardId === card.id}
                  onClick={isMyTurn && !pending ? onKeyboardActivate : undefined}
                  onKeyDown={(e) => onKeyDownCard(e, card, index)}
                  onPointerDown={(e) => onPointerDown(e, card, index)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* Regione live per l'esito di selezione/riordino (screen reader). */}
      <div ref={liveRef} className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </section>
  );
}
