"use client";

/**
 * Ridimensionamento LATO CLIENT di una foto scelta dall'utente, prima dell'invio al
 * backend (che accetta solo data URL d'immagine con tetto di dimensione). Il file
 * originale non lascia mai il browser: si spedisce solo il risultato compresso.
 *
 * `cover` ritaglia al centro per riempire esattamente `width`×`height` (foto profilo
 * quadrata, scheda prodotto 4:3); l'uscita è sempre JPEG (niente SVG né trasparenze).
 */

export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp";

export class ImageError extends Error {}

/**
 * Legge il file come data URL (NON `URL.createObjectURL`: la CSP del sito ammette solo
 * `img-src 'self' data:`, un URL `blob:` verrebbe bloccato) e lo decodifica.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new ImageError("Impossibile leggere l'immagine selezionata."));
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = fail;
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function resizeImageToDataUrl(
  file: File,
  width: number,
  height: number,
  opts: { quality?: number; maxChars?: number } = {},
): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new ImageError("Formato non supportato: usa una foto JPG, PNG o WebP.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new ImageError("La foto è troppo grande (massimo 15 MB).");
  }
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Il browser non supporta l'elaborazione delle immagini.");
  // Ritaglio centrale "cover": la porzione più grande della foto con il rapporto richiesto.
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
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
