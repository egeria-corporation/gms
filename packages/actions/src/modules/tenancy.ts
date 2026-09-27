// SPDX-License-Identifier: AGPL-3.0-only
// Workspace settings, branding, team & roles, profile, notifications, account requests.
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '@gms/db';
import { DomainError, WORKSPACE_ROLES, type RiskTier } from '@gms/domain';
import { resolveBrand } from '@gms/ui/theme';
import { z } from 'zod';
import { defineAction, getAction } from '../define';
import { Email, found, Hex, IdOut, json, Ok, uid, uuid, ws } from './lib';

const HEADING_FONTS = ['Inter', 'Source Serif 4', 'Atkinson Hyperlegible', 'Figtree'] as const;

export const updateBrand = defineAction({
  id: 'brand.update',
  title: 'Update branding',
  description:
    'Updates the foundation branding (display name, colors, heading font, logo paths, email sender). Colors are automatically adjusted to meet WCAG AA contrast; the response lists any adjustments.',
  input: z.object({
    displayName: z.string().trim().min(1).max(120),
    primaryColor: Hex,
    accentColor: Hex,
    headingFont: z.enum(HEADING_FONTS),
    logoPath: z.string().max(400).nullable().optional(),
    faviconPath: z.string().max(400).nullable().optional(),
    emailSenderName: z.string().trim().max(120).nullable().optional(),
    emailReplyTo: z.string().trim().email().nullable().optional().or(z.literal('')),
    expectedVersion: z.number().int().optional(),
  }),
  output: z.object({ version: z.number(), warnings: z.array(z.object({ message: z.string() }).loose()) }),
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const before = found(await ctx.db.selectFrom('workspace_brand').selectAll().where('workspace_id', '=', w.id).executeTakeFirst(), 'brand');
    if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) {
      throw new DomainError('precondition_failed', 'Someone else saved branding changes. Reload to see them.', { currentVersion: before.version });
    }
    const resolved = resolveBrand({ primary: input.primaryColor, accent: input.accentColor, headingFont: input.headingFont });
    const row = await ctx.db
      .updateTable('workspace_brand')
      .set({
        display_name: input.displayName,
        primary_color: input.primaryColor.toUpperCase(),
        accent_color: input.accentColor.toUpperCase(),
        heading_font: input.headingFont,
        ...(input.logoPath !== undefined ? { logo_path: input.logoPath } : {}),
        ...(input.faviconPath !== undefined ? { favicon_path: input.faviconPath } : {}),
        email_sender_name: input.emailSenderName ?? null,
        email_reply_to: input.emailReplyTo || null,
        contrast_warnings: json(resolved.warnings),
        resolved_tokens: json(resolved.tokens),
        version: before.version + 1,
        updated_by: uid(ctx),
      })
      .where('workspace_id', '=', w.id)
      .returning(['version', 'primary_color', 'accent_color', 'heading_font', 'display_name'])
      .executeTakeFirstOrThrow();
    ctx.audit({
      entityType: 'workspace_brand',
      entityId: w.id,
      before: { primary: before.primary_color, accent: before.accent_color, font: before.heading_font, name: before.display_name },
      after: { primary: row.primary_color, accent: row.accent_color, font: row.heading_font, name: row.display_name },
    });
    ctx.emit('brand.updated', { type: 'workspace', id: w.id }, { version: row.version });
    return { version: row.version, warnings: resolved.warnings as unknown as { message: string }[] };
  },
});

