// SPDX-License-Identifier: AGPL-3.0-only
// Import pullers: a funder's records read straight from the grants system it is leaving, through
// that system's API, with the funder's own credentials. Read-only: every request is a GET, except
// the one OAuth token request; nothing is ever written to the source. Every request names the
// fields it reads, and none of them is a bank or identity field. What comes back is rows of text
// for the import framework (@gms/importers), which screens sensitive columns first, as for a file.
//
//   Fluxx    REST API v2 on the funder's own instance (https://<name>.fluxx.io). An OAuth client the
//            funder creates at /oauth/applications; client credentials at /oauth/token. Grant
//            requests, the payments on them (request_transaction) and the organizations they went
//            to, joined into one row per grant request.
//   Zengine  REST API v1 (https://api.zenginehq.com/v1) with an OAuth access token the funder gets
//            from Zengine; 250 requests per 5 minutes per token, kept here with a sliding window.
//            The records of one form, with the form's field labels as columns.
//
// A pull reads at most 5,000 rows and says where the next one starts (`nextPage`), so a larger
// source is imported over several runs; a row imported before is skipped by its key.
// Request shapes: docs/importers.md lists the pages they come from and what is not verified.
import { ConnectorAuthError, ConnectorUnavailableError } from "./index.ts";
import { SourceReadError } from "./tabular.ts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PullerProvider = "fluxx" | "zengine";
export const PULLER_PROVIDERS: readonly PullerProvider[] = ["fluxx", "zengine"];

/** At most this many rows in one pull (the import framework's limit for one run). */
export const MAX_PULL_ROWS = 5000;
/** The longest a pull waits for a rate limit to clear before it stops and says when to try again. */
export const MAX_RATE_WAIT_MS = 20_000;
/** Server errors (502, 503, 504) are retried this many times. */
const RETRIES = 2;

/** The source asked the GMS to slow down for longer than a pull waits. Nothing was imported. */
export class ConnectorRateLimitedError extends Error {
  constructor(
    readonly provider: PullerProvider,
    readonly retryAfterSeconds: number,
  ) {
    super(`${provider} asked to wait ${retryAfterSeconds} seconds`);
    this.name = "ConnectorRateLimitedError";
  }
}

export interface PulledRecord {
  /** The source's own id for the row. */
  id: string;
  fields: Record<string, string>;
}

export interface PullResult {
  /** The column names, in order. */
  columns: string[];
  records: PulledRecord[];
  /** Where the next pull starts, or null when the source was read to its end. */
  nextPage: number | null;
  /** How many records the source holds in all, when it says. */
  total: number | null;
  /** Requests made (for the rate limit and the Worker's subrequest budget). */
  requests: number;
}

export interface PullerDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Longest wait for a rate limit (ms). */
  maxWaitMs?: number;
}

/** At most `limit` requests in any `windowMs`: the time to wait before the next one may go. */
export class RequestWindow {
  private readonly sent: number[] = [];
  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}
  waitFor(now: number): number {
    while (this.sent.length && this.sent[0]! <= now - this.windowMs) this.sent.shift();
    return this.sent.length < this.limit ? 0 : this.sent[0]! + this.windowMs - now;
  }
  record(now: number) {
    this.sent.push(now);
  }
}

/** Retry-After as seconds or an HTTP date; a missing or odd value reads as `fallback`. */
export function retryAfterMs(value: string | null, now: number, fallback: number): number {
  if (!value) return fallback;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? fallback : Math.max(0, at - now);
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "label", "title", "value"]) if (typeof o[k] === "string" || typeof o[k] === "number") return String(o[k]).trim();
  }
  return "";
};
/** A timestamp's date (YYYY-MM-DD), as the import reads dates. */
const day = (v: unknown): string => {
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
};

const PROVIDER_NAME = { fluxx: "Fluxx", zengine: "Zengine" } as const satisfies Record<PullerProvider, string>;
const sameHost = (a: string, b: string): boolean => {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
};

