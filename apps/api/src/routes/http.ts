// SPDX-License-Identifier: AGPL-3.0-only
// Glue between a Hono request and the service layer: build the ServiceContext from the
// authenticated Principal (or the signed-in person), and read JSON bodies and pagination.
import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import type { WorkspaceKind } from "../auth/scopes.ts";
import { trimSlash } from "../env.ts";
import { restTool, workspaceGates } from "../auth/rest-gates.ts";
import { forbidden } from "../auth/verify.ts";
import { badRequest, notFound, parsePagination } from "../lib/errors.ts";
import { makeActor, type ServiceConfig, type ServiceContext } from "../services/context.ts";
import type { PublicContext } from "../services/public.ts";

type C = Context<AppEnv>;

export function config(c: C): ServiceConfig {
  const deps = c.get("deps");
  return {
    baseUrl: trimSlash(c.env.GMS_BASE_URL),
    webBaseUrl: trimSlash(c.env.WEB_BASE_URL),
    passportBaseUrl: c.env.PASSPORT_BASE_URL ? trimSlash(c.env.PASSPORT_BASE_URL) : null,
    passportWebUrl: c.env.PASSPORT_WEB_URL ? trimSlash(c.env.PASSPORT_WEB_URL) : null,
    passportIssuer: c.env.PASSPORT_ISSUER ? trimSlash(c.env.PASSPORT_ISSUER) : c.env.PASSPORT_BASE_URL ? trimSlash(c.env.PASSPORT_BASE_URL) : null,
    credentialsKey: c.env.CREDENTIALS_ENCRYPTION_KEY ?? null,
    ...(deps.passportFetch ? { passportFetch: deps.passportFetch } : {}),
    passportClient: c.env.PASSPORT_GMS_CLIENT_ID && c.env.PASSPORT_GMS_CLIENT_SECRET ? { id: c.env.PASSPORT_GMS_CLIENT_ID, secret: c.env.PASSPORT_GMS_CLIENT_SECRET } : null,
    mailFrom: c.env.RESEND_FROM ?? null,
    passportAwardWrite: c.env.PASSPORT_AWARD_WRITE === "true",
    assistantEnabled: c.env.ASSISTANT_ENABLED === "true",
    assistantModel: c.env.ASSISTANT_MODEL?.trim() || null,
    facilitatedPayments: c.env.PAYMENTS_FACILITATED === "true",
    applicantPayeeRead: c.env.PASSPORT_APPLICANT_PAYEE_READ !== "false",
    webhookSecretKey: c.env.WEBHOOK_SECRET_KEY ?? null,
    passportWebhookSecret: c.env.PASSPORT_WEBHOOK_SECRET ?? null,
    resendInboundSecret: c.env.RESEND_INBOUND_SECRET ?? null,
    inboundDomain: c.env.RESEND_INBOUND_DOMAIN ?? (c.env.RESEND_FROM?.match(/@([A-Za-z0-9.-]+)/)?.[1] ?? null),
  };
}

const base = (c: C) => {
  const deps = c.get("deps");
  return { repos: deps.repos, ledger: deps.ledger, webhooks: deps.webhooks, now: deps.now, config: config(c), ports: deps.ports?.(c.env) ?? {} };
};

/** The context for a workspace-bound caller. Use after `authenticate()`. */
export async function svc(c: C): Promise<ServiceContext> {
  const p = c.get("principal");
  const ws = await c.get("deps").repos.table("workspaces").one({ id: p.workspaceId });
  if (!ws) throw notFound("Workspace");
  // Gates a workspace or an API client added hold over REST as they do over MCP: an agent or
  // API-client token cannot take a gated action directly (CLAUDE.md: no client bypasses a gate).
  if (p.kind !== "user" && !p.scopes.includes("approvals:bypass")) {
    const tool = restTool(c.req.method, new URL(c.req.url).pathname);
    if (tool) {
      const client = p.clientId ? await c.get("deps").auth.getClient(p.clientId) : null;
      if (workspaceGates(ws.settings).includes(tool) || (client?.gatedTools ?? []).includes(tool)) {
        throw forbidden("approval_required", `This workspace requires a person's approval for ${tool}. Call the MCP tool, which files the approval request, or do it in the GMS`);
      }
    }
  }
  return {
    ...base(c),
    actor: makeActor(p.kind, p.userId, p.clientId),
    workspace: { id: ws.id, kind: ws.kind as WorkspaceKind, role: p.role, memberScope: p.memberScope },
    scopes: p.scopes,
  };
}

/** The context for a signed-in person who has not named a workspace. Use after `requireUser()`. */
export function userSvc(c: C): ServiceContext {
  return { ...base(c), actor: makeActor("user", c.get("user").userId, null), workspace: null, scopes: [] };
}

export const publicCtx = (c: C): PublicContext => {
  const deps = c.get("deps");
  return { repos: deps.repos, now: deps.now, config: config(c) };
};

/** The JSON body; an empty body is `{}` so routes with all-optional input need none. */
export async function jsonBody(c: C): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest("The request body is not valid JSON");
  }
}

export const page = (c: C) => parsePagination({ page: c.req.query("page"), pageSize: c.req.query("pageSize") });

/** `?version=` as a positive integer, or undefined. */
export function versionQuery(c: C): number | undefined {
  const raw = c.req.query("version");
  if (raw === undefined) return undefined;
  if (!/^\d{1,6}$/.test(raw) || Number(raw) < 1) throw badRequest("version must be a positive integer", [{ code: "invalid_parameter", field: "version" }]);
  return Number(raw);
}
