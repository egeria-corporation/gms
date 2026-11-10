// SPDX-License-Identifier: AGPL-3.0-only
// The funder's Google Workspace through Composio (build spec §10.10).
//
// One Composio entity per funder workspace: the Composio `user_id` is the GMS workspace id.
// Composio holds the Google credential; the GMS never reads or stores it. The connection may hold
// exactly `drive.file` (files and folders the person chose in the Google Picker) and
// `admin.directory.user.readonly`, plus the OpenID identity scopes. Anything else is refused and
// the connection is deleted at Composio.
//
// A thin fetch client over the Composio REST API v3.1, the same five request shapes Passport's
// `packages/composio` uses in production. Each was checked against docs.composio.dev on
// 2026-11-10; docs/connectors.md lists the pages and what could not be verified.
import { ConnectorAuthError, ConnectorUnavailableError, type DirectoryPerson, type WorkspaceApps } from "./index.ts";

export const COMPOSIO_API_BASE = "https://backend.composio.dev";
/** Drive v3, the Admin SDK Directory API and Drive uploads are all served from this host, which keeps
 * every call inside the proxy's same-domain rule. */
export const GOOGLE_API = "https://www.googleapis.com";

export const GOOGLE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_DIRECTORY_USER_READONLY = "https://www.googleapis.com/auth/admin.directory.user.readonly";

/** Everything a Google connection may hold. Google reports the identity scopes in both spellings. */
const GOOGLE_ALLOWED_SCOPES: ReadonlySet<string> = new Set([
  GOOGLE_DRIVE_FILE,
  GOOGLE_DIRECTORY_USER_READONLY,
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);
/** Never allowed, even if the allow-list above were edited by mistake. */
const GOOGLE_FORBIDDEN = [/\/auth\/drive$/, /\/auth\/drive\.readonly$/, /\/auth\/drive\.metadata/, /\/auth\/drive\.appdata$/];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Scopes as providers and Composio report them: a space- or comma-separated string, an array, or nothing. */
export function normalizeScopes(input: unknown): string[] {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v !== "string") return;
    for (const s of v.split(/[\s,]+/)) if (s.trim()) parts.push(s.trim());
  };
  if (Array.isArray(input)) input.forEach(add);
  else add(input);
  return [...new Set(parts)];
}

export interface ScopeCheck {
  ok: boolean;
  /** Scopes outside the allow-list (empty when ok). */
  excess: string[];
  /** Whether each capability's scope is present. */
  drive: boolean;
  directory: boolean;
}

/** A Google connection passes only when every scope it holds is on the allow-list. */
export function checkGoogleScopes(scopes: unknown): ScopeCheck {
  const list = normalizeScopes(scopes);
  const excess = list.filter((s) => !GOOGLE_ALLOWED_SCOPES.has(s) || GOOGLE_FORBIDDEN.some((re) => re.test(s)));
  return { ok: excess.length === 0, excess, drive: list.includes(GOOGLE_DRIVE_FILE), directory: list.includes(GOOGLE_DIRECTORY_USER_READONLY) };
}

// ------------------------------------------------------------------------------------- client

export interface ConnectedAccount {
  id: string;
  status: string;
  authConfigId: string | null;
  /** Scopes the provider granted (`state.val.scope`) and the ones requested at initiation. */
  grantedScopes: string[];
  requestedScopes: string[];
}

export interface ConnectLink {
  connectedAccountId: string;
  redirectUrl: string;
  expiresAt: string | null;
}

export interface ProxyRequest {
  connectedAccountId: string;
  /** The Composio entity acting on the connection (the workspace id). */
  userId: string;
  /** Absolute URL on the provider's API host. */
  endpoint: string;
  method: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** A binary request body, sent base64-encoded with its own content type. */
  binary?: { base64: string; contentType: string };
}

export interface ProxyResponse {
  /** The provider's HTTP status. */
  status: number;
  data: unknown;
}

export interface ToolResult {
  successful: boolean;
  error: string | null;
  data: unknown;
}

export class ComposioError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly slug: string | null = null,
  ) {
    super(message);
    this.name = "ComposioError";
  }
}

export interface ComposioClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SLUG_RE = /^[A-Z0-9_]{1,128}$/;