/** The HTTP side both pullers share: rate window, 429 backoff, retries on server errors, error mapping, no redirects. */
class Http {
  requests = 0;
  constructor(
    private readonly provider: PullerProvider,
    private readonly deps: Required<Pick<PullerDeps, "fetch" | "sleep" | "now" | "maxWaitMs">>,
    private readonly window: RequestWindow | null,
  ) {}

  async send(url: string, init: RequestInit): Promise<Response> {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      if (this.window) {
        const wait = this.window.waitFor(this.deps.now());
        if (wait > 0) {
          if (waited + wait > this.deps.maxWaitMs) throw new ConnectorRateLimitedError(this.provider, Math.ceil(wait / 1000));
          await this.deps.sleep(wait);
          waited += wait;
        }
        this.window.record(this.deps.now());
      }
      this.requests++;
      let res: Response;
      try {
        // Never followed: the credentials and the records stay on the host that was checked
        // (a Fluxx instance on FLUXX_HOST_SUFFIXES, or Zengine's own API).
        res = await this.deps.fetch(url, { ...init, redirect: "manual" });
      } catch {
        throw new ConnectorUnavailableError(this.provider);
      }
      if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect" || (res.url && !sameHost(res.url, url))) throw new ConnectorUnavailableError(this.provider, `${PROVIDER_NAME[this.provider]} tried to send the request to another address, so it was not followed`);
      if (res.status === 429) {
        const wait = retryAfterMs(res.headers.get("retry-after"), this.deps.now(), 2 ** attempt * 1000);
        if (waited + wait > this.deps.maxWaitMs) throw new ConnectorRateLimitedError(this.provider, Math.max(1, Math.ceil(wait / 1000)));
        await this.deps.sleep(wait);
        waited += wait;
        continue;
      }
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < RETRIES) {
        await this.deps.sleep(2 ** attempt * 500);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.provider);
      if (res.status === 404) throw new SourceReadError(`${this.provider === "fluxx" ? "Fluxx" : "Zengine"} has no such record list. Check what you chose`);
      if (!res.ok) throw new ConnectorUnavailableError(this.provider, `${this.provider} answered ${res.status}`);
      return res;
    }
  }

  async json(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await this.send(url, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") throw new ConnectorUnavailableError(this.provider, `${this.provider} sent an unreadable answer`);
    return body as Record<string, unknown>;
  }
}

const withDefaults = (deps: PullerDeps) => ({
  fetch: deps.fetch ?? ((i: string, init?: RequestInit) => fetch(i, init)),
  sleep: deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  now: deps.now ?? (() => Date.now()),
  maxWaitMs: deps.maxWaitMs ?? MAX_RATE_WAIT_MS,
});

const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : []);

// ------------------------------------------------------------------------------------ Fluxx

/** The hosts a Fluxx instance may be on. Only these are ever called (one constant to widen). */
export const FLUXX_HOST_SUFFIXES = [".fluxx.io", ".fluxxlabs.com"] as const;
export const FLUXX_PAGE_SIZE = 100;
/** Ids per lookup of organizations or payments. */
const FLUXX_IDS_PER_LOOKUP = 50;

export interface FluxxCredentials {
  /** The instance's address, as the funder pastes it (https://acme.fluxx.io). */
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
}

/** The instance's base URL, or null when the address is not a Fluxx instance over HTTPS. */
export function fluxxBaseUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || u.port || !/^[a-z0-9.-]+$/.test(host)) return null;
  if (!FLUXX_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length)) return null;
  return `https://${host}`;
}

/** The grant request fields read, and nothing else. */
export const FLUXX_GRANT_COLS = ["id", "base_request_id", "project_title", "amount_requested", "amount_recommended", "granted", "state", "grant_approved_at", "grant_begins_at", "grant_ends_at", "grant_closed_at", "program_organization_id"] as const;
export const FLUXX_PAYMENT_COLS = ["id", "request_id", "amount_paid", "paid_at", "has_been_paid"] as const;
export const FLUXX_ORG_COLS = ["id", "name"] as const;

