// SPDX-License-Identifier: AGPL-3.0-only
// Platform: exports & saved reports, API keys, outbound webhook endpoints, agent credentials & AI-use policy,
// setup wizard (first workspace), operator console (tenants, time-boxed support access, flags).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from '@gms/db';
import { ALL_SCOPES, DomainError, parseScopes, SCOPES, slugify, type Scope } from '@gms/domain';
import { z } from 'zod';
import { defineAction } from '../define';
import { Email, found, Hex, IdOut, json, Ok, Slug, uid, uuid, ws } from './lib';

const ADMIN = ['owner', 'admin'] as const;
const ScopeList = z.array(z.string()).max(40).transform((s) => parseScopes(s));

function newSecret(prefix: string): { token: string; prefix: string; hash: string } {
  const body = randomBytes(24).toString('base64url');
  const token = `${prefix}_${body}`;
  return { token, prefix: token.slice(0, prefix.length + 7), hash: createHash('sha256').update(token).digest('hex') };
}

// Exports & reports -------------------------------------------------------------------------------------
export const requestExport = defineAction({
  id: 'exports.request',
  title: 'Request an export',
  description: 'Queues a CSV/XLSX export of a curated dataset (applications, awards, payments, reports, 990-PF grants-paid schedule) or a full workspace export (JSON + CommonGrants bundle). You are notified when it is ready.',
  input: z.object({
    kind: z.enum(['applications', 'awards', 'payments', 'reports', 'grantees', 'form_990pf', 'qualifying_distributions', 'workspace', 'report_definition']),
    format: z.enum(['csv', 'xlsx', 'json', 'zip']).default('csv'),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
  output: z.object({ exportId: z.string().uuid() }),
  scopes: ['analytics:read'],
  roles: ['owner', 'admin', 'program_officer', 'finance', 'auditor'],
  riskTier: 'R1',
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    if (input.kind === 'workspace' && !ctx.roles.some((r) => r === 'owner' || r === 'admin')) {
      throw new DomainError('forbidden', 'Only owners and admins can export the whole workspace.');
    }
    const r = await ctx.db
      .insertInto('exports')
      .values({ workspace_id: w.id, kind: input.kind, format: input.kind === 'workspace' ? 'zip' : input.format, params: json(input.params), status: 'queued', requested_by: uid(ctx) })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'export', entityId: r.id, after: { kind: input.kind, format: input.format } });
    ctx.emit('export.requested', { type: 'export', id: r.id }, { kind: input.kind });
    return { exportId: r.id };
  },
});

// API keys (R3: credential issuance is people-only) --------------------------------------------------------
export const createApiKey = defineAction({
  id: 'api_keys.create',
  title: 'Create an API key',
  description: 'Creates a workspace API key with the given scopes. The key is shown once; GMS stores only a hash. People only (R3).',
  input: z.object({ name: z.string().trim().min(1).max(100), scopes: ScopeList, expiresInDays: z.number().int().min(1).max(730).nullable().default(365) }),
  output: z.object({ id: z.string().uuid(), key: z.string(), prefix: z.string() }),
  scopes: [],
  roles: ADMIN,
  riskTier: 'R3',
  stepUp: true,
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    const s = newSecret('gms_sk');
    const r = await ctx.db
      .insertInto('api_keys')
      .values({ workspace_id: w.id, name: input.name, prefix: s.prefix, key_hash: s.hash, scopes: input.scopes, owner_id: uid(ctx), expires_at: input.expiresInDays ? new Date(ctx.now().getTime() + input.expiresInDays * 86400000).toISOString() : null })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'api_key', entityId: r.id, after: { name: input.name, scopes: input.scopes, prefix: s.prefix } });
    return { id: r.id, key: s.token, prefix: s.prefix };
  },
});

export const revokeApiKey = defineAction({
  id: 'api_keys.revoke',
  title: 'Revoke an API key',
  description: 'Revokes an API key immediately.',
  input: z.object({ id: uuid }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db.updateTable('api_keys').set({ revoked_at: ctx.now().toISOString() }).where('id', '=', input.id).execute();
    ctx.audit({ entityType: 'api_key', entityId: input.id, after: { revoked: true } });
    return { ok: true as const };
  },
});

