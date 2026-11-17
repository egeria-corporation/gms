// SPDX-License-Identifier: AGPL-3.0-only
// Importing grant history straight from Fluxx or Zengine (v1.9.0), with the funder's own
// credentials, read-only. A workspace admin connects (the credentials are checked with one read,
// then stored encrypted under CREDENTIALS_ENCRYPTION_KEY in connector_accounts); every pull then
// goes through the import wizard's dry run and commit (./imports.ts), at most 5,000 rows a run,
// resuming where the last run stopped. The credentials are deleted when an import has read the
// source to its end and finished, when the person disconnects, or after a week unused.
//
// The pullers (@gms/connectors, pullers.ts) only ever read, and name every field they read.
import { ConnectorAuthError, ConnectorRateLimitedError, ConnectorUnavailableError, FluxxPuller, fluxxBaseUrl, SourceReadError, ZenginePuller, type FluxxCredentials, type PullerProvider, type PullResult } from "@gms/connectors";
import { FLUXX, MAX_IMPORT_ROWS, tableFromRecords, ZENGINE, type SourceTable } from "@gms/importers";
import { decryptSecret, encryptSecret } from "@gms/passport-client";
import { z } from "zod";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import { audit, authorize, type ServiceContext, type ServiceWorkspace } from "./context.ts";
import type { Row } from "./repos/types.ts";

/** Stored credentials not used for this long are deleted at the next look. */
export const PULLER_CREDENTIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LABEL: Record<PullerProvider, string> = { fluxx: "Fluxx", zengine: "Zengine" };
/** What the connector_accounts row records: what may be read, never a credential. */
const SCOPES: Record<PullerProvider, string[]> = { fluxx: ["grant_request:read", "request_transaction:read", "request_report:read", "organization:read"], zengine: ["forms:read", "records:read"] };

/** One puller of each kind per isolate, so Zengine's rate window holds across requests. */
let defaults: { fluxx: FluxxPuller; zengine: ZenginePuller } | null = null;
export const pullersOf = (ctx: Pick<ServiceContext, "ports">) => ctx.ports.pullers ?? (defaults ??= { fluxx: new FluxxPuller(), zengine: new ZenginePuller() });

export const pullerProviderInput = z.enum(["fluxx", "zengine"]);
export const pullerConnectInput = z.union([
  z.object({ instanceUrl: z.string().trim().min(3).max(300), clientId: z.string().trim().min(1).max(500), clientSecret: z.string().trim().min(1).max(500) }).strict(),
  z.object({ token: z.string().trim().min(8).max(4000) }).strict(),
]);

type Account = Row<"connector_accounts">;

/** Who connects and uses a puller: a funder workspace's admin, signed in. The same check for every client. */
const admin = (ctx: ServiceContext): Promise<ServiceWorkspace> => authorize(ctx, { scope: "workspace:admin", kind: "funder", roles: ["admin"], person: true });
/** Giving the GMS (or taking away) credentials to another system changes access: a person does it, never an agent or API client. */
const personOnly = (ctx: ServiceContext) => {
  if (ctx.actor.kind !== "user") throw forbidden("human_only", "A person connects or disconnects a grants system, on the import screen");
};

const expired = (ctx: ServiceContext, a: Account) => ctx.now().getTime() - Math.max(Date.parse(a.updated_at), a.last_sync_at ? Date.parse(a.last_sync_at) : 0) > PULLER_CREDENTIAL_TTL_MS;

/** The stored account, if it is still usable. An expired one is deleted here. */
async function usable(ctx: ServiceContext, wsId: string, provider: PullerProvider): Promise<Account | null> {
  const a = await ctx.repos.table("connector_accounts").one({ workspace_id: wsId, provider });
  if (!a) return null;
  if (a.status !== "active" || !a.secret_enc) return null;
  if (expired(ctx, a)) {
    await deleteCredentials(ctx, wsId, provider, "unused");
    return null;
  }
  return a;
}

/** Delete a puller's stored credentials (the row goes; only the audit line says it existed). */
export async function deleteCredentials(ctx: ServiceContext, wsId: string, provider: PullerProvider, why: "finished" | "disconnected" | "unused") {
  const a = await ctx.repos.table("connector_accounts").one({ workspace_id: wsId, provider });
  if (!a) return false;
  await ctx.repos.table("connector_accounts").remove({ id: a.id, workspace_id: wsId });
  await audit(ctx, "connector.credentials_deleted", "connector_account", a.id, { provider, why }, wsId);
  return true;
}

const view = (provider: PullerProvider, a: Account | null, configured: boolean) => ({
  provider,
  label: LABEL[provider],
  configured,
  connected: !!a,
  /** Fluxx: the instance address. Never a credential. */
  instance: provider === "fluxx" && a ? (a.external_id ?? null) : null,
  connectedAt: a?.updated_at ?? null,
  lastReadAt: a?.last_sync_at ?? null,
});

