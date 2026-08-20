"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthUser } from "./contract";
import * as authClient from "./auth";

/**
 * Hook di STATO di autenticazione (competenza develop: stato client + fattibilità).
 * Possiede l'utente corrente e le azioni register/login/guest/logout, delegando
 * al client `auth.ts` che parla col backend (unica autorità). Nessuna regola qui.
 *
 * Al mount tenta un ripristino di sessione via /auth/me (token salvato in
 * sessionStorage/memoria). Copre lo stato di attesa iniziale (`initializing`).
 */

export type AuthStatus = "initializing" | "anonymous" | "authenticated";

export interface UseAuth {
  status: AuthStatus;
  user: AuthUser | null;
  /** true durante una chiamata di rete (register/login/guest/logout). */
  busy: boolean;
  /** messaggio d'errore leggibile dell'ultima azione (o null). */
  error: string | null;
  register: (email: string, password: string, displayName?: string) => Promise<boolean>;
  login: (email: string, password: string) => Promise<boolean>;
  guest: (displayName?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export function useAuth(): UseAuth {
  const [status, setStatus] = useState<AuthStatus>("initializing");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ripristino di sessione al primo mount (best-effort).
  useEffect(() => {
    let alive = true;
    authClient
      .me()
      .then((u) => {
        if (!alive) return;
        setUser(u);
        setStatus(u ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (!alive) return;
        setStatus("anonymous");
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Esegue un'azione auth, gestendo busy/error e aggiornando l'utente in caso di successo. */
  const run = useCallback(
    async (action: () => Promise<AuthUser>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const u = await action();
        setUser(u);
        setStatus("authenticated");
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Operazione non riuscita.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const register = useCallback(
    (email: string, password: string, displayName?: string) =>
      run(() => authClient.register(email, password, displayName)),
    [run],
  );
  const login = useCallback(
    (email: string, password: string) => run(() => authClient.login(email, password)),
    [run],
  );
  const guest = useCallback((displayName?: string) => run(() => authClient.guest(displayName)), [run]);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await authClient.logout();
    } finally {
      setUser(null);
      setStatus("anonymous");
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { status, user, busy, error, register, login, guest, logout, clearError };
}
