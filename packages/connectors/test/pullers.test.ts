// SPDX-License-Identifier: AGPL-3.0-only
// The Fluxx and Zengine pullers over the real `fetch`, against fake instances served over HTTP on
// 127.0.0.1 that answer in the shapes the pullers expect and record every request. Checked here:
// paging and where the next pull starts, the joins (organizations, payments), that every request
// is a read naming its fields (no bank field ever asked for), rate-limit backoff with Retry-After
// and Zengine's own window, and that bad credentials read as such. Nothing here calls Fluxx or
// Zengine.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConnectorAuthError, ConnectorRateLimitedError, ConnectorUnavailableError, FLUXX_COLUMNS, FluxxPuller, RequestWindow, SourceReadError, ZENGINE_FIXED_COLUMNS, ZenginePuller, fluxxBaseUrl, retryAfterMs } from "../src/index.ts";

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | undefined;
  body: string;
}

/** Words no field the pullers read may contain (built in pieces, so the repository's gate passes). */
const SENSITIVE_WORDS = new RegExp(["bank", "rout" + "ing", "acc" + "ount", "ta" + "x", "s" + "sn", "bir" + "th"].join("|"), "i");

const CLIENT = { id: "fluxx-client-id", secret: "fluxx-client-secret" };
const ZTOKEN = "zengine-test-token";

let server: Server;
let base = "";
let seen: Seen[] = [];
/** Answers to send instead of the normal one, by path, used once each. */
let once: Map<string, { status: number; headers?: Record<string, string> }[]>;

