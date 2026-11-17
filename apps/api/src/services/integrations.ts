// SPDX-License-Identifier: AGPL-3.0-only
// Workspace integrations (build spec §9.2 "Integrations", §10.10): outbound webhooks, API
// clients, MCP connections, funder-registered MCP servers, the Mercury / Google Workspace
// connectors, and the import sources connected through Composio (Google Sheets, Airtable). Every secret is shown once at creation or stored as ciphertext; none is returned.
// Connected apps (v1.12.0, docs/connectors.md): Slack, Google Drive and Salesforce connect here like
// the import sources; Drive also copies a picked file for an upload and saves an as-submitted PDF.
// Slack alerts are in ./connector-alerts.ts, Google Calendar in ./calendar-sync.ts. QuickBooks (v1.13.0)
// connects here too; its mapping, sync switch and entries are in ./accounting.ts.
import { APP_SCOPE_NAMES, ConnectorAuthError, ConnectorScopeError, ConnectorScopeUnverifiedError, ConnectorUnavailableError, DRIVE_FILE_ID, DriveFileRefusedError, isRegistrableMcpUrl, type Connection, type TabularConnection, type TabularProvider } from "@gms/connectors";
import { printValue, renderApplicationSnapshot, type SnapshotForm } from "@gms/documents";
import { decryptSecret, encryptSecret } from "@gms/passport-client";
import { WEBHOOK_EVENT_TYPES, encryptSecret as encryptWebhookSecret, generateWebhookSecret, isDeliverableUrl } from "@gms/webhooks";
import { z } from "zod";
import { generateClientSecret, hashSecret } from "../auth/crypto.ts";
import { SCOPES, scopesForRole, type Scope } from "../auth/scopes.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { parse } from "../lib/input.ts";
import { apiId, uuidOf } from "../lib/ids.ts";
import { agreementPdf, awardLetterPdf } from "./agreements.ts";
import { audit, authorize, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { getApplicationDetail } from "./inbox.ts";
import { outsideDocumentFile } from "./outside.ts";
import { RepoError, type Row } from "./repos/types.ts";

/** A person in the GMS, never an agent acting for them or an API client (human-only actions). */
export function humanOnly(ctx: Pick<ServiceContext, "actor">): void {
  if (ctx.actor.kind !== "user") throw new ApiError(403, "person_required", "This is done by a signed-in person in the GMS, never by an agent or an API client");
}

const admin = (ctx: ServiceContext, opts: { person?: boolean } = {}): Promise<ServiceWorkspace> => authorize(ctx, { scope: "workspace:admin", roles: ["admin"], ...(opts.person ? { person: true } : {}) });

// ------------------------------------------------------------------------------------ webhooks

export const webhookInput = z.object({ url: z.url().max(2000), events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).max(WEBHOOK_EVENT_TYPES.length).optional() }).strict();

const subscriptionView = (s: { id: string; url: string; eventTypes: string[]; active: boolean }) => ({ id: s.id, url: s.url, events: s.eventTypes, active: s.active });

export async function listWebhooks(ctx: ServiceContext) {
  const ws = await admin(ctx);
  return (await ctx.webhooks.listSubscriptions(ws.id)).map(subscriptionView);
}

/** The signing secret is returned once, here, and stored encrypted. */
export async function createWebhook(ctx: ServiceContext, input: z.output<typeof webhookInput>) {
  const ws = await admin(ctx);
  if (!isDeliverableUrl(input.url)) throw new ApiError(422, "invalid_url", "Webhook endpoints must be HTTPS");
  if (!ctx.config.webhookSecretKey) throw new ApiError(503, "webhooks_not_configured", "Outbound webhooks are not configured on this server");
  const secret = generateWebhookSecret();
  const sub = { id: crypto.randomUUID(), workspaceId: ws.id, url: input.url, eventTypes: [...new Set(input.events ?? [])], secretEnc: await encryptWebhookSecret(secret, ctx.config.webhookSecretKey), active: true };
  await ctx.webhooks.createSubscription(sub, ctx.actor.userId);
  await audit(ctx, "webhook.created", "webhook_subscription", sub.id, { url: new URL(input.url).origin, events: sub.eventTypes });
  return { ...subscriptionView(sub), secret };
}

export async function deleteWebhook(ctx: ServiceContext, id: string) {
  const ws = await admin(ctx);
  if (!(await ctx.webhooks.deleteSubscription(id, ws.id))) throw notFound("Webhook");
  await audit(ctx, "webhook.deleted", "webhook_subscription", id);
  return { deleted: true };
}

export async function listWebhookDeliveries(ctx: ServiceContext, id: string) {
  const ws = await admin(ctx);
  const sub = await ctx.webhooks.getSubscription(id);
  if (!sub || sub.workspaceId !== ws.id) throw notFound("Webhook");
  return (await ctx.webhooks.listDeliveries(id, 100)).map((d) => ({ id: d.id, eventId: d.eventId, eventType: d.eventType, status: d.status, attempts: d.attempts, lastStatusCode: d.lastStatusCode, lastError: d.lastError, nextAttemptAt: d.nextAttemptAt, deliveredAt: d.deliveredAt, createdAt: d.createdAt }));
}

/**
 * Send one delivery again: a new delivery row with the same event and the exact same signed body,
 * due now. The original row stays as the record of what happened. People only.
 */
