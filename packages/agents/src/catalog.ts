// SPDX-License-Identifier: AGPL-3.0-only
// The agent capability catalog: curated tools (named for agents) + tools generated from the action registry,
// filtered per caller (role, scopes, client tool allowlist, workspace tier overrides). Shared by MCP, A2A and
// /api/v1 so every surface exposes — and refuses — exactly the same things.
import {
  actionAudience,
  getAction,
  listActions,
  type ActionContext,
  type ActionRole,
  type AnyAction,
  type ApprovalPreview,
  type ExecuteResult,
} from '@gms/actions';
import { DomainError, type RiskTier, type Scope } from '@gms/domain';
import type { z } from 'zod';
import type { AgentPrincipal } from './auth';
import type { AgentEnv } from './env';
import { READS, runRead, type AnyRead } from './reads';
import { jsonSchemaOf, objectSchema, type JsonObject } from './schema';

export interface Capability {
  /** Tool name (MCP) / skill-facing name. */
  name: string;
  title: string;
  description: string;
  audience: 'public' | 'applicant' | 'staff';
  roles: readonly ActionRole[];
  scopes: readonly Scope[];
  riskTier: RiskTier;
  idempotent: boolean;
  input: z.ZodType;
  /** Backing action (mutations) or read helper. Exactly one is set. */
  actionId: string | null;
  read: AnyRead | null;
  curated: boolean;
  /** Default values merged into the caller's input before the action runs (e.g. dryRun). */
  defaults?: Record<string, unknown>;
}

interface CuratedAction {
  name: string;
  actionId: string;
  lead?: string;
  defaults?: Record<string, unknown>;
}

/** Curated tool names → actions. Everything else agent-callable is exposed as `<action_id with dots → underscores>`. */
export const CURATED_ACTIONS: CuratedAction[] = [
  { name: 'check_eligibility', actionId: 'opportunities.check_eligibility' },
  { name: 'start_application', actionId: 'applications.start' },
  {
    name: 'save_answers',
    actionId: 'applications.save_answers',
    lead: 'Problems come back as JSON Pointers (e.g. /org_ein) with a plain-language fix-it hint; correct them and call save_answers again.',
  },
  { name: 'validate_application', actionId: 'applications.validate' },
  {
    name: 'upload_attachment',
    actionId: 'applications.request_upload',
    lead: 'Returns a signed upload URL (PUT the file bytes), then call applications_confirm_upload.',
  },
  {
    name: 'request_submission',
    actionId: 'applications.submit',
    lead: 'Asks to submit the application. You cannot submit on your own: this returns status "approval_required" with a confirmUrl the person must open and confirm. Poll get_status afterwards.',
  },
  {
    name: 'submit_report',
    actionId: 'reports.submit',
    lead: 'Asks to submit a grant report; the person confirms at the returned confirmUrl.',
  },
  {
    name: 'screen_eligibility',
    actionId: 'applications.screen_eligibility',
    lead: 'Your screening is recorded as a suggestion for staff; it never changes the application status.',
  },
  {
    name: 'assign_reviewers',
    actionId: 'review.auto_assign',
    lead: 'Plans reviewer assignments. Runs as a dry run by default (returns the plan, assigns nothing); pass dryRun:false only after staff approve the plan.',
    defaults: { dryRun: true },
  },
  { name: 'draft_message', actionId: 'comms.draft_bulk_message' },
  {
    name: 'send_message',
    actionId: 'comms.send_bulk_message',
    lead: 'Sending is consequential: returns approval_required with a confirmUrl for a staff member.',
  },
  {
    name: 'draft_award',
    actionId: 'awards.draft',
    lead: 'Creates a DRAFT award only; activating it is people-only.',
  },
  {
    name: 'propose_payment_batch',
    actionId: 'payments.propose_batch',
    lead: 'Creates a DRAFT batch only. Approving payments is people-only and cannot be done by any agent.',
  },
  {
    name: 'run_report',
    actionId: 'exports.request',
    lead: 'Starts an export job and returns its id; poll get_export_status until it is ready.',
  },
];

