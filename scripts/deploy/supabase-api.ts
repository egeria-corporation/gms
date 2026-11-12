// SPDX-License-Identifier: AGPL-3.0-only
// The Supabase Management API (https://api.supabase.com/v1) over the injected fetch.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./core.ts";
import { reveal } from "./core.ts";

export const SUPABASE_API = "https://api.supabase.com/v1";

export function supabaseToken(ctx: Ctx): string | null {
  let token = ctx.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    try {
      token = readFileSync(join(ctx.home, ".supabase", "access-token"), "utf8").trim();
    } catch {
      token = undefined;
    }
  }
  return token ? reveal(ctx, token) : null;
}

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
    return this.call<{ id: string; slug?: string; name: string }[]>("GET", "/organizations");
  }
  projects() {
    return this.call<{ id: string; name: string; organization_id?: string; organization_slug?: string; region?: string; status?: string }[]>("GET", "/projects");
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
  query<T = any>(ref: string, query: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.call<T[] | { message?: string }>("POST", `/projects/${ref}/database/query`, { query });
  }
}

export const ACTIVE_STATUSES_NOT = new Set(["INACTIVE", "REMOVED", "GOING_DOWN", "PAUSED", "PAUSING", "RESTORE_FAILED"]);
export const isActiveProject = (p: { status?: string }) => !ACTIVE_STATUSES_NOT.has(p.status ?? "");

export function apiMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) return String((body as { message: unknown }).message).slice(0, 300);
  return typeof body === "string" ? body.slice(0, 300) : "no message";
}