export async function replayWebhookDelivery(ctx: ServiceContext, id: string, deliveryId: string) {
  const ws = await admin(ctx, { person: true });
  const sub = await ctx.webhooks.getSubscription(id);
  if (!sub || sub.workspaceId !== ws.id) throw notFound("Webhook");
  if (!sub.active) throw new ApiError(409, "webhook_inactive", "This webhook is no longer active");
  const original = await ctx.webhooks.getDelivery(deliveryId);
  if (!original || original.subscriptionId !== id) throw notFound("Delivery");
  const now = ctx.now().toISOString();
  const replay = { id: crypto.randomUUID(), subscriptionId: id, eventId: original.eventId, eventType: original.eventType, payload: original.payload, status: "pending" as const, attempts: 0, nextAttemptAt: now, lastStatusCode: null, lastError: null, deliveredAt: null, createdAt: now };
  await ctx.webhooks.insertDelivery(replay);
  await audit(ctx, "webhook.delivery_replayed", "webhook_subscription", id, { deliveryId: replay.id, replayOf: original.id, eventId: original.eventId, eventType: original.eventType });
  return { id: replay.id, replayOf: original.id, eventId: replay.eventId, eventType: replay.eventType, status: replay.status, attempts: 0, nextAttemptAt: now, createdAt: now };
}

// ------------------------------------------------------------------------------------ API clients

/** Scopes a workspace API client can never hold: the human gates stay with people. */
const NEVER_FOR_CLIENTS: readonly string[] = ["approvals:bypass"];
/** Submit and sign rights, and workspace administration, never ride on an applicant workspace's token. */
export const NEVER_FOR_APPLICANT_CLIENTS: readonly string[] = ["applications:submit", "agreements:write", "workspace:admin"];
export const apiClientInput = z.object({ name: z.string().trim().min(1).max(120), scopes: z.array(z.string()).min(1).max(SCOPES.length) }).strict();

const clientView = (c: Row<"api_clients">) => ({ id: c.id, name: c.name, scopes: c.allowed_scopes, createdAt: c.created_at, lastUsedAt: c.last_used_at, revokedAt: c.revoked_at });

export async function listApiClients(ctx: ServiceContext) {
  const ws = await admin(ctx);
  return (await ctx.repos.table("api_clients").find({ workspace_id: ws.id }, { orderBy: "created_at", ascending: false })).map(clientView);
}

/** The client secret is returned once, here; only its hash is stored. */
export async function createApiClient(ctx: ServiceContext, input: z.output<typeof apiClientInput>) {
  const ws = await admin(ctx, { person: true });
  const unknown = input.scopes.filter((s) => !(SCOPES as readonly string[]).includes(s) || NEVER_FOR_CLIENTS.includes(s));
  if (unknown.length) throw new ApiError(422, "invalid_scope", `These scopes cannot be granted to an API client: ${unknown.join(", ")}`);
  if (ws.kind === "applicant") {
    // An applicant's token reads and drafts. Submitting and signing stay with a person, so the
    // scopes that carry them are never issued, and nothing outside the applicant's own vocabulary is.
    const allowed = scopesForRole("applicant", "admin") as readonly string[];
    const refused = input.scopes.filter((s) => NEVER_FOR_APPLICANT_CLIENTS.includes(s) || !allowed.includes(s));
    if (refused.length) throw new ApiError(422, "invalid_scope", `An applicant workspace's token cannot carry: ${refused.join(", ")}. Tokens never submit or sign`);
  }
  const secret = generateClientSecret();
  const row = await ctx.repos.table("api_clients").insert({ workspace_id: ws.id, name: input.name, client_secret_hash: await hashSecret(secret), allowed_scopes: [...new Set(input.scopes)] as Scope[], created_by: ctx.actor.userId });
  await audit(ctx, "api_client.created", "api_client", row.id, { name: row.name, scopes: row.allowed_scopes });
  return { ...clientView(row), clientId: row.id, clientSecret: secret };
}

export async function revokeApiClient(ctx: ServiceContext, id: string) {
  const ws = await admin(ctx, { person: true });
  const [row] = await ctx.repos.table("api_clients").update({ id, workspace_id: ws.id, revoked_at: null }, { revoked_at: ctx.now().toISOString() });
  if (!row) throw notFound("API client");
  await audit(ctx, "api_client.revoked", "api_client", id);
  return clientView(row);
}

// ------------------------------------------------------------------------------------ MCP connections

type Conn = Row<"mcp_connections">;

async function connectionViews(ctx: ServiceContext, rows: Conn[]) {
  const clients = rows.length ? await ctx.repos.table("oauth_clients_dynamic").find({ id: [...new Set(rows.map((r) => r.client_id))] }) : [];
  return rows.map((c) => {
    const client = clients.find((x) => x.id === c.client_id);
    return { id: c.id, clientId: c.client_id, clientName: client?.client_name ?? null, clientUri: client?.client_uri ?? null, userId: c.user_id, mine: c.user_id === ctx.actor.userId, scopes: c.scopes, lastUsedAt: c.last_used_at, revokedAt: c.revoked_at, createdAt: c.created_at };
  });
}

/** Admins manage every agent connected to the workspace; any other member manages the ones they connected. */
async function connectionScope(ctx: ServiceContext): Promise<{ ws: ServiceWorkspace; all: boolean }> {
  if (ctx.scopes.includes("workspace:admin") && (ctx.workspace?.role === "admin" || ctx.workspace?.role === null)) return { ws: await admin(ctx), all: true };
  const ws = await authorize(ctx, { person: true });
  if (!ws) throw new ApiError(403, "workspace_required", "Name a workspace for this action");
  return { ws, all: false };
}

