import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey(),
  config: jsonb("config").notNull(),
  targetScore: integer("target_score").notNull(),
  status: text("status").notNull(), // "playing" | "ended"
  winnerSeat: integer("winner_seat"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const matchPlayers = pgTable("match_players", {
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
});

export const hands = pgTable("hands", {
  id: uuid("id").primaryKey(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  handNumber: integer("hand_number").notNull(),
  dealerSeat: integer("dealer_seat").notNull(),
  closerSeat: integer("closer_seat"),
  status: text("status").notNull(), // "playing" | "ended"
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const handScores = pgTable("hand_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  handId: uuid("hand_id").notNull().references(() => hands.id),
  seat: integer("seat").notNull(),
  ptsMelds: integer("pts_melds").notNull(),
  ptsBonus: integer("pts_bonus").notNull(),
  ptsPenaltyHand: integer("pts_penalty_hand").notNull(),
  ptsPozzetto: integer("pts_pozzetto").notNull(),
  totalDelta: integer("total_delta").notNull(),
});

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