/** Whether Fluxx and Zengine can be used here (the server can store credentials) and whether each is connected. */
export async function pullerSources(ctx: ServiceContext, wsId: string) {
  const configured = !!ctx.config.credentialsKey;
  const out = [];
  for (const p of ["fluxx", "zengine"] as const) out.push(view(p, configured ? await usable(ctx, wsId, p) : null, configured));
  return out;
}

export async function getPullerConnection(ctx: ServiceContext, provider: PullerProvider) {
  const ws = await admin(ctx);
  return view(provider, ctx.config.credentialsKey ? await usable(ctx, ws.id, provider) : null, !!ctx.config.credentialsKey);
}

function connectError(e: unknown, provider: PullerProvider): never {
  if (e instanceof ConnectorAuthError) throw new ApiError(422, "credentials_rejected", provider === "fluxx" ? "Fluxx did not accept this application id and secret. Nothing was saved" : "Zengine did not accept this access token. Nothing was saved");
  if (e instanceof SourceReadError) throw new ApiError(422, "invalid_instance", e.message);
  if (e instanceof ConnectorRateLimitedError) throw rateLimited(e);
  if (e instanceof ConnectorUnavailableError) throw new ApiError(503, "connector_unavailable", `${LABEL[provider]} could not be reached, so the credentials could not be checked. Nothing was saved`);
  throw e;
}

const rateLimited = (e: ConnectorRateLimitedError) => new ApiError(429, "source_rate_limited", `${LABEL[e.provider]} asks the GMS to wait about ${Math.max(1, Math.ceil(e.retryAfterSeconds / 60))} minute${e.retryAfterSeconds > 60 ? "s" : ""} before reading more. Nothing was imported; try again then`);

/**
 * Connect Fluxx (the instance address and the OAuth application's id and secret) or Zengine (an
 * access token). Checked with one read first; stored encrypted; returned never.
 */
export async function connectPuller(ctx: ServiceContext, provider: PullerProvider, input: z.output<typeof pullerConnectInput>) {
  personOnly(ctx);
  const ws = await admin(ctx);
  if (!ctx.config.credentialsKey) throw new ApiError(503, "credentials_not_configured", "This server cannot store credentials (CREDENTIALS_ENCRYPTION_KEY is not set)");
  const pullers = pullersOf(ctx);
  let secret: string;
  let externalId: string | null = null;
  if (provider === "fluxx") {
    if (!("instanceUrl" in input)) throw new ApiError(422, "bad_request", "Fluxx is connected with your Fluxx address and the application id and secret");
    const instance = fluxxBaseUrl(input.instanceUrl);
    if (!instance) throw new ApiError(422, "invalid_instance", "Paste your Fluxx address. It looks like https://yourfoundation.fluxx.io");
    const creds: FluxxCredentials = { instanceUrl: instance, clientId: input.clientId, clientSecret: input.clientSecret };
    await pullers.fluxx.verify(creds).catch((e: unknown) => connectError(e, provider));
    secret = JSON.stringify(creds);
    externalId = instance;
  } else {
    if (!("token" in input)) throw new ApiError(422, "bad_request", "Zengine is connected with an access token");
    await pullers.zengine.verify(input.token).catch((e: unknown) => connectError(e, provider));
    secret = JSON.stringify({ token: input.token });
  }
  const patch = { status: "active", scopes: SCOPES[provider], external_id: externalId, secret_enc: await encryptSecret(secret, ctx.config.credentialsKey), last_sync_at: null };
  const existing = await ctx.repos.table("connector_accounts").one({ workspace_id: ws.id, provider });
  const row = existing ? (await ctx.repos.table("connector_accounts").update({ id: existing.id }, patch))[0]! : await ctx.repos.table("connector_accounts").insert({ workspace_id: ws.id, provider, ...patch });
  await audit(ctx, "connector.connected", "connector_account", row.id, { provider, ...(externalId ? { instance: externalId } : {}) });
  return view(provider, row, true);
}

export async function disconnectPuller(ctx: ServiceContext, provider: PullerProvider) {
  personOnly(ctx);
  const ws = await admin(ctx);
  if (!(await deleteCredentials(ctx, ws.id, provider, "disconnected"))) throw notFound("Connection");
  return view(provider, null, !!ctx.config.credentialsKey);
}

async function credentials<T>(ctx: ServiceContext, wsId: string, provider: PullerProvider): Promise<{ account: Account; value: T }> {
  if (!ctx.config.credentialsKey) throw new ApiError(503, "import_source_not_configured", `Importing from ${LABEL[provider]} is not set up on this server`);
  const account = await usable(ctx, wsId, provider);
  if (!account) throw new ApiError(409, "source_not_connected", `Connect ${LABEL[provider]} first`);
  return { account, value: JSON.parse(await decryptSecret(account.secret_enc!, ctx.config.credentialsKey)) as T };
}