// Outbound webhooks ---------------------------------------------------------------------------------------------
export const WEBHOOK_EVENTS = [
  'opportunity.published',
  'application.submitted',
  'application.status_changed',
  'review.submitted',
  'decision.recorded',
  'award.created',
  'award.amended',
  'payee.onboarded',
  'payment.requested',
  'payment.approved',
  'payment.sent',
  'payment.failed',
  'report.due',
  'report.submitted',
] as const;

export const saveWebhookEndpoint = defineAction({
  id: 'webhooks.save_endpoint',
  title: 'Save a webhook endpoint',
  description: 'Creates or updates an outbound webhook endpoint. Deliveries are signed with HMAC-SHA256; the signing secret is shown once on creation. People only (R3) because it sends data out of GMS.',
  input: z.object({ id: uuid.optional(), url: z.string().url().max(500), description: z.string().max(300).optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1), status: z.enum(['active', 'disabled']).default('active') }),
  output: z.object({ id: z.string().uuid(), secret: z.string().nullable() }),
  scopes: [],
  roles: ADMIN,
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const url = new URL(input.url);
    if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new DomainError('validation_failed', 'Webhook URLs must use HTTPS.');
    if (input.id) {
      await ctx.db.updateTable('webhook_endpoints').set({ url: input.url, description: input.description ?? null, events: input.events, status: input.status }).where('id', '=', input.id).execute();
      ctx.audit({ entityType: 'webhook_endpoint', entityId: input.id, after: { url: input.url, events: input.events, status: input.status } });
      return { id: input.id, secret: null };
    }
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const ref = await ctx.deps.secrets.put(`webhook:${w.id}`, secret, { workspaceId: w.id });
    const r = await ctx.db
      .insertInto('webhook_endpoints')
      .values({ workspace_id: w.id, url: input.url, description: input.description ?? null, events: input.events, secret_ref: ref, status: input.status, created_by: uid(ctx) })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'webhook_endpoint', entityId: r.id, after: { url: input.url, events: input.events } });
    return { id: r.id, secret };
  },
});

export const deleteWebhookEndpoint = defineAction({
  id: 'webhooks.delete_endpoint',
  title: 'Delete a webhook endpoint',
  description: 'Deletes an outbound webhook endpoint.',
  input: z.object({ id: uuid }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db.deleteFrom('webhook_endpoints').where('id', '=', input.id).execute();
    ctx.audit({ entityType: 'webhook_endpoint', entityId: input.id, before: { deleted: true } });
    return { ok: true as const };
  },
});

