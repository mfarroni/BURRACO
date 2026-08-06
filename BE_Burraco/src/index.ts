import { createServer } from "./ws/server.js";
import { env } from "./config.js";

/**
 * Entry point del backend Burraco (web service persistente su Render).
 * NON serverless (decisione #1): mantiene le connessioni WebSocket aperte.
 */
const server = createServer();

server.listen(env.port, () => {
  console.log(`[be-burraco] in ascolto sulla porta ${env.port}`);
  console.log(`[be-burraco] origini WS consentite: ${env.allowedOrigins.join(", ")}`);
});

const shutdown = (signal: string) => {
  console.log(`[be-burraco] ricevuto ${signal}, chiusura in corso…`);
  server.close(() => process.exit(0));
  // Failsafe: forza l'uscita se le connessioni non si chiudono in tempo.
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