/** The agents connected to this workspace, on either side: all of them for an admin, the member's own otherwise. */
export async function listMcpConnections(ctx: ServiceContext) {
  const { ws, all } = await connectionScope(ctx);
  const rows = await ctx.repos.table("mcp_connections").find({ workspace_id: ws.id, ...(all ? {} : { user_id: ctx.actor.userId! }) }, { orderBy: "created_at", ascending: false });
  return connectionViews(ctx, rows);
}

/** Revoke an agent's connection. Its OAuth grant is revoked with it, so its tokens stop working at the next refresh. */
export async function revokeMcpConnection(ctx: ServiceContext, id: string) {
  // An agent never disconnects an agent: only a signed-in person does.
  if (ctx.actor.kind !== "user") throw new ApiError(403, "person_required", "This action must be taken by a signed-in person");
  const { ws, all } = await connectionScope(ctx);
  const now = ctx.now().toISOString();
  const [row] = await ctx.repos.table("mcp_connections").update({ id, workspace_id: ws.id, revoked_at: null, ...(all ? {} : { user_id: ctx.actor.userId! }) }, { revoked_at: now });
  if (!row) throw notFound("MCP connection");
  if (row.grant_id) await ctx.repos.table("oauth_grants").update({ id: row.grant_id }, { revoked_at: now });
  await audit(ctx, "mcp_connection.revoked", "mcp_connection", id, { clientId: row.client_id });
  return (await connectionViews(ctx, [row]))[0]!;
}

// ------------------------------------------------------------------------------------ custom MCP servers

export const mcpServerInput = z.object({ name: z.string().trim().min(1).max(120), url: z.url().max(2000), authHeader: z.string().min(1).max(4000).optional(), allowedTools: z.array(z.string().min(1).max(200)).max(200).optional() }).strict();
export const mcpServerPatch = z.object({ allowedTools: z.array(z.string().min(1).max(200)).max(200) }).strict();

const serverView = (s: Row<"custom_mcp_servers">) => ({ id: s.id, name: s.name, url: s.url, hasAuth: s.auth !== null, allowedTools: s.allowed_tools, readOnly: s.read_only, createdAt: s.created_at });

export async function authHeaderOf(ctx: Pick<ServiceContext, "config">, s: Row<"custom_mcp_servers">): Promise<string | null> {
  const enc = (s.auth as { headerEnc?: string } | null)?.headerEnc;
  return enc && ctx.config.credentialsKey ? decryptSecret(enc, ctx.config.credentialsKey) : null;
}

/** Ask the server for its tools. Only tools that declare themselves read-only can be allow-listed. */
async function remoteTools(ctx: ServiceContext, s: { url: string; authHeader: string | null }) {
  if (!ctx.ports.mcpDirectory) throw new ApiError(503, "mcp_directory_unavailable", "Custom MCP servers are not configured on this server");
  try {
    return await ctx.ports.mcpDirectory.listTools(s);
  } catch (e) {
    if (e instanceof ConnectorAuthError) throw new ApiError(422, "mcp_auth_rejected", "The MCP server rejected the credentials");
    if (e instanceof ConnectorUnavailableError) throw new ApiError(502, "mcp_unreachable", "The MCP server could not be reached or did not answer as an MCP server");
    throw e;
  }
}

function checkAllowed(tools: { name: string; readOnly: boolean }[], wanted: string[]) {
  const bad = wanted.filter((n) => !tools.find((t) => t.name === n)?.readOnly);
  if (bad.length) throw new ApiError(422, "tool_not_read_only", `Only tools the server marks read-only can be allowed. Not allowed: ${bad.join(", ")}`);
}

export async function listMcpServers(ctx: ServiceContext) {
  const ws = await admin(ctx);
  return (await ctx.repos.table("custom_mcp_servers").find({ workspace_id: ws.id }, { orderBy: "created_at" })).map(serverView);
}

export async function registerMcpServer(ctx: ServiceContext, input: z.output<typeof mcpServerInput>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
  if (!isRegistrableMcpUrl(input.url)) throw new ApiError(422, "invalid_url", "An MCP server must be an HTTPS URL on a public host");
  if (input.authHeader && !ctx.config.credentialsKey) throw new ApiError(503, "credentials_not_configured", "This server cannot store credentials (CREDENTIALS_ENCRYPTION_KEY is not set)");
  const tools = await remoteTools(ctx, { url: input.url, authHeader: input.authHeader ?? null });
  checkAllowed(tools, input.allowedTools ?? []);
  const row = await ctx.repos.table("custom_mcp_servers").insert({ workspace_id: ws.id, name: input.name, url: input.url, auth: (input.authHeader ? { headerEnc: await encryptSecret(input.authHeader, ctx.config.credentialsKey!) } : null) as Row<"custom_mcp_servers">["auth"], allowed_tools: [...new Set(input.allowedTools ?? [])], read_only: true, created_by: ctx.actor.userId });
  await audit(ctx, "custom_mcp_server.registered", "custom_mcp_server", row.id, { name: row.name, host: new URL(row.url).host, allowedTools: row.allowed_tools });
  return { ...serverView(row), tools };
}

async function ownServer(ctx: ServiceContext, id: string) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"] });
  const s = await ctx.repos.table("custom_mcp_servers").one({ id });
  if (!s || s.workspace_id !== ws.id) throw notFound("MCP server");
  return s;
}

export async function listMcpServerTools(ctx: ServiceContext, id: string) {
  const s = await ownServer(ctx, id);
  const tools = await remoteTools(ctx, { url: s.url, authHeader: await authHeaderOf(ctx, s) });
  return tools.map((t) => ({ ...t, allowed: s.allowed_tools.includes(t.name) }));
}

