// SPDX-License-Identifier: AGPL-3.0-only
// Connectors (build spec §10.10): ports for services outside the GMS, each with a fixture
// implementation for tests and local runs.
//
// - BankFeed: read-only outbound transactions for reconciliation (Mercury). It is NOT a payment
//   rail: nothing here can move money, and no account identifier is ever read or stored.
// - WorkspaceApps: the funder's Google Workspace through Composio (Drive export, directory read).
// - McpDirectory: lists the tools of a funder-registered MCP server; only read tools are allow-listed.

// ------------------------------------------------------------------------------------ bank feed

/** One outbound transaction as the GMS keeps it. No account identifier of either side is kept. */
export interface BankFeedTransaction {
  externalId: string;
  /** Positive amount in minor units (money that left the funder's account). */
  amountMinor: number;
  currency: string;
  postedAt: string;
  counterpartyName: string | null;
  memo: string | null;
}

export interface BankFeed {
  /** Outbound, posted transactions on or after `since` (ISO 8601), oldest first. */
  listOutbound(token: string, since: string | null): Promise<BankFeedTransaction[]>;
}

export class ConnectorUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message = `${provider} could not be reached`,
  ) {
    super(message);
    this.name = "ConnectorUnavailableError";
  }
}

export class ConnectorAuthError extends Error {
  constructor(readonly provider: string) {
    super(`${provider} rejected the credentials`);
    this.name = "ConnectorAuthError";
  }
}

export class FixtureBankFeed implements BankFeed {
  readonly calls: { since: string | null }[] = [];
  constructor(public transactions: BankFeedTransaction[] = []) {}
  async listOutbound(_token: string, since: string | null): Promise<BankFeedTransaction[]> {
    this.calls.push({ since });
    return this.transactions.filter((t) => !since || t.postedAt >= since).sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const toMinor = (amount: number): number => Math.round(Math.abs(amount) * 100);

/**
 * Mercury, read-only. UNVERIFIED: Mercury's API documentation could not be reached when this was
 * written, so the two endpoints and the field names below are from memory of the public API and
 * have not been run against Mercury (see docs/connectors.md). Only these fields are read from a
 * transaction: id, amount, postedAt, counterpartyName, note / bankDescription, status. Account
 * and routing details that Mercury returns on other fields are never read.
 */
export class MercuryBankFeed implements BankFeed {
  constructor(
    private readonly doFetch: FetchLike = (i, init) => fetch(i, init),
    private readonly baseUrl = "https://api.mercury.com/api/v1",
  ) {}

  private async get(token: string, path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    } catch {
      throw new ConnectorUnavailableError("mercury");
    }
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError("mercury");
    if (!res.ok) throw new ConnectorUnavailableError("mercury", `Mercury answered ${res.status}`);
    return res.json();
  }

  async listOutbound(token: string, since: string | null): Promise<BankFeedTransaction[]> {
    const accounts = ((await this.get(token, "/accounts")) as { accounts?: { id?: unknown }[] } | null)?.accounts ?? [];
    const out: BankFeedTransaction[] = [];
    for (const a of accounts) {
      if (typeof a.id !== "string") continue;
      const q = new URLSearchParams({ limit: "500", ...(since ? { start: since.slice(0, 10) } : {}) });
      const body = (await this.get(token, `/account/${encodeURIComponent(a.id)}/transactions?${q}`)) as { transactions?: Record<string, unknown>[] } | null;
      for (const t of body?.transactions ?? []) {
        const amount = typeof t.amount === "number" ? t.amount : Number.NaN;
        const postedAt = typeof t.postedAt === "string" ? t.postedAt : null;
        // Outbound and settled only: money that has actually left.
        if (!Number.isFinite(amount) || amount >= 0 || !postedAt || typeof t.id !== "string") continue;
        if (typeof t.status === "string" && t.status !== "sent") continue;
        const memo = typeof t.note === "string" && t.note ? t.note : typeof t.bankDescription === "string" ? t.bankDescription : null;
        out.push({ externalId: t.id, amountMinor: toMinor(amount), currency: "USD", postedAt, counterpartyName: typeof t.counterpartyName === "string" ? t.counterpartyName : null, memo });
      }
    }
    return out.filter((t) => !since || t.postedAt >= since).sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  }
}

// ------------------------------------------------------------------------------- workspace apps

export interface DirectoryPerson {
  email: string;
  name: string | null;
}

/**
 * The funder's Google Workspace through Composio (one entity per funder workspace, `drive.file`
 * through the Picker plus directory read-only). Only a fixture implementation ships: the Composio
 * request shapes are not written from memory. A production implementation goes behind this port
 * once it can be built against Composio's documentation and a real auth config.
 */
export interface WorkspaceApps {
  /** Whether the workspace has a live Composio connection; `connectUrl` starts one when it does not. */
  status(entityId: string): Promise<{ connected: boolean; connectUrl: string | null }>;
  /** People in the funder's directory, to suggest members at invite time. */
  listDirectory(entityId: string, query: string): Promise<DirectoryPerson[]>;
  /** Save a rendered PDF to a Drive folder the person chose in the Picker. Returns the file's URL. */
  exportToDrive(entityId: string, file: { name: string; bytes: Uint8Array; folderId: string }): Promise<{ url: string }>;
}

export class FixtureWorkspaceApps implements WorkspaceApps {
  connected = true;
  readonly exported: { entityId: string; name: string; folderId: string; size: number }[] = [];
  constructor(public people: DirectoryPerson[] = []) {}
  async status(entityId: string) {
    return this.connected ? { connected: true, connectUrl: null } : { connected: false, connectUrl: `https://composio.invalid/connect?entity=${encodeURIComponent(entityId)}` };
  }
  async listDirectory(_entityId: string, query: string) {
    const q = query.trim().toLowerCase();
    return this.people.filter((p) => !q || p.email.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q));
  }
  async exportToDrive(entityId: string, file: { name: string; bytes: Uint8Array; folderId: string }) {
    this.exported.push({ entityId, name: file.name, folderId: file.folderId, size: file.bytes.byteLength });
    return { url: `https://drive.google.invalid/file/${this.exported.length}` };
  }
}

