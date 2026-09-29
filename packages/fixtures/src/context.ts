// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared state and helpers for the seed steps: the runtime/executor, the anchor clock, deterministic ids and
// random streams, batched inserts, historical audit entries, and action contexts for people and agents.
import { randomUUID } from 'node:crypto';
import type { ActionContext, Runtime, WorkspaceRef } from '@gms/actions';
import { systemContext } from '@gms/actions';
import { sql, type Database } from '@gms/db';
import type { DB } from '@gms/db';
import type { Scope, WorkspaceRole } from '@gms/domain';
import type { Insertable } from 'kysely';
import { sid } from './ids';
import type { DemoWorkspace } from './people';
import { createRng, type Rng } from './rng';
import { Clock } from './time';

export type TableName = keyof DB & string;
export type Row<T extends TableName> = Insertable<DB[T]>;

export interface AuditInput {
  workspace: DemoWorkspace | string;
  at: string;
  actor: { type: 'human'; id: string; name: string } | { type: 'agent'; clientId: string; name: string; onBehalfOf: string; onBehalfOfName: string } | { type: 'system' };
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  riskTier?: 'R0' | 'R1' | 'R2' | 'R3';
}

export interface SeedPerson {
  id: string;
  email: string;
  name: string;
}

export class SeedContext {
  readonly db: Database;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly workspaces = new Map<string, WorkspaceRef>();
  readonly people = new Map<string, SeedPerson>();
  private readonly audits: Row<'audit_log'>[] = [];
  readonly counts: Record<string, number> = {};
  /** Reference-number counters to raise at the end (so later numbers never collide with seeded ones). */
  readonly refCounters: { ws: string; kind: string; year: number; value: number }[] = [];

  constructor(
    readonly runtime: Runtime,
    anchor: Date,
    readonly log: (msg: string) => void,
  ) {
    this.db = runtime.db;
    this.clock = new Clock(anchor);
    this.rng = createRng('gms-demo-v1');
  }

  /** A named random stream (stable no matter what other steps do). */
  stream(name: string): Rng {
    return this.rng.fork(name);
  }

  id(name: string): string {
    return sid(name);
  }

  ws(key: string): WorkspaceRef {
    const w = this.workspaces.get(key);
    if (!w) throw new Error(`workspace ${key} not created yet`);
    return w;
  }

  person(key: string): SeedPerson {
    const p = this.people.get(key);
    if (!p) throw new Error(`person ${key} not created yet`);
    return p;
  }

  /** Batched insert (service connection; triggers still run). */
  async insert<T extends TableName>(table: T, rows: readonly Row<T>[], chunk = 400): Promise<void> {
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);
      if (!part.length) continue;
      await this.db.insertInto(table).values(part as never).execute();
    }
    this.counts[table] = (this.counts[table] ?? 0) + rows.length;
  }

  /** Queues a historical audit entry (written in one batch at the end, with its real timestamp). */
  audit(e: AuditInput): void {
    const ws = this.workspaces.get(e.workspace)?.id ?? e.workspace;
    const a = e.actor;
    this.audits.push({
      workspace_id: ws,
      occurred_at: e.at,
      actor_type: a.type,
      actor_id: a.type === 'human' ? a.id : a.type === 'agent' ? a.clientId : null,
      actor_name: a.type === 'system' ? 'GMS' : a.name,
      agent_client_id: a.type === 'agent' ? a.clientId : null,
      on_behalf_of: a.type === 'agent' ? a.onBehalfOf : null,
      on_behalf_of_name: a.type === 'agent' ? a.onBehalfOfName : null,
      action: e.action,
      entity_type: e.entityType,
      entity_id: e.entityId,
      before: e.before === undefined ? null : JSON.stringify(e.before),
      after: e.after === undefined ? null : JSON.stringify(e.after),
      risk_tier: e.riskTier ?? 'R1',
      request_id: `seed-${this.audits.length + 1}`,
      user_agent: a.type === 'human' ? 'Mozilla/5.0 (demo seed)' : null,
    });
  }

  async flushAudit(): Promise<void> {
    const rows = [...this.audits].sort((x, y) => String(x.occurred_at).localeCompare(String(y.occurred_at)));
    this.audits.length = 0;
    await this.insert('audit_log', rows);
  }

  human(key: string): { type: 'human'; id: string; name: string } {
    const p = this.person(key);
    return { type: 'human', id: p.id, name: p.name };
  }

  /** Action context for a signed-in person (RLS applies). `aal2` also counts as a fresh step-up. */
  asPerson(key: string, workspace: string | null, roles: WorkspaceRole[], opts: { aal2?: boolean } = {}): ActionContext {
    const p = this.person(key);
    const now = this.runtime.deps.clock().toISOString();
    return {
      workspace: workspace ? this.ws(workspace) : null,
      actor: { type: 'human', id: p.id, name: p.name },
      roles,
      scopes: '*',
      claims: { role: 'authenticated', sub: p.id, email: p.email, aal: opts.aal2 ? 'aal2' : 'aal1' },
      aal: opts.aal2 ? 'aal2' : 'aal1',
      stepUpAt: opts.aal2 ? now : null,
      requestId: randomUUID(),
      channel: 'ui',
      userAgent: 'Mozilla/5.0 (demo seed)',
    };
  }

  /** Action context for an agent acting for a person (scopes from its token / account). */
  asAgent(agent: { clientId: string; name: string; scopes: readonly Scope[] }, forKey: string, workspace: string, roles: WorkspaceRole[], channel: ActionContext['channel'] = 'mcp'): ActionContext {
    const p = this.person(forKey);
    return {
      workspace: this.ws(workspace),
      actor: { type: 'agent', id: agent.clientId, name: agent.name, agentClientId: agent.clientId, onBehalfOf: p.id, onBehalfOfName: p.name },
      roles,
      scopes: agent.scopes,
      claims: { role: 'authenticated', sub: p.id, email: p.email, aal: 'aal1', client_id: agent.clientId },
      aal: 'aal1',
      requestId: randomUUID(),
      channel,
      userAgent: `${agent.name} (demo seed)`,
    };
  }

  system(workspace: string | null): ActionContext {
    return systemContext(workspace ? this.ws(workspace) : null, 'worker');
  }

  async run<O>(actionId: string, input: unknown, ctx: ActionContext): Promise<O> {
    return this.runtime.executor.run<O>(actionId, input, ctx);
  }

  bump(name: string, n = 1): void {
    this.counts[name] = (this.counts[name] ?? 0) + n;
  }

  /** Raises a workspace's reference counter so numbers issued later never collide with seeded ones. */
  async setReferenceCounter(workspace: string, kind: string, year: number, value: number): Promise<void> {
    await sql`insert into gms_private.reference_counters (workspace_id, kind, year, value) values (${this.ws(workspace).id}::uuid, ${kind}, ${year}, ${value})
      on conflict (workspace_id, kind, year) do update set value = greatest(gms_private.reference_counters.value, excluded.value)`.execute(this.db);
  }
}

export function json(v: unknown): string {
  return JSON.stringify(v ?? null);
}
