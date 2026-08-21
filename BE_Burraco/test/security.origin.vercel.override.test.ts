import { test, before } from "node:test";
import assert from "node:assert/strict";

/**
 * REMEDIATION CORS — override di VERCEL_PROJECT/VERCEL_TEAM_SLUG via env.
 *
 * File dedicato: le env sono impostate PRIMA dell'import dinamico del modulo
 * (config legge process.env al load; originPolicy costruisce la regex una volta).
 * Con NODE_ENV=production e ALLOWED_ORIGINS assente, verifichiamo che lo strato
 * (b) usi i valori SOVRASCRITTI e non i default burraco/groupgames.
 */

process.env.NODE_ENV = "production";
delete process.env.ALLOWED_ORIGINS;
process.env.VERCEL_PROJECT = "customapp";
process.env.VERCEL_TEAM_SLUG = "myteam";

let isOriginAllowed: (origin: string | undefined) => boolean;

before(async () => {
  ({ isOriginAllowed } = await import("../src/net/originPolicy.js"));
});

test("override: URL del progetto/team sovrascritti sono ammessi", () => {
  assert.equal(isOriginAllowed("https://customapp.vercel.app"), true);
  assert.equal(isOriginAllowed("https://customapp-git-dev-myteam.vercel.app"), true);
  assert.equal(isOriginAllowed("https://customapp-hash99-myteam.vercel.app"), true);
});

test("override: i default burraco/groupgames NON sono più ammessi", () => {
  assert.equal(isOriginAllowed("https://burraco-git-main-groupgames.vercel.app"), false);
  assert.equal(isOriginAllowed("https://burraco.vercel.app"), false);
});

test("override: team errato rifiutato anche col progetto giusto", () => {
  assert.equal(isOriginAllowed("https://customapp-git-dev-groupgames.vercel.app"), false);
});

test("fail-closed preservato: origin non-Vercel e origin assente rifiutati", () => {
  assert.equal(isOriginAllowed("https://ok.example"), false);
  assert.equal(isOriginAllowed(undefined), false);
});
