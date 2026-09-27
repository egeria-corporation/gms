// SPDX-License-Identifier: AGPL-3.0-only
// People (auth users + profiles + TOTP factors), the three workspaces, their brands, settings and teams.
import { seedTotpFactor } from '@gms/adapters';
import { sql } from '@gms/db';
import type { WorkspaceRole } from '@gms/domain';
import { json, type SeedContext } from '../context';
import { hexOf } from '../ids';
import { DEMO_USERS, demoTotpSecret, demoUser, type DemoUser, type DemoWorkspace } from '../people';

export interface TenantSpec {
  key: DemoWorkspace;
  slug: string;
  name: string;
  timezone: string;
  owner: string;
  primaryColor: string;
  accentColor: string;
  headingFont: 'Inter' | 'Source Serif 4' | 'Atkinson Hyperlegible' | 'Figtree';
  contactEmail: string;
  aboutMd: string;
  createdDaysAgo: number;
}

export const TENANTS: Record<DemoWorkspace, TenantSpec> = {
  halcyon: {
    key: 'halcyon',
    slug: 'halcyon',
    name: 'Halcyon Ridge Foundation',
    timezone: 'America/Los_Angeles',
    owner: 'helen',
    primaryColor: '#0F5E5A',
    accentColor: '#E0A526',
    headingFont: 'Source Serif 4',
    contactEmail: 'grants@halcyonridge.example',
    aboutMd: [
      '## About Halcyon Ridge Foundation',
      '',
      'For more than thirty years, Halcyon Ridge Foundation has invested in the people and places of **Alder, Bramble and Cinder Counties**. We believe the best ideas come from neighbors who already know what their communities need, so we fund local organizations with flexible, respectful grants and we keep our applications short.',
      '',
      'Today we give through three programs:',
      '',
      '- **Youth Arts Fund**: creative programs where young people ages 12–24 make, perform and lead.',
      '- **Neighborhood Food Security**: pantries, kitchens and growers making sure every family has enough to eat.',
      '- **Capacity Building Grants**: the unglamorous things (boards, books, systems) that help small nonprofits thrive.',
      '',
      'Have a question before you apply? Write to us at grants@halcyonridge.example. A real person will answer, usually within two business days.',
    ].join('\n'),
    createdDaysAgo: 700,
  },
  marigold: {
    key: 'marigold',
    slug: 'marigold',
    name: 'Marigold Street Fund',
    timezone: 'America/Chicago',
    owner: 'rosa',
    primaryColor: '#B4532A',
    accentColor: '#3F5B8C',
    headingFont: 'Figtree',
    contactEmail: 'hello@marigoldstreet.example',
    aboutMd:
      '## About Marigold Street Fund\n\nMarigold Street Fund is a small, neighbor-led fund that backs **community organizing**: tenant unions, block clubs, youth councils and the people who knock on doors. Our grants are small, fast and easy to apply for.',
    createdDaysAgo: 420,
  },
  sunbeam: {
    key: 'sunbeam',
    slug: 'sunbeam',
    name: 'Sunbeam Test Fund',
    timezone: 'America/Denver',
    owner: 'sam',
    primaryColor: '#F2D74B',
    accentColor: '#E0A526',
    headingFont: 'Atkinson Hyperlegible',
    contactEmail: 'grants@sunbeamtest.example',
    aboutMd: '## About Sunbeam Test Fund\n\nA demonstration workspace whose bright yellow brand color does not meet contrast requirements on its own. GMS adjusts it automatically so every page stays readable.',
    createdDaysAgo: 60,
  },
};

