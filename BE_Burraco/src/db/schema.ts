import { sql } from "drizzle-orm";
import {
  boolean,
  date,
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
  /**
   * FASE 5.1 (migrazione 0006): ruolo applicativo. `'user'` di default (additiva,
   * non confligge con 2v2 né statistiche). `'admin'` abilita l'area webmaster. Il
   * ruolo è letto dal DB a OGNI richiesta amministrativa (token opachi → revoca
   * istantanea): nessun claim da scadere. Promozione del primo admin via query
   * manuale documentata, mai da un endpoint.
   */
  role: text("role").notNull().default("user"),
  /**
   * FASE 5.3 (migrazione 0008): consenso alle comunicazioni PROMOZIONALI. Le
   * comunicazioni di SERVIZIO (transazionali) prescindono da questo flag; le
   * promozionali richiedono `promo_opt_in=true`. Default false (opt-in esplicito).
   */
  promoOptIn: boolean("promo_opt_in").notNull().default(false),
  /**
   * FASE 5.3: token opaco per la disiscrizione via link pubblico `GET /unsubscribe`.
   * Nullable: valorizzato alla prima necessità. Non è un segreto di sessione.
   */
  unsubToken: text("unsub_token"),
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
    // Macro-ciclo 3 (2v2, migrazione 0003): SQUADRA vincitrice. Nullable e additiva.
    // `winner_seat` RESTA (audit: posto che ha materialmente chiuso). La vittoria è
    // della SQUADRA (P4); le statistiche di coppia (Fase 3, differite) confronteranno
    // `winner_team` con `match_players.team`. Backfill `winner_team = winner_seat` per
    // le partite completate storiche (in 1v1 team = seat → identico).
    winnerTeam: integer("winner_team"),
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
    seat: integer("seat").notNull(), // 0..n-1
    // Macro-ciclo 3 (2v2, migrazione 0003): SQUADRA del posto. Nullable e additiva:
    // le partite pre-migrazione restano valide (backfill `team = seat`). In modalità
    // individuale `team === seat`; in coppie posti opposti condividono la squadra
    // (0+2, 1+3). Il codice scrive sempre `team` d'ora in poi; le letture usano
    // `team ?? seat` per le righe storiche. La PROPRIETÀ del posto (playerToken/
    // clientId, SEC-04/10/11) resta INVARIATA: `team` è solo per punteggio/storico.
    team: integer("team"),
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

/**
 * Lotto 5 (R8 — PROTEZIONE LOGIN / LOCKOUT PROGRESSIVO, migrazione 0004): contatore
 * PERSISTITO dei login falliti, così la protezione sopravvive al risveglio/cold start
 * di Render (in RAM si azzererebbe, vanificandola). Additiva e non referenziata da FK.
 *
 * Nessun segreto: `key` è l'hash sha256 di (email normalizzata + IP) — mai l'email o
 * l'IP in chiaro, mai password/token. `failed_count` cresce entro la finestra e si
 * azzera dopo WINDOW_MS di inattività (nessun blocco definitivo). `last_failed_at`
 * governa sia l'azzeramento automatico sia lo sweep periodico (indicizzato).
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    key: text("key").primaryKey(), // hash(email + ip); nessun segreto in chiaro
    failedCount: integer("failed_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Sweep dei record inattivi (pruneLoginAttempts) senza seq-scan dell'intera tabella.
    lastFailedIdx: index("login_attempts_last_failed_idx").on(t.lastFailedAt),
  }),
);

/* ══════════════════ CICLO Contatti/Webmaster/Retention ══════════════════ */

/**
 * FASE 2 (migrazione 0005): messaggi del form contatti PUBBLICO. Principio
 * portante (§2.1): il messaggio si salva SEMPRE; l'email è un di più. `ip_hash` è
 * `sha256(ip + salt)`: mai l'IP in chiaro. `stato_invio` traccia l'esito email
 * senza mai rivelarlo all'utente (risposta sempre generica).
 */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    email: text("email").notNull(),
    oggetto: text("oggetto").notNull(),
    messaggio: text("messaggio").notNull(),
    // Nullable: il form è pubblico (anche non autenticato). FK ON DELETE no action.
    userId: uuid("user_id").references(() => users.id),
    ipHash: text("ip_hash").notNull(),
    // 'salvato' | 'inviato' | 'errore_invio' | 'skippato'
    statoInvio: text("stato_invio").notNull().default("salvato"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Valorizzato quando il webmaster legge il messaggio (governa la retention 180gg).
    lettoAt: timestamp("letto_at", { withTimezone: true }),
  },
  (t) => ({
    createdAtIdx: index("contact_messages_created_at_idx").on(t.createdAt.desc()),
  }),
);