/** One row per grant request, with these columns (the Fluxx adapter's preset names them). */
export const FLUXX_COLUMNS = ["Fluxx ID", "Request ID", "Organization", "Project title", "Amount requested", "Amount awarded", "Granted", "Status", "Approved on", "Grant begins", "Grant ends", "Closed on", "Amount paid", "Last paid on"] as const;

const orFilter = (field: string, ids: readonly (string | number)[]) => JSON.stringify({ group_type: "or", conditions: ids.map((id) => [field, "eq", id]) });

export class FluxxPuller {
  private readonly deps: ReturnType<typeof withDefaults>;
  constructor(
    deps: PullerDeps = {},
    /** Where an instance address points; tests point it at a fake instance. */
    private readonly resolveBase: (instanceUrl: string) => string | null = fluxxBaseUrl,
  ) {
    this.deps = withDefaults(deps);
  }

  private base(c: FluxxCredentials): string {
    const b = this.resolveBase(c.instanceUrl);
    if (!b) throw new SourceReadError("Paste your Fluxx address. It looks like https://yourfoundation.fluxx.io");
    return b;
  }

  private async token(http: Http, base: string, c: FluxxCredentials): Promise<string> {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret });
    let res: Record<string, unknown>;
    try {
      res = await http.json(`${base}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    } catch (e) {
      // A bad client id or secret is a 400 or 401 from the token endpoint.
      if (e instanceof ConnectorUnavailableError && /answered 400/.test(e.message)) throw new ConnectorAuthError("fluxx");
      throw e;
    }
    if (typeof res.access_token !== "string" || !res.access_token) throw new ConnectorAuthError("fluxx");
    return res.access_token;
  }

  private async list(http: Http, base: string, token: string, model: string, cols: readonly string[], page: number, filter?: string) {
    const q = new URLSearchParams({ cols: JSON.stringify(cols), page: String(page), per_page: String(FLUXX_PAGE_SIZE), ...(filter ? { filter } : {}) });
    const body = await http.json(`${base}/api/rest/v2/${model}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const records = body.records && typeof body.records === "object" ? Object.values(body.records as Record<string, unknown>).find(Array.isArray) : undefined;
    const rows = objects(records);
    const totalPages = typeof body.total_pages === "number" ? body.total_pages : null;
    const more = totalPages !== null ? page < totalPages : rows.length === FLUXX_PAGE_SIZE;
    return { rows, more, total: typeof body.total_entries === "number" ? body.total_entries : null };
  }

  /** Check the credentials with one token request and one one-row read. Nothing is kept. */
  async verify(c: FluxxCredentials): Promise<void> {
    const http = new Http("fluxx", this.deps, null);
    const base = this.base(c);
    const token = await this.token(http, base, c);
    await this.list(http, base, token, "grant_request", ["id"], 1);
  }

  /**
   * Grant requests from `startPage`, with each granted request's organization name and what was
   * paid on it, one row per request. At most `maxRows` rows.
   */
  async pullGrantHistory(c: FluxxCredentials, opts: { startPage?: number; maxRows?: number } = {}): Promise<PullResult> {
    const http = new Http("fluxx", this.deps, null);
    const base = this.base(c);
    const max = Math.min(opts.maxRows ?? MAX_PULL_ROWS, MAX_PULL_ROWS);
    const token = await this.token(http, base, c);
    const grants: Record<string, unknown>[] = [];
    let page = Math.max(1, Math.floor(opts.startPage ?? 1));
    let nextPage: number | null = null;
    let total: number | null = null;
    for (;;) {
      const r = await this.list(http, base, token, "grant_request", FLUXX_GRANT_COLS, page);
      total = r.total ?? total;
      grants.push(...r.rows);
      if (!r.more) break;
      page++;
      if (grants.length + FLUXX_PAGE_SIZE > max) {
        nextPage = page;
        break;
      }
    }
    const granted = grants.filter((g) => g.granted === true || g.granted === "true" || g.granted === 1);

    // Organization names for the granted requests, looked up by id in small batches.
    const orgIds = [...new Set(granted.map((g) => g.program_organization_id).filter((x): x is string | number => typeof x === "number" || (typeof x === "string" && x !== "")))];
    const orgName = new Map<string, string>();
    for (let i = 0; i < orgIds.length; i += FLUXX_IDS_PER_LOOKUP) {
      const ids = orgIds.slice(i, i + FLUXX_IDS_PER_LOOKUP);
      for (let p = 1; ; p++) {
        const r = await this.list(http, base, token, "organization", FLUXX_ORG_COLS, p, orFilter("id", ids));
        for (const o of r.rows) orgName.set(String(o.id), text(o.name));
        if (!r.more) break;
      }
    }

    // What was paid on each granted request.
    const paid = new Map<string, { minor: number; last: string }>();
    const requestIds = granted.map((g) => g.id).filter((x): x is string | number => typeof x === "number" || typeof x === "string");
    for (let i = 0; i < requestIds.length; i += FLUXX_IDS_PER_LOOKUP) {
      const ids = requestIds.slice(i, i + FLUXX_IDS_PER_LOOKUP);
      for (let p = 1; ; p++) {
        const r = await this.list(http, base, token, "request_transaction", FLUXX_PAYMENT_COLS, p, orFilter("request_id", ids));
        for (const t of r.rows) {
          const amount = typeof t.amount_paid === "number" ? t.amount_paid : Number(text(t.amount_paid));
          const on = day(t.paid_at);
          if (!(amount > 0) || (t.has_been_paid !== true && !on)) continue;
          const k = String(t.request_id);
          const cur = paid.get(k) ?? { minor: 0, last: "" };
          cur.minor += Math.round(amount * 100);
          if (on > cur.last) cur.last = on;
          paid.set(k, cur);
        }
        if (!r.more) break;
      }
    }

    const records = grants.map((g): PulledRecord => {
      const id = String(g.id ?? "");
      const p = paid.get(id);
      const values: string[] = [id, text(g.base_request_id), orgName.get(String(g.program_organization_id)) ?? "", text(g.project_title), text(g.amount_requested), text(g.amount_recommended), g.granted === true || g.granted === "true" || g.granted === 1 ? "Yes" : "No", text(g.state), day(g.grant_approved_at), day(g.grant_begins_at), day(g.grant_ends_at), day(g.grant_closed_at), p ? (p.minor / 100).toFixed(2) : "", p?.last ?? ""];
      return { id, fields: Object.fromEntries(FLUXX_COLUMNS.map((c, i) => [c, values[i]!])) };
    });
    return { columns: [...FLUXX_COLUMNS], records, nextPage, total, requests: http.requests };
  }
}

