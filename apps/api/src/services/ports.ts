// SPDX-License-Identifier: AGPL-3.0-only
// Ports for side effects outside the database: file bytes and OpenGrants discovery. Each has an
// in-memory implementation for tests and local development and a production implementation
// (R2 / the hosted OpenGrants MCP).

import type { AuthSession, SessionsPort } from "./sessions.ts";

// ---------------------------------------------------------------------------------- file storage

// File bytes: the port and its implementations live in `@gms/documents`.
export { MemoryFileStorage, R2FileStorage, SupabaseFileStorage, TieredFileStorage, sha256Hex, type FileStorage, type StoredFile } from "@gms/documents";

// ---------------------------------------------------------------------------------- OpenGrants

/** What the applicant's organization looks like to a search: never more than the cached projection. */
export interface OrgSearchContext {
  orgType?: string;
  region?: string;
  mission?: string;
  revenueBand?: string;
}

export interface OpenGrantsListing {
  id: string;
  title: string;
  funder?: string;
  url?: string;
  /** Where the listing came from; a GMS opportunity URL means it can be applied to here. */
  source?: string;
  deadline?: string;
  amount?: string;
  summary?: string;
  [key: string]: unknown;
}

export type OpenGrantsTool = "search" | "match" | "eligibility" | "alerts";

export interface OpenGrantsClient {
  call(tool: OpenGrantsTool, args: Record<string, unknown>, org: OrgSearchContext): Promise<{ items: OpenGrantsListing[]; raw?: unknown }>;
}

export class OpenGrantsUnavailableError extends Error {
  constructor(message = "OpenGrants could not be reached") {
    super(message);
    this.name = "OpenGrantsUnavailableError";
  }
}

/** Fixed answers for tests and for installs without an OpenGrants key. */
export class FixtureOpenGrantsClient implements OpenGrantsClient {
  readonly calls: { tool: OpenGrantsTool; args: Record<string, unknown>; org: OrgSearchContext }[] = [];
  constructor(private readonly listings: OpenGrantsListing[] = []) {}
  async call(tool: OpenGrantsTool, args: Record<string, unknown>, org: OrgSearchContext) {
    this.calls.push({ tool, args, org });
    const q = typeof args.query === "string" ? args.query.toLowerCase() : "";
    return { items: this.listings.filter((l) => !q || `${l.title} ${l.summary ?? ""}`.toLowerCase().includes(q)) };
  }
}

/** Tool names on the hosted OpenGrants MCP for each proxy route. */
const MCP_TOOL: Record<OpenGrantsTool, string> = { search: "search_grants", match: "match_grants", eligibility: "check_eligibility", alerts: "create_funding_alert" };

function listingsFrom(result: unknown): OpenGrantsListing[] {
  const r = result as { structuredContent?: unknown; content?: { type?: string; text?: string }[] } | null;
  let payload: unknown = r?.structuredContent;
  if (payload === undefined) {
    const text = r?.content?.find((c) => c.type === "text")?.text;
    try {
      payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      payload = null;
    }
  }
  const list = Array.isArray(payload) ? payload : ((payload as { items?: unknown; results?: unknown; grants?: unknown } | null)?.items ?? (payload as { results?: unknown } | null)?.results ?? (payload as { grants?: unknown } | null)?.grants);
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({ ...x, id: String(x.id ?? x.slug ?? x.url ?? ""), title: String(x.title ?? x.name ?? "Untitled") }))
    .filter((x) => x.id !== "");
}

/**
 * The hosted OpenGrants MCP over Streamable HTTP (stateless `tools/call`). The applicant's org
 * context travels as the `organization` argument; nothing else about the workspace is sent.
 */