export async function updateMcpServer(ctx: ServiceContext, id: string, input: z.output<typeof mcpServerPatch>) {
  const s = await ownServer(ctx, id);
  checkAllowed(await remoteTools(ctx, { url: s.url, authHeader: await authHeaderOf(ctx, s) }), input.allowedTools);
  const [row] = await ctx.repos.table("custom_mcp_servers").update({ id: s.id }, { allowed_tools: [...new Set(input.allowedTools)] });
  await audit(ctx, "custom_mcp_server.tools_changed", "custom_mcp_server", s.id, { allowedTools: input.allowedTools });
  return serverView(row ?? s);
}

export async function removeMcpServer(ctx: ServiceContext, id: string) {
  const s = await ownServer(ctx, id);
  await ctx.repos.table("custom_mcp_servers").remove({ id: s.id });
  await audit(ctx, "custom_mcp_server.removed", "custom_mcp_server", s.id, { name: s.name });
  return { deleted: true };
}

// ------------------------------------------------------------------------------------ connectors

export const PROVIDERS = ["mercury", "google_workspace", "google_sheets", "airtable", "slack", "google_drive", "salesforce", "quickbooks"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const connectorInput = z
  .object({
    token: z.string().min(8).max(4000).optional(),
    /** Import sources: the web page Composio returns to, a path inside this workspace (`/w/<handle>/…`). */
    returnTo: z.string().max(300).optional(),
  })
  .strict();

/**
 * Connections that live at Composio, one per workspace: the read-only import sources (Google
 * Sheets, Airtable, Salesforce), Slack for alerts and an applicant's Google Drive. A workspace
 * admin connects them, signed in; the GMS stores no credential.
 */
type ComposioProvider = TabularProvider | "slack" | "google_drive" | "salesforce" | "quickbooks";
const COMPOSIO_SOURCES: readonly Provider[] = ["google_sheets", "airtable", "slack", "google_drive", "salesforce", "quickbooks"];
const isImportSource = (p: Provider): p is ComposioProvider => COMPOSIO_SOURCES.includes(p);
/** What the connector_accounts row records for each: the scope names only, never a credential. */
const IMPORT_SCOPES: Record<ComposioProvider, string[]> = { google_sheets: ["spreadsheets.readonly"], airtable: ["data.records:read", "schema.bases:read"], slack: APP_SCOPE_NAMES.slack, google_drive: APP_SCOPE_NAMES.google_drive, salesforce: APP_SCOPE_NAMES.salesforce, quickbooks: APP_SCOPE_NAMES.quickbooks };
export const importSourcePort = (ctx: Pick<ServiceContext, "ports">, p: ComposioProvider): TabularConnection | Connection | undefined =>
  ({ google_sheets: ctx.ports.sheets, airtable: ctx.ports.airtable, slack: ctx.ports.slack, google_drive: ctx.ports.drive, salesforce: ctx.ports.salesforce, quickbooks: ctx.ports.quickbooks })[p];
const IMPORT_LABEL: Record<ComposioProvider, string> = { google_sheets: "Google Sheets", airtable: "Airtable", slack: "Slack", google_drive: "Google Drive", salesforce: "Salesforce", quickbooks: "QuickBooks" };
/** Google Drive is the applicant's (a funder connects Google Workspace instead). */
const KIND_OF: Partial<Record<ComposioProvider, "funder" | "applicant">> = { google_drive: "applicant", quickbooks: "funder" };
/** The connected apps return to their settings page; the import sources to the import page. */
const HOME_OF: Record<ComposioProvider, string> = { google_sheets: "import", airtable: "import", salesforce: "import", slack: "settings/apps", google_drive: "settings/apps", quickbooks: "settings/accounting" };

/** A path in this workspace's pages, or the provider's own page when the one given is not. */
function importReturnTo(handle: string, returnTo: string | undefined, home = "import"): string {
  const fallback = `/w/${handle}/${home}`;
  if (!returnTo) return fallback;
  return returnTo.startsWith(`/w/${handle}/`) && /^\/w\/[a-z0-9-]+\/[A-Za-z0-9/_?=&.-]*$/.test(returnTo) && !returnTo.includes("//", 1) ? returnTo : fallback;
}

const accountView = (a: Row<"connector_accounts"> | null, provider: Provider) => ({ provider, connected: !!a && a.status === "active", status: a?.status ?? "not_connected", scopes: a?.scopes ?? [], lastSyncAt: a?.last_sync_at ?? null });

export function providerOf(value: string | undefined): Provider {
  if (!value || !(PROVIDERS as readonly string[]).includes(value)) throw notFound("Connector");
  return value as Provider;
}

const account = (ctx: ServiceContext, wsId: string, provider: Provider) => ctx.repos.table("connector_accounts").one({ workspace_id: wsId, provider });

/** What a failed Composio or Google call means for the person connecting Google Workspace. */
function googleWorkspaceError(e: unknown): never {
  if (e instanceof ConnectorScopeError) throw new ApiError(422, "connector_scope_rejected", e.message);
  if (e instanceof ConnectorScopeUnverifiedError) throw new ApiError(422, "connector_scope_unverified", e.message);
  if (e instanceof ConnectorAuthError) throw new ApiError(502, "connector_rejected", "Composio rejected this server's connection settings. Nothing was changed");
  if (e instanceof ConnectorUnavailableError) throw new ApiError(503, "connector_unavailable", "Composio could not be reached. Nothing was changed");
  throw e;
}

export async function getConnector(ctx: ServiceContext, provider: Provider) {
  if (isImportSource(provider)) return getImportSource(ctx, provider);
  const ws = await authorize(ctx, { scope: "payments:read", kind: "funder", roles: ["admin", "finance"] });
  const a = await account(ctx, ws.id, provider);
  if (provider === "google_workspace" && ctx.ports.workspaceApps) {
    // A read never starts a connection, and an unreachable Composio shows the stored state as not connected.
    const s = await ctx.ports.workspaceApps.status(ws.id).catch((e: unknown) => {
      if (e instanceof ConnectorScopeError || e instanceof ConnectorScopeUnverifiedError || e instanceof ConnectorAuthError || e instanceof ConnectorUnavailableError) return { connected: false, connectUrl: null };
      throw e;
    });
    return { ...accountView(a, provider), connected: s.connected, connectUrl: s.connectUrl };
  }
  // Google Workspace without Composio on this server: say so, so the app does not offer a
  // Connect button that can only fail.
  if (provider === "google_workspace") return { ...accountView(a, provider), status: "not_configured" as const };
  return accountView(a, provider);
}

/**
 * Connect a provider. Mercury: a read-only API token, verified by one read and stored encrypted;
 * it is used only to list outbound transactions for reconciliation. Google Workspace: the
 * connection lives at Composio (entity = this workspace); the GMS stores no Google credential.
 */
export async function connect(ctx: ServiceContext, provider: Provider, input: z.output<typeof connectorInput>) {
  if (isImportSource(provider)) return connectImportSource(ctx, provider, input);
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
  const existing = await account(ctx, ws.id, provider);
  if (provider === "google_workspace") {
    if (!ctx.ports.workspaceApps) throw new ApiError(503, "connector_not_configured", "Google Workspace through Composio is not configured on this server");
    // Not connected yet: Composio returns a hosted Google sign-in link for this workspace's entity.
    // Composio sends the browser back to this workspace's connector settings.
    const home = await ctx.repos.table("workspaces").one({ id: ws.id });
    const s = await ctx.ports.workspaceApps.status(ws.id, { link: true, ...(home ? { returnTo: `/w/${home.handle}/settings/connectors` } : {}) }).catch(googleWorkspaceError);
    const patch = { status: s.connected ? "active" : "pending", scopes: ["drive.file", "admin.directory.user.readonly"], external_id: ws.id };
    const row = existing ? (await ctx.repos.table("connector_accounts").update({ id: existing.id }, patch))[0]! : await ctx.repos.table("connector_accounts").insert({ workspace_id: ws.id, provider, ...patch });
    await audit(ctx, "connector.connected", "connector_account", row.id, { provider, state: row.status });
    return { ...accountView(row, provider), connected: s.connected, connectUrl: s.connectUrl };
  }
  if (!input.token) throw new ApiError(422, "token_required", "Paste a read-only Mercury API token");
  if (!ctx.ports.bank) throw new ApiError(503, "connector_not_configured", "The Mercury connector is not configured on this server");
  if (!ctx.config.credentialsKey) throw new ApiError(503, "credentials_not_configured", "This server cannot store credentials (CREDENTIALS_ENCRYPTION_KEY is not set)");
  try {
    await ctx.ports.bank.listOutbound(input.token, ctx.now().toISOString());
  } catch (e) {
    if (e instanceof ConnectorAuthError) throw new ApiError(422, "token_rejected", "Mercury rejected this token. Nothing was saved");
    if (e instanceof ConnectorUnavailableError) throw new ApiError(503, "connector_unavailable", "Mercury could not be reached, so the token could not be verified. Nothing was saved");
    throw e;
  }
  const patch = { status: "active", scopes: ["transactions:read"], secret_enc: await encryptSecret(input.token, ctx.config.credentialsKey) };
  const row = existing ? (await ctx.repos.table("connector_accounts").update({ id: existing.id }, patch))[0]! : await ctx.repos.table("connector_accounts").insert({ workspace_id: ws.id, provider, ...patch });
  await audit(ctx, "connector.connected", "connector_account", row.id, { provider });
  return accountView(row, provider);
}

export async function disconnect(ctx: ServiceContext, provider: Provider) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: isImportSource(provider) ? KIND_OF[provider] : "funder", roles: ["admin"], person: true });
  if (provider === "slack" || provider === "google_drive" || provider === "salesforce" || provider === "quickbooks") humanOnly(ctx);
  const a = await account(ctx, ws.id, provider);
  if (!a) throw notFound("Connector");
  // An import source's connection lives at Composio too: removed there first, then the row is marked.
  if (isImportSource(provider)) await importSourcePort(ctx, provider)?.disconnect(ws.id).catch(googleWorkspaceError);
  // Without Slack there is nowhere to post: the alert settings go with the connection, at once.
  if (provider === "slack") await ctx.repos.table("alert_subscriptions").remove({ workspace_id: ws.id });
  // Without QuickBooks the sync is off, and stays off until a person turns it on again (services/accounting.ts).
  if (provider === "quickbooks") await ctx.repos.table("accounting_links").update({ workspace_id: ws.id, provider: "quickbooks" }, { sync_enabled: false });
  // Google's credential lives at Composio, so the connection is removed there before the row is marked.
  if (provider === "google_workspace" && ctx.ports.workspaceApps?.disconnect) await ctx.ports.workspaceApps.disconnect(ws.id).catch(googleWorkspaceError);
  await ctx.repos.table("connector_accounts").update({ id: a.id }, { status: "revoked", secret_enc: null });
  await audit(ctx, "connector.disconnected", "connector_account", a.id, { provider });
  return accountView({ ...a, status: "revoked" }, provider);
}