export const updateWorkspace = defineAction({
  id: 'workspace.update',
  title: 'Update workspace settings',
  description: 'Updates workspace name, timezone, public contact, about text, and operational settings (scan requirement, overdue-report payment hold, second-approval threshold, transparency page).',
  input: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().min(3).max(64).optional(),
    publicContactEmail: z.string().email().nullable().optional(),
    aboutMd: z.string().max(10000).nullable().optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    scanRequired: z.boolean().optional(),
    overdueReportHold: z.boolean().optional(),
    secondApprovalThresholdCents: z.number().int().min(0).optional(),
    transparencyEnabled: z.boolean().optional(),
    retentionDays: z.number().int().min(365).optional(),
  }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    if (input.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
      } catch {
        throw new DomainError('validation_failed', 'Unknown timezone.', {}, [{ pointer: '/timezone', message: 'Pick a timezone from the list.' }]);
      }
    }
    const wsPatch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.publicContactEmail !== undefined ? { public_contact_email: input.publicContactEmail } : {}),
      ...(input.aboutMd !== undefined ? { about_md: input.aboutMd } : {}),
      ...(input.fiscalYearStartMonth !== undefined ? { fiscal_year_start_month: input.fiscalYearStartMonth } : {}),
    };
    if (Object.keys(wsPatch).length) await ctx.db.updateTable('workspaces').set(wsPatch).where('id', '=', w.id).execute();
    const setPatch = {
      ...(input.scanRequired !== undefined ? { scan_required: input.scanRequired } : {}),
      ...(input.overdueReportHold !== undefined ? { overdue_report_hold: input.overdueReportHold } : {}),
      ...(input.secondApprovalThresholdCents !== undefined ? { second_approval_threshold_cents: input.secondApprovalThresholdCents } : {}),
      ...(input.transparencyEnabled !== undefined ? { transparency_enabled: input.transparencyEnabled } : {}),
      ...(input.retentionDays !== undefined ? { retention_days: input.retentionDays } : {}),
    };
    if (Object.keys(setPatch).length) await ctx.db.updateTable('workspace_settings').set(setPatch).where('workspace_id', '=', w.id).execute();
    ctx.audit({ entityType: 'workspace', entityId: w.id, after: input });
    return { ok: true as const };
  },
});

export const setActionTier = defineAction({
  id: 'workspace.set_action_tier',
  title: 'Raise an action’s risk tier',
  description: 'Raises the risk tier of an action for this workspace (for example, require confirmation for saving answers). Tiers can only be raised; R3 can never be lowered.',
  input: z.object({ actionId: z.string(), tier: z.enum(['R0', 'R1', 'R2', 'R3']).nullable() }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R3',
  stepUp: true,
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const action = getAction(input.actionId);
    if (!action) throw new DomainError('not_found', 'Unknown action.');
    const order: Record<RiskTier, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };
    if (input.tier && order[input.tier] < order[action.riskTier]) {
      throw new DomainError('validation_failed', `Tiers can only be raised. "${action.title}" is ${action.riskTier} by default.`);
    }
    const s = await ctx.db.selectFrom('workspace_settings').select('action_tier_overrides').where('workspace_id', '=', w.id).executeTakeFirstOrThrow();
    const overrides = { ...(s.action_tier_overrides as Record<string, string>) };
    if (input.tier && input.tier !== action.riskTier) overrides[input.actionId] = input.tier;
    else delete overrides[input.actionId];
    await ctx.db.updateTable('workspace_settings').set({ action_tier_overrides: json(overrides) }).where('workspace_id', '=', w.id).execute();
    ctx.audit({ entityType: 'workspace_settings', entityId: w.id, before: s.action_tier_overrides, after: overrides });
    return { ok: true as const };
  },
});

// Team & roles --------------------------------------------------------------------
const Role = z.enum(WORKSPACE_ROLES);

export const inviteMember = defineAction({
  id: 'team.invite',
  title: 'Invite a team member',
  description: 'Invites a person to this workspace with a role. They receive an email with a link that expires in 14 days.',
  input: z.object({ email: Email, role: Role }),
  output: IdOut,
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    if (input.role === 'owner' && !ctx.roles.includes('owner')) throw new DomainError('forbidden', 'Only an owner can invite another owner.');
    const existing = await ctx.db
      .selectFrom('workspace_members as m')
      .innerJoin('profiles as p', 'p.id', 'm.user_id')
      .select('m.id')
      .where('m.workspace_id', '=', w.id)
      .where(sql<boolean>`lower(p.email) = ${input.email}`)
      .executeTakeFirst();
    if (existing) throw new DomainError('conflict', 'That person is already on the team.');
    await ctx.db
      .updateTable('invitations')
      .set({ status: 'revoked' })
      .where('workspace_id', '=', w.id)
      .where('status', '=', 'pending')
      .where(sql<boolean>`lower(email) = ${input.email}`)
      .execute();
    const token = randomBytes(24).toString('base64url');
    const row = await ctx.db
      .insertInto('invitations')
      .values({
        workspace_id: w.id,
        email: input.email,
        role: input.role,
        token_hash: createHash('sha256').update(token).digest('hex'),
        invited_by: uid(ctx),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'invitation', entityId: row.id, after: { email: input.email, role: input.role } });
    ctx.emit('team.invited', { type: 'invitation', id: row.id }, { email: input.email, role: input.role, token, sensitive: ['token'] });
    return { id: row.id };
  },
});