export class McpOpenGrantsClient implements OpenGrantsClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string | null,
    private readonly doFetch: (input: string, init?: RequestInit) => Promise<Response> = (i, init) => fetch(i, init),
  ) {}

  async call(tool: OpenGrantsTool, args: Record<string, unknown>, org: OrgSearchContext) {
    let res: Response;
    try {
      res = await this.doFetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name: MCP_TOOL[tool], arguments: { ...args, organization: org } } }),
      });
    } catch {
      throw new OpenGrantsUnavailableError();
    }
    if (!res.ok) throw new OpenGrantsUnavailableError(`OpenGrants answered ${res.status}`);
    let text = await res.text();
    // A Streamable HTTP server may answer one JSON-RPC message as a single SSE event.
    if ((res.headers.get("Content-Type") ?? "").includes("text/event-stream")) text = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop() ?? "";
    let body: { result?: unknown; error?: { message?: string } };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new OpenGrantsUnavailableError("OpenGrants returned a body that is not JSON");
    }
    if (body.error) throw new OpenGrantsUnavailableError(body.error.message ?? "OpenGrants refused the request");
    return { items: listingsFrom(body.result), raw: body.result };
  }
}

// ---------------------------------------------------------------------------------- user directory

/** What the GMS shows about a member: the address they sign in with and the name on their account. */
export interface DirectoryUser {
  email: string | null;
  name: string | null;
}

/** Names and emails of people, from the auth provider. Used to label members; never for access decisions. */
export interface UserDirectory {
  lookup(userIds: readonly string[]): Promise<Map<string, DirectoryUser>>;
}

export class MemoryUserDirectory implements UserDirectory {
  readonly users = new Map<string, DirectoryUser>();
  async lookup(userIds: readonly string[]): Promise<Map<string, DirectoryUser>> {
    return new Map(userIds.filter((id) => this.users.has(id)).map((id) => [id, this.users.get(id)!]));
  }
}

/** The part of the Supabase admin API the directory uses (service-role client). */
export interface SupabaseAdminLike {
  auth: { admin: { getUserById(id: string): Promise<{ data: { user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null }; error: unknown }> } };
}

export class SupabaseUserDirectory implements UserDirectory {
  constructor(private readonly client: SupabaseAdminLike) {}
  async lookup(userIds: readonly string[]): Promise<Map<string, DirectoryUser>> {
    const out = new Map<string, DirectoryUser>();
    // A member list is a page of people, not a table scan: one admin read each, a miss is simply unlabeled.
    await Promise.all(
      [...new Set(userIds)].slice(0, 200).map(async (id) => {
        try {
          const { data } = await this.client.auth.admin.getUserById(id);
          const meta = data.user?.user_metadata ?? {};
          const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
          if (data.user) out.set(id, { email: data.user.email ?? null, name });
        } catch {
          // Unreachable auth: the list still loads, without labels.
        }
      }),
    );
    return out;
  }
}

/** The part of the Supabase client the sessions port uses: two service-role-only functions. */
export interface SupabaseRpcLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** A person's own Supabase Auth sessions, through `gms_sessions_of` / `gms_end_session_of`. */
export class SupabaseSessions implements SessionsPort {
  constructor(private readonly client: SupabaseRpcLike) {}
  async list(userId: string): Promise<AuthSession[]> {
    const { data, error } = await this.client.rpc("gms_sessions_of", { person: userId });
    if (error) throw new Error(`Reading sessions failed: ${error.message}`);
    return ((data as { id: string; created_at: string; last_active_at: string | null; user_agent: string | null; ip: string | null; aal: string | null }[] | null) ?? []).map((s) => ({ id: s.id, createdAt: s.created_at, lastActiveAt: s.last_active_at, userAgent: s.user_agent, ip: s.ip, aal: s.aal }));
  }
  async end(userId: string, sessionId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("gms_end_session_of", { person: userId, session_id: sessionId });
    if (error) throw new Error(`Ending the session failed: ${error.message}`);
    return data === true;
  }
}

export class MemorySessions implements SessionsPort {
  constructor(readonly rows: (AuthSession & { userId: string })[] = []) {}
  async list(userId: string): Promise<AuthSession[]> {
    return this.rows.filter((s) => s.userId === userId).map(({ userId: _u, ...s }) => s);
  }
  async end(userId: string, sessionId: string): Promise<boolean> {
    const i = this.rows.findIndex((s) => s.userId === userId && s.id === sessionId);
    if (i < 0) return false;
    this.rows.splice(i, 1);
    return true;
  }
}

// ------------------------------------------------------------------------------------ identity (Sign in with Passport)

