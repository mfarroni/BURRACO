import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { WebSocket } from "ws";
import { createHttpApp } from "../src/http/app.js";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { MemoryStatsStore } from "../src/stats/store.memory.js";
import { RoomManager } from "../src/room/RoomManager.js";
import type { ServerMessage } from "../src/contract/types.js";

/**
 * CICLO Profilo — FOTO ai POSTI: GET /tables/:code/avatars. Solo chi siede al tavolo
 * vede le foto (posto → data URL); estranei, tavoli inesistenti e codici malformati →
 * 404; senza Bearer → 401. Mai id utente nella risposta.
 */

let server: http.Server;
let base: string;
let manager: RoomManager;

class FakeSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  send(s: string): void {
    this.sent.push(JSON.parse(s) as ServerMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  as(): WebSocket {
    return this as unknown as WebSocket;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

before(async () => {
  const auth = new AuthService(new MemoryAuthStore());
  manager = new RoomManager({ authService: auth, requireAuth: false });
  server = http.createServer(createHttpApp(auth, new MemoryStatsStore(), manager));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function register(email: string): Promise<{ token: string; id: string }> {
  const r = await fetch(base + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password12", displayName: email.split("@")[0] }),
  });
  const j = (await r.json()) as { token: string; user: { id: string } };
  return { token: j.token, id: j.user.id };
}

const get = (path: string, token?: string) =>
  fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("foto ai posti: i giocatori seduti le vedono; estranei e codici ignoti → 404; senza token → 401", async () => {
  const a = await register("anna@example.com");
  const b = await register("bruno@example.com");
  const outsider = await register("carlo@example.com");

  const setAv = await fetch(base + "/users/me/avatar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ avatar: PNG_1PX }),
  });
  assert.equal(setAv.status, 200);

  const wsA = new FakeSocket();
  manager.handleMessage(wsA.as(), {
    type: "open_table",
    code: "AVT1",
    private: false,
    displayName: "x",
    clientId: "cid-a",
    authToken: a.token,
  });
  await delay(30);
  const wsB = new FakeSocket();
  manager.handleMessage(wsB.as(), {
    type: "join_room",
    roomCode: "AVT1",
    displayName: "y",
    clientId: "cid-b",
    authToken: b.token,
  });
  await delay(30);

  assert.equal((await get("/tables/AVT1/avatars")).status, 401);

  for (const who of [a, b]) {
    const r = await get("/tables/avt1/avatars", who.token);
    assert.equal(r.status, 200);
    const body = (await r.json()) as { avatars: { seat: number; avatar: string | null }[] };
    assert.equal(body.avatars.length, 2);
    const bySeat = Object.fromEntries(body.avatars.map((x) => [x.seat, x.avatar]));
    assert.deepEqual(Object.values(bySeat).sort(), [PNG_1PX, null].sort());
    // Nessun id utente nella risposta.
    assert.ok(!JSON.stringify(body).includes(a.id) && !JSON.stringify(body).includes(b.id));
  }

  assert.equal((await get("/tables/AVT1/avatars", outsider.token)).status, 404);
  assert.equal((await get("/tables/NOPE9/avatars", a.token)).status, 404);
  assert.equal((await get("/tables/%3Cx%3E/avatars", a.token)).status, 404);
});
