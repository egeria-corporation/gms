// SPDX-License-Identifier: AGPL-3.0-only
// The service layer's contract. Every REST route and every MCP tool builds a ServiceContext and
// calls a service function; a service function starts with `authorize(ctx, need)` and is the only
// code that reads or writes data. One layer, one authorization check (CLAUDE.md).
import type { LlmClient } from "@gms/assist";
import type { BankFeed, McpDirectory, WorkspaceApps } from "@gms/connectors";
import { formatActor, record, type Actor, type LedgerStore } from "@gms/ledger";
import type { Mailer } from "@gms/notify";
import type { FetchLike } from "@gms/passport-client";
import { fanOut, isWebhookEventType, type WebhookStore } from "@gms/webhooks";
import type { Scope, WorkspaceKind } from "../auth/scopes.ts";
import { forbidden } from "../auth/verify.ts";
import { ApiError, notFound } from "../lib/errors.ts";
import type { FileStorage, OpenGrantsClient, UserDirectory } from "./ports.ts";
import { RepoError, type Repos } from "./repos/types.ts";

export interface ServiceActor {
  /** `system` and `passport` are never built from a request: jobs and verified Passport webhooks only. */
  kind: "user" | "client" | "delegated" | "system" | "passport";
  userId: string | null;
  clientId: string | null;
  /** The ledger actor: `user:<id>`, `client:<id>` or `user:<id>/client:<id>`. */
  ledger: Actor;
  id: string;
}

export interface ServiceWorkspace {
  id: string;
  kind: WorkspaceKind;
  /** The person's role; null for a client-credentials token. */
  role: string | null;
  /** Consultant / external reviewer restrictions from the membership. */
  memberScope: Record<string, unknown> | null;
}

export interface ServiceConfig {
  /** GMS_BASE_URL and WEB_BASE_URL, without trailing slashes. */
  baseUrl: string;
  webBaseUrl: string;
  passportBaseUrl: string | null;
  /** CREDENTIALS_ENCRYPTION_KEY; null when the install has not configured Passport linking. */
  credentialsKey: string | null;
  /** Injected in tests (recorded fixtures); the platform `fetch` otherwise. */
  passportFetch?: FetchLike;
  /** The GMS's own Passport client ("OpenGrants GMS"), used for applicant consent; null when not configured. */
  passportClient: { id: string; secret: string } | null;
  /** RESEND_FROM; null when outbound mail is not configured. */
  mailFrom: string | null;
  /** WEBHOOK_SECRET_KEY: encrypts outbound webhook signing secrets; null when not configured. */
  webhookSecretKey?: string | null;
  /** PASSPORT_WEBHOOK_SECRET and RESEND_INBOUND_SECRET, for verifying inbound deliveries. */
  passportWebhookSecret?: string | null;
  resendInboundSecret?: string | null;
  /** The domain inbound replies are addressed to (`thread+<id>@domain`); defaults to the domain of RESEND_FROM. */
  inboundDomain?: string | null;
  /** Mirror accepted awards into Passport (`POST /passport/funders/{orgId}/awards`). Off until Passport serves the route. */
  passportAwardWrite?: boolean;
  /** ASSISTANT_ENABLED. When false the assist routes answer 404 and the web app hides its panels. */
  assistantEnabled?: boolean;
}

/** Outbound side effects a service may cause. Each is optional: a missing port degrades, it never throws. */
export interface ServicePorts {
  mailer?: Mailer;
  /** Read-only bank feed for reconciliation (Mercury). */
  bank?: BankFeed;
  /** The funder's Google Workspace through Composio. */
  workspaceApps?: WorkspaceApps;
  /** Tool listing for funder-registered MCP servers. */
  mcpDirectory?: McpDirectory;
  /** Where export bundles and ledger archives are written. */
  exports?: { put(key: string, body: string, contentType: string): Promise<void> };
  storage?: FileStorage;
  openGrants?: OpenGrantsClient;
  /** Names and emails for member lists. */
  directory?: UserDirectory;
  /** The model behind the drafting assistant (Anthropic API). */
  llm?: LlmClient;
}

