// SPDX-License-Identifier: AGPL-3.0-only
// Google Search Console for the operators' measures (docs/measures.md), through Composio, read only.
//
//   COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID   google_search_console   webmasters.readonly
//
// One connection for the GMS's operators, not for a workspace: it reads how the GMS's own public
// pages do in Google Search. It lives on one Composio entity, SEARCH_CONSOLE_ENTITY, which can never
// be a workspace id (those are UUIDs), so no workspace's connections are ever touched. It is kept
// out of the workspace connected apps (./apps.ts) so the Settings › Connected apps screen never
// offers it.
//
// Composio holds the Google token; the GMS stores none. The connection's scopes are read from
// Composio and checked before every use: anything beyond webmasters.readonly (and sign-in identity)
// is deleted at Composio and refused; a connection that reports no scopes is not used.
//
// Only two predefined tools are ever executed (SEARCH_CONSOLE_TOOLS), with the arguments written
// below. Slugs and argument names were checked with Composio's tool search and schemas on
// 2026-11-17 (no tool was executed). Nothing here has run against Composio or Google.
import { ComposioClient, ComposioError, ConnectorScopeError, ConnectorScopeUnverifiedError, normalizeScopes, type ConnectedAccount } from "./composio.ts";
import { ConnectorAuthError, ConnectorUnavailableError } from "./index.ts";
import { dig, SourceReadError } from "./tabular.ts";

/** The Composio entity of the operators' one connection. Not a UUID, so never a workspace's. */
export const SEARCH_CONSOLE_ENTITY = "gms-operators";
export const WEBMASTERS_READONLY = "https://www.googleapis.com/auth/webmasters.readonly";

/** The tools this connector may execute. Nothing else is ever sent to Composio's tool endpoint. */
export const SEARCH_CONSOLE_TOOLS = {
  listSites: "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
  query: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
} as const;

const IDENTITY = ["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"];

/**
 * The narrowest reading: Search Console's read-only scope and sign-in identity, nothing else. The
 * full `webmasters` scope (which can add and remove properties and sitemaps) is refused even if the
 * allow-list were edited by mistake. Relax here, and nowhere else.
 */
export const SEARCH_CONSOLE_SCOPE_RULES = {
  label: "Google Search Console",
  allowed: new Set<string>([WEBMASTERS_READONLY, ...IDENTITY]),
  forbidden: [/\/auth\/webmasters$/, /\/auth\/siteverification/, /\/auth\/indexing/, /\/auth\/drive/, /\/auth\/gmail/, /\/auth\/analytics(\.|$)/] as readonly RegExp[],
  required: [WEBMASTERS_READONLY] as readonly string[],
};

export function checkSearchConsoleScopes(scopes: unknown): { ok: boolean; excess: string[]; missing: string[] } {
  const r = SEARCH_CONSOLE_SCOPE_RULES;
  const list = normalizeScopes(scopes);
  const excess = list.filter((s) => !r.allowed.has(s) || r.forbidden.some((re) => re.test(s)));
  return { ok: excess.length === 0, excess, missing: r.required.filter((s) => !list.includes(s)) };
}

// ------------------------------------------------------------------------------------- shapes

export interface SearchConsoleSite {
  /** `sc-domain:example.org` (a domain property) or `https://www.example.org/` (a URL-prefix property). */
  siteUrl: string;
  permissionLevel: string;
}

export interface SearchAnalyticsRow {
  /** The dimension values, in the order asked (a page URL for `page`). */
  keys: string[];
  clicks: number;
  impressions: number;
}

export interface SearchAnalyticsQuery {
  siteUrl: string;
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  endDate: string;
  /** No dimension gives one row of totals. */
  dimensions: readonly ("page" | "date")[];
  /** Pages kept (Search Console's `includingRegex` on the page): the GMS's own host only. */
  pageRegex: string;
  rowLimit: number;
}

/** What a property string may look like before it is sent anywhere. */
export const SITE_URL = /^(sc-domain:[a-z0-9.-]{1,253}|https?:\/\/[a-z0-9.-]{1,253}(:[0-9]{1,5})?\/[^\s]{0,200})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_ROWS = 5000;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : 0);

/** The properties in GOOGLE_SEARCH_CONSOLE_LIST_SITES's answer (`siteEntry[]`). */
export function sitesOf(data: unknown): SearchConsoleSite[] {
  const list = dig(data, "siteEntry");
  if (!Array.isArray(list)) return [];
  return list.map(rec).flatMap((s) => {
    const siteUrl = str(s.siteUrl);
    return siteUrl && SITE_URL.test(siteUrl) ? [{ siteUrl, permissionLevel: str(s.permissionLevel) ?? "unknown" }] : [];
  });
}