/**
 * FASE 5.1 (migrazione 0006): traccia amministrativa. Ogni operazione webmaster
 * scrive qui PRIMA dell'esecuzione, nella stessa transazione. `target` descrive i
 * soggetti (id/criterio) senza segreti; `outcome` include 'dry_run'.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    action: text("action").notNull(),
    target: jsonb("target"),
    outcome: text("outcome").notNull(), // 'ok'|'rejected'|'error'|'dry_run'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    createdAtIdx: index("admin_audit_log_created_at_idx").on(t.createdAt.desc()),
  }),
);

/**
 * FASE 4 (migrazione 0007): totali CONSOLIDATI per utente registrato. Le
 * statistiche sono ON-THE-FLY sul dettaglio: potare il dettaglio le cancellerebbe.
 * Questa tabella conserva le voci PERMANENTI così il profilo mostra i totali anche
 * dopo la potatura. Aggiornata incrementalmente su `completeMatch` + riconciliazione
 * periodica (rete di sicurezza). Una riga per utente registrato (gli ospiti no).
 */
export const userStatsTotals = pgTable("user_stats_totals", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  matchesPlayed: integer("matches_played").notNull().default(0),
  matchesWon: integer("matches_won").notNull().default(0),
  matchesLost: integer("matches_lost").notNull().default(0),
  matchesAbandoned: integer("matches_abandoned").notNull().default(0),
  totalPoints: integer("total_points").notNull().default(0),
  bestMatchScore: integer("best_match_score"),
  burrachiPuliti: integer("burrachi_puliti").notNull().default(0),
  burrachiSporchi: integer("burrachi_sporchi").notNull().default(0),
  vsRegistered: integer("vs_registered").notNull().default(0),
  vsGuest: integer("vs_guest").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * FASE 5.3 (migrazione 0008): comunicazione ai registrati. `corpo` è SOLO testo
 * semplice; `criterio` seleziona i destinatari (registratiDopo/minPartite/
 * inattiviDaGiorni/all). L'invio è asincrono a lotti; l'aggregato resta qui.
 */
export const broadcasts = pgTable("broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").notNull().references(() => users.id),
  oggetto: text("oggetto").notNull(),
  corpo: text("corpo").notNull(),
  tipo: text("tipo").notNull(), // 'servizio' | 'promozionale'
  criterio: jsonb("criterio").notNull(),
  stato: text("stato").notNull().default("bozza"), // 'bozza'|'in_invio'|'completato'|'errore'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * FASE 5.3: un destinatario per riga. `UNIQUE(broadcast_id, user_id)` = idempotenza
 * (un doppio send non duplica). Retention 90gg dopo invio; l'aggregato resta in
 * `broadcasts`.
 */
export const broadcastRecipients = pgTable(
  "broadcast_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    broadcastId: uuid("broadcast_id").notNull().references(() => broadcasts.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    stato: text("stato").notNull().default("in_coda"), // 'in_coda'|'inviato'|'errore'|'saltato'
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    broadcastUserUq: uniqueIndex("broadcast_recipients_broadcast_user_uq").on(t.broadcastId, t.userId),
    broadcastIdx: index("broadcast_recipients_broadcast_idx").on(t.broadcastId),
  }),
);

/**
 * FASE 5.4 (migrazione 0009): eventi applicativi NOSTRI (l'unica fonte di log che
 * controlliamo). `messaggio`/`meta` sono GIÀ redatti (nessun segreto/token/indirizzo
 * completo). Tetto righe + retention 30–90gg: cresce, ricade nel budget.
 */
export const appEvents = pgTable(
  "app_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    livello: text("livello").notNull(), // 'info'|'warn'|'error'
    categoria: text("categoria").notNull(), // 'auth'|'contact'|'cleanup'|'broadcast'|…
    messaggio: text("messaggio").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    createdAtIdx: index("app_events_created_at_idx").on(t.createdAt.desc()),
  }),
);

/* ══════════════════ CICLO Pannello Admin + Notifiche Email ══════════════════ */

