import {
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
 */

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