// Agents -----------------------------------------------------------------------------------------------------------
export const createPat = defineAction({
  id: 'agents.create_token',
  title: 'Connect an agent with a token',
  description: 'Creates a personal access token so an AI agent can act for you with the scopes you choose. Shown once. Consequential actions still ask you to confirm in GMS. People only (R3).',
  input: z.object({ agentName: z.string().trim().min(1).max(100), scopes: ScopeList, expiresInDays: z.number().int().min(1).max(365).default(90), workspaceBound: z.boolean().default(true) }),
  output: z.object({ tokenId: z.string().uuid(), token: z.string(), clientId: z.string().uuid() }),
  scopes: [],
  roles: ['authenticated'],
  riskTier: 'R3',
  idempotent: false,
  requiresWorkspace: false,
  async run(input, ctx) {
    const me = uid(ctx);
    if (!input.scopes.length) throw new DomainError('validation_failed', 'Choose at least one permission.');
    const staffScopes = input.scopes.filter((s) => SCOPES[s].audience === 'staff');
    const isStaff = ctx.roles.some((r) => ['owner', 'admin', 'program_officer', 'finance', 'auditor'].includes(r));
    if (staffScopes.length && !isStaff) throw new DomainError('forbidden', `Only foundation staff can grant: ${staffScopes.join(', ')}.`);
    const client = await ctx.db
      .insertInto('agent_clients')
      .values({ client_id: `pat_${randomUUID()}`, name: input.agentName, kind: 'pat_client', owner_user_id: me, scopes: input.scopes, registration: 'manual', workspace_id: null })
      .returning('id')
      .executeTakeFirstOrThrow();
    const s = newSecret('gms_pat');
    const t = await ctx.db
      .insertInto('personal_access_tokens')
      .values({
        user_id: me,
        workspace_id: input.workspaceBound ? (ctx.workspace?.id ?? null) : null,
        agent_client_id: client.id,
        name: input.agentName,
        prefix: s.prefix,
        token_hash: s.hash,
        scopes: input.scopes,
        audience: ['mcp', 'a2a', 'api'],
        expires_at: new Date(ctx.now().getTime() + input.expiresInDays * 86400000).toISOString(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'personal_access_token', entityId: t.id, after: { agentName: input.agentName, scopes: input.scopes, prefix: s.prefix } });
    return { tokenId: t.id, token: s.token, clientId: client.id };
  },
});

export const revokeAgentAccess = defineAction({
  id: 'agents.revoke',
  title: 'Revoke or pause an agent',
  description: 'Pauses, resumes or revokes an agent’s access: a token, a consent grant, or (for admins) an agent account.',
  input: z.object({ kind: z.enum(['token', 'grant', 'client']), id: uuid, action: z.enum(['pause', 'resume', 'revoke']) }),
  output: Ok,
  scopes: [],
  roles: ['authenticated'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const now = ctx.now().toISOString();
    if (input.kind === 'token') {
      const r = await ctx.db
        .updateTable('personal_access_tokens')
        .set(input.action === 'revoke' ? { revoked_at: now } : {})
        .where('id', '=', input.id)
        .where('user_id', '=', uid(ctx))
        .returning('agent_client_id')
        .executeTakeFirst();
      if (!r) throw new DomainError('not_found', 'Token not found.');
      if (r.agent_client_id && input.action !== 'revoke') {
        await ctx.db.updateTable('agent_clients').set({ status: input.action === 'pause' ? 'paused' : 'active' }).where('id', '=', r.agent_client_id).execute();
      }
    } else if (input.kind === 'grant') {
      const status = input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'revoked';
      const r = await ctx.db.updateTable('agent_grants').set({ status }).where('id', '=', input.id).where('user_id', '=', uid(ctx)).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw new DomainError('not_found', 'Connection not found.');
    } else {
      const status = input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'revoked';
      const r = await ctx.db.updateTable('agent_clients').set({ status }).where('id', '=', input.id).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw new DomainError('forbidden', 'Only the owner or a workspace admin can change this agent.');
    }
    ctx.audit({ entityType: `agent_${input.kind}`, entityId: input.id, after: { action: input.action } });
    return { ok: true as const };
  },
});

export const createAgentAccount = defineAction({
  id: 'agents.create_account',
  title: 'Create an agent account',
  description: 'Creates a foundation-owned agent account (e.g. an operations assistant) with an owner, scopes, a tool allowlist and a rate limit; returns an API key shown once. People only (R3).',
  input: z.object({ name: z.string().trim().min(1).max(100), ownerUserId: uuid, scopes: ScopeList, toolAllowlist: z.array(z.string().max(80)).max(100).nullable().default(null), rateLimitPerMin: z.number().int().min(1).max(600).default(60), homepageUrl: z.string().url().optional() }),
  output: z.object({ clientId: z.string().uuid(), key: z.string() }),
  scopes: [],
  roles: ADMIN,
  riskTier: 'R3',
  stepUp: true,
  idempotent: false,
  async run(input, ctx) {
    const w = ws(ctx);
    const c = await ctx.db
      .insertInto('agent_clients')
      .values({ workspace_id: w.id, client_id: `agent_${slugify(input.name)}_${randomBytes(4).toString('hex')}`, name: input.name, kind: 'agent_account', owner_user_id: input.ownerUserId, scopes: input.scopes, tool_allowlist: input.toolAllowlist, rate_limit_per_min: input.rateLimitPerMin, homepage_url: input.homepageUrl ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    const s = newSecret('gms_ak');
    await ctx.db.insertInto('api_keys').values({ workspace_id: w.id, name: `${input.name} key`, prefix: s.prefix, key_hash: s.hash, scopes: input.scopes, owner_id: input.ownerUserId, agent_client_id: c.id }).execute();
    ctx.audit({ entityType: 'agent_client', entityId: c.id, after: { name: input.name, owner: input.ownerUserId, scopes: input.scopes } });
    return { clientId: c.id, key: s.token };
  },
});

export const updateAgentAccount = defineAction({
  id: 'agents.update_account',
  title: 'Update an agent account',
  description: 'Changes an agent account’s scopes, tool allowlist, or rate limit. Scopes can never include people-only actions.',
  input: z.object({ clientId: uuid, scopes: ScopeList.optional(), toolAllowlist: z.array(z.string()).max(100).nullable().optional(), rateLimitPerMin: z.number().int().min(1).max(600).optional() }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R3',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db
      .updateTable('agent_clients')
      .set({ ...(input.scopes ? { scopes: input.scopes } : {}), ...(input.toolAllowlist !== undefined ? { tool_allowlist: input.toolAllowlist } : {}), ...(input.rateLimitPerMin ? { rate_limit_per_min: input.rateLimitPerMin } : {}) })
      .where('id', '=', input.clientId)
      .execute();
    if (input.scopes) await ctx.db.updateTable('api_keys').set({ scopes: input.scopes }).where('agent_client_id', '=', input.clientId).execute();
    ctx.audit({ entityType: 'agent_client', entityId: input.clientId, after: input });
    return { ok: true as const };
  },
});

export const updateAiPolicy = defineAction({
  id: 'agents.update_policy',
  title: 'Update the AI-use policy',
  description: 'Sets the foundation’s AI-use policy for applicants (allowed, allowed with disclosure, or not allowed), reviewer assistance, and kill switches for agent submissions, MCP and A2A.',
  input: z.object({
    aiUse: z.enum(['allowed', 'disclosure', 'prohibited']),
    disclosurePrompt: z.string().trim().min(10).max(500).optional(),
    reviewerAssist: z.boolean(),
    agentSubmissionsEnabled: z.boolean(),
    mcpEnabled: z.boolean(),
    a2aEnabled: z.boolean(),
  }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const before = await ctx.db.selectFrom('agent_policies').selectAll().where('workspace_id', '=', w.id).executeTakeFirst();
    await ctx.db
      .updateTable('agent_policies')
      .set({
        ai_use: input.aiUse,
        ...(input.disclosurePrompt ? { disclosure_prompt: input.disclosurePrompt } : {}),
        reviewer_assist: input.reviewerAssist,
        agent_submissions_enabled: input.agentSubmissionsEnabled,
        mcp_enabled: input.mcpEnabled,
        a2a_enabled: input.a2aEnabled,
      })
      .where('workspace_id', '=', w.id)
      .execute();
    ctx.audit({ entityType: 'agent_policy', entityId: w.id, before, after: input });
    return { ok: true as const };
  },
});

export const setLlmKey = defineAction({
  id: 'agents.set_model_key',
  title: 'Set the model provider key',
  description: 'Stores an optional model-provider API key (Anthropic or OpenAI-compatible) for built-in assistants, in the SecretStore. People only (R3).',
  input: z.object({ provider: z.enum(['anthropic', 'openai']).nullable(), apiKey: z.string().min(10).max(400).optional() }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R3',
  stepUp: true,
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    let ref: string | null = null;
    if (input.provider && input.apiKey) ref = await ctx.deps.secrets.put(`llm:${w.id}`, input.apiKey, { workspaceId: w.id });
    await ctx.db.updateTable('agent_policies').set({ llm_provider: input.provider, llm_key_ref: ref }).where('workspace_id', '=', w.id).execute();
    ctx.audit({ entityType: 'agent_policy', entityId: w.id, action: 'agents.set_model_key', after: { provider: input.provider, keySet: Boolean(ref) } });
    return { ok: true as const };
  },
});

// OAuth consent (O-01) ----------------------------------------------------------------------------------------------
export const grantConsent = defineAction({
  id: 'oauth.grant_consent',
  title: 'Allow an agent to act for you',
  description: 'Records a person’s consent for an OAuth client with the (possibly narrowed) scopes and duration they chose. People only (R3).',
  input: z.object({ clientId: uuid, scopes: ScopeList, durationDays: z.number().int().min(1).max(365).default(90) }),
  output: z.object({ grantId: z.string().uuid() }),
  scopes: [],
  roles: ['authenticated'],
  riskTier: 'R3',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const me = uid(ctx);
    const client = found(await ctx.db.selectFrom('agent_clients').select(['id', 'scopes', 'status', 'name']).where('id', '=', input.clientId).executeTakeFirst(), 'agent');
    if (client.status !== 'active') throw new DomainError('forbidden', 'This agent has been paused or revoked.');
    const allowed = input.scopes.filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s));
    await ctx.db.updateTable('agent_grants').set({ status: 'revoked' }).where('client_id', '=', client.id).where('user_id', '=', me).where('status', '=', 'active').execute();
    const g = await ctx.db
      .insertInto('agent_grants')
      .values({ client_id: client.id, user_id: me, workspace_id: ctx.workspace?.id ?? null, scopes: allowed, status: 'active', expires_at: new Date(ctx.now().getTime() + input.durationDays * 86400000).toISOString() })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'agent_grant', entityId: g.id, after: { client: client.name, scopes: allowed, days: input.durationDays } });
    return { grantId: g.id };
  },
});

