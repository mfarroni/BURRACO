/**
 * KIT DI TEST per l'area /admin/* (CICLO Pannello Admin). NON è un file di test
 * (`*.test.ts`): è un modulo di supporto importato dai test admin/email.
 *
 * Perché uno store dedicato: `MemoryAuthStore` crea SEMPRE utenti con `role:"user"`
 * e non esiste alcun endpoint di promozione (la promozione admin è manuale via SQL,
 * per decisione del piano). Per esercitare il gate `requireAdmin` — che legge il
 * ruolo dal DB a OGNI richiesta — serve poter promuovere/revocare un utente ad admin
 * a runtime. `AdminTestAuthStore` intercetta le letture dell'utente e inietta
 * `role:"admin"` per gli id presenti in `adminIds`: questo riproduce fedelmente la
 * lettura per-richiesta (revoca istantanea, test S3) senza toccare il codice di prod.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { AuthService } from "../src/auth/service.js";
import { MemoryAuthStore } from "../src/auth/store.memory.js";
import { createHttpApp } from "../src/http/app.js";
import type { StoredUser } from "../src/auth/types.js";

export class AdminTestAuthStore extends MemoryAuthStore {
  /** Insieme MUTABILE di id promossi ad admin: riflette il ruolo letto per-richiesta. */
  readonly adminIds = new Set<string>();

  override async getUserById(id: string): Promise<StoredUser | null> {
    const u = await super.getUserById(id); // già una copia difensiva
    if (u && this.adminIds.has(id)) u.role = "admin";
    return u;
  }

  override async getUserByEmail(email: string): Promise<StoredUser | null> {
    const u = await super.getUserByEmail(email);
    if (u && this.adminIds.has(u.id)) u.role = "admin";
    return u;
  }
}

export interface TestServer {
  base: string;
  store: AdminTestAuthStore;
  auth: AuthService;
  close: () => Promise<void>;
}

/** Avvia un server HTTP isolato (limiter freschi) con lo store admin-aware. */
export async function startAdminServer(): Promise<TestServer> {
  const store = new AdminTestAuthStore();
  const auth = new AuthService(store);
  const app = createHttpApp(auth);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    store,
    auth,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface HttpResult {
  status: number;
  json: any;
  text: string;
  headers: Headers;
}

/** Richiesta HTTP generica con Bearer opzionale; drena sempre il corpo. */
export async function call(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Registra un utente REGISTRATO e ritorna token + id. */
export async function makeUser(
  base: string,
  email: string,
  password = "password12",
  displayName?: string,
): Promise<{ token: string; id: string; user: any }> {
  const r = await call(base, "POST", "/auth/register", { body: { email, password, displayName } });
  if (r.status !== 201) throw new Error(`register fallita (${r.status}): ${r.text}`);
  return { token: r.json.token, id: r.json.user.id, user: r.json.user };
}

/** Registra un utente e lo promuove ad admin nello store del server. */
export async function makeAdmin(server: TestServer, email: string): Promise<{ token: string; id: string }> {
  const u = await makeUser(server.base, email);
  server.store.adminIds.add(u.id);
  return { token: u.token, id: u.id };
}

/** Crea un OSPITE (ruolo 'user', isGuest true) e ritorna token + id. */
export async function makeGuest(base: string): Promise<{ token: string; id: string }> {
  const r = await call(base, "POST", "/auth/guest", { body: { displayName: "Ospite" } });
  if (r.status !== 201) throw new Error(`guest fallita (${r.status}): ${r.text}`);
  return { token: r.json.token, id: r.json.user.id };
}

/** UUID v4 valido ma inesistente (per rotte con :id). */
export const RANDOM_UUID = "11111111-1111-4111-8111-111111111111";