/** A one-time sign-in the web app redeems for a session (`supabase.auth.verifyOtp({ token_hash, type })`). */
export interface SignInToken {
  tokenHash: string;
  type: string;
}

/**
 * Accounts, for Sign in with Passport. The caller has already verified the person's email with
 * Passport's ID token; this port never checks who is asking.
 */
export interface IdentityPort {
  /** The account with this email, without creating one. */
  findByEmail(email: string): Promise<string | null>;
  /** Find or create the account for a verified email, and record the Passport user id on it. */
  ensureUser(email: string, link: { passportUserId: string; name?: string | null }): Promise<{ userId: string; created: boolean }>;
  signInToken(email: string): Promise<SignInToken>;
}

/** The parts of the Supabase service-role client the identity port uses. */
export interface SupabaseIdentityLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  auth: {
    admin: {
      createUser(attrs: { email: string; email_confirm: boolean; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }): Promise<{ data: { user: { id: string } | null }; error: { message: string; code?: string; status?: number } | null }>;
      updateUserById(id: string, attrs: { app_metadata?: Record<string, unknown>; email_confirm?: boolean }): Promise<{ error: { message: string } | null }>;
      generateLink(params: { type: "magiclink"; email: string }): Promise<{ data: { properties?: { hashed_token?: string; verification_type?: string } | null }; error: { message: string } | null }>;
    };
  };
}

export class SupabaseIdentity implements IdentityPort {
  constructor(private readonly client: SupabaseIdentityLike) {}

  async findByEmail(email: string): Promise<string | null> {
    const { data, error } = await this.client.rpc("gms_user_id_by_email", { p_email: email });
    if (error) throw new Error(`Looking up the account failed: ${error.message}`);
    return typeof data === "string" && data ? data : null;
  }

  async ensureUser(email: string, link: { passportUserId: string; name?: string | null }): Promise<{ userId: string; created: boolean }> {
    const existing = await this.findByEmail(email);
    if (existing) {
      // Passport verified the address, so the account's email counts as confirmed; the Passport
      // user id is kept in app metadata (server-controlled), which merges with what is there.
      await this.client.auth.admin.updateUserById(existing, { app_metadata: { passport_user_id: link.passportUserId }, email_confirm: true });
      return { userId: existing, created: false };
    }
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { passport_user_id: link.passportUserId },
      ...(link.name ? { user_metadata: { full_name: link.name } } : {}),
    });
    if (data.user) return { userId: data.user.id, created: true };
    // Two sign-ins for a new person at once: the other one created the account.
    const raced = await this.findByEmail(email);
    if (raced) return { userId: raced, created: false };
    throw new Error(`Creating the account failed: ${error?.message ?? "no user returned"}`);
  }

  async signInToken(email: string): Promise<SignInToken> {
    const { data, error } = await this.client.auth.admin.generateLink({ type: "magiclink", email });
    const hash = data.properties?.hashed_token;
    if (error || !hash) throw new Error(`Creating the sign-in failed: ${error?.message ?? "no token returned"}`);
    return { tokenHash: hash, type: data.properties?.verification_type ?? "magiclink" };
  }
}

export class MemoryIdentity implements IdentityPort {
  /** email (lower case) → account. */
  readonly users = new Map<string, { userId: string; passportUserId: string | null }>();
  readonly issued: { email: string; tokenHash: string }[] = [];
  async findByEmail(email: string): Promise<string | null> {
    return this.users.get(email.trim().toLowerCase())?.userId ?? null;
  }
  async ensureUser(email: string, link: { passportUserId: string }): Promise<{ userId: string; created: boolean }> {
    const key = email.trim().toLowerCase();
    const existing = this.users.get(key);
    if (existing) {
      existing.passportUserId = link.passportUserId;
      return { userId: existing.userId, created: false };
    }
    const userId = crypto.randomUUID();
    this.users.set(key, { userId, passportUserId: link.passportUserId });
    return { userId, created: true };
  }
  async signInToken(email: string): Promise<SignInToken> {
    const tokenHash = `th_${crypto.randomUUID().replace(/-/g, "")}`;
    this.issued.push({ email: email.trim().toLowerCase(), tokenHash });
    return { tokenHash, type: "magiclink" };
  }
}
