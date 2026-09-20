import type { Request, Response } from "express";
import type { AuthService } from "../auth/service.js";
import type { AuthPrincipal } from "../auth/types.js";

/**
 * FASE 5.1 — Gate dell'area webmaster. Risolve il principale dal Bearer e lo
 * ritorna SOLO se è admin. Altrimenti INVIA GIÀ una risposta 404 (non 403): un
 * 403 confermerebbe l'esistenza dell'area riservata, un 404 la nega del tutto —
 * stessa risposta di una rotta inesistente.
 *
 * Il ruolo è risolto dal DB a ogni richiesta (token opachi): una revoca ha effetto
 * immediato, anche con un token ancora valido. Nessun contenuto è nascosto solo via
 * CSS: gli endpoint semplicemente non rispondono ai non-admin.
 *
 * Ritorna `null` quando ha già risposto (il chiamante fa `return`), altrimenti il
 * principale admin. Stesso pattern di `requireRegistered` in http/app.ts.
 */
export function createRequireAdmin(auth: AuthService) {
  return async function requireAdmin(req: Request, res: Response): Promise<AuthPrincipal | null> {
    const header = req.headers.authorization;
    const token = header && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
    const principal = await auth.getPrincipalByToken(token || undefined);
    if (!principal || principal.role !== "admin") {
      // 404 identico a una rotta sconosciuta: l'esistenza dell'area non è osservabile.
      res.status(404).json({ error: "NOT_FOUND", message: "Risorsa non trovata." });
      return null;
    }
    return principal;
  };
}