export interface ServiceContext {
  actor: ServiceActor;
  /** Null only for the few actions a signed-in person takes before choosing a workspace. */
  workspace: ServiceWorkspace | null;
  scopes: readonly string[];
  repos: Repos;
  ledger: LedgerStore;
  webhooks: WebhookStore;
  now: () => Date;
  config: ServiceConfig;
  ports: ServicePorts;
}

export function makeActor(kind: "user" | "client" | "delegated", userId: string | null, clientId: string | null): ServiceActor {
  const ledger: Actor = kind === "user" ? { kind, userId: userId! } : kind === "client" ? { kind, clientId: clientId! } : { kind, userId: userId!, clientId: clientId! };
  return { kind, userId, clientId, ledger, id: formatActor(ledger) };
}

/** The parts of a ServiceContext that exist without a caller: what jobs and inbound webhooks start from. */
export type BaseContext = Pick<ServiceContext, "repos" | "ledger" | "webhooks" | "now" | "config" | "ports">;

/**
 * A context for work no person asked for: a cron job (`system:<job>`) or a verified Passport event.
 * It carries no scopes, so `authorize` refuses it; only the job and webhook services accept it.
 */
export function systemContext(base: BaseContext, who: { job: string } | "passport", workspace: { id: string; kind: WorkspaceKind } | null): ServiceContext {
  const ledger: Actor = who === "passport" ? { kind: "passport" } : { kind: "system", job: who.job };
  return { ...base, actor: { kind: ledger.kind as "system" | "passport", userId: null, clientId: null, ledger, id: formatActor(ledger) }, workspace: workspace ? { ...workspace, role: null, memberScope: null } : null, scopes: [] };
}

export interface Need {
  /** The scope the action requires. Omit only for person-level actions with no workspace. */
  scope?: Scope;
  /** The workspace kind the action belongs to. */
  kind?: WorkspaceKind;
  /** People only: the role must be one of these. Tokens are bound by `scope`. */
  roles?: readonly string[];
  /** The action must be taken by a signed-in person (never a client-credentials token). */
  person?: boolean;
  /**
   * The workspace that owns the record being touched. It must be the caller's workspace, unless
   * `consent` names an applicant → funder consent that lets the caller's workspace read it.
   */
  owner?: string | null;
  consent?: { applicantWorkspaceId: string; funderWorkspaceId: string };
  /** What the record is called in the 404 a caller gets for someone else's record. */
  what?: string;
}

/**
 * The one authorization check. Scope, role, workspace kind and ownership, with cross-workspace
 * reads allowed only through a live row in `consents`. Returns the caller's workspace.
 * A record that belongs to another workspace answers 404, never 403, so ids cannot be probed.
 */
export async function authorize(ctx: ServiceContext, need: Need & { scope: Scope }): Promise<ServiceWorkspace>;
export async function authorize(ctx: ServiceContext, need: Need): Promise<ServiceWorkspace | null>;
export async function authorize(ctx: ServiceContext, need: Need): Promise<ServiceWorkspace | null> {
  if (need.person && !ctx.actor.userId) throw forbidden("person_required", "This action must be taken by a signed-in person");
  const ws = ctx.workspace;
  if (need.scope) {
    if (!ws) throw forbidden("workspace_required", "Name a workspace for this action");
    if (!ctx.scopes.includes(need.scope)) throw forbidden("insufficient_scope", `This action needs the ${need.scope} scope`, need.scope);
  } else if (!ctx.actor.userId) {
    // No scope names the action, so it is one only a signed-in person takes (onboarding, switching).
    throw forbidden("person_required", "This action must be taken by a signed-in person");
  }
  if (!ws) {
    if (need.kind || need.roles || need.owner !== undefined) throw forbidden("workspace_required", "Name a workspace for this action");
    return null;
  }
  if (need.kind && ws.kind !== need.kind) throw forbidden("wrong_workspace_kind", `This action belongs to ${need.kind} workspaces`);
  if (need.roles && ws.role !== null && !need.roles.includes(ws.role)) throw forbidden("insufficient_role", `This needs one of these roles: ${need.roles.join(", ")}`);
  if (need.owner !== undefined && need.owner !== ws.id) {
    const c = need.consent;
    const party = c && (c.applicantWorkspaceId === ws.id || c.funderWorkspaceId === ws.id);
    const live = party ? await ctx.repos.table("consents").one({ applicant_workspace_id: c.applicantWorkspaceId, funder_workspace_id: c.funderWorkspaceId, revoked_at: null }) : null;
    if (!live) throw notFound(need.what ?? "Resource");
  }
  return ws;
}