/** Keeps ids, status and scopes only. Whatever else `state.val` carries (tokens) is dropped here. */
export function mapConnectedAccount(body: unknown): ConnectedAccount {
  const b = rec(body);
  const id = str(b.id);
  if (!id) throw new ComposioError("Composio returned a connected account without an id", 502);
  const val = rec(rec(b.state).val);
  return {
    id,
    status: str(b.status) ?? "INITIALIZING",
    authConfigId: str(rec(b.auth_config).id),
    grantedScopes: normalizeScopes(val.scope ?? val.scopes),
    requestedScopes: normalizeScopes(b.requested_scopes),
  };
}

export class ComposioClient {
  private readonly base: string;
  private readonly doFetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: ComposioClientConfig) {
    if (!cfg.apiKey) throw new Error("COMPOSIO_API_KEY is not set");
    this.base = (cfg.baseUrl ?? COMPOSIO_API_BASE).replace(/\/+$/, "");
    this.doFetch = cfg.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method,
        headers: { "x-api-key": this.cfg.apiKey, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ComposioError(`Composio request failed: ${(e as Error).name}`, 502);
    }
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      const err = rec(rec(parsed).error);
      // Composio's own message; it never echoes the API key.
      throw new ComposioError(str(err.message) ?? `Composio responded ${res.status}`, res.status, str(err.slug));
    }
    return parsed;
  }

  private id(id: string): string {
    if (!ID_RE.test(id)) throw new ComposioError("Invalid connected account id", 400);
    return encodeURIComponent(id);
  }

  /** `POST /api/v3.1/connected_accounts/link`: a hosted sign-in link for (auth config, entity). */
  async createConnectLink(input: { authConfigId: string; userId: string; callbackUrl: string }): Promise<ConnectLink> {
    const b = rec(await this.call("POST", "/api/v3.1/connected_accounts/link", { auth_config_id: input.authConfigId, user_id: input.userId, callback_url: input.callbackUrl }));
    const connectedAccountId = str(b.connected_account_id);
    const redirectUrl = str(b.redirect_url);
    if (!connectedAccountId || !redirectUrl) throw new ComposioError("Composio returned an incomplete connect link", 502);
    return { connectedAccountId, redirectUrl, expiresAt: str(b.expires_at) };
  }

  /** `GET /api/v3.1/connected_accounts`: the entity's accounts on one auth config, newest first. */
  async listConnectedAccounts(input: { authConfigId: string; userId: string }): Promise<{ id: string; status: string }[]> {
    const q = new URLSearchParams({ user_ids: input.userId, auth_config_ids: input.authConfigId, order_by: "created_at", order_direction: "desc", limit: "25" });
    const b = rec(await this.call("GET", `/api/v3.1/connected_accounts?${q}`));
    return arr(b.items)
      .map(rec)
      .flatMap((a) => (str(a.id) ? [{ id: str(a.id)!, status: str(a.status) ?? "INITIALIZING" }] : []));
  }

  /** `GET /api/v3.1/connected_accounts/{id}`: status and scopes. */
  async getConnectedAccount(id: string): Promise<ConnectedAccount> {
    return mapConnectedAccount(await this.call("GET", `/api/v3.1/connected_accounts/${this.id(id)}`));
  }

  /** `DELETE /api/v3.1/connected_accounts/{id}`. Already gone counts as deleted. */
  async deleteConnectedAccount(id: string): Promise<void> {
    try {
      await this.call("DELETE", `/api/v3.1/connected_accounts/${this.id(id)}`);
    } catch (e) {
      if (e instanceof ComposioError && e.status === 404) return;
      throw e;
    }
  }

  /** `POST /api/v3.1/tools/execute/{slug}`: a predefined toolkit tool. */
  async executeTool(slug: string, input: { connectedAccountId: string; userId: string; arguments: Record<string, unknown> }): Promise<ToolResult> {
    if (!SLUG_RE.test(slug)) throw new ComposioError("Invalid tool slug", 400);
    const b = rec(await this.call("POST", `/api/v3.1/tools/execute/${slug}`, { connected_account_id: input.connectedAccountId, user_id: input.userId, arguments: input.arguments }));
    return { successful: b.successful === true, error: str(b.error), data: b.data ?? null };
  }

  /** `POST /api/v3.1/tools/execute/proxy`: one provider API call with the connection's credential. */
  async proxy(req: ProxyRequest): Promise<ProxyResponse> {
    const parameters = Object.entries(req.query ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([name, value]) => ({ name, value: String(value), type: "query" as const }));
    const b = rec(
      await this.call("POST", "/api/v3.1/tools/execute/proxy", {
        connected_account_id: req.connectedAccountId,
        user_id: req.userId,
        endpoint: req.endpoint,
        method: req.method,
        ...(parameters.length ? { parameters } : {}),
        ...(req.body === undefined ? {} : { body: req.body }),
        ...(req.binary ? { binary_body: { base64: req.binary.base64, content_type: req.binary.contentType } } : {}),
      }),
    );
    return { status: typeof b.status === "number" ? b.status : 502, data: b.data ?? null };
  }
}