/** Creates (or finds) the auth user + profile for demo people, with deterministic ids. */
export async function createPeople(ctx: SeedContext, users: readonly DemoUser[], createdAt: (u: DemoUser) => string): Promise<void> {
  const auth = ctx.runtime.adapters.auth;
  for (const u of users) {
    const id = ctx.id(`user:${u.email}`);
    await sql`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
      values (${id}::uuid, ${u.email}, ${createdAt(u)}::timestamptz, ${JSON.stringify({ full_name: u.name })}::jsonb, ${createdAt(u)}::timestamptz)
      on conflict do nothing`.execute(ctx.db);
    // The auth adapter owns identities: this returns the row above (and proves magic-link sign-in will find it).
    const found = await auth.ensureUser({ email: u.email, fullName: u.name });
    await sql`insert into public.profiles (id, email, full_name, created_at) values (${found}::uuid, ${u.email}, ${u.name}, ${createdAt(u)}::timestamptz)
      on conflict (id) do update set full_name = excluded.full_name, created_at = excluded.created_at`.execute(ctx.db);
    ctx.people.set(u.key, { id: found, email: u.email, name: u.name });
  }
  ctx.bump('users', users.length);
}

/** Verified TOTP factors with known DEV-ONLY secrets (test auth mode only). */
export async function seedFactors(ctx: SeedContext, users: readonly DemoUser[]): Promise<number> {
  if (process.env.GMS_AUTH_MODE !== 'test') {
    ctx.log('GMS_AUTH_MODE is not "test": skipping TOTP factors (enroll them in the app instead).');
    return 0;
  }
  let n = 0;
  for (const u of users) {
    const p = ctx.person(u.key);
    const existing = await sql<{ n: number }>`select count(*)::int as n from gms_private.test_auth_factors where user_id = ${p.id}::uuid and status = 'verified'`.execute(ctx.db);
    if ((existing.rows[0]?.n ?? 0) > 0) continue;
    await seedTotpFactor(ctx.db, p.id, demoTotpSecret(u.email));
    n++;
  }
  ctx.bump('totp_factors', n);
  return n;
}

/** Creates a workspace through the setup action (system actor), then brands it as its owner. */
export async function createTenant(ctx: SeedContext, spec: TenantSpec): Promise<void> {
  const owner = demoUser(spec.owner);
  const out = await ctx.run<{ workspaceId: string; ownerId: string }>(
    'setup.create_workspace',
    {
      slug: spec.slug,
      name: spec.name,
      timezone: spec.timezone,
      ownerEmail: owner.email,
      ownerName: owner.name,
      primaryColor: spec.primaryColor,
      accentColor: spec.accentColor,
      headingFont: spec.headingFont,
      emailSenderName: spec.name,
    },
    ctx.system(null),
  );
  ctx.workspaces.set(spec.key, { id: out.workspaceId, slug: spec.slug, name: spec.name, timezone: spec.timezone });
  const created = ctx.clock.iso(-spec.createdDaysAgo);
  await ctx.db.updateTable('workspaces').set({ created_at: created }).where('id', '=', out.workspaceId).execute();
  await ctx.db
    .updateTable('workspace_members')
    .set({ title: owner.title, created_at: created })
    .where('workspace_id', '=', out.workspaceId)
    .where('user_id', '=', out.ownerId)
    .execute();

  // Settings through the action layer (system actor), branding as the owner (RLS applies; contrast is auto-fixed).
  await ctx.run('workspace.update', { publicContactEmail: spec.contactEmail, aboutMd: spec.aboutMd, transparencyEnabled: true }, ctx.system(spec.key));
  await ctx.run(
    'brand.update',
    {
      displayName: spec.name,
      primaryColor: spec.primaryColor,
      accentColor: spec.accentColor,
      headingFont: spec.headingFont,
      emailSenderName: spec.name,
      emailReplyTo: spec.contactEmail,
    },
    ctx.asPerson(spec.owner, spec.key, ['owner']),
  );
  ctx.bump('workspaces');
}