/** The rows of a search analytics answer (`rows[]`, each with keys, clicks and impressions). */
export function analyticsRowsOf(data: unknown): SearchAnalyticsRow[] {
  const rows = dig(data, "rows");
  if (!Array.isArray(rows)) return [];
  return rows.map(rec).map((r) => ({ keys: Array.isArray(r.keys) ? r.keys.filter((k): k is string => typeof k === "string") : [], clicks: num(r.clicks), impressions: num(r.impressions) }));
}

/** The arguments of GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY, after the checks. */
export function searchAnalyticsArgs(q: SearchAnalyticsQuery): Record<string, unknown> {
  if (!SITE_URL.test(q.siteUrl)) throw new SourceReadError("That is not a Search Console property");
  if (!DAY.test(q.startDate) || !DAY.test(q.endDate) || q.startDate > q.endDate) throw new SourceReadError("The dates of the Search Console report are not valid");
  if (!q.pageRegex || q.pageRegex.length > 300) throw new SourceReadError("The Search Console report must be limited to the GMS's own pages");
  return {
    site_url: q.siteUrl,
    start_date: q.startDate,
    end_date: q.endDate,
    dimensions: [...q.dimensions],
    search_type: "web",
    data_state: "final",
    row_limit: Math.max(1, Math.min(MAX_ROWS, Math.floor(q.rowLimit))),
    dimension_filter_groups: [{ filters: [{ dimension: "page", operator: "includingRegex", expression: q.pageRegex }] }],
  };
}

// ------------------------------------------------------------------------------------- port

export interface SearchConsole {
  readonly provider: "google_search_console";
  /** Whether the operators' connection is there and within the scopes; with `link`, a Composio-hosted Google sign-in when it is not. */
  status(opts?: { link?: boolean; returnTo?: string }): Promise<{ connected: boolean; connectUrl: string | null }>;
  /** Remove the operators' connection at Composio. */
  disconnect(): Promise<void>;
  /** The properties the connected Google account can read. */
  listSites(): Promise<SearchConsoleSite[]>;
  /** Clicks and impressions, from Search Console's search analytics. Read only. */
  query(q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]>;
}

export interface SearchConsoleConfig {
  client: ComposioClient;
  /** The auth config created for google_search_console with exactly webmasters.readonly. */
  authConfigId: string;
  /** The web page Composio returns the browser to after the Google sign-in. */
  callbackUrl: (returnTo?: string) => string;
}

