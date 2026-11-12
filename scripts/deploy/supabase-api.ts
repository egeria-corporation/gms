// SPDX-License-Identifier: AGPL-3.0-only
// The Supabase Management API (https://api.supabase.com/v1) over the injected fetch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./core.ts";
import { reveal } from "./core.ts";

export const SUPABASE_API = "https://api.supabase.com/v1";

/** SUPABASE_ACCESS_TOKEN, else the file the Supabase CLI writes when it has no OS keyring. A token kept in the keyring cannot be read here. */
export function supabaseToken(ctx: Ctx): string | null {
  let token = ctx.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    try {
      token = readFileSync(join(ctx.env.SUPABASE_HOME || join(ctx.home, ".supabase"), "access-token"), "utf8").trim();
    } catch {
      token = undefined;
    }
  }
  return token ? reveal(ctx, token) : null;
}

export const LOGIN_MESSAGE = "Supabase is not signed in. Create a personal access token in the Supabase dashboard (Account, Access Tokens), export it as SUPABASE_ACCESS_TOKEN, then re-run. (`supabase login` often keeps its token in the system keyring, which this tool cannot read.)";

export interface ApiReply<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  status: number;
  body: T;
}

export class Supabase {
  ctx: Ctx;
  token: string;
  constructor(ctx: Ctx, token: string) {
    this.ctx = ctx;
    this.token = token;
  }
  async call<T = any>(method: string, path: string, body?: unknown): Promise<ApiReply<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await this.ctx.fetch(`${SUPABASE_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: r.status, body: parsed as T };
  }
  organizations() {
    return this.call<{ id?: string; slug?: string; name: string }[]>("GET", "/organizations");
  }
  projects() {
    return this.call<{ id?: string; ref?: string; name: string; organization_id?: string; organization_slug?: string; region?: string; status?: string }[]>("GET", "/projects");
  }
  project(ref: string) {
    return this.call<{ id: string; name: string; status?: string }>("GET", `/projects/${ref}`);
  }
  /** The anon and service-role keys. Held in memory only; every value is registered as secret. */
  async keys(ref: string): Promise<{ anon: string; service: string } | null> {
    const r = await this.call<{ name?: string; api_key?: string }[]>("GET", `/projects/${ref}/api-keys?reveal=true`);
    if (r.status !== 200 || !Array.isArray(r.body)) return null;
    for (const k of r.body) reveal(this.ctx, k.api_key);
    const anon = r.body.find((k) => k.name === "anon")?.api_key;
    const service = r.body.find((k) => k.name === "service_role")?.api_key;
    return anon && service ? { anon, service } : null;
  }
  /** The signing keys the project uses for sessions, or null when the endpoint cannot be read. */
  async signingKeys(ref: string): Promise<{ algorithm?: string; status?: string }[] | null> {
    const r = await this.call<{ keys?: { algorithm?: string; status?: string }[] } | { algorithm?: string; status?: string }[]>("GET", `/projects/${ref}/config/auth/signing-keys`);
    if (r.status !== 200) return null;
    const list = Array.isArray(r.body) ? r.body : (r.body as { keys?: unknown[] })?.keys;
    return Array.isArray(list) ? (list as { algorithm?: string; status?: string }[]) : null;
  }
  /** The legacy HS256 JWT secret, registered as a secret. */
  async jwtSecret(ref: string): Promise<string | null> {
    const r = await this.call<{ jwt_secret?: string }>("GET", `/projects/${ref}/postgrest`);
    return r.status === 200 && r.body?.jwt_secret ? reveal(this.ctx, r.body.jwt_secret) : null;
  }
  query<T = any>(ref: string, query: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.call<T[] | { message?: string }>("POST", `/projects/${ref}/database/query`, { query });
  }
}

export const ACTIVE_STATUSES_NOT = new Set(["INACTIVE", "REMOVED", "GOING_DOWN", "PAUSING", "PAUSE_FAILED", "RESTORE_FAILED", "INIT_FAILED", "UPGRADING_FAILED"]);
/** Statuses a project never leaves by itself. */
export const TERMINAL_STATUSES = new Set(["INIT_FAILED", "REMOVED", "RESTORE_FAILED", "PAUSE_FAILED", "UPGRADING_FAILED", "INACTIVE"]);
export const projectRef = (p: { ref?: string; id?: string }) => (p.ref ?? p.id ?? "") as string;
export const isActiveProject = (p: { status?: string }) => !ACTIVE_STATUSES_NOT.has(p.status ?? "");

export function apiMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) return String((body as { message: unknown }).message).slice(0, 300);
  return typeof body === "string" ? body.slice(0, 300) : "no message";
}

export const KEYS_MESSAGE = "Could not read the project's anon and service_role API keys. If the project's legacy keys are turned off, turn them on again in the Supabase dashboard (Project Settings, API Keys, Legacy): this version of the GMS needs them.";
