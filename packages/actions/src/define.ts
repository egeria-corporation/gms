// SPDX-License-Identifier: AGPL-3.0-only
import type { RequestClaims, Tx } from '@gms/db';
import type { Actor, RiskTier, Scope, WorkspaceRole } from '@gms/domain';
import type { z } from 'zod';
import type { ActionDeps } from './deps';

/**
 * Who may call an action:
 *  - 'public'        anyone, including anonymous callers
 *  - 'authenticated' any signed-in person (object-level access is enforced by RLS)
 *  - 'system'        only the system actor (workers, webhooks)
 *  - WorkspaceRole   a member of the current workspace with that role
 */
export type ActionRole = 'public' | 'authenticated' | 'system' | WorkspaceRole;

export type Channel = 'ui' | 'api' | 'mcp' | 'a2a' | 'cg' | 'worker' | 'webhook' | 'test';

export interface WorkspaceRef {
  id: string;
  slug: string;
  name: string;
  timezone: string;
}

export interface ActionContext {
  workspace: WorkspaceRef | null;
  actor: Actor;
  /** Workspace roles of the human (or the person an agent acts for). */
  roles: WorkspaceRole[];
  /** '*' for interactive human sessions; explicit scopes for agents, PATs and API keys. */
  scopes: readonly Scope[] | '*';
  /** Verified claims used for RLS. System actors run with the service role instead. */
  claims: RequestClaims;
  aal: 'aal1' | 'aal2';
  /** When the person last verified their authenticator (ISO). Step-up actions need this to be recent. */
  stepUpAt?: string | null;
  requestId: string;
  channel: Channel;
  ip?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
  /** Set when executing an R2 action a person has confirmed. */
  approvalRequestId?: string | null;
}

export interface AuditEntry {
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  /** Defaults to the action id. */
  action?: string;
}

export interface RunContext extends ActionContext {
  db: Tx;
  deps: ActionDeps;
  /** Records the audit entry for this action (one per call; later calls add more rows). */
  audit(entry: AuditEntry): void;
  /** Queues a domain event in the transactional outbox. */
  emit(eventType: string, entity: { type: string; id: string | null }, payload?: Record<string, unknown>): void;
  now(): Date;
}

export interface ApprovalPreview {
  title: string;
  summary: string;
  /** Exact changes a person is confirming, shown as a list of label/value pairs. */
  fields: { label: string; value: string }[];
  /** Applicant-supplied text shown for context; always labeled as such. */
  quotedContent?: { label: string; text: string }[];
  entity?: { type: string; id: string };
  attestation?: string;
}

export interface ActionDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  id: string;
  /** Short human title, e.g. "Submit application". */
  title: string;
  /** Written for LLMs: what it does, when to use it, what it needs, what it returns. */
  description: string;
  input: I;
  output: O;
  scopes: readonly Scope[];
  roles: readonly ActionRole[];
  riskTier: RiskTier;
  /** Whether callers may pass an idempotency key. */
  idempotent: boolean;
  /** Requires an aal2 (TOTP step-up) session for humans. */
  stepUp?: boolean;
  /** Needs a workspace (tenant) context. Defaults to true. */
  requiresWorkspace?: boolean;
  /** Tool exposure. Defaults to the audience implied by roles. */
  audience?: 'applicant' | 'staff' | 'public' | 'system';
  /** Human-readable preview for R2 approval requests (runs under RLS as the on-behalf-of person). */
  preview?: (input: z.output<I>, ctx: RunContext) => Promise<ApprovalPreview>;
  run: (input: z.output<I>, ctx: RunContext) => Promise<z.input<O>>;
}

export type AnyAction = ActionDefinition<z.ZodType, z.ZodType>;

const registry = new Map<string, AnyAction>();

export function defineAction<I extends z.ZodType, O extends z.ZodType>(def: ActionDefinition<I, O>): ActionDefinition<I, O> {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(def.id)) throw new Error(`invalid action id: ${def.id}`);
  if (registry.has(def.id) && registry.get(def.id) !== (def as unknown as AnyAction)) {
    throw new Error(`duplicate action id: ${def.id}`);
  }
  if (def.riskTier === 'R3' && def.roles.includes('public')) throw new Error(`${def.id}: R3 actions cannot be public`);
  registry.set(def.id, def as unknown as AnyAction);
  return def;
}

export function getAction(id: string): AnyAction | undefined {
  return registry.get(id);
}

export function listActions(): AnyAction[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function actionAudience(a: AnyAction): 'applicant' | 'staff' | 'public' | 'system' {
  if (a.audience) return a.audience;
  if (a.roles.includes('public')) return 'public';
  if (a.roles.includes('authenticated')) return 'applicant';
  if (a.roles.every((r) => r === 'system')) return 'system';
  return 'staff';
}