export class ComposioSearchConsole implements SearchConsole {
  readonly provider = "google_search_console" as const;
  constructor(private readonly cfg: SearchConsoleConfig) {
    if (!cfg.authConfigId) throw new Error("The Composio auth config id is not set");
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ComposioError) {
        if (e.status === 401 || e.status === 403 || e.status === 422) throw new ConnectorAuthError("composio");
        throw new ConnectorUnavailableError("composio", "Composio could not be reached");
      }
      throw e;
    }
  }

  /** The account after the checks: this auth config, this entity, active, within the scopes. Null when not usable yet. */
  private async checked(account: ConnectedAccount): Promise<ConnectedAccount | null> {
    if (account.status !== "ACTIVE" || account.authConfigId !== this.cfg.authConfigId) return null;
    if (account.userId !== null && account.userId !== SEARCH_CONSOLE_ENTITY) return null;
    const label = SEARCH_CONSOLE_SCOPE_RULES.label;
    if (!account.grantedScopes.length && !account.requestedScopes.length) throw new ConnectorScopeUnverifiedError(`The permissions of the ${label} connection could not be read, so it is not being used. Disconnect and connect again.`);
    const scopes = checkSearchConsoleScopes([...account.grantedScopes, ...account.requestedScopes]);
    if (!scopes.ok) {
      await this.cfg.client.deleteConnectedAccount(account.id);
      throw new ConnectorScopeError(scopes.excess, `The ${label} connection was given more access than the GMS allows, so it was removed. Connect again and keep read-only access.`);
    }
    if (scopes.missing.length) throw new ConnectorScopeUnverifiedError(`The ${label} connection does not include read-only access to Search Console. Disconnect and connect again, and keep the permissions asked for.`);
    return account;
  }

  private async active(): Promise<ConnectedAccount | null> {
    const listed = await this.cfg.client.listConnectedAccounts({ authConfigId: this.cfg.authConfigId, userId: SEARCH_CONSOLE_ENTITY });
    const candidate = listed.find((a) => a.status === "ACTIVE");
    if (!candidate) return null;
    return this.checked(await this.cfg.client.getConnectedAccount(candidate.id));
  }

  async status(opts: { link?: boolean; returnTo?: string } = {}): Promise<{ connected: boolean; connectUrl: string | null }> {
    return this.wrap(async () => {
      if (await this.active()) return { connected: true, connectUrl: null };
      if (!opts.link) return { connected: false, connectUrl: null };
      const link = await this.cfg.client.createConnectLink({ authConfigId: this.cfg.authConfigId, userId: SEARCH_CONSOLE_ENTITY, callbackUrl: this.cfg.callbackUrl(opts.returnTo) });
      return { connected: false, connectUrl: link.redirectUrl };
    });
  }

  async disconnect(): Promise<void> {
    await this.wrap(async () => {
      for (const a of await this.cfg.client.listConnectedAccounts({ authConfigId: this.cfg.authConfigId, userId: SEARCH_CONSOLE_ENTITY })) await this.cfg.client.deleteConnectedAccount(a.id);
    });
  }

  private async run(slug: (typeof SEARCH_CONSOLE_TOOLS)[keyof typeof SEARCH_CONSOLE_TOOLS], args: Record<string, unknown>, failed: string): Promise<unknown> {
    return this.wrap(async () => {
      const account = await this.active();
      if (!account) throw new ConnectorAuthError("composio");
      const r = await this.cfg.client.executeTool(slug, { connectedAccountId: account.id, userId: SEARCH_CONSOLE_ENTITY, arguments: args });
      // Google's own error text is not passed on: one plain sentence instead.
      if (!r.successful) throw new SourceReadError(failed);
      return r.data;
    });
  }

  async listSites(): Promise<SearchConsoleSite[]> {
    return sitesOf(await this.run(SEARCH_CONSOLE_TOOLS.listSites, {}, "Search Console did not list the properties. Try again in a few minutes"));
  }

  async query(q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]> {
    const args = searchAnalyticsArgs(q);
    return analyticsRowsOf(await this.run(SEARCH_CONSOLE_TOOLS.query, args, "Search Console did not answer. Try again in a few minutes"));
  }
}

/** Tests and mock mode: the same port with fixed data. */
export class FixtureSearchConsole implements SearchConsole {
  readonly provider = "google_search_console" as const;
  connected = true;
  readonly queries: SearchAnalyticsQuery[] = [];
  constructor(
    public sites: SearchConsoleSite[] = [
      { siteUrl: "sc-domain:opengrants.io", permissionLevel: "siteOwner" },
      { siteUrl: "https://gms.opengrants.io/", permissionLevel: "siteFullUser" },
      { siteUrl: "https://www.example.org/", permissionLevel: "siteOwner" },
    ],
    /** The rows for a query, by what was asked. */
    public answer: (q: SearchAnalyticsQuery) => SearchAnalyticsRow[] = () => [],
  ) {}
  async status(opts: { link?: boolean; returnTo?: string } = {}) {
    if (this.connected) return { connected: true, connectUrl: null };
    return { connected: false, connectUrl: opts.link ? `https://composio.invalid/connect/google_search_console?entity=${SEARCH_CONSOLE_ENTITY}` : null };
  }
  async disconnect() {
    this.connected = false;
  }
  async listSites() {
    if (!this.connected) throw new ConnectorAuthError("composio");
    return [...this.sites];
  }
  async query(q: SearchAnalyticsQuery) {
    if (!this.connected) throw new ConnectorAuthError("composio");
    searchAnalyticsArgs(q);
    this.queries.push(q);
    return this.answer(q);
  }
}

// ------------------------------------------------------------------------------------- wiring

/** The Worker settings Search Console reads (names only; values are Wrangler secrets). */
export interface SearchConsoleEnv {
  COMPOSIO_API_KEY?: string;
  COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID?: string;
}

/** Search Console, only when the Composio key and its own auth config are set; absent (and hidden) otherwise. */
export function searchConsolePort(env: SearchConsoleEnv, callback: (returnTo: string | undefined) => string, client?: ComposioClient): { searchConsole?: SearchConsole } {
  if (!env.COMPOSIO_API_KEY || !env.COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID) return {};
  return { searchConsole: new ComposioSearchConsole({ client: client ?? new ComposioClient({ apiKey: env.COMPOSIO_API_KEY }), authConfigId: env.COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID, callbackUrl: callback }) };
}