// ------------------------------------------------------------------------------- the connector

export interface GoogleWorkspaceConfig {
  client: ComposioClient;
  /** COMPOSIO_GOOGLE_AUTH_CONFIG_ID: the Google auth config created with exactly the allowed scopes. */
  authConfigId: string;
  /** Where Composio sends the person after Google sign-in; must be a page of the web app. */
  /** Where Composio sends the browser afterwards. `returnTo` is a path in the web app, when the caller named one. */
  callbackUrl: (entityId: string, returnTo?: string) => string;
}

/** A connection that holds a scope the GMS must never have. The connection has been deleted. */
export class ConnectorScopeError extends Error {
  constructor(public readonly excess: string[]) {
    super("The Google connection was granted more access than the GMS allows, so it was removed. Connect again and leave the requested permissions as they are.");
    this.name = "ConnectorScopeError";
  }
}

/**
 * Composio did not say which scopes the connection holds, so the allow-list cannot be checked.
 * The connection is left in place but nothing is done with it: unknown is treated as refused.
 */
export class ConnectorScopeUnverifiedError extends Error {
  constructor() {
    super("The scopes of the Google connection could not be read, so it is not being used. Disconnect and connect again.");
    this.name = "ConnectorScopeUnverifiedError";
  }
}

const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/;
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
const DIRECTORY_PAGES = 3;
const DIRECTORY_PAGE_SIZE = 200;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

/** A Drive `multipart/related` upload body: JSON metadata, then the file bytes. */
export function driveMultipart(meta: { name: string; parents: string[] }, bytes: Uint8Array, mime: string, boundary: string): Uint8Array {
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  out.set(tail, head.length + bytes.length);
  return out;
}

/** A file name without control characters or path separators. */
const cleanName = (name: string) =>
  [...name]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || ch === "/" || ch === "\\" ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "document.pdf";