// -------------------------------------------------------------------------------- MCP directory

export interface RemoteTool {
  name: string;
  description: string | null;
  /** From the tool's `annotations.readOnlyHint`. A tool that does not declare it is treated as a write tool. */
  readOnly: boolean;
}

export interface McpDirectory {
  listTools(server: { url: string; authHeader: string | null }): Promise<RemoteTool[]>;
}

export class FixtureMcpDirectory implements McpDirectory {
  constructor(public tools: Record<string, RemoteTool[]> = {}) {}
  async listTools(server: { url: string }): Promise<RemoteTool[]> {
    const t = this.tools[server.url];
    if (!t) throw new ConnectorUnavailableError("mcp", "The MCP server could not be reached");
    return t;
  }
}

/** `tools/list` on a Streamable HTTP MCP server (stateless JSON-RPC over POST). */
export class HttpMcpDirectory implements McpDirectory {
  constructor(private readonly doFetch: FetchLike = (i, init) => fetch(i, init)) {}

  async listTools(server: { url: string; authHeader: string | null }): Promise<RemoteTool[]> {
    let res: Response;
    try {
      res = await this.doFetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(server.authHeader ? { Authorization: server.authHeader } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
    } catch {
      throw new ConnectorUnavailableError("mcp", "The MCP server could not be reached");
    }
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError("mcp");
    if (!res.ok) throw new ConnectorUnavailableError("mcp", `The MCP server answered ${res.status}`);
    let text = await res.text();
    if ((res.headers.get("Content-Type") ?? "").includes("text/event-stream")) text = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop() ?? "";
    let body: { result?: { tools?: unknown } };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new ConnectorUnavailableError("mcp", "The MCP server returned a body that is not JSON");
    }
    const tools = Array.isArray(body.result?.tools) ? (body.result.tools as Record<string, unknown>[]) : [];
    return tools
      .filter((t) => typeof t.name === "string")
      .map((t) => ({ name: t.name as string, description: typeof t.description === "string" ? t.description : null, readOnly: (t.annotations as { readOnlyHint?: unknown } | undefined)?.readOnlyHint === true }));
  }
}

/** Only HTTPS servers on public hosts may be registered (no loopback, link-local or private literals). */
export function isRegistrableMcpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(":")) return false; // IP literals
  return true;
}