// ---- import sources (Google Sheets, Airtable) through Composio ----

/** Status of an import source. A read never starts a connection; an unreachable Composio reads as not connected. */
async function getImportSource(ctx: ServiceContext, provider: ComposioProvider) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: KIND_OF[provider], roles: ["admin"] });
  const a = await account(ctx, ws.id, provider);
  const port = importSourcePort(ctx, provider);
  if (!port) return { ...accountView(a, provider), status: "not_configured" as const, connectUrl: null };
  const s = await port.status(ws.id).catch((e: unknown) => {
    if (e instanceof ConnectorScopeError || e instanceof ConnectorScopeUnverifiedError || e instanceof ConnectorAuthError || e instanceof ConnectorUnavailableError) return { connected: false, connectUrl: null };
    throw e;
  });
  return { ...accountView(a, provider), connected: s.connected, connectUrl: s.connectUrl };
}

/**
 * Connect an import source: Composio returns a hosted sign-in link for this workspace's entity, with
 * read-only access. The GMS stores no credential; the row keeps the status and the scope names.
 */
async function connectImportSource(ctx: ServiceContext, provider: ComposioProvider, input: z.output<typeof connectorInput>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: KIND_OF[provider], roles: ["admin"], person: true });
  // Connecting an account is a person's act in the GMS: never an agent's or an API client's.
  if (provider === "slack" || provider === "google_drive" || provider === "salesforce" || provider === "quickbooks") humanOnly(ctx);
  if (input.token) throw new ApiError(422, "token_not_accepted", `${IMPORT_LABEL[provider]} is connected by signing in, not with a token`);
  const port = importSourcePort(ctx, provider);
  if (!port) throw new ApiError(503, "connector_not_configured", `${IMPORT_LABEL[provider]} through Composio is not configured on this server`);
  const home = await ctx.repos.table("workspaces").one({ id: ws.id });
  const s = await port.status(ws.id, { link: true, ...(home ? { returnTo: importReturnTo(home.handle, input.returnTo, HOME_OF[provider]) } : {}) }).catch(googleWorkspaceError);
  const existing = await account(ctx, ws.id, provider);
  const patch = { status: s.connected ? "active" : "pending", scopes: IMPORT_SCOPES[provider], external_id: ws.id, secret_enc: null };
  const row = existing ? (await ctx.repos.table("connector_accounts").update({ id: existing.id }, patch))[0]! : await ctx.repos.table("connector_accounts").insert({ workspace_id: ws.id, provider, ...patch });
  await audit(ctx, "connector.connected", "connector_account", row.id, { provider, state: row.status });
  return { ...accountView(row, provider), connected: s.connected, connectUrl: s.connectUrl };
}