/**
 * Migrazione 0010 — CONTATORE giornaliero degli invii ACCETTATI da Brevo, per
 * giorno-solare nel fuso `EMAIL_QUOTA_TZ` (default Europe/Rome). Fonte di verità di
 * "quanto inviato oggi": una UPSERT locale, preferita all'interrogazione dell'API
 * Brevo a ogni invio. La chiave è la data (`YYYY-MM-DD`): il cambio di giorno crea una
 * nuova riga a `sent=0` (nessun job di reset a mezzanotte). Si contano SOLO gli esiti
 * 'sent' (skipped/error non consumano quota reale). `mode: "string"` mantiene la data
 * come stringa allineata al valore calcolato via Intl (nessun fuso implicito lato JS).
 */
export const emailQuotaDaily = pgTable("email_quota_daily", {
  day: date("day", { mode: "string" }).primaryKey(),
  sent: integer("sent").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Migrazione 0010 — CODA delle email TRANSAZIONALI (oggi 'benvenuto'; predisposta ad
 * altri tipi one-off). I broadcast NON entrano qui: hanno già `broadcast_recipients`.
 * `body` è SOLO testo semplice, GIÀ composto alla scrittura (nessun HTML). `priorita`
 * 0 = massima (benvenuto): è il canale d'ordine benvenuto>broadcast quando competono
 * sulla quota. Indice PARZIALE sui soli `in_attesa`: la coda resta piccola per il
 * dispatcher anche con storico grande.
 */
export const emailQueue = pgTable(
  "email_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tipo: text("tipo").notNull(), // 'benvenuto' (estendibile)
    toEmail: text("to_email").notNull(),
    toName: text("to_name"),
    subject: text("subject").notNull(),
    body: text("body").notNull(), // solo testo semplice, già composto
    priorita: integer("priorita").notNull().default(0),
    stato: text("stato").notNull().default("in_attesa"), // 'in_attesa'|'inviata'|'fallita'|'saltata'
    tentativi: integer("tentativi").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => ({
    // Indice parziale: rispecchia `WHERE stato = 'in_attesa'` della migrazione SQL.
    pendingIdx: index("email_queue_pending_idx")
      .on(t.stato, t.priorita, t.createdAt)
      .where(sql`${t.stato} = 'in_attesa'`),
  }),
);

/**
 * Migrazione 0011 — PREDISPOSIZIONE Eventi/Tornei del circolo. Solo scaffolding:
 * CRUD admin minimale (create/list), nessuna vetrina pubblica in questo ciclo.
 * `pubblicato` separa bozza e pubblicazione senza cancellare. `created_by` nullable
 * (audit soft) con FK a users senza cascade.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    titolo: text("titolo").notNull(),
    descrizione: text("descrizione"),
    luogo: text("luogo"),
    inizioAt: timestamp("inizio_at", { withTimezone: true }).notNull(),
    fineAt: timestamp("fine_at", { withTimezone: true }),
    pubblicato: boolean("pubblicato").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    inizioIdx: index("events_inizio_idx").on(t.inizioAt.desc()),
  }),
);

/**
 * Migrazione 0011 — PREDISPOSIZIONE prodotti Shop. Solo scaffolding: CRUD admin
 * minimale (create/list), nessun carrello/pagamento in questo ciclo. `prezzo_cent`
 * è un intero in CENTESIMI (mai float sul denaro); `immagine_url` è un URL, non un
 * blob (il DB non è un CDN). `disponibile` è l'interruttore di visibilità futura.
 */
export const shopProducts = pgTable(
  "shop_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    descrizione: text("descrizione"),
    prezzoCent: integer("prezzo_cent").notNull().default(0),
    valuta: text("valuta").notNull().default("EUR"),
    immagineUrl: text("immagine_url"),
    disponibile: boolean("disponibile").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    disponibileIdx: index("shop_products_disponibile_idx").on(t.disponibile),
  }),
);

/* ══════════════════ CICLO Profilo + Webmaster ══════════════════ */

/**
 * Migrazione 0012 — FOTO PROFILO dell'utente registrato, in tabella DEDICATA: la riga
 * `users` è letta a ogni richiesta autenticata e non deve portarsi dietro decine di KB.
 * `data` è un data URL (`data:image/jpeg|png|webp;base64,…`) già ridimensionato dal
 * client, con tetto di dimensione lato server. Visibile solo al proprietario.
 */
export const userAvatars = pgTable("user_avatars", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
