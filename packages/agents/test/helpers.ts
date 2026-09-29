// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared setup for @gms/agents DB tests: a fresh database, a runtime bound to it, two workspaces and people.
import { randomUUID } from 'node:crypto';
import { createRuntime, type ActionContext, type Runtime, type WorkspaceRef } from '@gms/actions';
import { createTestDatabase, createUser, type TestDatabase, type TestUser } from '@gms/db/testing';
import type { AgentEnv } from '../src';

export const ORIGIN = 'http://halcyon.localhost:3000';

export interface Setup {
  t: TestDatabase;
  runtime: Runtime;
  wsA: WorkspaceRef;
  wsB: WorkspaceRef;
  owner: TestUser;
  applicant: TestUser;
  env: (ws?: WorkspaceRef, extra?: Partial<AgentEnv>) => AgentEnv;
  human: (
    user: TestUser,
    ws: WorkspaceRef,
    roles?: ActionContext['roles'],
    extra?: Partial<ActionContext>,
  ) => ActionContext;
}

export async function setup(prefix: string): Promise<Setup> {
  process.env.GMS_AUTH_MODE ??= 'test';
  const t = await createTestDatabase(prefix);
  const runtime = createRuntime({ db: t.db });
  const owner = await createUser(t.db, { name: 'Helen Ortiz', email: 'helen@halcyon.example' });
  const applicant = await createUser(t.db, { name: 'Maya Chen', email: 'maya@riverbend.example' });
  const mk = (slug: string, name: string) =>
    t.db
      .insertInto('workspaces')
      .values({ slug, name, timezone: 'America/Los_Angeles' })
      .returning(['id', 'slug', 'name', 'timezone'])
      .executeTakeFirstOrThrow();
  const wsA = await mk('halcyon', 'Halcyon Foundation');
  const wsB = await mk('other', 'Other Foundation');
  await t.db
    .insertInto('workspace_members')
    .values({ workspace_id: wsA.id, user_id: owner.id, role: 'owner' })
    .execute();
  const env = (ws: WorkspaceRef = wsA, extra: Partial<AgentEnv> = {}): AgentEnv => ({
    workspace: ws,
    origin: ORIGIN,
    brandName: ws.name,
    runtime,
    requestId: randomUUID(),
    ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    supabaseUrl: null,
    ...extra,
  });
  const human = (
    user: TestUser,
    ws: WorkspaceRef,
    roles: ActionContext['roles'] = [],
    extra: Partial<ActionContext> = {},
  ): ActionContext => ({
    workspace: ws,
    actor: { type: 'human', id: user.id, name: user.name },
    roles,
    scopes: '*',
    claims: { role: 'authenticated', sub: user.id, email: user.email, aal: 'aal1' },
    aal: 'aal1',
    requestId: randomUUID(),
    channel: 'test',
    ...extra,
  });
  return { t, runtime, wsA, wsB, owner, applicant, env, human };
}