/** Adds the rest of a workspace's team (direct inserts, with a historical audit trail). */
export async function addTeam(ctx: SeedContext, key: DemoWorkspace): Promise<void> {
  const w = ctx.ws(key);
  const spec = TENANTS[key];
  const members = DEMO_USERS.filter((u) => u.workspace === key && u.key !== spec.owner);
  const rng = ctx.stream(`team:${key}`);
  const rows = members.map((u) => {
    const joined = ctx.clock.iso(-rng.int(40, spec.createdDaysAgo - 5));
    ctx.audit({
      workspace: key,
      at: joined,
      actor: ctx.human(spec.owner),
      action: 'team.invite',
      entityType: 'invitation',
      entityId: ctx.id(`invitation:${key}:${u.email}`),
      after: { email: u.email, role: u.role },
    });
    ctx.audit({ workspace: key, at: joined, actor: ctx.human(u.key), action: 'team.accept_invite', entityType: 'workspace_member', entityId: ctx.id(`member:${key}:${u.email}`), after: { role: u.role } });
    return {
      id: ctx.id(`member:${key}:${u.email}`),
      workspace_id: w.id,
      user_id: ctx.person(u.key).id,
      role: u.role as WorkspaceRole,
      title: u.title,
      review_capacity: u.role === 'reviewer' ? rng.int(12, 25) : null,
      mfa_required: !['reviewer', 'board'].includes(u.role),
      invited_by: ctx.person(spec.owner).id,
      created_at: joined,
      last_modified_at: joined,
    };
  });
  await ctx.insert('workspace_members', rows);
  await ctx.insert(
    'invitations',
    members.map((u) => ({
      id: ctx.id(`invitation:${key}:${u.email}`),
      workspace_id: w.id,
      email: u.email,
      role: u.role,
      token_hash: hexOf(`invitation:${key}:${u.email}`),
      status: 'accepted',
      invited_by: ctx.person(spec.owner).id,
      accepted_at: rows.find((r) => r.user_id === ctx.person(u.key).id)?.created_at ?? null,
      created_at: rows.find((r) => r.user_id === ctx.person(u.key).id)?.created_at,
    })),
  );
}

/** A pending invitation so the team page shows one. */
export async function pendingInvitation(ctx: SeedContext): Promise<void> {
  const w = ctx.ws('halcyon');
  await ctx.insert('invitations', [
    {
      id: ctx.id('invitation:halcyon:pending'),
      workspace_id: w.id,
      email: 'luis@halcyonridge.example',
      role: 'program_officer',
      token_hash: hexOf('invitation:halcyon:pending'),
      status: 'pending',
      invited_by: ctx.person('helen').id,
      expires_at: ctx.clock.iso(11),
      created_at: ctx.clock.iso(-3),
    },
  ]);
  ctx.audit({ workspace: 'halcyon', at: ctx.clock.iso(-3), actor: ctx.human('helen'), action: 'team.invite', entityType: 'invitation', entityId: ctx.id('invitation:halcyon:pending'), after: { email: 'luis@halcyonridge.example', role: 'program_officer' } });
}

/** Taxonomy terms for Halcyon (geography = the three counties). */
export async function taxonomy(ctx: SeedContext): Promise<void> {
  const w = ctx.ws('halcyon');
  const terms: [string, string, string][] = [
    ['geography', 'alder', 'Alder County'],
    ['geography', 'bramble', 'Bramble County'],
    ['geography', 'cinder', 'Cinder County'],
    ['cause', 'arts', 'Arts & culture'],
    ['cause', 'food', 'Food security'],
    ['cause', 'education', 'Education'],
    ['cause', 'health', 'Health & wellness'],
    ['cause', 'environment', 'Environment'],
    ['cause', 'housing', 'Housing'],
    ['cause', 'capacity', 'Nonprofit capacity'],
    ['population', 'youth-12-24', 'Youth ages 12–24'],
    ['population', 'families', 'Families with children'],
    ['population', 'older-adults', 'Older adults'],
  ];
  await ctx.insert(
    'taxonomy_terms',
    terms.map(([kind, code, label]) => ({ id: ctx.id(`term:${kind}:${code}`), workspace_id: w.id, kind, code, label, created_at: ctx.clock.iso(-600) })),
  );
  await ctx.insert('custom_field_definitions', [
    { id: ctx.id('cf:award:board_meeting'), workspace_id: w.id, entity: 'award', key: 'boardMeeting', label: 'Approved at board meeting', field_type: 'date', options: json([]), required: false },
    { id: ctx.id('cf:application:source'), workspace_id: w.id, entity: 'application', key: 'heardAbout', label: 'How they heard about us', field_type: 'select', options: json(['Newsletter', 'Word of mouth', 'Community event', 'Website']), required: false },
  ]);
}