export const revokeInvite = defineAction({
  id: 'team.revoke_invite',
  title: 'Revoke an invitation',
  description: 'Revokes a pending team invitation.',
  input: z.object({ invitationId: uuid }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const r = await ctx.db
      .updateTable('invitations')
      .set({ status: 'revoked' })
      .where('id', '=', input.invitationId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new DomainError('not_found', 'That invitation is not pending.');
    ctx.audit({ entityType: 'invitation', entityId: input.invitationId, after: { status: 'revoked' } });
    return { ok: true as const };
  },
});

export const acceptInvite = defineAction({
  id: 'team.accept_invite',
  title: 'Accept a team invitation',
  description: 'Accepts a workspace invitation for the signed-in person (the email must match the invitation).',
  input: z.object({ token: z.string().min(10) }),
  output: z.object({ workspaceId: z.string().uuid(), role: z.string() }),
  scopes: [],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const hash = createHash('sha256').update(input.token).digest('hex');
    const r = await sql<{ workspace_id: string; role: string }>`select * from gms.accept_invitation(${hash})`.execute(ctx.db);
    const row = r.rows[0];
    if (!row) throw new DomainError('not_found', 'This invitation link is not valid, has expired, or is for a different email address.');
    ctx.audit({ entityType: 'workspace_member', entityId: null, after: { workspaceId: row.workspace_id, role: row.role, userId: uid(ctx) } });
    ctx.emit('team.member_joined', { type: 'workspace', id: row.workspace_id }, { userId: uid(ctx), role: row.role });
    return { workspaceId: row.workspace_id, role: row.role };
  },
});

export const changeRole = defineAction({
  id: 'team.change_role',
  title: 'Change a team member’s role',
  description: 'Changes a team member’s role. People only (R3), with authenticator step-up. The last owner cannot be demoted.',
  input: z.object({ memberId: uuid, role: Role }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R3',
  stepUp: true,
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const m = found(await ctx.db.selectFrom('workspace_members').selectAll().where('id', '=', input.memberId).where('workspace_id', '=', w.id).executeTakeFirst(), 'team member');
    if ((m.role === 'owner' || input.role === 'owner') && !ctx.roles.includes('owner')) {
      throw new DomainError('forbidden', 'Only an owner can change owner roles.');
    }
    if (m.role === 'owner' && input.role !== 'owner') {
      const owners = await ctx.db.selectFrom('workspace_members').select('id').where('workspace_id', '=', w.id).where('role', '=', 'owner').where('status', '=', 'active').execute();
      if (owners.length <= 1) throw new DomainError('invariant_violated', 'A workspace needs at least one owner. Make someone else an owner first.');
    }
    await ctx.db.updateTable('workspace_members').set({ role: input.role }).where('id', '=', m.id).execute();
    ctx.audit({ entityType: 'workspace_member', entityId: m.id, before: { role: m.role }, after: { role: input.role } });
    ctx.emit('team.role_changed', { type: 'workspace_member', id: m.id }, { from: m.role, to: input.role, userId: m.user_id });
    return { ok: true as const };
  },
});

export const removeMember = defineAction({
  id: 'team.remove_member',
  title: 'Remove a team member',
  description: 'Removes a person from the workspace. People only (R3), with step-up.',
  input: z.object({ memberId: uuid }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin'],
  riskTier: 'R3',
  stepUp: true,
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const m = found(await ctx.db.selectFrom('workspace_members').selectAll().where('id', '=', input.memberId).where('workspace_id', '=', w.id).executeTakeFirst(), 'team member');
    if (m.user_id === uid(ctx)) throw new DomainError('invariant_violated', 'You cannot remove yourself. Ask another admin.');
    if (m.role === 'owner') throw new DomainError('forbidden', 'Change this owner’s role before removing them.');
    await ctx.db.deleteFrom('workspace_members').where('id', '=', m.id).execute();
    ctx.audit({ entityType: 'workspace_member', entityId: m.id, before: { role: m.role, userId: m.user_id } });
    return { ok: true as const };
  },
});

