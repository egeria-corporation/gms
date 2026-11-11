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

/** The email already has an account tied to a different Passport user: nobody is signed in. */
export class AccountMismatchError extends Error {
  constructor() {
    super("This email is linked to a different Passport user");
    this.name = "AccountMismatchError";
  }
}

/**
 * Accounts, for Sign in with Passport. The caller has already verified the person's email with
 * Passport's ID token; this port never checks who is asking.
 */
export interface IdentityPort {
  /** The account with this email, without creating one. */
  findByEmail(email: string): Promise<string | null>;
  /**
   * Find or create the account for a verified email. An existing account is adopted only if its
   * own email was proven: one that was never confirmed (anyone can start a sign-up for any address)
   * is deleted and made afresh. The Passport user id is recorded on first use and is then fixed:
   * a different Passport user presenting the same email throws {@link AccountMismatchError}.
   */
  ensureUser(email: string, link: { passportUserId: string; name?: string | null }): Promise<{ userId: string; created: boolean }>;
  signInToken(email: string): Promise<SignInToken>;
}

/** The parts of the Supabase service-role client the identity port uses. */
export interface SupabaseIdentityLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  auth: {
    admin: {
      createUser(attrs: { email: string; email_confirm: boolean; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }): Promise<{ data: { user: { id: string } | null }; error: { message: string; code?: string; status?: number } | null }>;
      updateUserById(id: string, attrs: { app_metadata?: Record<string, unknown> }): Promise<{ error: { message: string } | null }>;
      deleteUser(id: string): Promise<{ error: { message: string } | null }>;
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

  /** The account for an email with what `ensureUser` decides on; null when there is none. */
  private async account(email: string): Promise<{ id: string; confirmed: boolean; passportUserId: string | null } | null> {
    const { data, error } = await this.client.rpc("gms_account_by_email", { p_email: email });
    if (error) throw new Error(`Looking up the account failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { id?: unknown; email_confirmed?: unknown; passport_user_id?: unknown } | null | undefined;
    if (!row || typeof row.id !== "string" || !row.id) return null;
    return { id: row.id, confirmed: row.email_confirmed === true, passportUserId: typeof row.passport_user_id === "string" && row.passport_user_id ? row.passport_user_id : null };
  }

  async ensureUser(email: string, link: { passportUserId: string; name?: string | null }): Promise<{ userId: string; created: boolean }> {
    const existing = await this.account(email);
    if (existing?.confirmed) {
      if (existing.passportUserId && existing.passportUserId !== link.passportUserId) throw new AccountMismatchError();
      if (!existing.passportUserId) {
        // First Passport sign-in for an account whose email was already proven here. The id goes
        // in app metadata (server-controlled; it merges with what is there) and is never replaced.
        const { error } = await this.client.auth.admin.updateUserById(existing.id, { app_metadata: { passport_user_id: link.passportUserId } });
        if (error) throw new Error(`Linking the account failed: ${error.message}`);
      }
      return { userId: existing.id, created: false };
    }
    if (existing) {
      // Never confirmed: whoever started it did not prove the address, and it could not have been
      // signed in to, so it holds nothing of the owner's. Confirming it in place would hand its
      // creator whatever they set on it; it is removed and the owner gets a fresh account.
      const { error } = await this.client.auth.admin.deleteUser(existing.id);
      if (error) throw new Error(`Replacing the unconfirmed account failed: ${error.message}`);
    }
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { passport_user_id: link.passportUserId },
      ...(link.name ? { user_metadata: { full_name: link.name } } : {}),
    });
    if (data.user) return { userId: data.user.id, created: true };
    // Two sign-ins for a new person at once: the other one created the account.
    const raced = await this.account(email);
    if (raced?.confirmed && (!raced.passportUserId || raced.passportUserId === link.passportUserId)) return { userId: raced.id, created: false };
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
  /** email (lower case) → account. `confirmed: false` is a sign-up nobody proved. */
  readonly users = new Map<string, { userId: string; passportUserId: string | null; confirmed?: boolean }>();
  readonly issued: { email: string; tokenHash: string }[] = [];
  /** Accounts removed because they were never confirmed. */
  readonly deleted: string[] = [];
  async findByEmail(email: string): Promise<string | null> {
    return this.users.get(email.trim().toLowerCase())?.userId ?? null;
  }
  async ensureUser(email: string, link: { passportUserId: string }): Promise<{ userId: string; created: boolean }> {
    const key = email.trim().toLowerCase();
    const existing = this.users.get(key);
    if (existing && existing.confirmed !== false) {
      if (existing.passportUserId && existing.passportUserId !== link.passportUserId) throw new AccountMismatchError();
      existing.passportUserId = link.passportUserId;
      return { userId: existing.userId, created: false };
    }
    if (existing) this.deleted.push(existing.userId);
    const userId = crypto.randomUUID();
    this.users.set(key, { userId, passportUserId: link.passportUserId, confirmed: true });
    return { userId, created: true };
  }
  async signInToken(email: string): Promise<SignInToken> {
    const tokenHash = `th_${crypto.randomUUID().replace(/-/g, "")}`;
    this.issued.push({ email: email.trim().toLowerCase(), tokenHash });
    return { tokenHash, type: "magiclink" };
  }
}

// ------------------------------------------------------------------------------------ Passport's second step

/** What the API remembers when Passport says a sign-in passed its authenticator. */
export interface SecondStepRecord {
  userId: string;
  /** SHA-256 (hex) of the one-time sign-in token handed to the web app. The token itself is never stored. */
  tokenDigest: string;
  acr: string;
  /** When the person passed Passport's authenticator. */
  authTime: Date;
  /** The session must claim the record before this. */
  claimBy: Date;
  /** The trust ends here, whatever the session does. */
  validUntil: Date;
}

/**
 * Passport's authenticator, accepted as this app's second step for one session (owner's decision,
 * 2026-11-11). A record is made when a Passport sign-in arrives with `acr: aal2`; the session that
 * redeems that sign-in's one-time token claims it; from then until `validUntil` that session counts
 * as two-step verified. A record gives no access by itself and cannot be claimed without the token.
 */
export interface SecondStepPort {
  record(row: SecondStepRecord): Promise<void>;
  /** Bind the unclaimed, unexpired record for this person and token to `sessionId`. Null when there is none. */
  claim(userId: string, tokenDigest: string, sessionId: string, now: Date): Promise<{ validUntil: Date } | null>;
  /** Whether `sessionId` holds a claimed record that has not run out. */
  verified(userId: string, sessionId: string, now: Date): Promise<boolean>;
}

/** Through three service-role-only database functions (migration 0018). */
export class SupabaseSecondSteps implements SecondStepPort {
  constructor(private readonly client: SupabaseRpcLike) {}
  async record(row: SecondStepRecord): Promise<void> {
    const { error } = await this.client.rpc("gms_passport_second_step_record", {
      p_user: row.userId,
      p_digest: row.tokenDigest,
      p_acr: row.acr,
      p_auth_time: row.authTime.toISOString(),
      p_claim_by: row.claimBy.toISOString(),
      p_valid_until: row.validUntil.toISOString(),
    });
    if (error) throw new Error(`Recording Passport's second step failed: ${error.message}`);
  }
  async claim(userId: string, tokenDigest: string, sessionId: string, _now: Date): Promise<{ validUntil: Date } | null> {
    // The database's clock decides: the function compares against now() in the same statement that claims.
    const { data, error } = await this.client.rpc("gms_passport_second_step_claim", { p_user: userId, p_digest: tokenDigest, p_session: sessionId });
    if (error) throw new Error(`Claiming Passport's second step failed: ${error.message}`);
    return typeof data === "string" && data ? { validUntil: new Date(data) } : null;
  }
  async verified(userId: string, sessionId: string, _now: Date): Promise<boolean> {
    const { data, error } = await this.client.rpc("gms_passport_second_step_ok", { p_user: userId, p_session: sessionId });
    if (error) throw new Error(`Reading Passport's second step failed: ${error.message}`);
    return data === true;
  }
}

export class MemorySecondSteps implements SecondStepPort {
  readonly rows: (SecondStepRecord & { sessionId: string | null })[] = [];
  async record(row: SecondStepRecord): Promise<void> {
    this.rows.push({ ...row, sessionId: null });
  }
  async claim(userId: string, tokenDigest: string, sessionId: string, now: Date): Promise<{ validUntil: Date } | null> {
    // One record per session, as the database's unique index has it.
    if (this.rows.some((r) => r.sessionId === sessionId)) return null;
    const row = this.rows.find((r) => r.userId === userId && r.tokenDigest === tokenDigest && r.sessionId === null && r.claimBy > now && r.validUntil > now);
    if (!row) return null;
    row.sessionId = sessionId;
    return { validUntil: row.validUntil };
  }
  async verified(userId: string, sessionId: string, now: Date): Promise<boolean> {
    return this.rows.some((r) => r.userId === userId && r.sessionId === sessionId && r.validUntil > now);
  }
}
