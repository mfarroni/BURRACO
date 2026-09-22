import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * REMEDIATION R1 (SEC-ADM-01) — verifica funzionale agente_test della GUARDIA DI
 * RE-ENTRANCY del dispatcher email (`src/mail/dispatcher.ts`).
 *
 * COSA VERIFICA
 *  1) Due invocazioni CONCORRENTI di `runEmailDispatch()` non si sovrappongono: mentre
 *     il primo tick è in corso (`dispatching=true`, sospeso sul primo `await`), un
 *     secondo tick esce SUBITO con `{welcomeSent:0,broadcastSent:0}` senza avviare un
 *     secondo drenaggio delle code.
 *  2) Il `reset` nel `finally` rilascia la guardia: un tick successivo la supera davvero.
 *
 * PERCHÉ env + import dinamico (stesso pattern di `remediation.cors.verify.test.ts`):
 * `runEmailDispatch` corto-circuita PRIMA della guardia se `!db` o `!env.mail.enabled`.
 * Nelle suite `db` è null (nessun DATABASE_URL) → la guardia non verrebbe MAI raggiunta.
 * Per esercitarla davvero si rende `db` non-nullo e l'invio abilitato impostando
 * DATABASE_URL/BREVO_ENABLED PRIMA dell'import dinamico. Il runner isola OGNI file in un
 * processo separato: queste env non contaminano le altre suite.
 *
 * PERCHÉ NON SERVE UN POSTGRES REALE: la connessione punta a 127.0.0.1:1 (rifiuto
 * immediato). L'osservabile della guardia — il SECONDO tick che esce subito — si risolve
 * in modo SINCRONO, prima di qualunque `await`/rete; nessuna asserzione dipende dall'esito
 * della query. L'unica query del PRIMO tick fallisce in background ed è assorbita
 * (`.catch`), e il Pool viene chiuso nell'`after`.
 *
 * GAP NOTO (documentato nel report, lasciato all'ispezione + agente_security): il "claim
 * guardato" dell'altra metà di R1 (UPDATE ... WHERE stato IN ('in_attesa'|'in_coda') e
 * conteggio quota/`sent` solo se `claimed.length===1`) è semantica SQL: senza un Postgres
 * reale non è esercitabile in modo pulito e non ha un artefatto di schema da asserire.
 */

process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:1/db";
process.env.BREVO_ENABLED = "true";

let runEmailDispatch: () => Promise<{ welcomeSent: number; broadcastSent: number }>;
let pool: { end?: () => Promise<void> } | null;

before(async () => {
  ({ runEmailDispatch } = await import("../src/mail/dispatcher.js"));
  ({ pool } = (await import("../src/db/client.js")) as { pool: { end?: () => Promise<void> } | null });
});

after(async () => {
  // Chiude il Pool fittizio (nessuna connessione stabilita: solo cleanup del socket).
  await pool?.end?.();
});

test("R1: un secondo tick concorrente esce subito senza sovrapporsi (dispatching guard)", async () => {
  // p1 avvia il tick: gira in modo sincrono fino al primo await (dispatching=true), poi
  // sospende sulla lettura della quota. La sua query sul db fittizio fallirà: la assorbo,
  // è irrilevante per la guardia.
  const p1 = runEmailDispatch();
  p1.catch(() => {});

  // p2 parte MENTRE p1 è in volo: la guardia lo fa uscire subito (return sincrono),
  // senza toccare le code né la quota.
  const r2 = await runEmailDispatch();
  assert.deepEqual(r2, { welcomeSent: 0, broadcastSent: 0 });

  await Promise.allSettled([p1]); // attende il finally del primo tick → reset di dispatching
});

test("R1: il finally rilascia la guardia (un tick successivo la supera)", async () => {
  // Se il finally NON avesse resettato `dispatching`, questa chiamata ritornerebbe none
  // (promise RISOLTA). Poiché supera la guardia, entra nel try ed esegue getQuotaStatus
  // sul db fittizio → la promise REJECTA. Il rifiuto prova che la guardia è stata rilasciata.
  await assert.rejects(runEmailDispatch());
});