export const setReviewerCapacity = defineAction({
  id: 'team.set_review_capacity',
  title: 'Set reviewer capacity',
  description: 'Sets how many applications a reviewer can take in a stage (used by auto-assignment).',
  input: z.object({ memberId: uuid, capacity: z.number().int().min(0).max(500).nullable() }),
  output: Ok,
  scopes: [],
  roles: ['owner', 'admin', 'program_officer'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db.updateTable('workspace_members').set({ review_capacity: input.capacity }).where('id', '=', input.memberId).execute();
    ctx.audit({ entityType: 'workspace_member', entityId: input.memberId, after: { capacity: input.capacity } });
    return { ok: true as const };
  },
});

// Profile & account -----------------------------------------------------------------
export const updateProfile = defineAction({
  id: 'profile.update',
  title: 'Update your profile',
  description: 'Updates the signed-in person’s name and notification preferences.',
  input: z.object({
    fullName: z.string().trim().min(1).max(200).optional(),
    notificationPrefs: z.object({ email: z.boolean(), in_app: z.boolean(), digest: z.enum(['off', 'daily', 'weekly']) }).optional(),
  }),
  output: Ok,
  scopes: ['profile:write'],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const me = uid(ctx);
    await ctx.db
      .updateTable('profiles')
      .set({
        ...(input.fullName !== undefined ? { full_name: input.fullName } : {}),
        ...(input.notificationPrefs ? { notification_prefs: json(input.notificationPrefs) } : {}),
      })
      .where('id', '=', me)
      .execute();
    ctx.audit({ entityType: 'profile', entityId: me, after: input });
    return { ok: true as const };
  },
});

export const requestAccountDeletion = defineAction({
  id: 'account.request_deletion',
  title: 'Request account deletion',
  description: 'Asks GMS to delete the signed-in person’s account. Submitted applications are kept as required by the foundation’s records policy; personal details are removed.',
  input: z.object({ confirm: z.literal(true) }),
  output: Ok,
  scopes: [],
  roles: ['authenticated'],
  riskTier: 'R3',
  idempotent: true,
  requiresWorkspace: false,
  async run(_input, ctx) {
    const me = uid(ctx);
    await ctx.db.updateTable('profiles').set({ deletion_requested_at: new Date().toISOString() }).where('id', '=', me).execute();
    ctx.audit({ entityType: 'profile', entityId: me, after: { deletionRequested: true } });
    ctx.emit('account.deletion_requested', { type: 'profile', id: me });
    return { ok: true as const };
  },
});

export const markNotificationsRead = defineAction({
  id: 'notifications.mark_read',
  title: 'Mark notifications read',
  description: 'Marks notifications as read (all, or the given ids).',
  input: z.object({ ids: z.array(uuid).max(200).optional() }),
  output: Ok,
  scopes: [],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    let q = ctx.db.updateTable('notifications').set({ read_at: new Date().toISOString() }).where('user_id', '=', uid(ctx)).where('read_at', 'is', null);
    if (input.ids?.length) q = q.where('id', 'in', input.ids);
    await q.execute();
    return { ok: true as const };
  },
});

export const saveView = defineAction({
  id: 'views.save',
  title: 'Save a table view',
  description: 'Saves a named table view (filters, columns, density) for the console.',
  input: z.object({ id: uuid.optional(), surface: z.string().max(60), name: z.string().trim().min(1).max(80), config: z.record(z.string(), z.unknown()), shared: z.boolean().default(false) }),
  output: IdOut,
  scopes: [],
  roles: ['owner', 'admin', 'program_officer', 'finance', 'auditor'],
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    if (input.id) {
      await ctx.db.updateTable('saved_views').set({ name: input.name, config: json(input.config), shared: input.shared }).where('id', '=', input.id).where('user_id', '=', uid(ctx)).execute();
      return { id: input.id };
    }
    const r = await ctx.db
      .insertInto('saved_views')
      .values({ workspace_id: w.id, user_id: uid(ctx), surface: input.surface, name: input.name, config: json(input.config), shared: input.shared })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: r.id };
  },
});
