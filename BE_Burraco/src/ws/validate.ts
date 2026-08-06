import { z } from "zod";
import type { ClientMessage } from "../contract/types.js";

/**
 * SEC-07 — Validazione di SCHEMA dei messaggi in ingresso, al BORDO del WS.
 * Ogni ClientMessage è validato per FORMA prima di raggiungere il motore di
 * regole: se non è conforme, il chiamante risponde con MALFORMED al mittente,
 * senza mai sollevare eccezioni interne ("Errore interno del server").
 *
 * NB: la validazione è di sola FORMA (tipi/campi). La legalità della mossa
 * (regole del Burraco) resta ESCLUSIVAMENTE del motore server-side.
 */

const clientMoveId = z.string().optional();

const joinRoom = z.object({
  type: z.literal("join_room"),
  roomCode: z.string(),
  playerToken: z.string().optional(),
  displayName: z.string(),
});

const draw = z.object({
  type: z.literal("draw"),
  source: z.enum(["deck", "discard"]),
  clientMoveId,
});

const meldNew = z.object({
  type: z.literal("meld_new"),
  cards: z.array(z.string()),
  clientMoveId,
});

const meldExtend = z.object({
  type: z.literal("meld_extend"),
  meldId: z.string(),
  cards: z.array(z.string()),
  clientMoveId,
});

const pinellaSubstitute = z.object({
  type: z.literal("pinella_substitute"),
  meldId: z.string(),
  cardInHand: z.string(),
  clientMoveId,
});

const discard = z.object({
  type: z.literal("discard"),
  card: z.string(),
  clientMoveId,
});

const heartbeat = z.object({ type: z.literal("heartbeat") });

const clientMessageSchema = z.discriminatedUnion("type", [
  joinRoom,
  draw,
  meldNew,
  meldExtend,
  pinellaSubstitute,
  discard,
  heartbeat,
]);

/**
 * Valida un valore già deserializzato da JSON. Non lancia mai: ritorna un
 * risultato discriminato. In caso di successo, `msg` è tipizzato come
 * ClientMessage (le chiavi sconosciute vengono scartate da zod).
 */
export function parseClientMessage(
  raw: unknown,
): { ok: true; msg: ClientMessage } | { ok: false } {
  const res = clientMessageSchema.safeParse(raw);
  if (!res.success) return { ok: false };
  return { ok: true, msg: res.data as ClientMessage };
}
