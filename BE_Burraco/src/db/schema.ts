import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema minimale (decisione #5): SOLO checkpoint e audit. Lo stato di gioco
 * autoritativo vive in RAM; qui si persistono fine mano/partita ed eventi.
 * Nessun restore-from-DB in v1.
 *
 * Macro-ciclo 1 (Auth + Ospiti): si aggiungono `users` e `sessions` per
 * l'identità (account registrati e ospiti unificati sotto `is_guest`). La
 * PERSISTENZA auth è astratta dietro `AuthStore` (src/auth): con DATABASE_URL
 * usa queste tabelle Drizzle, senza usa un'implementazione in-memory. Lo schema
 * qui resta la fonte per `drizzle-kit generate` (migrazione versionata).
 */

/**
 * Identità unificata (decisione D del PIANO): un unico modello per account
 * registrati e ospiti. `is_guest=true` → nessuna email, nessun password_hash.
 * `email`/`password_hash` sono nullable proprio per accogliere gli ospiti.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: gli ospiti non hanno email. Unicità garantita a livello DB per gli
  // account registrati (indice unique); NULL multipli sono ammessi in Postgres.
  email: text("email").unique(),
  displayName: text("display_name").notNull(),
  // Nullable: gli ospiti non hanno password. Hash argon2id per i registrati.
  passwordHash: text("password_hash"),
  isGuest: boolean("is_guest").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /**
   * Igiene sessioni (macro-ciclo lobby): marca temporale di SCADENZA del record
   * OSPITE all'uscita (chiusura pagina / ritorno alla vetrina). Serve a distinguere
   * gli ospiti non più attivi senza cancellarli fisicamente subito: la cancellazione
   * fisica avviene nello sweep SOLO se l'ospite non è più referenziato (§6.4). Il
   * `display_name` resta leggibile in chiaro (nessuna anonimizzazione). Sempre NULL
   * per gli account registrati: non vengono mai marcati scaduti né cancellati.
   */
  expiredAt: timestamp("expired_at", { withTimezone: true }),
});

/**
 * Sessioni opache (decisione B): il token in chiaro NON viene mai persistito;
 * si salva SOLO il suo hash (sha256). Scadenza (`expires_at`) e revoca
 * (`revoked_at`) rendono i token verificabili/invalidabili lato server.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").unique().notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey(),
    config: jsonb("config").notNull(),
    targetScore: integer("target_score").notNull(),
    // Vocabolario di stato (macro-ciclo lobby): "playing" | "completed" | "aborted" |
    // "abandoned". SOLO "completed" (fine legittima per raggiungimento del punteggio
    // pieno) aggiorna le statistiche; "aborted" (annullamento) e "abandoned"
    // (disconnessione oltre la grazia) non toccano mai i contatori.
    status: text("status").notNull(),
    winnerSeat: integer("winner_seat"),
    // Fine partita (best-effort): valorizzato alla conclusione/annullamento/abbandono.
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // Identità dell'utente che ha ANNULLATO la partita (solo per status "aborted"),
    // per audit/analisi future. Nullable e non-breaking; il record storico della
    // partita non viene mai cancellato. FK a users con ON DELETE no action (nessun
    // cascade): un ospite referenziato qui non è cancellabile fisicamente.
    abortedBy: uuid("aborted_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Ordinamento dello storico per fine partita (rende l'indice efficace e
    // semplifica getRecentMatches, che ordina per matches.ended_at).
    endedAtIdx: index("matches_ended_at_idx").on(t.endedAt.desc()),
  }),
);

export const matchPlayers = pgTable(
  "match_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id").notNull().references(() => matches.id),
    seat: integer("seat").notNull(), // 0 | 1
    displayName: text("display_name").notNull(),
    playerTokenHash: text("player_token_hash").notNull(),
    connectionStatus: text("connection_status").notNull().default("connected"),
    // Macro-ciclo 1: traccia CHI (account/ospite) ha occupato il posto. Nullable e
    // non-breaking: le partite pre-auth (o senza DB) restano valide. Il posto in
    // partita resta governato da playerToken/clientId (SEC-04/10/11) INVARIATI.
    userId: uuid("user_id").references(() => users.id),
  },
  (t) => ({
    // Ogni query statistica parte da "le partecipazioni di questo utente": senza
    // indice sarebbe un seq-scan dell'intera tabella. Le FK non sono auto-indicizzate.
    userMatchIdx: index("match_players_user_match_idx").on(t.userId, t.matchId),
  }),
);

export const hands = pgTable(
  "hands",
  {
    id: uuid("id").primaryKey(),
    matchId: uuid("match_id").notNull().references(() => matches.id),
    handNumber: integer("hand_number").notNull(),
    dealerSeat: integer("dealer_seat").notNull(),
    closerSeat: integer("closer_seat"),
    status: text("status").notNull(), // "playing" | "ended"
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => ({
    // Join hands→match (somma punteggi, dettaglio): non indicizzato di default.
    matchIdx: index("hands_match_idx").on(t.matchId),
  }),
);

export const handScores = pgTable(
  "hand_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handId: uuid("hand_id").notNull().references(() => hands.id),
    seat: integer("seat").notNull(),
    ptsMelds: integer("pts_melds").notNull(),
    ptsBonus: integer("pts_bonus").notNull(),
    ptsPenaltyHand: integer("pts_penalty_hand").notNull(),
    ptsPozzetto: integer("pts_pozzetto").notNull(),
    totalDelta: integer("total_delta").notNull(),
    // Fatti di STILE (migrazione 0002). Additivi con default retro-compatibili: le
    // smazzate storiche restano valide (0 burrachi, pozzetto non in diretta).
    burrachiPuliti: integer("burrachi_puliti").notNull().default(0),
    burrachiSporchi: integer("burrachi_sporchi").notNull().default(0),
    pozzettoInDiretta: boolean("pozzetto_in_diretta").notNull().default(false),
  },
  (t) => ({
    // Chiave d'idempotenza: una sola riga punteggio per (smazzata, seat). Blocca il
    // doppio conteggio da un eventuale secondo endHand sullo stesso hand_id.
    handSeatUq: uniqueIndex("hand_scores_hand_seat_uq").on(t.handId, t.seat),
    // Join hand_scores→hands: è il più caldo (ogni SUM(total_delta) e il dettaglio).
    handIdx: index("hand_scores_hand_idx").on(t.handId),
  }),
);

export const gameEvents = pgTable("game_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  handId: uuid("hand_id"),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  actorSeat: integer("actor_seat"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const checkpoints = pgTable("checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  handId: uuid("hand_id").notNull(),
  seq: integer("seq").notNull(),
  // Stato pieno server-side: MAI esposto ai client.
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
