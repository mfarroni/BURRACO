"use client";

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { CENTER_CROP, MAX_ZOOM, clampCrop, type Crop, type SourceImage } from "@/lib/image";

/**
 * REGOLAZIONE DELL'INQUADRATURA di una foto prima del salvataggio (scheda prodotto
 * shop, foto profilo). Due pezzi separati, così il riquadro può stare DENTRO
 * l'anteprima reale (la scheda prodotto) e i comandi sotto:
 *  - `CropFrame`: il riquadro col rapporto d'uscita. Trascinamento (mouse, dito),
 *    zoom con rotellina o pizzico a due dita, tastiera (frecce, + / −, 0).
 *  - `CropControls`: cursore dello zoom, pulsante "Centra" e istruzioni.
 *
 * L'anteprima è solo CSS (percentuali sul riquadro, niente canvas durante il gesto):
 * la stessa geometria di `cropRect` in `lib/image.ts`, quindi ciò che si vede è ciò
 * che `renderCropToDataUrl` produrrà al salvataggio.
 */

const KEY_STEP = 0.05;
const KEY_STEP_FAST = 0.2;
const ZOOM_STEP = 0.1;

/** Dimensioni della foto in unità "larghezza del riquadro" (1 = riquadro pieno). */
function layout(source: SourceImage, aspect: number, crop: Crop) {
  const nw = source.img.naturalWidth || 1;
  const nh = source.img.naturalHeight || 1;
  const s = Math.max(1 / nw, 1 / aspect / nh) * crop.zoom;
  const iw = nw * s; // larghezza foto / larghezza riquadro
  const ih = nh * s * aspect; // altezza foto / altezza riquadro
  return { iw, ih };
}

export function CropFrame({
  source,
  aspect,
  crop,
  onChange,
  label,
  hintId,
  round = false,
}: {
  source: SourceImage;
  /** Rapporto larghezza/altezza dell'uscita (4/3 per il prodotto, 1 per l'avatar). */
  aspect: number;
  crop: Crop;
  onChange: (c: Crop) => void;
  label: string;
  /** id delle istruzioni (`CropControls`), per `aria-describedby`. */
  hintId?: string;
  round?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  // Valori correnti per i gestori nativi (rotellina) e per i gesti in corso.
  const latest = useRef({ crop, onChange, source, aspect });
  latest.current = { crop, onChange, source, aspect };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ crop: Crop; cx: number; cy: number; dist: number } | null>(null);

  const { iw, ih } = layout(source, aspect, crop);
  const c = clampCrop(crop);

  // Rotellina: listener NATIVO non passivo, altrimenti preventDefault non ferma lo scroll.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { crop: cur, onChange: set } = latest.current;
      set(clampCrop({ ...cur, zoom: cur.zoom * Math.exp(-e.deltaY * 0.0015) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Riparte da zero il gesto quando cambia il numero di dita/puntatori. */
  const resetGesture = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 0) {
      gesture.current = null;
      return;
    }
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const dist = pts.length >= 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0;
    gesture.current = { crop: latest.current.crop, cx, cy, dist };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    resetGesture();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current || !frameRef.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    let zoom = g.crop.zoom;
    if (pts.length >= 2 && g.dist > 0) {
      zoom = g.crop.zoom * (Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) / g.dist);
    }
    // Trascinare la foto verso destra mostra la sua parte sinistra (x diminuisce).
    const rect = frameRef.current.getBoundingClientRect();
    const l = layout(latest.current.source, latest.current.aspect, { ...g.crop, zoom });
    const freeX = (l.iw - 1) * rect.width;
    const freeY = (l.ih - 1) * rect.height;
    const x = freeX > 0.5 ? g.crop.x - (2 * (cx - g.cx)) / freeX : g.crop.x;
    const y = freeY > 0.5 ? g.crop.y - (2 * (cy - g.cy)) / freeY : g.crop.y;
    latest.current.onChange(clampCrop({ zoom, x, y }));
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    resetGesture();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_FAST : KEY_STEP;
    let next: Crop | null = null;
    switch (e.key) {
      case "ArrowLeft":
        next = { ...c, x: c.x - step };
        break;
      case "ArrowRight":
        next = { ...c, x: c.x + step };
        break;
      case "ArrowUp":
        next = { ...c, y: c.y - step };
        break;
      case "ArrowDown":
        next = { ...c, y: c.y + step };
        break;
      case "+":
      case "=":
        next = { ...c, zoom: c.zoom + ZOOM_STEP };
        break;
      case "-":
      case "_":
        next = { ...c, zoom: c.zoom - ZOOM_STEP };
        break;
      case "0":
      case "Home":
        next = CENTER_CROP;
        break;
    }
    if (next) {
      e.preventDefault();
      onChange(clampCrop(next));
    }
  };

  return (
    <div
      ref={frameRef}
      className={round ? "img-crop-frame is-round" : "img-crop-frame"}
      style={{ aspectRatio: String(aspect) }}
      tabIndex={0}
      role="group"
      aria-roledescription="area di ritaglio"
      aria-label={label}
      aria-describedby={hintId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL: nessuna ottimizzazione Next applicabile */}
      <img
        src={source.src}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          left: `${(-(iw - 1) * (c.x + 1) * 50).toFixed(3)}%`,
          top: `${(-(ih - 1) * (c.y + 1) * 50).toFixed(3)}%`,
          width: `${(iw * 100).toFixed(3)}%`,
          height: `${(ih * 100).toFixed(3)}%`,
          maxWidth: "none",
          objectFit: "fill",
        }}
      />
    </div>
  );
}

export function CropControls({
  crop,
  onChange,
  hintId,
  disabled = false,
}: {
  crop: Crop;
  onChange: (c: Crop) => void;
  hintId: string;
  disabled?: boolean;
}) {
  const c = clampCrop(crop);
  const zoomId = `${hintId}-zoom`;
  return (
    <div className="img-crop-controls">
      <div className="img-crop-zoom">
        <label htmlFor={zoomId}>Zoom</label>
        <input
          id={zoomId}
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={c.zoom}
          onChange={(e) => onChange(clampCrop({ ...c, zoom: Number(e.target.value) }))}
          aria-valuetext={`${Math.round(c.zoom * 100)}%`}
          disabled={disabled}
        />
        <button type="button" className="img-crop-center" onClick={() => onChange(CENTER_CROP)} disabled={disabled}>
          Centra
        </button>
      </div>
      <p id={hintId} className="img-crop-hint">
        Trascina la foto per spostarla; rotellina o due dita per lo zoom. Da tastiera, sulla foto: frecce per
        spostare (Maiusc per passi lunghi), + e − per lo zoom, 0 per centrare.
      </p>
    </div>
  );
}