export class GoogleWorkspaceConnector implements WorkspaceApps {
  constructor(private readonly cfg: GoogleWorkspaceConfig) {
    if (!cfg.authConfigId) throw new Error("COMPOSIO_GOOGLE_AUTH_CONFIG_ID is not set");
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ComposioError) {
        if (e.status === 401 || e.status === 403) throw new ConnectorAuthError("Composio rejected the server's API key or the connection");
        throw new ConnectorUnavailableError("Composio could not be reached");
      }
      throw e;
    }
  }

  /**
   * The workspace's live connection, after the scope check. A connection holding any scope outside
   * the allow-list is deleted at Composio and reported as a {@link ConnectorScopeError}.
   */
  private async active(entityId: string): Promise<{ account: ConnectedAccount; scopes: ScopeCheck } | null> {
    const listed = await this.cfg.client.listConnectedAccounts({ authConfigId: this.cfg.authConfigId, userId: entityId });
    const candidate = listed.find((a) => a.status === "ACTIVE");
    if (!candidate) return null;
    const account = await this.cfg.client.getConnectedAccount(candidate.id);
    // The list filter is not trusted on its own: the account must sit on the GMS's auth config.
    if (account.status !== "ACTIVE" || account.authConfigId !== this.cfg.authConfigId) return null;
    // Fail closed: an account read that names no scope at all proves nothing about what was granted.
    if (!account.grantedScopes.length && !account.requestedScopes.length) throw new ConnectorScopeUnverifiedError();
    const scopes = checkGoogleScopes([...account.grantedScopes, ...account.requestedScopes]);
    if (!scopes.ok) {
      await this.cfg.client.deleteConnectedAccount(account.id);
      throw new ConnectorScopeError(scopes.excess);
    }
    return { account, scopes };
  }

  /**
   * Whether the workspace is connected. With `link`, a workspace that is not connected gets a
   * Composio-hosted sign-in link; without it nothing is created (reads must not leave half-started
   * connections behind).
   */
  async status(entityId: string, opts: { link?: boolean; returnTo?: string } = {}): Promise<{ connected: boolean; connectUrl: string | null }> {
    return this.wrap(async () => {
      const live = await this.active(entityId);
      if (live) return { connected: true, connectUrl: null };
      if (!opts.link) return { connected: false, connectUrl: null };
      const link = await this.cfg.client.createConnectLink({ authConfigId: this.cfg.authConfigId, userId: entityId, callbackUrl: this.cfg.callbackUrl(entityId, opts.returnTo) });
      return { connected: false, connectUrl: link.redirectUrl };
    });
  }

  /** Remove every connection the workspace has on the GMS's auth config (live or half-started). */
  async disconnect(entityId: string): Promise<void> {
    await this.wrap(async () => {
      for (const a of await this.cfg.client.listConnectedAccounts({ authConfigId: this.cfg.authConfigId, userId: entityId })) await this.cfg.client.deleteConnectedAccount(a.id);
    });
  }

  /**
   * People in the funder's directory (Admin SDK `users.list`, `admin.directory.user.readonly`).
   * Read-only, and optional: a connection without the directory scope, or one whose Google account
   * is not allowed to read the directory, yields no suggestions rather than an error.
   */
  async listDirectory(entityId: string, query: string): Promise<DirectoryPerson[]> {
    return this.wrap(async () => {
      const live = await this.active(entityId);
      if (!live || !live.scopes.directory) return [];
      const q = query.trim().toLowerCase();
      const people: DirectoryPerson[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < DIRECTORY_PAGES; page++) {
        const res = await this.cfg.client.proxy({
          connectedAccountId: live.account.id,
          userId: entityId,
          endpoint: `${GOOGLE_API}/admin/directory/v1/users`,
          method: "GET",
          query: { customer: "my_customer", viewType: "admin_view", maxResults: DIRECTORY_PAGE_SIZE, orderBy: "email", fields: "nextPageToken,users(primaryEmail,name/fullName,suspended,archived)", pageToken },
        });
        if (res.status === 403 || res.status === 404) return [];
        if (res.status !== 200) throw new ConnectorUnavailableError(`Google's directory answered ${res.status}`);
        const d = rec(res.data);
        for (const raw of arr(d.users)) {
          const u = rec(raw);
          const email = str(u.primaryEmail)?.toLowerCase();
          if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || u.suspended === true || u.archived === true) continue;
          const name = str(rec(u.name).fullName);
          if (!q || email.includes(q) || (name ?? "").toLowerCase().includes(q)) people.push({ email, name });
        }
        pageToken = str(d.nextPageToken) ?? undefined;
        if (!pageToken) break;
      }
      return people;
    });
  }

  /**
   * Save a rendered PDF into a Drive folder the person chose in the Google Picker. `drive.file`
   * reaches only items the person picked for this app (and files the app creates), so a folder
   * that was not picked answers 404 here.
   */
  async exportToDrive(entityId: string, file: { name: string; bytes: Uint8Array; folderId: string }): Promise<{ url: string; id: string }> {
    if (!DRIVE_ID_RE.test(file.folderId)) throw new Error("Invalid Drive folder id");
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_EXPORT_BYTES) throw new Error("The file is empty or larger than 20 MB");
    return this.wrap(async () => {
      const live = await this.active(entityId);
      if (!live) throw new ConnectorAuthError("Google Workspace is not connected for this workspace");
      if (!live.scopes.drive) throw new ConnectorAuthError("The Google connection does not include Drive access. Connect again and keep the Drive permission");
      const boundary = `gms-${crypto.randomUUID()}`;
      const body = driveMultipart({ name: cleanName(file.name), parents: [file.folderId] }, file.bytes, "application/pdf", boundary);
      const res = await this.cfg.client.proxy({
        connectedAccountId: live.account.id,
        userId: entityId,
        endpoint: `${GOOGLE_API}/upload/drive/v3/files`,
        method: "POST",
        query: { uploadType: "multipart", supportsAllDrives: true, fields: "id,webViewLink" },
        binary: { base64: toBase64(body), contentType: `multipart/related; boundary=${boundary}` },
      });
      if (res.status === 403 || res.status === 404) throw new ConnectorAuthError("That Drive folder is not shared with the GMS. Choose it again in the Google Picker, signed in as the account that connected");
      if (res.status !== 200) throw new ConnectorUnavailableError(`Google Drive answered ${res.status}`);
      const d = rec(res.data);
      const id = str(d.id);
      if (!id || !DRIVE_ID_RE.test(id)) throw new ConnectorUnavailableError("Google Drive did not return the new file");
      return { id, url: str(d.webViewLink) ?? `https://drive.google.com/file/d/${id}/view` };
    });
  }
}