/** Append one ledger event for the caller's workspace (or `workspaceId` when it is being created). */
export async function audit(ctx: ServiceContext, eventType: string, subjectType: string, subjectId: string, data: Record<string, unknown> = {}, workspaceId?: string): Promise<void> {
  await record(ctx.ledger, { workspaceId: workspaceId ?? ctx.workspace?.id ?? null, actor: ctx.actor.ledger, eventType, subjectType, subjectId, data }, { now: ctx.now });
}

/** Fan an event out to the workspace's webhook subscriptions. Unknown event types are not sent. */
export async function emit(ctx: ServiceContext, type: string, data: Record<string, unknown>): Promise<void> {
  if (!ctx.workspace || !isWebhookEventType(type)) return;
  await fanOut({ id: crypto.randomUUID(), type, workspaceId: ctx.workspace.id, occurredAt: ctx.now().toISOString(), data }, { store: ctx.webhooks, now: ctx.now });
}

export interface StatusChange {
  /** Ledger event, e.g. `opportunity.published`. */
  event: string;
  subjectType: string;
  subjectId: string;
  current: string;
  from: readonly string[];
  to: string;
  /** Human-readable refusal, or null. Checked after `from`. */
  guard?: () => string | null | Promise<string | null>;
  write: () => Promise<void>;
  /** Webhook event type, when subscribers hear about this change. */
  webhook?: string;
  data?: Record<string, unknown>;
}

/**
 * guard → write → ledger → webhook for records that have no machine in `@gms/workflow`
 * (opportunities, competitions). Applications, awards, agreements, tranches and requirements use
 * their machines through `workflowPorts`.
 */
export async function changeStatus(ctx: ServiceContext, c: StatusChange): Promise<void> {
  if (!c.from.includes(c.current)) throw new ApiError(409, "invalid_transition", `This ${c.subjectType} is ${c.current.replace(/_/g, " ")}; it must be ${c.from.join(" or ")}`);
  const refusal = (await c.guard?.()) ?? null;
  if (refusal) throw new ApiError(409, "guard_failed", refusal);
  await c.write();
  const data = { from: c.current, to: c.to, ...(c.data ?? {}) };
  await audit(ctx, c.event, c.subjectType, c.subjectId, data);
  if (c.webhook) await emit(ctx, c.webhook, { subjectType: c.subjectType, subjectId: c.subjectId, ...data });
}

/** Ports for a `@gms/workflow` machine: the caller supplies the write, ledger and webhooks are wired here. */
export function workflowPorts(ctx: ServiceContext, write: (change: { subjectType: string; subjectId: string; from: string; to: string; patch: Record<string, unknown> }) => Promise<void>) {
  return {
    write,
    ledger: (e: { eventType: string; subjectType: string; subjectId: string; data: Record<string, unknown> }) => audit(ctx, e.eventType, e.subjectType, e.subjectId, e.data),
    emit: (e: { type: string; subjectType: string; subjectId: string; data: Record<string, unknown> }) => emit(ctx, e.type, { subjectType: e.subjectType, subjectId: e.subjectId, ...e.data }),
  };
}

/** Turn a refused database write into the CommonGrants error it should be. */
export async function guardWrite<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof RepoError)) throw e;
    if (e.kind === "conflict") throw new ApiError(409, "conflict", `${what} already exists`);
    if (e.kind === "invalid") throw new ApiError(422, "invalid", `${what} is not valid`);
    throw new ApiError(503, "database_unavailable", "The database could not be reached");
  }
}

export const required = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw notFound(what);
  return value;
};