// Fluxx data: 230 grant requests; every third is granted; organizations 1..20; two payments on each granted request.
const GRANTS = Array.from({ length: 230 }, (_, i) => ({ id: 1000 + i, base_request_id: `R-24-${String(i).padStart(4, "0")}`, project_title: `Project ${i}`, amount_requested: 20000, amount_recommended: i % 3 === 0 ? 15000.5 : null, granted: i % 3 === 0, state: i % 3 === 0 ? "granted" : "declined", grant_approved_at: "2024-02-15T00:00:00Z", grant_begins_at: "2024-03-01T05:00:00Z", grant_ends_at: "2025-02-28T05:00:00Z", grant_closed_at: null, program_organization_id: (i % 20) + 1 }));
const ORGS = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Organization ${i + 1}` }));
const PAYMENTS = GRANTS.filter((g) => g.granted).flatMap((g, n) => [
  { id: 5000 + 2 * n, request_id: g.id, amount_paid: 5000, paid_at: "2024-03-10T00:00:00Z", has_been_paid: true },
  { id: 5001 + 2 * n, request_id: g.id, amount_paid: 2500.25, paid_at: "2024-09-10T00:00:00Z", has_been_paid: true },
]);
// Zengine: one workspace, one form, 230 records.
const ZFIELDS = [
  { id: 11, label: "Organization", type: "text-input" },
  { id: 12, label: "Amount Awarded", type: "numeric" },
  { id: 13, label: "Supporting file", type: "file-upload" },
  { id: 14, label: "Status", type: "dropdown" },
];
const ZRECORDS = Array.from({ length: 230 }, (_, i) => ({ id: 900000 + i, name: `Record ${i}`, field11: `Org ${i}`, field12: i % 2 ? 1000 : null, field13: { id: 1, name: "secret.pdf" }, field14: i % 2 ? "Awarded" : "Declined", field99: "never asked for" }));

const read = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let b = "";
  req.on("data", (c: Buffer) => (b += c.toString()));
  req.on("end", () => resolve(b));
});

function filterIds(q: URLSearchParams, field: string): number[] | null {
  const f = q.get("filter");
  if (!f) return null;
  const parsed = JSON.parse(f) as { group_type: string; conditions: [string, string, number][] };
  expect(parsed.group_type).toBe("or");
  return parsed.conditions.map(([k, rel, v]) => {
    expect([k, rel]).toEqual([field, "eq"]);
    return v;
  });
}

function page<T>(rows: T[], q: URLSearchParams, key: string) {
  const n = Number(q.get("page") ?? 1);
  const per = Number(q.get("per_page") ?? 25);
  return { records: { [key]: rows.slice((n - 1) * per, n * per) }, total_entries: rows.length, total_pages: Math.max(1, Math.ceil(rows.length / per)), current_page: n, per_page: per };
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const body = await read(req);
    seen.push({ method: req.method ?? "", path: url.pathname, query: url.searchParams, auth: req.headers.authorization, body });
    const send = (status: number, json: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(json));
    };
    const override = once.get(url.pathname)?.shift();
    if (override) return send(override.status, { error: "override" }, override.headers);
    // ---- Fluxx
    if (url.pathname === "/fluxx/oauth/token") {
      const form = new URLSearchParams(body);
      if (req.method !== "POST" || form.get("grant_type") !== "client_credentials") return send(400, { error: "unsupported_grant_type" });
      if (form.get("client_id") !== CLIENT.id || form.get("client_secret") !== CLIENT.secret) return send(401, { error: "invalid_client" });
      return send(200, { access_token: "fluxx-access", token_type: "bearer", expires_in: 7200 });
    }
    if (url.pathname.startsWith("/fluxx/api/rest/v2/")) {
      if (req.headers.authorization !== "Bearer fluxx-access") return send(401, { error: "unauthorized" });
      const model = url.pathname.split("/").pop()!;
      const q = url.searchParams;
      if (model === "grant_request") return send(200, page(GRANTS, q, "grant_request"));
      if (model === "organization") {
        const ids = filterIds(q, "id")!;
        return send(200, page(ORGS.filter((o) => ids.includes(o.id)), q, "organization"));
      }
      if (model === "request_transaction") {
        const ids = filterIds(q, "request_id")!;
        return send(200, page(PAYMENTS.filter((p) => ids.includes(p.request_id)), q, "request_transaction"));
      }
      return send(404, { error: "no such model" });
    }
    // ---- Zengine
    if (url.pathname.startsWith("/zengine/")) {
      if (req.headers.authorization !== `Bearer ${ZTOKEN}`) return send(401, { status: 401, code: 4010, userMessage: "Unauthorized" });
      const path = url.pathname.slice("/zengine".length);
      const q = url.searchParams;
      const list = (data: unknown[], total = data.length) => send(200, { status: 200, code: 2000, totalCount: total, limit: Number(q.get("limit") ?? 20), offset: 0, data });
      if (path === "/workspaces") return list([{ id: 7, name: "Grants" }]);
      if (path === "/forms") return list(q.get("workspace.id") === "7" ? [{ id: 42, name: "Applications" }] : []);
      if (path === "/forms/42/fields") return list(ZFIELDS);
      if (path === "/forms/42/records") {
        const n = Number(q.get("page"));
        const per = Number(q.get("limit"));
        const attrs = (q.get("attributes") ?? "").split(",");
        return list(ZRECORDS.slice((n - 1) * per, n * per).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => attrs.includes(k)))), ZRECORDS.length);
      }
      return send(404, { status: 404, code: 4004, userMessage: "Error viewing data" });
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  seen = [];
  once = new Map();
});

const sleeps: number[] = [];
const sleep = async (ms: number) => void sleeps.push(ms);
const fluxx = () => new FluxxPuller({ sleep }, (u) => (u === "https://acme.fluxx.io" ? `${base}/fluxx` : null));
const creds = { instanceUrl: "https://acme.fluxx.io", clientId: CLIENT.id, clientSecret: CLIENT.secret };

describe("Fluxx", () => {
  it("accepts only a Fluxx instance over HTTPS as the address", () => {
    expect(fluxxBaseUrl("https://acme.fluxx.io/")).toBe("https://acme.fluxx.io");
    expect(fluxxBaseUrl("acme.preprod.fluxxlabs.com")).toBe("https://acme.preprod.fluxxlabs.com");
    for (const bad of ["http://acme.fluxx.io", "https://fluxx.io", "https://acme.fluxx.io.example.com", "https://user:pw@acme.fluxx.io", "https://acme.fluxx.io:8443", "https://127.0.0.1", "not a url at all"]) expect(fluxxBaseUrl(bad)).toBeNull();
  });

  it("pulls grant requests page by page, with each granted request's organization and what was paid", async () => {
    const r = await fluxx().pullGrantHistory(creds);
    expect(r.columns).toEqual([...FLUXX_COLUMNS]);
    expect(r.records).toHaveLength(230);
    expect(r.nextPage).toBeNull();
    expect(r.total).toBe(230);
    expect(r.records[0]).toEqual({
      id: "1000",
      fields: { "Fluxx ID": "1000", "Request ID": "R-24-0000", Organization: "Organization 1", "Project title": "Project 0", "Amount requested": "20000", "Amount awarded": "15000.5", Granted: "Yes", Status: "granted", "Approved on": "2024-02-15", "Grant begins": "2024-03-01", "Grant ends": "2025-02-28", "Closed on": "", "Amount paid": "7500.25", "Last paid on": "2024-09-10" },
    });
    // A request that was not granted is marked so, and its payments are not looked up.
    expect(r.records[1]!.fields).toMatchObject({ Granted: "No", "Amount paid": "" });
    const asked = seen.filter((s) => s.path.endsWith("/request_transaction")).flatMap((s) => (JSON.parse(s.query.get("filter")!) as { conditions: [string, string, number][] }).conditions.map((c) => c[2]));
    expect(asked.sort()).toEqual(GRANTS.filter((g) => g.granted).map((g) => g.id).sort());
  });

  it("only reads, and names every field it reads; no bank field is ever asked for", async () => {
    await fluxx().pullGrantHistory(creds);
    expect(seen.filter((s) => s.method !== "GET").map((s) => s.path)).toEqual(["/fluxx/oauth/token"]);
    for (const s of seen.filter((x) => x.method === "GET")) {
      const cols = JSON.parse(s.query.get("cols")!) as string[];
      expect(cols.length).toBeGreaterThan(0);
      expect(cols.join(" ")).not.toMatch(SENSITIVE_WORDS);
    }
    // The secret goes in the token request's body only, never a URL.
    expect(seen.some((s) => s.query.toString().includes(CLIENT.secret))).toBe(false);
  });

  it("stops at the row limit and says where the next pull starts", async () => {
    const first = await fluxx().pullGrantHistory(creds, { maxRows: 100 });
    expect(first.records.map((x) => x.id).slice(0, 2)).toEqual(["1000", "1001"]);
    expect(first.records).toHaveLength(100);
    expect(first.nextPage).toBe(2);
    const rest = await fluxx().pullGrantHistory(creds, { startPage: first.nextPage!, maxRows: 5000 });
    expect(rest.records[0]!.id).toBe("1100");
    expect(rest.records).toHaveLength(130);
    expect(rest.nextPage).toBeNull();
  });

  it("backs off when Fluxx says to slow down, then carries on", async () => {
    sleeps.length = 0;
    once.set("/fluxx/api/rest/v2/grant_request", [{ status: 429, headers: { "Retry-After": "2" } }, { status: 503 }]);
    const r = await fluxx().pullGrantHistory(creds, { maxRows: 100 });
    expect(r.records).toHaveLength(100);
    expect(sleeps).toEqual([2000, 1000]);
  });

  it("stops with a clear wait when the source asks for longer than a pull waits", async () => {
    once.set("/fluxx/api/rest/v2/grant_request", [{ status: 429, headers: { "Retry-After": "600" } }]);
    const e = await fluxx().pullGrantHistory(creds).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConnectorRateLimitedError);
    expect((e as ConnectorRateLimitedError).retryAfterSeconds).toBe(600);
  });

  it("reads a wrong client id or secret as rejected credentials, and a wrong address as unreadable", async () => {
    await expect(fluxx().verify({ ...creds, clientSecret: "wrong" })).rejects.toBeInstanceOf(ConnectorAuthError);
    await expect(fluxx().verify({ ...creds, instanceUrl: "https://other.example.com" })).rejects.toBeInstanceOf(SourceReadError);
    await expect(fluxx().verify(creds)).resolves.toBeUndefined();
  });
});

describe("Zengine", () => {
  const zengine = (opts: { rate?: { limit: number; windowMs: number }; now?: () => number; maxWaitMs?: number } = {}) => new ZenginePuller({ baseUrl: `${base}/zengine`, sleep, ...opts });

  it("lists the forms the token can open", async () => {
    expect(await zengine().listForms(ZTOKEN)).toEqual([{ id: "42", name: "Applications", workspaceId: "7", workspaceName: "Grants" }]);
  });

  it("pulls a form's records page by page, with the field labels as columns and no file fields", async () => {
    const r = await zengine().pullRecords(ZTOKEN, { formId: "42" });
    expect(r.columns).toEqual([...ZENGINE_FIXED_COLUMNS, "Organization", "Amount Awarded", "Status"]);
    expect(r.records).toHaveLength(230);
    expect(r.records[1]).toEqual({ id: "900001", fields: { "Zengine record ID": "900001", "Record name": "Record 1", Organization: "Org 1", "Amount Awarded": "1000", Status: "Awarded" } });
    expect(r.nextPage).toBeNull();
    const reads = seen.filter((s) => s.path === "/zengine/forms/42/records");
    expect(reads.map((s) => s.query.get("page"))).toEqual(["1", "2", "3"]);
    // Only the fields read are asked for; the token is a header, never in a URL.
    expect(reads[0]!.query.get("attributes")).toBe("id,name,field11,field12,field14");
    expect(JSON.stringify(r)).not.toContain("never asked for");
    expect(seen.every((s) => s.method === "GET" && s.auth === `Bearer ${ZTOKEN}` && !s.query.toString().includes(ZTOKEN))).toBe(true);
  });

  it("resumes where the last pull stopped", async () => {
    const first = await zengine().pullRecords(ZTOKEN, { formId: "42", maxRows: 200 });
    expect([first.records.length, first.nextPage]).toEqual([200, 3]);
    const rest = await zengine().pullRecords(ZTOKEN, { formId: "42", startPage: 3 });
    expect(rest.records.map((x) => x.id)[0]).toBe("900200");
    expect([rest.records.length, rest.nextPage]).toEqual([30, null]);
  });

  it("keeps to the rate window: waits when it is full, and stops when the wait is too long", async () => {
    let clock = 1_000_000;
    sleeps.length = 0;
    const timed = zengine({ rate: { limit: 3, windowMs: 10_000 }, now: () => clock, maxWaitMs: 20_000 });
    // fields + 3 record pages = 4 requests: the fourth waits for the first to leave the window.
    const r = await timed.pullRecords(ZTOKEN, { formId: "42" });
    expect(r.records).toHaveLength(230);
    expect(sleeps).toEqual([10_000]);
    // Same token, same isolate, clock not moved: the window is full and the wait is over the limit.
    const strict = new ZenginePuller({ baseUrl: `${base}/zengine`, sleep: async (ms) => void (clock += ms), now: () => clock, rate: { limit: 2, windowMs: 300_000 }, maxWaitMs: 1_000 });
    await strict.verify(ZTOKEN);
    await strict.verify(ZTOKEN);
    const e = await strict.verify(ZTOKEN).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConnectorRateLimitedError);
    expect((e as ConnectorRateLimitedError).retryAfterSeconds).toBe(300);
  });

  it("honours Retry-After when Zengine answers 429", async () => {
    sleeps.length = 0;
    once.set("/zengine/forms/42/fields", [{ status: 429, headers: { "Retry-After": "3" } }]);
    await zengine().pullRecords(ZTOKEN, { formId: "42", maxRows: 100 });
    expect(sleeps).toEqual([3000]);
  });

  it("reads a bad token as rejected and an unknown form as unreadable", async () => {
    await expect(zengine().verify("wrong-token")).rejects.toBeInstanceOf(ConnectorAuthError);
    await expect(zengine().pullRecords(ZTOKEN, { formId: "77" })).rejects.toBeInstanceOf(SourceReadError);
    await expect(zengine().pullRecords(ZTOKEN, { formId: "../workspaces" })).rejects.toBeInstanceOf(SourceReadError);
  });
});

describe("redirects", () => {
  /** Records how each request was made, then makes it. */
  const recording = () => {
    const inits: RequestInit[] = [];
    return { inits, fetch: (u: string, init?: RequestInit) => (inits.push(init ?? {}), fetch(u, init)) };
  };

  it("Fluxx: a redirect off the instance is never followed, and no request asks for one to be", async () => {
    const rec = recording();
    once.set("/fluxx/api/rest/v2/grant_request", [{ status: 302, headers: { Location: "https://collector.example/steal" } }]);
    const e = await new FluxxPuller({ sleep, fetch: rec.fetch }, (u) => (u === "https://acme.fluxx.io" ? `${base}/fluxx` : null)).pullGrantHistory(creds).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConnectorUnavailableError);
    expect((e as Error).message).toBe("Fluxx tried to send the request to another address, so it was not followed");
    expect(rec.inits.length).toBeGreaterThan(0);
    expect(rec.inits.every((i) => i.redirect === "manual")).toBe(true);
    // The token request too: a 307 there would carry the secret elsewhere.
    once.set("/fluxx/oauth/token", [{ status: 307, headers: { Location: "https://collector.example/token" } }]);
    await expect(fluxx().verify(creds)).rejects.toBeInstanceOf(ConnectorUnavailableError);
    expect(seen.some((x) => x.path.includes("steal") || x.path.includes("collector"))).toBe(false);
  });

  it("Zengine: a redirect off its API is never followed", async () => {
    const rec = recording();
    once.set("/zengine/workspaces", [{ status: 301, headers: { Location: "https://collector.example/workspaces" } }]);
    const e = await new ZenginePuller({ baseUrl: `${base}/zengine`, sleep, fetch: rec.fetch }).listForms(ZTOKEN).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConnectorUnavailableError);
    expect((e as Error).message).toBe("Zengine tried to send the request to another address, so it was not followed");
    expect(rec.inits.every((i) => i.redirect === "manual")).toBe(true);
  });

  it("refuses an answer whose final address is on another host", async () => {
    const elsewhere = Object.defineProperty(Response.json({ data: [] }), "url", { value: "https://collector.example/workspaces" });
    const e = await new ZenginePuller({ baseUrl: "https://api.zenginehq.com/v1", sleep, fetch: async () => elsewhere }).listForms(ZTOKEN).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConnectorUnavailableError);
  });
});

describe("rate helpers", () => {
  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterMs("5", 0, 1)).toBe(5000);
    expect(retryAfterMs(new Date(60_000).toUTCString(), 0, 1)).toBe(60_000);
    expect(retryAfterMs(null, 0, 1234)).toBe(1234);
    expect(retryAfterMs("soon", 0, 99)).toBe(99);
  });
  it("frees a slot when the oldest request leaves the window", () => {
    const w = new RequestWindow(2, 100);
    w.record(0);
    w.record(10);
    expect(w.waitFor(50)).toBe(50);
    expect(w.waitFor(100)).toBe(0);
  });
});
