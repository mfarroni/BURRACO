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

/**
 * NEW-4 (hardening): limiti di LUNGHEZZA difensivi, coerenti col dominio. Una
 * mano di Burraco non supera poche decine di carte, gli id sono UUID/short-id, i
 * nomi sono brevi. Input oltre i limiti → schema non conforme → MALFORMED, come
 * per ogni altra violazione di forma. Non incidono sulle regole (solo forma).
 */
const MAX_ID = 64; // id di carta/meld, token, clientMoveId
const MAX_NAME = 64; // displayName
// Cap difensivo generoso sul roomCode: il RoomManager lo normalizza/tronca già a
// 12, quindi qui bastano limitare gli input patologici senza cambiarne la semantica.
const MAX_ROOM = 64;
// authToken: token opaco base64url (~43 char). Cap ampio ma limitato per non
// bufferizzare input patologici (la validità reale la decide l'AuthService).
const MAX_AUTH_TOKEN = 512;
const MAX_CARDS = 20; // carte per singola azione (upper bound largo sul dominio)

const cardId = z.string().max(MAX_ID);
const clientMoveId = z.string().max(MAX_ID).optional();
const cardIdArray = z.array(cardId).max(MAX_CARDS);

const joinRoom = z.object({
  type: z.literal("join_room"),
  roomCode: z.string().max(MAX_ROOM),
  playerToken: z.string().max(MAX_ID).optional(),
  displayName: z.string().max(MAX_NAME),
  // LIFECYCLE: identità di sessione per-browser per il reclaim del posto. Cap
  // difensivo coerente con gli altri id (è un UUID lato client).
  clientId: z.string().max(MAX_ID).optional(),
  // AUTH: token di sessione opaco per identità e gating SEC-08 (validato dal
  // servizio, non qui). Solo controllo di FORMA/lunghezza al bordo.
  authToken: z.string().max(MAX_AUTH_TOKEN).optional(),
});

// LIFECYCLE: smontaggio esplicito del tavolo. Nessun payload oltre al tipo.
const resetRoom = z.object({ type: z.literal("reset_room") });

const draw = z.object({
  type: z.literal("draw"),
  source: z.enum(["deck", "discard"]),
  clientMoveId,
});

const meldNew = z.object({
  type: z.literal("meld_new"),
  cards: cardIdArray,
  clientMoveId,
});

const meldExtend = z.object({
  type: z.literal("meld_extend"),
  meldId: z.string().max(MAX_ID),
  cards: cardIdArray,
  clientMoveId,
});

const pinellaSubstitute = z.object({
  type: z.literal("pinella_substitute"),
  meldId: z.string().max(MAX_ID),
  cardInHand: cardId,
  clientMoveId,
});

const discard = z.object({
  type: z.literal("discard"),
  card: cardId,
  clientMoveId,
});

// ANNULLA l'ultima calata annullabile: nessun payload oltre al correlation id.
const undoLast = z.object({
  type: z.literal("undo_last"),
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
  undoLast,
  resetRoom,
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
