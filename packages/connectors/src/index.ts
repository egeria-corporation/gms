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

/** Transaction kinds that are never a grant payment: card activity, fees and moves between the funder's own accounts. */
const NOT_A_PAYMENT = /card|fee|internalTransfer|treasuryTransfer/i;
const PAGE = 1000;

const listOf = (body: unknown, key: string): Record<string, unknown>[] => {
  const v = Array.isArray(body) ? body : (body as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
};

/**
 * Mercury, read-only. Two endpoints, both checked against Mercury's API reference on 2026-11-10
 * (docs/connectors.md has the detail and what remains unverified):
 *   GET /api/v1/accounts                          (limit, start_after)
 *   GET /api/v1/account/{accountId}/transactions  (limit ≤ 1000, offset, start, status, order)
 * Only these transaction fields are read: id, amount (negative for debits), postedAt,
 * counterpartyName, note / externalMemo / bankDescription, status, kind. Mercury also returns
 * account and routing details on other fields (`details`); they are never read. It has not been
 * run against a live Mercury account.
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

  private async accountIds(token: string): Promise<string[]> {
    const ids: string[] = [];
    let after: string | null = null;
    // Cursor pagination; ten pages is far beyond any funder's account list.
    for (let page = 0; page < 10; page++) {
      const q: URLSearchParams = new URLSearchParams({ limit: String(PAGE), ...(after ? { start_after: after } : {}) });
      const batch: string[] = listOf(await this.get(token, `/accounts?${q}`), "accounts").map((a) => a.id).filter((id): id is string => typeof id === "string");
      ids.push(...batch);
      if (batch.length < PAGE) break;
      after = batch[batch.length - 1]!;
    }
    return ids;
  }

  async listOutbound(token: string, since: string | null): Promise<BankFeedTransaction[]> {
    const out: BankFeedTransaction[] = [];
    for (const id of await this.accountIds(token)) {
      for (let offset = 0; offset < 20 * PAGE; offset += PAGE) {
        // `sent` is Mercury's settled state; without `start` Mercury returns the last 30 days only.
        const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset), order: "asc", status: "sent", ...(since ? { start: since.slice(0, 10) } : {}) });
        const batch = listOf(await this.get(token, `/account/${encodeURIComponent(id)}/transactions?${q}`), "transactions");
        for (const t of batch) {
          const amount = typeof t.amount === "number" ? t.amount : Number.NaN;
          const postedAt = typeof t.postedAt === "string" ? t.postedAt : null;
          // Outbound and settled only: money that has actually left for someone else.
          if (!Number.isFinite(amount) || amount >= 0 || !postedAt || typeof t.id !== "string") continue;
          if (typeof t.status === "string" && t.status !== "sent") continue;
          if (typeof t.kind === "string" && NOT_A_PAYMENT.test(t.kind)) continue;
          const memo = [t.note, t.externalMemo, t.bankDescription].find((m): m is string => typeof m === "string" && m !== "") ?? null;
          out.push({ externalId: t.id, amountMinor: toMinor(amount), currency: "USD", postedAt, counterpartyName: typeof t.counterpartyName === "string" ? t.counterpartyName : null, memo });
        }
        if (batch.length < PAGE) break;
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
  /** Call one tool. The GMS only ever calls tools a workspace admin allow-listed, and only read tools can be. */
  callTool?(server: { url: string; authHeader: string | null }, name: string, args: Record<string, unknown>): Promise<unknown>;
}

export class FixtureMcpDirectory implements McpDirectory {
  constructor(public tools: Record<string, RemoteTool[]> = {}) {}
  async listTools(server: { url: string }): Promise<RemoteTool[]> {
    const t = this.tools[server.url];
    if (!t) throw new ConnectorUnavailableError("mcp", "The MCP server could not be reached");
    return t;
  }

  /** Canned tool results by `url#tool`, and every call made. */
  results: Record<string, unknown> = {};
  readonly calls: { url: string; name: string; args: Record<string, unknown> }[] = [];
  async callTool(server: { url: string }, name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ url: server.url, name, args });
    const key = `${server.url}#${name}`;
    if (!(key in this.results)) throw new ConnectorUnavailableError("mcp", "The MCP server could not be reached");
    return this.results[key];
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

  /** `tools/call`. Returns the structured content when the server gives one, the text content otherwise. */
  async callTool(server: { url: string; authHeader: string | null }, name: string, args: Record<string, unknown>): Promise<unknown> {
    let res: Response;
    try {
      res = await this.doFetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(server.authHeader ? { Authorization: server.authHeader } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ConnectorUnavailableError("mcp", "The MCP server could not be reached");
    }
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError("mcp");
    if (!res.ok) throw new ConnectorUnavailableError("mcp", `The MCP server answered ${res.status}`);
    let text = await res.text();
    if ((res.headers.get("Content-Type") ?? "").includes("text/event-stream")) text = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop() ?? "";
    let body: { result?: { structuredContent?: unknown; content?: { type?: string; text?: string }[]; isError?: boolean }; error?: unknown };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new ConnectorUnavailableError("mcp", "The MCP server returned a body that is not JSON");
    }
    if (body.error || body.result?.isError) throw new ConnectorUnavailableError("mcp", "The MCP server reported an error for this tool");
    if (body.result?.structuredContent !== undefined) return body.result.structuredContent;
    // Tool text is capped: it is context for a draft, not a document store.
    return (body.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").slice(0, 4000);
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
