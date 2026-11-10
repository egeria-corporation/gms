// SPDX-License-Identifier: AGPL-3.0-only
// Runs the real API Worker in-process so the web client can be tested against it: `createApp`
// from apps/api over its in-memory repositories, reached through an injected `fetch`.
//
// The API's test helpers are loaded by URL at run time so this package's type-check does not pull
// the Worker's sources (and their Workers-only globals) into the web program.
import { createHttpApi } from "../src/api/client.ts";

interface Table {
  insert(row: Record<string, unknown>): Promise<Record<string, unknown>>;
  find(where?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}
export interface ApiHarness {
  request(path: string, init?: RequestInit): Promise<Response>;
  session(userId: string, opts?: { aal?: "aal1" | "aal2" }): Promise<string>;
  repos: { table(name: string): Table };
  passport: { fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response> };
  clock: { now: Date };
}
interface ApiHelpers {
  harness(): Promise<ApiHarness>;
  BASE: string;
  WEB: string;
  PASSPORT: string;
  USER_ADMIN: string;
  WS_FUNDER: string;
  ORG_RIVERBEND: string;
}

export async function loadApi(): Promise<ApiHelpers> {
  const url = new URL("../../api/test/helpers.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ url)) as ApiHelpers;
}

/** The web HTTP client wired to an in-process API, signed in as `userId`. */
export function httpApiFor(helpers: ApiHelpers, h: ApiHarness, userId: string | null, email = "dana.ortiz@riverbendcf.example") {
  const fetchInProcess: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const u = new URL(req.url);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    return h.request(u.pathname + u.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
  };
  return createHttpApi({
    baseUrl: helpers.BASE,
    token: async () => (userId ? h.session(userId) : null),
    identity: async () => ({ email }),
    fetch: fetchInProcess,
  });
}