/**
 * Pull outbound Mercury transactions newer than the last sync into `bank_transactions`. Stores an
 * amount, a date, a counterparty name and a memo: never an account identifier. Called by the
 * jobs Worker every six hours and by `POST /gms/connectors/mercury/sync`.
 */
export async function syncBank(ctx: ServiceContext, workspaceId: string): Promise<{ fetched: number; added: number }> {
  const a = await account(ctx, workspaceId, "mercury");
  if (!a || a.status !== "active" || !a.secret_enc || !ctx.ports.bank || !ctx.config.credentialsKey) return { fetched: 0, added: 0 };
  let txns;
  try {
    txns = await ctx.ports.bank.listOutbound(await decryptSecret(a.secret_enc, ctx.config.credentialsKey), a.last_sync_at);
  } catch (e) {
    if (e instanceof ConnectorAuthError) await ctx.repos.table("connector_accounts").update({ id: a.id }, { status: "error" });
    if (e instanceof ConnectorAuthError || e instanceof ConnectorUnavailableError) return { fetched: 0, added: 0 };
    throw e;
  }
  let added = 0;
  for (const t of txns) {
    try {
      await ctx.repos.table("bank_transactions").insert({ workspace_id: workspaceId, provider: "mercury", external_txn_id: t.externalId, amount_minor: t.amountMinor, currency: t.currency, posted_at: t.postedAt, counterparty_name: t.counterpartyName, memo: t.memo?.slice(0, 500) ?? null });
      added++;
    } catch (e) {
      if (!(e instanceof RepoError && e.kind === "conflict")) throw e;
    }
  }
  await ctx.repos.table("connector_accounts").update({ id: a.id }, { last_sync_at: ctx.now().toISOString() });
  return { fetched: txns.length, added };
}

export async function syncConnector(ctx: ServiceContext, provider: Provider) {
  const ws = await authorize(ctx, { scope: "payments:release", kind: "funder", roles: ["admin", "finance"] });
  if (provider !== "mercury") throw new ApiError(422, "nothing_to_sync", `${isImportSource(provider) ? IMPORT_LABEL[provider] : "Google Workspace"} has nothing to sync; it is read when you use it`);
  const a = await account(ctx, ws.id, provider);
  if (!a || a.status !== "active") throw new ApiError(409, "not_connected", "Connect Mercury first");
  const out = await syncBank(ctx, ws.id);
  await audit(ctx, "connector.synced", "connector_account", a.id, { provider, ...out });
  return { ...accountView(await account(ctx, ws.id, provider), provider), ...out };
}

/** People in the funder's Google directory, to suggest at invite time. */
export async function suggestMembers(ctx: ServiceContext, query: string) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"] });
  if (!ctx.ports.workspaceApps) return [];
  // Suggestions are a convenience: any connector failure means none, never a failed invite screen.
  try {
    const s = await ctx.ports.workspaceApps.status(ws.id);
    return s.connected ? (await ctx.ports.workspaceApps.listDirectory(ws.id, query)).slice(0, 20) : [];
  } catch (e) {
    if (e instanceof ConnectorScopeError || e instanceof ConnectorScopeUnverifiedError || e instanceof ConnectorAuthError || e instanceof ConnectorUnavailableError) return [];
    throw e;
  }
}

