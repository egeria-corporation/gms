// SPDX-License-Identifier: AGPL-3.0-only
// Ports for side effects outside the database: file bytes and OpenGrants discovery. Each has an
// in-memory implementation for tests and local development and a production implementation
// (R2 / the hosted OpenGrants MCP).

// ---------------------------------------------------------------------------------- file storage

export interface StoredFile {
  storage: "supabase" | "r2";
  path: string;
}

export interface FileStorage {
  /** Store the bytes under `path`; returns where they went. */
  put(path: string, bytes: Uint8Array, mime: string): Promise<StoredFile>;
  get(file: StoredFile): Promise<Uint8Array | null>;
}

export class MemoryFileStorage implements FileStorage {
  readonly files = new Map<string, { bytes: Uint8Array; mime: string }>();
  async put(path: string, bytes: Uint8Array, mime: string): Promise<StoredFile> {
    this.files.set(path, { bytes, mime });
    return { storage: "r2", path };
  }
  async get(file: StoredFile): Promise<Uint8Array | null> {
    return this.files.get(file.path)?.bytes ?? null;
  }
}

/** The `ATTACHMENTS` R2 bucket. Supabase Storage holds small files on installs without R2 (wired by the host). */
export class R2FileStorage implements FileStorage {
  constructor(private readonly bucket: R2Bucket) {}
  async put(path: string, bytes: Uint8Array, mime: string): Promise<StoredFile> {
    await this.bucket.put(path, bytes, { httpMetadata: { contentType: mime } });
    return { storage: "r2", path };
  }
  async get(file: StoredFile): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(file.path);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}

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
