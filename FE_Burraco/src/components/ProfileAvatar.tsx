"use client";

import { useEffect, useRef, useState } from "react";
import { fetchAvatar, saveAvatar } from "@/lib/profile";
import { AuthClientError } from "@/lib/auth";
import { ACCEPTED_IMAGE_TYPES, ImageError, resizeImageToDataUrl } from "@/lib/image";

/**
 * FOTO PROFILO del giocatore. Senza foto mostra l'iniziale del nome. Per i
 * REGISTRATI (`editable`) offre carica/cambia/rimuovi: la foto è ritagliata al centro
 * e ridotta a 256×256 nel browser, poi inviata al backend (che la rivalida). Gli
 * ospiti vedono solo l'iniziale: il backend non conserva foto per loro (403).
 */

const AVATAR_SIZE = 256;
/** Sotto il tetto del backend (150.000 caratteri). */
const AVATAR_MAX_CHARS = 140_000;

export function ProfileAvatar({ name, editable }: { name: string; editable: boolean }) {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const data = await resizeImageToDataUrl(file, AVATAR_SIZE, AVATAR_SIZE, { maxChars: AVATAR_MAX_CHARS });
      setAvatar(await saveAvatar(data));
    } catch (err) {
      setError(
        err instanceof ImageError || err instanceof AuthClientError ? err.message : "Impossibile salvare la foto.",
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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
            {busy ? "Salvataggio…" : avatar ? "Cambia foto" : "Carica foto"}
          </label>
          {avatar && (
            <button type="button" className="btn-ghost profile-avatar-btn" onClick={() => void onRemove()} disabled={busy}>
              Rimuovi
            </button>
          )}
          <p id="profile-avatar-hint" className="profile-avatar-hint">
            JPG, PNG o WebP: la foto viene ritagliata e ridotta a 256 × 256 px.
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