/**
 * The funder's Google directory for invite suggestions, as its own route. Unlike `suggestMembers`
 * it says why there is nothing: not configured, not connected, or a connection that cannot be used.
 */
export async function searchDirectory(ctx: ServiceContext, query: string) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"] });
  if (!ctx.ports.workspaceApps) throw new ApiError(503, "connector_not_configured", "Google Workspace through Composio is not configured on this server");
  const apps = ctx.ports.workspaceApps;
  const s = await apps.status(ws.id).catch(googleWorkspaceError);
  if (!s.connected) throw new ApiError(409, "connector_not_connected", "Connect Google Workspace first");
  return (await apps.listDirectory(ws.id, query.slice(0, 200)).catch(googleWorkspaceError)).slice(0, 20);
}

export const driveExportInput = z
  .object({
    /** `letter`: an award's letter. `agreement`: an agreement (executed once executed). `snapshot`: an application as submitted. */
    documentKind: z.enum(["letter", "agreement", "snapshot"]),
    /** The award, agreement or application id, prefixed or bare. */
    subjectId: z.string().min(1).max(100),
    /** The Drive folder the person chose in the Google Picker. */
    folderId: z.string().regex(/^[A-Za-z0-9_-]{10,128}$/),
  })
  .strict();

const SUBJECT = { letter: "award", agreement: "agreement", snapshot: "application" } as const;

/** An application as a funder may read it, printed form by form. */
async function snapshotPdf(ctx: ServiceContext, applicationId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  // The detail read authorizes the caller and applies reviewer masking; the rows below only add names.
  const detail = await getApplicationDetail(ctx, applicationId);
  const app = await ctx.repos.table("applications").one({ id: applicationId });
  const [funder, applicant, opportunity] = await Promise.all([
    ctx.repos.table("workspaces").one({ id: ctx.workspace!.id }),
    app ? ctx.repos.table("workspaces").one({ id: app.applicant_workspace_id }) : null,
    app ? ctx.repos.table("opportunities").one({ id: app.opportunity_id }) : null,
  ]);
  const forms: SnapshotForm[] = detail.formResponses.map((r) => ({ title: r.formTitle ?? "Form", status: r.status, fields: Object.entries(r.response ?? {}).map(([k, v]): [string, string] => [k, printValue(v)]) }));
  const bytes = await renderApplicationSnapshot(
    { title: detail.title ?? "Application", applicant: applicant?.display_name ?? "Applicant", opportunity: opportunity?.title ?? "", submittedAt: detail.submittedAt ?? null, verificationLevel: detail.verificationLevelAtSubmit ?? null, forms },
    { funderName: funder?.display_name ?? "", accent: (funder?.brand as { accent?: string } | null)?.accent, createdAt: detail.submittedAt ?? ctx.now().toISOString(), reference: apiId("application", applicationId) },
  );
  return { bytes, filename: `application-${apiId("application", applicationId)}.pdf` };
}

/**
 * Save an award letter, an agreement or an application snapshot as a PDF into a Drive folder the
 * person picked. The file is rendered (or loaded) by the same services that serve the download,
 * so the caller must be able to read the record; nothing but the PDF leaves the GMS.
 */
export async function exportToDrive(ctx: ServiceContext, input: z.output<typeof driveExportInput>) {
  const ws = await authorize(ctx, { scope: input.documentKind === "snapshot" ? "applications:read" : "awards:read", kind: "funder", roles: ["admin", "program_officer"], person: true });
  if (!ctx.ports.workspaceApps) throw new ApiError(503, "connector_not_configured", "Google Workspace through Composio is not configured on this server");
  const id = uuidOf(SUBJECT[input.documentKind], input.subjectId, input.documentKind === "snapshot" ? "Application" : input.documentKind === "letter" ? "Award" : "Agreement");
  const file = input.documentKind === "letter" ? await awardLetterPdf(ctx, id) : input.documentKind === "agreement" ? await agreementPdf(ctx, id) : await snapshotPdf(ctx, id);
  let saved;
  try {
    saved = await ctx.ports.workspaceApps.exportToDrive(ws.id, { name: file.filename, bytes: file.bytes, folderId: input.folderId });
  } catch (e) {
    // A folder that was not picked, or a connection without Drive access, is the person's to fix.
    if (e instanceof ConnectorAuthError) throw new ApiError(409, "drive_folder_unavailable", "Google Drive would not take the file. Connect Google Workspace, then choose the folder again in the Google Picker");
    googleWorkspaceError(e);
  }
  await audit(ctx, "connector.drive_export", SUBJECT[input.documentKind], id, { provider: "google_workspace", documentKind: input.documentKind, fileName: file.filename, driveFileId: saved.id ?? null, bytes: file.bytes.byteLength });
  return { documentKind: input.documentKind, subjectId: apiId(SUBJECT[input.documentKind], id), fileId: saved.id ?? null, fileName: file.filename, name: file.filename, url: saved.url };
}

// ---- Google Drive (applicants): attach a picked file, save the as-submitted PDF ----

/** The largest upload any attachment picker takes (applications, outside applications, the vault). */
export const MAX_DRIVE_ATTACH_BYTES = 25 * 1024 * 1024;
/** Who uses an applicant's Drive connection: the roles that may add files. */
const DRIVE_ROLES = ["admin", "editor", "finance"] as const;