// ------------------------------------------------------------------------------------ Zengine

export const ZENGINE_API = "https://api.zenginehq.com/v1";
/** Zengine's limit: 250 requests per 5 minutes per access token. */
export const ZENGINE_RATE = { limit: 250, windowMs: 5 * 60 * 1000 } as const;
export const ZENGINE_PAGE_SIZE = 100;
/** Workspaces whose forms are listed. */
const ZENGINE_MAX_WORKSPACES = 20;
/** Field types never read: files and signatures are not grant history. */
const ZENGINE_SKIPPED_TYPES = /upload|file|signature|password|image/i;

export const ZENGINE_FIXED_COLUMNS = ["Zengine record ID", "Record name"] as const;

export interface ZengineForm {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
}

export class ZenginePuller {
  private readonly deps: ReturnType<typeof withDefaults>;
  /** One window per token, for this isolate. */
  private readonly windows = new Map<string, RequestWindow>();
  constructor(
    deps: PullerDeps & { baseUrl?: string; rate?: { limit: number; windowMs: number } } = {},
  ) {
    this.deps = withDefaults(deps);
    this.baseUrl = deps.baseUrl ?? ZENGINE_API;
    this.rate = deps.rate ?? ZENGINE_RATE;
  }
  private readonly baseUrl: string;
  private readonly rate: { limit: number; windowMs: number };