const CURATED_READ_NAMES = new Set([
  'search_opportunities',
  'get_opportunity',
  'get_application_form',
  'get_status',
  'list_requests',
  'get_payment_status',
  'query_pipeline',
  'get_application',
  'get_review_progress',
  'list_overdue_reports',
  'search_grantees',
  'get_portfolio_metrics',
  'get_approval_requests',
  'get_export_status',
]);

function tierNote(tier: RiskTier): string {
  if (tier === 'R2')
    return ' Consequential (R2): when an agent calls this, nothing happens yet — GMS returns status "approval_required" with a confirmUrl, and a person confirms inside GMS.';
  if (tier === 'R0') return ' Read-only.';
  return '';
}

/** True when an action may ever be exposed to an agent. R3 and system-only actions never are. */
export function agentCallable(a: AnyAction): boolean {
  if (a.riskTier === 'R3') return false;
  if (actionAudience(a) === 'system') return false;
  if (a.roles.length && a.roles.every((r) => r === 'system')) return false;
  // Actions without scopes are UI-only: there is no permission a person could grant an agent for them.
  return a.scopes.length > 0;
}

function actionCapability(
  a: AnyAction,
  name: string,
  curated: boolean,
  lead?: string,
  defaults?: Record<string, unknown>,
): Capability {
  const audience = actionAudience(a);
  return {
    name,
    title: a.title,
    description:
      `${lead ? `${lead} ` : ''}${a.description}${tierNote(a.riskTier)}${curated ? '' : ` Runs the GMS action ${a.id} (scope: ${a.scopes.join(' ')}).`}`.trim(),
    audience: audience === 'system' ? 'staff' : audience,
    roles: a.roles,
    scopes: a.scopes,
    riskTier: a.riskTier,
    idempotent: a.idempotent,
    input: a.input,
    actionId: a.id,
    read: null,
    curated,
    ...(defaults ? { defaults } : {}),
  };
}

function readCapability(r: AnyRead): Capability {
  return {
    name: r.name,
    title: r.title,
    description: `${r.description} Read-only.`,
    audience: r.audience,
    roles: r.roles,
    scopes: r.scopes,
    riskTier: 'R0',
    idempotent: true,
    input: r.input,
    actionId: null,
    read: r,
    curated: CURATED_READ_NAMES.has(r.name),
  };
}

let catalogCache: Capability[] | null = null;

/** Every capability agents could ever see (before per-caller filtering). Never contains an R3 action. */
export function allCapabilities(): Capability[] {
  if (catalogCache) return catalogCache;
  const caps: Capability[] = READS.map(readCapability);
  const curatedIds = new Set<string>();
  for (const c of CURATED_ACTIONS) {
    const a = getAction(c.actionId);
    if (!a || !agentCallable(a)) continue;
    curatedIds.add(a.id);
    caps.push(actionCapability(a, c.name, true, c.lead, c.defaults));
  }
  for (const a of listActions()) {
    if (curatedIds.has(a.id) || !agentCallable(a)) continue;
    caps.push(actionCapability(a, a.id.replace(/\./g, '_'), false));
  }
  catalogCache = caps;
  return caps;
}

export function findCapability(name: string): Capability | undefined {
  return allCapabilities().find((c) => c.name === name);
}

export function capabilityForAction(actionId: string): Capability | undefined {
  return allCapabilities().find((c) => c.actionId === actionId);
}

// ---------------------------------------------------------------------------------------------------------
// Per-caller filtering
// ---------------------------------------------------------------------------------------------------------
function signedIn(ctx: ActionContext): boolean {
  return ctx.claims.role === 'authenticated' && Boolean(ctx.claims.sub);
}

export function roleAllows(cap: Pick<Capability, 'roles'>, ctx: ActionContext): boolean {
  if (cap.roles.includes('public')) return true;
  if (cap.roles.includes('authenticated') && signedIn(ctx)) return true;
  return ctx.roles.some((r) => cap.roles.includes(r));
}

export function scopesAllow(cap: Pick<Capability, 'scopes'>, ctx: ActionContext): boolean {
  if (ctx.scopes === '*') return true;
  const granted = ctx.scopes as readonly string[];
  return cap.scopes.every((s) => granted.includes(s));
}

