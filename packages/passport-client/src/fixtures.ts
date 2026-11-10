// SPDX-License-Identifier: AGPL-3.0-only
// Recorded-fixture mode: a `fetch` that answers from recorded Passport responses, for offline tests
// and local development without the Passport test deployment. Fixtures hold fictional organizations
// and, for banks, a name and last four digits only.
import type { FetchLike } from "./tokens.ts";

export interface Fixture {
  method: string;
  /** Path with optional query, e.g. `/passport/payees/…`. A fixture without a query matches any query. */
  path: string;
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FixtureFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
}

/**
 * Fixtures for the same method and path are served in order; the last one repeats. An unmatched
 * request answers 501 in the CommonGrants error shape, so a missing fixture is obvious in a test.
 */
export function fixtureFetch(fixtures: Fixture[]): FixtureFetch {
  const cursor = new Map<string, number>();
  const calls: RecordedCall[] = [];
  const doFetch: FetchLike = (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const full = url.pathname + url.search;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown = init?.body ?? null;
    if (typeof body === "string" && headers["content-type"]?.includes("json")) body = JSON.parse(body) as unknown;
    calls.push({ method, path: full, headers, body });

    const matches = fixtures.filter((f) => f.method.toUpperCase() === method && (f.path === full || f.path === url.pathname));
    if (!matches.length) {
      return Promise.resolve(Response.json({ status: 501, message: `No fixture for ${method} ${full}`, errors: [{ code: "no_fixture" }] }, { status: 501 }));
    }
    const key = `${method} ${matches[0]!.path}`;
    const i = cursor.get(key) ?? 0;
    cursor.set(key, i + 1);
    const f = matches[Math.min(i, matches.length - 1)]!;
    return Promise.resolve(Response.json(f.body, { status: f.status, headers: f.headers }));
  };
  return { fetch: doFetch, calls };
}