  private http(token: string): Http {
    let w = this.windows.get(token);
    if (!w) {
      w = new RequestWindow(this.rate.limit, this.rate.windowMs);
      this.windows.set(token, w);
    }
    return new Http("zengine", this.deps, w);
  }

  /** The token goes in the Authorization header, never the query string, so it is not in any log. */
  private get(http: Http, token: string, path: string, query: Record<string, string> = {}) {
    const q = new URLSearchParams(query);
    return http.json(`${this.baseUrl}${path}${q.toString() ? `?${q}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
  }

  async verify(token: string): Promise<void> {
    await this.get(this.http(token), token, "/workspaces", { limit: "1" });
  }

  /** The forms in the workspaces the token can open. */
  async listForms(token: string): Promise<ZengineForm[]> {
    const http = this.http(token);
    const workspaces = objects((await this.get(http, token, "/workspaces", { limit: String(ZENGINE_PAGE_SIZE) })).data).slice(0, ZENGINE_MAX_WORKSPACES);
    const out: ZengineForm[] = [];
    for (const w of workspaces) {
      const forms = objects((await this.get(http, token, "/forms", { "workspace.id": String(w.id), limit: String(ZENGINE_PAGE_SIZE), attributes: "id,name" })).data);
      for (const f of forms) out.push({ id: String(f.id), name: text(f.name) || `Form ${f.id}`, workspaceId: String(w.id), workspaceName: text(w.name) });
    }
    return out;
  }

  /** The records of one form from `startPage`, at most `maxRows`, with the form's field labels as columns. */
  async pullRecords(token: string, opts: { formId: string; startPage?: number; maxRows?: number }): Promise<PullResult> {
    if (!/^\d{1,12}$/.test(opts.formId)) throw new SourceReadError("Choose a Zengine form");
    const http = this.http(token);
    const max = Math.min(opts.maxRows ?? MAX_PULL_ROWS, MAX_PULL_ROWS);
    const fields = objects((await this.get(http, token, `/forms/${opts.formId}/fields`, { limit: String(ZENGINE_PAGE_SIZE) })).data).filter((f) => (typeof f.id === "number" || typeof f.id === "string") && !ZENGINE_SKIPPED_TYPES.test(text(f.type)));
    const seen = new Map<string, number>();
    const labelled = fields.map((f) => {
      const base = text(f.label) || `Field ${f.id}`;
      const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
      seen.set(base.toLowerCase(), n);
      return { attr: `field${f.id}`, label: n === 1 ? base : `${base} (${n})` };
    });
    const attributes = ["id", "name", ...labelled.map((f) => f.attr)].join(",");
    const records: PulledRecord[] = [];
    let page = Math.max(1, Math.floor(opts.startPage ?? 1));
    let nextPage: number | null = null;
    let total: number | null = null;
    for (;;) {
      const body = await this.get(http, token, `/forms/${opts.formId}/records`, { limit: String(ZENGINE_PAGE_SIZE), page: String(page), attributes });
      total = typeof body.totalCount === "number" ? body.totalCount : total;
      const rows = objects(body.data);
      for (const r of rows) records.push({ id: String(r.id ?? ""), fields: Object.fromEntries([["Zengine record ID", String(r.id ?? "")], ["Record name", text(r.name)], ...labelled.map((f) => [f.label, text(r[f.attr])])]) });
      const more = total !== null ? page * ZENGINE_PAGE_SIZE < total : rows.length === ZENGINE_PAGE_SIZE;
      if (!more || !rows.length) break;
      page++;
      if (records.length + ZENGINE_PAGE_SIZE > max) {
        nextPage = page;
        break;
      }
    }
    return { columns: [...ZENGINE_FIXED_COLUMNS, ...labelled.map((f) => f.label)], records, nextPage, total, requests: http.requests };
  }
}