export function allowlistAllows(
  cap: Pick<Capability, 'name' | 'actionId'>,
  principal: AgentPrincipal | null,
): boolean {
  const list = principal?.toolAllowlist;
  if (!list) return true;
  return list.includes(cap.name) || (cap.actionId !== null && list.includes(cap.actionId));
}

async function effectiveTier(env: AgentEnv, cap: Capability, ctx: ActionContext): Promise<RiskTier> {
  if (!cap.actionId) return cap.riskTier;
  const a = getAction(cap.actionId);
  return a ? env.runtime.executor.effectiveTier(a, ctx, env.runtime.db) : cap.riskTier;
}

/** The capabilities this caller can use right now (role, scopes, allowlist, tier overrides). */
export async function visibleCapabilities(
  env: AgentEnv,
  ctx: ActionContext,
  principal: AgentPrincipal | null,
): Promise<(Capability & { tier: RiskTier })[]> {
  const out: (Capability & { tier: RiskTier })[] = [];
  for (const cap of allCapabilities()) {
    if (!roleAllows(cap, ctx) || !scopesAllow(cap, ctx) || !allowlistAllows(cap, principal)) continue;
    const tier = await effectiveTier(env, cap, ctx);
    if (tier === 'R3') continue;
    out.push({ ...cap, tier });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------------------------------------
export type InvokeResult =
  | { status: 'ok'; output: unknown; summary: string }
  | {
      status: 'approval_required';
      approvalRequestId: string;
      confirmUrl: string;
      expiresAt: string;
      preview: ApprovalPreview;
      summary: string;
    };

function humanOnly(title: string): DomainError {
  return new DomainError(
    'human_only',
    `"${title}" can only be done by a person in GMS. Agents cannot be granted this.`,
    { riskTier: 'R3' },
  );
}

/** Checks role / scope / allowlist / tier gates in a fixed order (R3 first, so it is never masked). */
async function gate(
  env: AgentEnv,
  cap: Capability,
  ctx: ActionContext,
  principal: AgentPrincipal | null,
): Promise<void> {
  if ((await effectiveTier(env, cap, ctx)) === 'R3') throw humanOnly(cap.title);
  if (!allowlistAllows(cap, principal)) {
    throw new DomainError(
      'forbidden',
      `"${cap.name}" is not on this agent’s tool allowlist. An admin can change the allowlist in GMS.`,
    );
  }
  if (!roleAllows(cap, ctx)) {
    if (!signedIn(ctx))
      throw new DomainError('unauthenticated', `"${cap.name}" needs an access token for a person.`, {
        requiredScopes: cap.scopes,
      });
    throw new DomainError(
      'forbidden',
      `The person this agent acts for cannot "${cap.title.toLowerCase()}".`,
      { requiredRoles: cap.roles },
    );
  }
  if (!scopesAllow(cap, ctx)) {
    const granted = ctx.scopes === '*' ? [] : (ctx.scopes as readonly string[]);
    throw new DomainError(
      'insufficient_scope',
      `This token is missing scope(s): ${cap.scopes.filter((s) => !granted.includes(s)).join(' ')}.`,
      {
        requiredScopes: cap.scopes,
        missingScopes: cap.scopes.filter((s) => !granted.includes(s)),
      },
    );
  }
}

function withDefaults(cap: Capability, input: unknown): unknown {
  if (!cap.defaults) return input ?? {};
  const base =
    input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return { ...cap.defaults, ...base };
}

function summarizeOutput(cap: Capability, output: unknown): string {
  if (cap.actionId === 'applications.save_answers' || cap.actionId === 'reports.save') {
    const errs = ((output as { errors?: { pointer: string; message: string }[] }).errors ?? []).slice(0, 10);
    const conflicts = (output as { conflicts?: unknown[] }).conflicts ?? [];
    const head = `Saved${(output as { etag?: string }).etag ? ` (etag ${(output as { etag: string }).etag})` : ''}.`;
    return [
      head,
      errs.length
        ? `${errs.length} problem(s) to fix: ${errs.map((e) => `${e.pointer} — ${e.message}`).join('; ')}`
        : 'No problems so far.',
      conflicts.length
        ? `${conflicts.length} field(s) were changed by someone else and not overwritten.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (cap.actionId === 'applications.validate') {
    const o = output as { ready: boolean; errors: { pointer: string; message: string }[] };
    return o.ready
      ? 'Ready to submit: every answer passes.'
      : `Not ready: ${o.errors.length} problem(s). ${o.errors
          .slice(0, 8)
          .map((e) => `${e.pointer} — ${e.message}`)
          .join('; ')}`;
  }
  const json = JSON.stringify(output);
  return `${cap.title}: done. ${json.length > 400 ? `${json.slice(0, 400)}…` : json}`;
}

/** Adds a fix-it hint to every JSON-Pointer error an action returns. */
function withHints(cap: Capability, output: unknown): unknown {
  if (!output || typeof output !== 'object' || !Array.isArray((output as { errors?: unknown }).errors))
    return output;
  const tool = cap.actionId === 'reports.save' ? 'reports_save' : 'save_answers';
  const errors = (output as { errors: { pointer: string; message: string; fieldId?: string }[] }).errors.map(
    (e) => ({
      ...e,
      hint: `${e.message} Then call ${tool} again with a corrected value for "${e.fieldId ?? e.pointer.replace(/^\//, '').split('/')[0]}".`,
    }),
  );
  return { ...(output as Record<string, unknown>), errors };
}

export async function invokeCapability(
  env: AgentEnv,
  cap: Capability,
  input: unknown,
  ctx: ActionContext,
  principal: AgentPrincipal | null,
): Promise<InvokeResult> {
  await gate(env, cap, ctx, principal);
  if (cap.read) {
    const output = await runRead(env, cap.read, input, ctx);
    return { status: 'ok', output, summary: cap.read.summarize(output as never, { env }) };
  }
  const r: ExecuteResult<unknown> = await env.runtime.executor.execute(
    cap.actionId!,
    withDefaults(cap, input),
    ctx,
  );
  if (r.status === 'approval_required') {
    return {
      status: 'approval_required',
      approvalRequestId: r.approvalRequestId,
      confirmUrl: r.confirmUrl,
      expiresAt: r.expiresAt,
      preview: r.preview,
      summary: `Nothing was done yet: a person needs to confirm “${r.preview.title}”. Ask the person to confirm at ${r.confirmUrl} (expires ${r.expiresAt}). Poll get_status or get_approval_request afterwards.`,
    };
  }
  const output = withHints(cap, r.output);
  return { status: 'ok', output, summary: summarizeOutput(cap, output) };
}

/**
 * Executes any registry action by id for /api/v1/actions/{id}. Actions that agents can never call are refused
 * with a clear reason (R3 → human_only; UI-only/system → forbidden).
 */
export async function callAction(
  env: AgentEnv,
  actionId: string,
  input: unknown,
  ctx: ActionContext,
  principal: AgentPrincipal | null,
): Promise<InvokeResult> {
  const a = getAction(actionId);
  if (!a) throw new DomainError('not_found', `Unknown action "${actionId}".`);
  if (a.riskTier === 'R3') throw humanOnly(a.title);
  if (!agentCallable(a))
    throw new DomainError(
      'forbidden',
      `"${a.title}" is only available to people in GMS (there is no agent permission for it).`,
    );
  const cap = capabilityForAction(actionId) ?? actionCapability(a, a.id.replace(/\./g, '_'), false);
  return invokeCapability(env, cap, input, ctx, principal);
}

/** JSON Schemas for a capability (MCP inputSchema / outputSchema). */
export function capabilitySchemas(cap: Capability): { input: JsonObject; output: JsonObject | null } {
  const input = objectSchema(jsonSchemaOf(cap.input, 'input'));
  if (cap.read) return { input, output: objectSchema(jsonSchemaOf(cap.read.output, 'output')) };
  const a = getAction(cap.actionId!);
  const result = a ? jsonSchemaOf(a.output, 'output') : {};
  return {
    input,
    output: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'approval_required'] },
        result,
        approvalRequestId: { type: 'string' },
        confirmUrl: { type: 'string' },
        expiresAt: { type: 'string' },
        preview: { type: 'object' },
      },
      required: ['status'],
    },
  };
}
