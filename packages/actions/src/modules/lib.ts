// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared helpers for action modules.
import { sql, type Tx } from '@gms/db';
import { assertTransition, DomainError, referenceNumber, workspacePrefix, type Machine } from '@gms/domain';
import { z } from 'zod';
import type { RunContext, WorkspaceRef } from '../define';

export const uuid = z.string().uuid();
export const Empty = z.object({});
export const Ok = z.object({ ok: z.literal(true) });
export const IdOut = z.object({ id: z.string().uuid() });

export function ws(ctx: RunContext): WorkspaceRef {
  if (!ctx.workspace) throw new DomainError('precondition_failed', 'This action needs a workspace.');
  return ctx.workspace;
}

export function uid(ctx: RunContext): string {
  const id = ctx.claims.sub;
  if (!id) throw new DomainError('unauthenticated', 'Sign in to do this.');
  return id;
}

export function found<T>(row: T | undefined | null, what = 'record'): T {
  if (row === undefined || row === null) throw new DomainError('not_found', `That ${what} was not found, or you do not have access to it.`);
  return row;
}

export function transition<S extends string>(m: Machine<S>, from: string, to: S): void {
  assertTransition(m, from as S, to);
}

export async function nextReference(trx: Tx, workspace: WorkspaceRef, kind: string, year: number): Promise<string> {
  const r = await sql<{ n: number }>`select gms_private.next_reference(${workspace.id}::uuid, ${kind}, ${year}) as n`.execute(trx);
  const prefix = workspacePrefix(workspace.name) + (kind === 'award' ? 'A' : '');
  return referenceNumber(prefix, year, Number(r.rows[0]!.n));
}

export function yearInZone(d: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(d));
}

export function json(v: unknown): string {
  return JSON.stringify(v ?? null);
}

/** Records an application status change (append-only history) and emits the domain event. */
export async function recordStatus(
  ctx: RunContext,
  app: { id: string; workspace_id: string; status: string },
  to: string,
  reason: string | null,
  opts: { visibleToApplicant?: boolean } = {},
): Promise<void> {
  await ctx.db
    .insertInto('status_history')
    .values({
      workspace_id: app.workspace_id,
      application_id: app.id,
      from_status: app.status,
      to_status: to,
      reason,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.type === 'human' ? ctx.actor.id : (ctx.actor.agentClientId ?? null),
      actor_name: ctx.actor.onBehalfOfName ? `${ctx.actor.name}, acting for ${ctx.actor.onBehalfOfName}` : ctx.actor.name,
      visible_to_applicant: opts.visibleToApplicant ?? true,
    })
    .execute();
  ctx.emit('application.status_changed', { type: 'application', id: app.id }, { from: app.status, to, reason });
}

export function isAgent(ctx: RunContext): boolean {
  return ctx.actor.type === 'agent';
}

export function agentClientId(ctx: RunContext): string | null {
  return ctx.actor.type === 'agent' ? (ctx.actor.agentClientId ?? null) : null;
}

export const Money = z.number().int().nonnegative();
export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const IsoDateTime = z.string().datetime({ offset: true });
export const Slug = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers and dashes');
export const Email = z.string().trim().toLowerCase().email();
export const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a 6-digit hex color like #0F5E5A');
