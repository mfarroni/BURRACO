import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";

/** Audit lancio R03 — GET /ping: risposta leggera per keep-alive, senza DB. */

let server: http.Server;
let base: string;

before(async () => {
  server = http.createServer(createHttpApp(new AuthService(new MemoryAuthStore())));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("GET /ping → 200 {status:ok}, non cacheabile, senza campi del DB", async () => {
  const res = await fetch(base + "/ping");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { status: "ok" });
});
