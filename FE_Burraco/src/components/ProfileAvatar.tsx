"use client";

import { useEffect, useRef, useState } from "react";
import { fetchAvatar, saveAvatar } from "@/lib/profile";
import { AuthClientError } from "@/lib/auth";
import {
  ACCEPTED_IMAGE_TYPES,
  CENTER_CROP,
  ImageError,
  loadImageFile,
  renderCropToDataUrl,
  type Crop,
  type SourceImage,
} from "@/lib/image";
import { CropControls, CropFrame } from "./ImageCropper";

/**
 * FOTO PROFILO del giocatore. Senza foto mostra l'iniziale del nome. Per i
 * REGISTRATI (`editable`) offre carica/cambia/rimuovi: scelto il file, l'utente ne
 * regola l'inquadratura (trascina, zoom) e conferma; la foto è ridotta a 256×256 nel
 * browser, poi inviata al backend (che la rivalida). Gli
 * ospiti vedono solo l'iniziale: il backend non conserva foto per loro (403).
 */

const AVATAR_SIZE = 256;
/** Sotto il tetto del backend (150.000 caratteri). */
const AVATAR_MAX_CHARS = 140_000;

export function ProfileAvatar({ name, editable }: { name: string; editable: boolean }) {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Originale scelto e in attesa di conferma, con l'inquadratura corrente.
  const [pending, setPending] = useState<SourceImage | null>(null);
  const [crop, setCrop] = useState<Crop>(CENTER_CROP);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editable) return;
    let alive = true;
    fetchAvatar()
      .then((a) => {
        if (alive) setAvatar(a);
      })
      .catch(() => {
        /* foto facoltativa: in errore resta l'iniziale */
      });
    return () => {
      alive = false;
    };
  }, [editable]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setPending(await loadImageFile(file));
      setCrop(CENTER_CROP);
    } catch (err) {
      setError(err instanceof ImageError ? err.message : "Impossibile leggere la foto.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onConfirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const data = renderCropToDataUrl(pending, AVATAR_SIZE, AVATAR_SIZE, crop, { maxChars: AVATAR_MAX_CHARS });
      setAvatar(await saveAvatar(data));
      setPending(null);
    } catch (err) {
      setError(
        err instanceof ImageError || err instanceof AuthClientError ? err.message : "Impossibile salvare la foto.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      setAvatar(await saveAvatar(null));
    } catch (err) {
      setError(err instanceof AuthClientError ? err.message : "Impossibile rimuovere la foto.");
    } finally {
      setBusy(false);
    }
  };

  const initial = (name.trim()[0] ?? "?").toUpperCase();

  if (pending) {
    return (
      <div className="profile-avatar-block">
        <div className="profile-avatar-crop">
          <CropFrame
            source={pending}
            aspect={1}
            crop={crop}
            onChange={setCrop}
            label={`Inquadratura della foto profilo di ${name}`}
            hintId="profile-avatar-crop-hint"
            round
          />
          <CropControls crop={crop} onChange={setCrop} hintId="profile-avatar-crop-hint" disabled={busy} />
          <div className="profile-avatar-actions">
            <button type="button" className="btn-ghost profile-avatar-btn" onClick={() => void onConfirm()} disabled={busy}>
              {busy ? "Salvataggio…" : "Salva foto"}
            </button>
            <button type="button" className="btn-ghost profile-avatar-btn" onClick={() => setPending(null)} disabled={busy}>
              Annulla
            </button>
          </div>
          {error && (
            <p className="profile-avatar-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="profile-avatar-block">
      <div className="profile-avatar" aria-busy={busy}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL: nessuna ottimizzazione Next applicabile
          <img src={avatar} alt={`Foto profilo di ${name}`} />
        ) : (
          <span className="profile-avatar-initial" aria-hidden="true">
            {initial}
          </span>
        )}
      </div>
      {editable && (
        <div className="profile-avatar-actions">
          <input
            ref={fileRef}
            id="profile-avatar-file"
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            className="profile-avatar-file"
            onChange={(e) => void onPick(e.target.files?.[0])}
            disabled={busy}
            aria-describedby="profile-avatar-hint"
          />
          <label htmlFor="profile-avatar-file" className="btn-ghost profile-avatar-btn" aria-disabled={busy}>
            {busy ? "Attendere…" : avatar ? "Cambia foto" : "Carica foto"}
          </label>
          {avatar && (
            <button type="button" className="btn-ghost profile-avatar-btn" onClick={() => void onRemove()} disabled={busy}>
              Rimuovi
            </button>
          )}
          <p id="profile-avatar-hint" className="profile-avatar-hint">
            JPG, PNG o WebP: dopo la scelta ne regoli l&apos;inquadratura; viene ridotta a 256 × 256 px.
          </p>
          {error && (
            <p className="profile-avatar-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
