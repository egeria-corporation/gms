// SPDX-License-Identifier: AGPL-3.0-or-later
// Process-wide runtime: adapters + executor, shared by the web app, the worker, scripts and tests.
import { createAdapters, paymentRailFor, type AdapterSet } from '@gms/adapters';
import { getDb, type Database } from '@gms/db';
import { DomainError, SYSTEM_ACTOR } from '@gms/domain';
import { randomUUID } from 'node:crypto';
import type { ActionContext, WorkspaceRef } from './define';
import type { ActionDeps } from './deps';
import { createExecutor, type Executor } from './executor';
import './modules/index';

export interface OriginConfig {
  mode: 'single' | 'multi';
  rootDomain: string;
  protocol: 'http' | 'https';
}

export function originConfig(): OriginConfig {
  const rootDomain = (process.env.GMS_ROOT_DOMAIN ?? 'localhost:3000').toLowerCase();
  return {
    mode: process.env.GMS_MODE === 'single' ? 'single' : 'multi',
    rootDomain,
    protocol: /localhost|127\.0\.0\.1/.test(rootDomain) ? 'http' : 'https',
  };
}

/** Public origin for a tenant, e.g. http://halcyon.localhost:3000 (multi) or https://grants.example.org (single). */
export function originFor(slug: string | null): string {
  const c = originConfig();
  if (!slug || c.mode === 'single') return `${c.protocol}://${c.rootDomain}`;
  return `${c.protocol}://${slug}.${c.rootDomain}`;
}

export interface Runtime {
  adapters: AdapterSet;
  deps: ActionDeps;
  executor: Executor;
  db: Database;
}

let runtime: Runtime | null = null;

export function createRuntime(opts: { db?: Database; clock?: () => Date } = {}): Runtime {
  const db = opts.db ?? getDb();
  const adapters = createAdapters({ db: () => db });
  const deps: ActionDeps = {
    mailer: adapters.mailer,
    storage: adapters.storage,
    scanner: adapters.scanner,
    secrets: adapters.secrets,
    llm: adapters.llm,
    diligence: adapters.diligence,
    auth: adapters.auth,
    paymentRail: async (workspaceId, trx) => {
      // The connection is read in the caller's transaction (it may have just been created there);
      // rail-side state uses the service connection.
      // The simulated bank's onboarding page lives on the tenant's host (/dev/mercury/invites/…).
      const ws = await db.selectFrom('workspaces').select('slug').where('id', '=', workspaceId).executeTakeFirst();
      const rail = await paymentRailFor(workspaceId, trx as unknown as Database, adapters.secrets, { railDb: db, onboardingBaseUrl: originFor(ws?.slug ?? null) });
      if (!rail) throw new DomainError('precondition_failed', 'Connect the bank (or choose the manual rail) first.');
      return rail;
    },
    origin: originFor,
    clock: opts.clock ?? (() => new Date()),
  };
  return { adapters, deps, executor: createExecutor(deps, { db }), db };
}

/** The shared runtime for this process. */
export function getRuntime(): Runtime {
  runtime ??= createRuntime();
  return runtime;
}

/** Context for system work (workers, webhooks). Service privileges; every action still audited. */
export function systemContext(workspace: WorkspaceRef | null, channel: ActionContext['channel'] = 'worker'): ActionContext {
  return {
    workspace,
    actor: SYSTEM_ACTOR,
    roles: [],
    scopes: '*',
    claims: { role: 'anon' },
    aal: 'aal1',
    requestId: randomUUID(),
    channel,
  };
}

export async function workspaceRef(db: Database, idOrSlug: string): Promise<WorkspaceRef | null> {
  const isId = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const row = await db
    .selectFrom('workspaces')
    .select(['id', 'slug', 'name', 'timezone'])
    .where(isId ? 'id' : 'slug', '=', idOrSlug)
    .executeTakeFirst();
  return row ?? null;
}
