// SPDX-License-Identifier: AGPL-3.0-only
// Workspace integrations (build spec §9.2 "Integrations", §10.10): outbound webhooks, API
// clients, MCP connections, funder-registered MCP servers, and the Mercury / Google Workspace
// connectors. Every secret is shown once at creation or stored as ciphertext; none is returned.
import { ConnectorAuthError, ConnectorUnavailableError, isRegistrableMcpUrl } from "@gms/connectors";
import { decryptSecret, encryptSecret } from "@gms/passport-client";
import { WEBHOOK_EVENT_TYPES, encryptSecret as encryptWebhookSecret, generateWebhookSecret, isDeliverableUrl } from "@gms/webhooks";
import { z } from "zod";
import { generateClientSecret, hashSecret } from "../auth/crypto.ts";
import { SCOPES, scopesForRole, type Scope } from "../auth/scopes.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { apiId } from "../lib/ids.ts";
import { audit, authorize, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import { RepoError, type Row } from "./repos/types.ts";

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

export const PROVIDERS = ["mercury", "google_workspace"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const connectorInput = z.object({ token: z.string().min(8).max(4000).optional() }).strict();

const accountView = (a: Row<"connector_accounts"> | null, provider: Provider) => ({ provider, connected: !!a && a.status === "active", status: a?.status ?? "not_connected", scopes: a?.scopes ?? [], lastSyncAt: a?.last_sync_at ?? null });

export function providerOf(value: string | undefined): Provider {
  if (!value || !(PROVIDERS as readonly string[]).includes(value)) throw notFound("Connector");
  return value as Provider;
}

const account = (ctx: ServiceContext, wsId: string, provider: Provider) => ctx.repos.table("connector_accounts").one({ workspace_id: wsId, provider });

export async function getConnector(ctx: ServiceContext, provider: Provider) {
  const ws = await authorize(ctx, { scope: "payments:read", kind: "funder", roles: ["admin", "finance"] });
  const a = await account(ctx, ws.id, provider);
  if (provider === "google_workspace" && ctx.ports.workspaceApps) {
    const s = await ctx.ports.workspaceApps.status(ws.id);
    return { ...accountView(a, provider), connected: s.connected, connectUrl: s.connectUrl };
  }
  return accountView(a, provider);
}

/**
 * Connect a provider. Mercury: a read-only API token, verified by one read and stored encrypted;
 * it is used only to list outbound transactions for reconciliation. Google Workspace: the
 * connection lives at Composio (entity = this workspace); the GMS stores no Google credential.
 */
export async function connect(ctx: ServiceContext, provider: Provider, input: z.output<typeof connectorInput>) {
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
  const existing = await account(ctx, ws.id, provider);
  if (provider === "google_workspace") {
    if (!ctx.ports.workspaceApps) throw new ApiError(503, "connector_not_configured", "Google Workspace through Composio is not configured on this server");
    const s = await ctx.ports.workspaceApps.status(ws.id);
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
  const ws = await authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
  const a = await account(ctx, ws.id, provider);
  if (!a) throw notFound("Connector");
  await ctx.repos.table("connector_accounts").update({ id: a.id }, { status: "revoked", secret_enc: null });
  await audit(ctx, "connector.disconnected", "connector_account", a.id, { provider });
  return accountView({ ...a, status: "revoked" }, provider);
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
  if (provider !== "mercury") throw new ApiError(422, "nothing_to_sync", "Google Workspace has nothing to sync; it is read when you use it");
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
  const s = await ctx.ports.workspaceApps.status(ws.id);
  return s.connected ? (await ctx.ports.workspaceApps.listDirectory(ws.id, query)).slice(0, 20) : [];
}

export { apiId };
