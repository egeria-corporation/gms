// SPDX-License-Identifier: AGPL-3.0-only
// @gms/fixtures: deterministic, fictional demo data for GMS (`pnpm seed`).
import { getRuntime, type Runtime } from '@gms/actions';
import { sql, type Database } from '@gms/db';
import { APPLICANT_SCOPES } from '@gms/domain';
import { SeedContext } from './context';
import { DEMO_USERS, type DemoUser } from './people';
import { agents, OPS_SCOPES } from './steps/agents';
import { applications } from './steps/applications';
import { awards } from './steps/awards';
import { board } from './steps/board';
import { catalog, flagshipStatus, formLibrary } from './steps/catalog';
import { comms } from './steps/comms';
import { importFixtures, screenGrantees } from './steps/diligence';
import { orgs } from './steps/orgs';
import { payments } from './steps/payments';
import { postAward } from './steps/postaward';
import { reviews } from './steps/reviews';
import { addTeam, createPeople, createTenant, pendingInvitation, seedFactors, taxonomy, TENANTS } from './steps/tenants';
import { resolveAnchor } from './time';

export { totpNow } from '@gms/adapters';
export { DEMO_USERS, DEMO_TOTP_SECRETS, demoTotpSecret, demoUser, type DemoUser, type DemoWorkspace } from './people';
export { SEED_IDS, userId } from './seed-ids';
export { resolveAnchor } from './time';
export { flagshipStatus } from './steps/catalog';
export { OPS_SCOPES, OPS_TOOLS } from './steps/agents';

export interface SeedOptions {
  /** Runtime (executor + adapters + db). Defaults to the process runtime (DATABASE_URL). */
  runtime?: Runtime;
  /** Only the Halcyon workspace, its owner (with TOTP factor) and its brand. */
  minimal?: boolean;
  /** The "now" anchor for relative dates. Defaults to GMS_SEED_NOW or today at 12:00 UTC. */
  now?: Date;
  /** Store the placeholder agreement PDFs in Storage (default true). */
  documents?: boolean;
  log?: (message: string) => void;
}

export interface DevTokens {
  /** Maya Chen's personal access token for "Grant Writer Assistant" (applicant scopes). */
  grantWriterAssistant: { token: string; tokenId: string; agentClientId: string; ownerEmail: string; scopes: string[] };
  /** The foundation's "Ops Assistant" agent-account API key (staff scopes). */
  opsAssistant: { key: string; agentClientId: string; ownerEmail: string; scopes: string[] };
}

export interface SeedResult {
  mode: 'minimal' | 'full';
  anchor: string;
  flagshipStatus: 'forecasted' | 'open' | 'closed';
  durationMs: number;
  counts: Record<string, number>;
  tokens: DevTokens | null;
  pendingApprovalIds: string[];
}

export class DemoDataExistsError extends Error {
  constructor() {
    super('Demo data already exists (workspace "halcyon").');
    this.name = 'DemoDataExistsError';
  }
}

/** True when the demo workspace already exists in this database. */
export async function hasDemoData(db: Database): Promise<boolean> {
  const r = await db.selectFrom('workspaces').select('id').where('slug', '=', TENANTS.halcyon.slug).executeTakeFirst();
  return Boolean(r);
}

const STAFF_CREATED_DAYS: Record<string, number> = { halcyon: 720, marigold: 430, sunbeam: 62 };

/** Seeds the demo data. Throws DemoDataExistsError when the Halcyon workspace already exists. */
export async function seed(opts: SeedOptions = {}): Promise<SeedResult> {
  const started = Date.now();
  const runtime = opts.runtime ?? getRuntime();
  const log = opts.log ?? (() => {});
  if (await hasDemoData(runtime.db)) throw new DemoDataExistsError();
  const anchor = opts.now ?? resolveAnchor();
  const ctx = new SeedContext(runtime, anchor, log);
  const createdAt = (u: DemoUser) => ctx.clock.iso(-(u.workspace ? STAFF_CREATED_DAYS[u.workspace]! : 650));
  log(`anchor ${anchor.toISOString()} (flagship ${flagshipStatus(anchor)})`);

  if (opts.minimal) {
    const helen = DEMO_USERS.filter((u) => u.key === 'helen');
    await createPeople(ctx, helen, createdAt);
    await createTenant(ctx, TENANTS.halcyon);
    await seedFactors(ctx, helen);
    await ctx.flushAudit();
    return { mode: 'minimal', anchor: anchor.toISOString(), flagshipStatus: flagshipStatus(anchor), durationMs: Date.now() - started, counts: { ...ctx.counts }, tokens: null, pendingApprovalIds: [] };
  }

  log('people and workspaces');
  await createPeople(ctx, DEMO_USERS, createdAt);
  for (const t of Object.values(TENANTS)) await createTenant(ctx, t);
  await seedFactors(ctx, DEMO_USERS.filter((u) => u.workspace !== null));
  for (const t of Object.values(TENANTS)) await addTeam(ctx, t.key);
  await pendingInvitation(ctx);
  await taxonomy(ctx);
  await formLibrary(ctx);

  log('IRS / OFAC fixtures');
  const diligence = await importFixtures(ctx);
  ctx.counts.irs_exempt_orgs = diligence.irs;
  ctx.counts.sanctions_entries = diligence.sanctions;

  log('programs, forms and opportunities');
  const cat = await catalog(ctx);
  log('organizations');
  const og = await orgs(ctx);
  log('applications');
  const apps = await applications(ctx, cat, og);
  log('reviews');
  await reviews(ctx, cat, apps);
  log('awards and agreements');
  const aw = await awards(ctx, apps, { documents: opts.documents ?? true });
  log('bank, payees and payments');
  await payments(ctx, cat, aw);
  log('reports');
  const post = await postAward(ctx, cat, aw);
  log('board');
  await board(ctx, apps);
  log('agents and approval requests');
  const ag = await agents(ctx, cat, apps, aw, post.mayaUpcomingRequirementId);
  log('messages and notifications');
  await comms(ctx, apps, aw, ag.grantWriter.clientId);
  log('due diligence screenings');
  const screening = await screenGrantees(ctx, aw);
  ctx.counts.potential_matches = screening.potentialMatches;

  for (const r of ctx.refCounters) await ctx.setReferenceCounter(r.ws, r.kind, r.year, r.value);
  await ctx.flushAudit();
  // Populate the analytics matviews now so dashboards have data before the worker's first hourly refresh.
  log('analytics');
  await sql`select analytics.refresh_all()`.execute(ctx.db);

  return {
    mode: 'full',
    anchor: anchor.toISOString(),
    flagshipStatus: flagshipStatus(anchor),
    durationMs: Date.now() - started,
    counts: { ...ctx.counts },
    tokens: {
      grantWriterAssistant: { token: ag.grantWriter.token, tokenId: ag.grantWriter.tokenId, agentClientId: ag.grantWriter.clientId, ownerEmail: 'maya@eastside-youth-music.example', scopes: [...APPLICANT_SCOPES] },
      opsAssistant: { key: ag.ops.key, agentClientId: ag.ops.clientId, ownerEmail: 'jordan@halcyonridge.example', scopes: [...OPS_SCOPES] },
    },
    pendingApprovalIds: ag.pendingApprovals,
  };
}
