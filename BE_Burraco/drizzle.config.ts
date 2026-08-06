import type { Config } from "drizzle-kit";

/**
 * Configurazione Drizzle Kit per generare/applicare le migrazioni verso Neon.
 * DATABASE_URL deve puntare all'endpoint POOLED di Neon.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