// Custom fields & taxonomies (S-08) -------------------------------------------------------------------------------------
export const saveCustomField = defineAction({
  id: 'settings.save_custom_field',
  title: 'Save a custom field',
  description: 'Defines a custom field for applications, organizations, awards or opportunities (exposed in CommonGrants customFields).',
  input: z.object({ id: uuid.optional(), entity: z.enum(['application', 'org', 'award', 'opportunity']), key: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/).max(60), label: z.string().trim().min(1).max(120), fieldType: z.enum(['text', 'number', 'date', 'select', 'boolean', 'currency']), options: z.array(z.string().max(80)).max(50).default([]), required: z.boolean().default(false) }),
  output: IdOut,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const values = { entity: input.entity, key: input.key, label: input.label, field_type: input.fieldType, options: json(input.options), required: input.required };
    if (input.id) {
      await ctx.db.updateTable('custom_field_definitions').set(values).where('id', '=', input.id).execute();
      return { id: input.id };
    }
    const r = await ctx.db.insertInto('custom_field_definitions').values({ ...values, workspace_id: w.id }).returning('id').executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'custom_field', entityId: r.id, after: values });
    return { id: r.id };
  },
});

export const saveTaxonomyTerm = defineAction({
  id: 'settings.save_term',
  title: 'Save a taxonomy term',
  description: 'Adds or renames a cause-area, geography or population term.',
  input: z.object({ id: uuid.optional(), kind: z.enum(['cause', 'geography', 'population']), code: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(120), parentId: uuid.nullable().optional() }),
  output: IdOut,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    if (input.id) {
      await ctx.db.updateTable('taxonomy_terms').set({ code: input.code, label: input.label, parent_id: input.parentId ?? null }).where('id', '=', input.id).execute();
      return { id: input.id };
    }
    const r = await ctx.db.insertInto('taxonomy_terms').values({ workspace_id: w.id, kind: input.kind, code: input.code, label: input.label, parent_id: input.parentId ?? null }).returning('id').executeTakeFirstOrThrow();
    return { id: r.id };
  },
});

