"use client";

/**
 * Ridimensionamento LATO CLIENT di una foto scelta dall'utente, prima dell'invio al
 * backend (che accetta solo data URL d'immagine con tetto di dimensione). Il file
 * originale non lascia mai il browser: si spedisce solo il risultato compresso.
 *
 * `cover` riempie esattamente `width`×`height` (foto profilo quadrata, scheda prodotto
 * 4:3): di default al centro, oppure con l'inquadratura (`Crop`) scelta dall'utente
 * nel componente `ImageCropper`. L'uscita è sempre JPEG (niente SVG né trasparenze).
 */

export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp";

export class ImageError extends Error {}

/**
 * Inquadratura scelta dall'utente dentro il riquadro di uscita:
 *  - `zoom` ≥ 1: 1 = ritaglio "cover" (la porzione più grande col rapporto richiesto);
 *  - `x`, `y` in [-1, 1]: posizione nello spazio libero, 0 = centro, -1 = bordo
 *    sinistro/alto della foto, 1 = bordo destro/basso. Così l'inquadratura resta
 *    sempre dentro la foto, a qualsiasi zoom (niente bande vuote).
 */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

export const CENTER_CROP: Crop = { zoom: 1, x: 0, y: 0 };
export const MAX_ZOOM = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampCrop(c: Crop): Crop {
  return { zoom: clamp(c.zoom, 1, MAX_ZOOM), x: clamp(c.x, -1, 1), y: clamp(c.y, -1, 1) };
}

/** Foto originale decodificata, tenuta in memoria finché l'utente regola l'inquadratura. */
export interface SourceImage {
  img: HTMLImageElement;
  /** Data URL dell'originale, per l'anteprima (la CSP non ammette `blob:`). */
  src: string;
}

/**
 * Legge il file come data URL (NON `URL.createObjectURL`: la CSP del sito ammette solo
 * `img-src 'self' data:`, un URL `blob:` verrebbe bloccato) e lo decodifica.
 */
export function loadImageFile(file: File): Promise<SourceImage> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    return Promise.reject(new ImageError("Formato non supportato: usa una foto JPG, PNG o WebP."));
  }
  if (file.size > 15 * 1024 * 1024) {
    return Promise.reject(new ImageError("La foto è troppo grande (massimo 15 MB)."));
  }
  return new Promise((resolve, reject) => {
    const fail = () => reject(new ImageError("Impossibile leggere l'immagine selezionata."));
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => resolve({ img, src });
      img.onerror = fail;
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Porzione della foto (in pixel dell'originale) che finisce nel riquadro di uscita
 * `width`×`height` con l'inquadratura `crop`.
 */
export function cropRect(nw: number, nh: number, width: number, height: number, crop: Crop) {
  const c = clampCrop(crop);
  const scale = Math.max(width / nw, height / nh) * c.zoom;
  const sw = width / scale;
  const sh = height / scale;
  return { sx: ((nw - sw) * (c.x + 1)) / 2, sy: ((nh - sh) * (c.y + 1)) / 2, sw, sh };
}

/** Disegna l'inquadratura su un canvas `width`×`height` e la esporta in JPEG entro `maxChars`. */
export function renderCropToDataUrl(
  source: SourceImage,
  width: number,
  height: number,
  crop: Crop,
  opts: { quality?: number; maxChars?: number } = {},
): string {
  const { img } = source;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Il browser non supporta l'elaborazione delle immagini.");
  const { sx, sy, sw, sh } = cropRect(img.naturalWidth, img.naturalHeight, width, height, crop);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);

  // Qualità decrescente finché il risultato rientra nel tetto del backend.
  const maxChars = opts.maxChars ?? Infinity;
  let quality = opts.quality ?? 0.85;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > maxChars && quality > 0.4) {
    quality -= 0.1;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  if (out.length > maxChars) throw new ImageError("Impossibile comprimere la foto entro il limite consentito.");
  return out;
}

/** Scorciatoia: carica il file e lo ritaglia al centro (inquadratura automatica). */
export async function resizeImageToDataUrl(
  file: File,
  width: number,
  height: number,
  opts: { quality?: number; maxChars?: number } = {},
): Promise<string> {
  return renderCropToDataUrl(await loadImageFile(file), width, height, CENTER_CROP, opts);
}