/** A failed pull, in plain words. The stored credentials stay unless the source rejected them. */
async function pullError(ctx: ServiceContext, wsId: string, provider: PullerProvider, e: unknown): Promise<never> {
  if (e instanceof ConnectorAuthError) {
    // Rejected credentials are no use to anyone: they go now.
    await deleteCredentials(ctx, wsId, provider, "disconnected");
    throw new ApiError(409, "source_not_connected", `${LABEL[provider]} no longer accepts the saved credentials, so they were deleted. Connect again`);
  }
  if (e instanceof ConnectorRateLimitedError) throw rateLimited(e);
  if (e instanceof SourceReadError) throw new ApiError(422, "source_not_readable", e.message);
  if (e instanceof ConnectorUnavailableError) throw new ApiError(503, "connector_unavailable", `${LABEL[provider]} could not be reached. Nothing was read; try again in a few minutes`);
  throw e;
}

/** The forms a Zengine token can read, by workspace, for the person to choose one. */
export async function zengineForms(ctx: ServiceContext) {
  const ws = await admin(ctx);
  const { value } = await credentials<{ token: string }>(ctx, ws.id, "zengine");
  return pullersOf(ctx).zengine.listForms(value.token).catch((e: unknown) => pullError(ctx, ws.id, "zengine", e));
}

export interface PulledSource {
  table: SourceTable;
  label: string;
  ref: string;
  nextPage: number | null;
  total: number | null;
  startPage: number;
}

const range = (start: number, rows: number, total: number | null, perPage = 100) => {
  const first = (start - 1) * perPage + 1;
  return `records ${first.toLocaleString("en-US")}–${(first + rows - 1).toLocaleString("en-US")}${total !== null ? ` of ${total.toLocaleString("en-US")}` : ""}`;
};

/**
 * Read one run's worth of rows from Fluxx or Zengine (at most 5,000, from `startPage`). Nothing
 * pulled is stored here: the caller screens the table first, as for a file.
 */
export async function pullSource(ctx: ServiceContext, wsId: string, src: { kind: "fluxx"; startPage?: number | undefined } | { kind: "zengine"; formId: string; startPage?: number | undefined }, target?: string): Promise<PulledSource> {
  // Pulls are a funder admin's, signed in, whoever calls the import routes.
  if (ctx.workspace?.kind !== "funder") throw new ApiError(422, "bad_request", `${LABEL[src.kind]} imports grant history into a funder workspace`);
  const startPage = src.startPage ?? 1;
  let pulled: PullResult;
  let account: Account;
  let label: string;
  let ref: string;
  if (src.kind === "fluxx") {
    const c = await credentials<FluxxCredentials>(ctx, wsId, "fluxx");
    account = c.account;
    // Past reports read Fluxx's request_report; every other target reads grant requests.
    const reports = target === "history_reports";
    const opts = { startPage, maxRows: MAX_IMPORT_ROWS };
    pulled = await (reports ? pullersOf(ctx).fluxx.pullReports(c.value, opts) : pullersOf(ctx).fluxx.pullGrantHistory(c.value, opts)).catch((e: unknown) => pullError(ctx, wsId, "fluxx", e));
    const host = new URL(c.value.instanceUrl).hostname;
    label = `Fluxx · ${host} · ${reports ? "reports" : "grant requests"}`;
    ref = `fluxx:${host}`;
  } else {
    const c = await credentials<{ token: string }>(ctx, wsId, "zengine");
    account = c.account;
    pulled = await pullersOf(ctx).zengine.pullRecords(c.value.token, { formId: src.formId, startPage, maxRows: MAX_IMPORT_ROWS }).catch((e: unknown) => pullError(ctx, wsId, "zengine", e));
    label = `Zengine · form ${src.formId}`;
    ref = `zengine:form:${src.formId}`;
  }
  await ctx.repos.table("connector_accounts").update({ id: account.id }, { last_sync_at: ctx.now().toISOString() });
  if (!pulled.records.length) throw new ApiError(422, "empty_source", startPage > 1 ? `${LABEL[src.kind]} has no more records after the ones imported` : `${LABEL[src.kind]} returned no records`);
  return { table: tableFromRecords(pulled.records, pulled.columns), label: `${label} (${range(startPage, pulled.records.length, pulled.total)})`, ref, nextPage: pulled.nextPage, total: pulled.total, startPage };
}

/** The adapter a pulled source is read with. */
export const pullerAdapter = (kind: PullerProvider) => (kind === "fluxx" ? FLUXX : ZENGINE);