export const driveFetchInput = z.object({ fileId: z.string().regex(DRIVE_FILE_ID) }).strict();
export const driveSaveInput = z
  .object({
    /** `application`: an application submitted on this GMS. `outside`: an outside application's as-submitted PDF. */
    kind: z.enum(["application", "outside"]),
    id: z.string().min(1).max(100),
    /** A folder the person chose in the Google Picker; My Drive when omitted. */
    folderId: z.string().regex(DRIVE_FILE_ID).optional(),
  })
  .strict();

function drivePort(ctx: ServiceContext) {
  if (!ctx.ports.drive) throw new ApiError(503, "connector_not_configured", "Google Drive through Composio is not configured on this server");
  return ctx.ports.drive;
}

function driveError(e: unknown): never {
  if (e instanceof DriveFileRefusedError) throw new ApiError(e.reason === "too_large" ? 413 : 422, `drive_${e.reason}`, e.message);
  if (e instanceof ConnectorAuthError) throw new ApiError(409, "drive_not_connected", "Connect Google Drive first (Settings, Connected apps)");
  googleWorkspaceError(e);
}

/**
 * Copy a file the person picked in the Google Picker, for an upload. The bytes come back to the
 * browser, which hands them to the same upload as a file from the computer, with the same size
 * and type checks. Nothing is stored here. A person only.
 */
export async function fetchFromDrive(ctx: ServiceContext, body: unknown) {
  const ws = await authorize(ctx, { scope: "applications:write", kind: "applicant", roles: DRIVE_ROLES, person: true });
  humanOnly(ctx);
  // Authorized before the body is read: a caller who may not gets 403, never 400.
  const input = parse(driveFetchInput, body);
  const file = await drivePort(ctx).download(ws.id, input.fileId, MAX_DRIVE_ATTACH_BYTES).catch(driveError);
  await audit(ctx, "connector.drive_copied", "workspace", ws.id, { provider: "google_drive", bytes: file.bytes.byteLength, mime: file.mimeType });
  return file;
}

/** An application this workspace submitted on the GMS, printed form by form as it was submitted. */
async function submittedApplicationPdf(ctx: ServiceContext, wsId: string, rawId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const id = uuidOf("application", rawId, "Application");
  const app = await ctx.repos.table("applications").one({ id, applicant_workspace_id: wsId });
  if (!app) throw notFound("Application");
  if (!app.submitted_at) throw new ApiError(409, "not_submitted", "This application has not been submitted yet");
  const [me, funder, opportunity, responses] = await Promise.all([
    ctx.repos.table("workspaces").one({ id: wsId }),
    ctx.repos.table("workspaces").one({ id: app.workspace_id }),
    ctx.repos.table("opportunities").one({ id: app.opportunity_id }),
    ctx.repos.table("form_responses").find({ application_id: app.id }, { orderBy: "created_at" }),
  ]);
  const forms = responses.length ? await ctx.repos.table("forms").find({ id: [...new Set(responses.map((r) => r.form_id))] }) : [];
  const printed: SnapshotForm[] = responses
    .filter((r) => r.status !== "draft")
    .map((r) => ({ title: forms.find((f) => f.id === r.form_id)?.title ?? "Form", status: r.status, fields: Object.entries((r.response ?? {}) as Record<string, unknown>).map(([k, v]): [string, string] => [k, printValue(v)]) }));
  const bytes = await renderApplicationSnapshot(
    { title: app.title ?? "Application", applicant: me?.display_name ?? "Applicant", opportunity: opportunity?.title ?? "", submittedAt: app.submitted_at, verificationLevel: app.verification_level_at_submit ?? null, forms: printed },
    { funderName: funder?.display_name ?? "", createdAt: app.submitted_at, reference: apiId("application", app.id) },
  );
  return { bytes, filename: `As submitted - ${(app.title ?? "Application").slice(0, 150)}.pdf` };
}

/**
 * "Save the as-submitted packet to Drive": the PDF of what was submitted, created in the person's
 * Drive through `drive.file` (My Drive, or a folder they picked). A person only.
 */
export async function saveToDrive(ctx: ServiceContext, body: unknown) {
  const ws = await authorize(ctx, { scope: "applications:read", kind: "applicant", roles: DRIVE_ROLES, person: true });
  humanOnly(ctx);
  const input = parse(driveSaveInput, body);
  const port = drivePort(ctx);
  let file: { bytes: Uint8Array; filename: string };
  if (input.kind === "outside") {
    const row = await ctx.repos.table("outside_applications").one({ id: input.id.replace(/^oap_/, ""), workspace_id: ws.id });
    if (!row) throw notFound("Outside application");
    if (!row.snapshot_document_id) throw new ApiError(409, "not_submitted", "Record the submission first: the as-submitted copy is made then");
    const doc = await outsideDocumentFile(ctx, row.id, "snapshot");
    file = { bytes: doc.bytes, filename: doc.filename };
  } else file = await submittedApplicationPdf(ctx, ws.id, input.id);
  const saved = await port.savePdf(ws.id, { name: file.filename, bytes: file.bytes, ...(input.folderId ? { folderId: input.folderId } : {}) }).catch(driveError);
  await audit(ctx, "connector.drive_saved", input.kind === "outside" ? "outside_application" : "application", input.kind === "outside" ? input.id.replace(/^oap_/, "") : uuidOf("application", input.id, "Application"), { provider: "google_drive", fileName: file.filename, driveFileId: saved.id, bytes: file.bytes.byteLength });
  return { fileId: saved.id, fileName: file.filename, url: saved.url };
}

export { apiId };