export const deleteTaxonomyTerm = defineAction({
  id: 'settings.delete_term',
  title: 'Delete a taxonomy term',
  description: 'Deletes a taxonomy term.',
  input: z.object({ id: uuid }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db.deleteFrom('taxonomy_terms').where('id', '=', input.id).execute();
    return { ok: true as const };
  },
});

// Setup wizard (F) — runs as the system actor, only while no workspace exists (or for operators in multi-tenant mode).
export const createWorkspace = defineAction({
  id: 'setup.create_workspace',
  title: 'Create a workspace',
  description: 'Creates a foundation workspace with its owner, brand and defaults. Used by the setup wizard (F-01…F-05), `pnpm run setup`, and the operator console.',
  input: z.object({
    slug: Slug,
    name: z.string().trim().min(2).max(200),
    timezone: z.string().default('America/Los_Angeles'),
    ownerEmail: Email,
    ownerName: z.string().trim().min(1).max(200),
    primaryColor: Hex.default('#1F4E79'),
    accentColor: Hex.default('#C9822B'),
    headingFont: z.enum(['Inter', 'Source Serif 4', 'Atkinson Hyperlegible', 'Figtree']).default('Inter'),
    emailSenderName: z.string().max(120).optional(),
  }),
  output: z.object({ workspaceId: z.string().uuid(), ownerId: z.string().uuid() }),
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const taken = await ctx.db.selectFrom('workspaces').select('id').where('slug', '=', input.slug).executeTakeFirst();
    if (taken) throw new DomainError('conflict', 'That web address is taken. Choose another.', {}, [{ pointer: '/slug', message: 'Already in use.' }]);
    const w = await ctx.db.insertInto('workspaces').values({ slug: input.slug, name: input.name, timezone: input.timezone }).returning('id').executeTakeFirstOrThrow();
    const ownerId = ctx.deps.auth ? await ctx.deps.auth.ensureUser({ email: input.ownerEmail, fullName: input.ownerName }) : randomUUID();
    await sql`insert into public.profiles (id, email, full_name) values (${ownerId}::uuid, ${input.ownerEmail}, ${input.ownerName})
      on conflict (id) do update set full_name = coalesce(public.profiles.full_name, excluded.full_name)`.execute(ctx.db);
    await ctx.db.insertInto('workspace_members').values({ workspace_id: w.id, user_id: ownerId, role: 'owner' }).execute();
    await ctx.db
      .updateTable('workspace_brand')
      .set({ display_name: input.name, primary_color: input.primaryColor, accent_color: input.accentColor, heading_font: input.headingFont, email_sender_name: input.emailSenderName ?? input.name })
      .where('workspace_id', '=', w.id)
      .execute();
    ctx.audit({ entityType: 'workspace', entityId: w.id, action: 'setup.create_workspace', after: { slug: input.slug, name: input.name, owner: input.ownerEmail } });
    ctx.emit('workspace.created', { type: 'workspace', id: w.id }, { slug: input.slug });
    return { workspaceId: w.id, ownerId };
  },
});

// Operator console (G) -----------------------------------------------------------------------------------------------------
export const requestSupportAccess = defineAction({
  id: 'operator.grant_support_access',
  title: 'Grant time-boxed support access',
  description: 'A workspace owner/admin consents to platform-operator support access for up to 72 hours, with a reason. Every access is audited.',
  input: z.object({ operatorUserId: uuid, reason: z.string().trim().min(10).max(1000), hours: z.number().int().min(1).max(72).default(24) }),
  output: IdOut,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R3',
  stepUp: true,
  idempotent: true,
  async run(input, ctx) {
    const w = ws(ctx);
    const r = await ctx.db
      .insertInto('support_access_grants')
      .values({ workspace_id: w.id, operator_user_id: input.operatorUserId, granted_by: uid(ctx), reason: input.reason, expires_at: new Date(ctx.now().getTime() + input.hours * 3600000).toISOString() })
      .returning('id')
      .executeTakeFirstOrThrow();
    ctx.audit({ entityType: 'support_access_grant', entityId: r.id, after: { operator: input.operatorUserId, hours: input.hours, reason: input.reason } });
    return { id: r.id };
  },
});

export const revokeSupportAccess = defineAction({
  id: 'operator.revoke_support_access',
  title: 'Revoke support access',
  description: 'Ends a support-access grant immediately.',
  input: z.object({ id: uuid }),
  output: Ok,
  scopes: [],
  roles: ADMIN,
  riskTier: 'R1',
  idempotent: true,
  async run(input, ctx) {
    await ctx.db.updateTable('support_access_grants').set({ revoked_at: ctx.now().toISOString() }).where('id', '=', input.id).execute();
    ctx.audit({ entityType: 'support_access_grant', entityId: input.id, after: { revoked: true } });
    return { ok: true as const };
  },
});

export const setFeatureFlags = defineAction({
  id: 'operator.set_flags',
  title: 'Set workspace feature flags',
  description: 'System/operator: sets feature flags or status for a tenant (e.g. SSO, Mercury OAuth, direct send stub).',
  input: z.object({ workspaceId: uuid, flags: z.record(z.string(), z.boolean()).optional(), status: z.enum(['active', 'suspended', 'archived']).optional(), plan: z.enum(['self_hosted', 'free', 'standard', 'enterprise']).optional() }),
  output: Ok,
  scopes: [],
  roles: ['system'],
  riskTier: 'R1',
  idempotent: true,
  requiresWorkspace: false,
  async run(input, ctx) {
    const w = found(await ctx.db.selectFrom('workspaces').select(['feature_flags', 'status', 'plan']).where('id', '=', input.workspaceId).executeTakeFirst(), 'workspace');
    await ctx.db
      .updateTable('workspaces')
      .set({
        ...(input.flags ? { feature_flags: json({ ...(w.feature_flags as object), ...input.flags }) } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.plan ? { plan: input.plan } : {}),
      })
      .where('id', '=', input.workspaceId)
      .execute();
    ctx.audit({ entityType: 'workspace', entityId: input.workspaceId, action: 'operator.set_flags', before: w, after: input });
    return { ok: true as const };
  },
});
