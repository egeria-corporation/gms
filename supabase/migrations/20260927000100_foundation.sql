-- SPDX-License-Identifier: AGPL-3.0-only
-- GMS foundation: extensions, roles, helper functions, tenancy, identity,
-- applicant commons, platform tables (audit, outbox, webhooks) and agent tables.
--
-- RLS model: application requests run inside a transaction that sets
--   role = gms_authenticated (or gms_anon) and request.jwt.claims = <verified claims>.
-- The gms_* roles are used instead of Supabase's anon/authenticated so that the
-- Supabase Data API (PostgREST) can never read or write these tables directly,
-- even if a self-hoster leaves it enabled. See DECISIONS.md (2026-09-27, "RLS roles").

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema if not exists gms;
create schema if not exists gms_private;
create schema if not exists analytics;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'gms_anon') then
    create role gms_anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'gms_authenticated') then
    create role gms_authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'gms_analytics') then
    create role gms_analytics nologin noinherit;
  end if;
end
$$;

grant gms_anon, gms_authenticated, gms_analytics to current_user;

grant usage on schema public, gms to gms_anon, gms_authenticated;
grant usage on schema analytics to gms_analytics, gms_authenticated;
revoke all on schema gms_private from public;
grant usage on schema gms_private to gms_anon, gms_authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to gms_authenticated;
alter default privileges in schema public grant select on tables to gms_anon;
alter default privileges in schema public grant usage, select on sequences to gms_authenticated;

-- ---------------------------------------------------------------------------
-- Claims helpers (same semantics as Supabase auth.uid()/auth.jwt()).
-- ---------------------------------------------------------------------------
create or replace function gms.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function gms.uid() returns uuid
language sql stable as $$
  select nullif(gms.jwt() ->> 'sub', '')::uuid
$$;

create or replace function gms.aal() returns text
language sql stable as $$
  select coalesce(gms.jwt() ->> 'aal', 'aal1')
$$;

create or replace function gms.email() returns text
language sql stable as $$
  select lower(gms.jwt() ->> 'email')
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function gms_private.touch_last_modified() returns trigger
language plpgsql as $$
begin
  new.last_modified_at := now();
  return new;
end
$$;

create or replace function gms_private.append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'table %.% is append-only', tg_table_schema, tg_table_name
    using errcode = 'P0001', hint = 'append_only';
end
$$;

-- Adds the last_modified_at trigger to every public table that has the column.
create or replace function gms_private.install_touch_triggers() returns void
language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'last_modified_at' and t.table_type = 'BASE TABLE'
  loop
    if not exists (
      select 1 from pg_trigger
      where tgname = 'touch_last_modified' and tgrelid = format('public.%I', r.table_name)::regclass
    ) then
      execute format(
        'create trigger touch_last_modified before update on public.%I for each row execute function gms_private.touch_last_modified()',
        r.table_name
      );
    end if;
  end loop;
end
$$;

-- Standard workspace policies: read_roles may select, write_roles may insert/update/delete.
create or replace function gms_private.staff_policies(tbl text, read_roles text[], write_roles text[]) returns void
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', tbl);
  execute format(
    'create policy %I on public.%I for select to gms_authenticated using (gms.is_member(workspace_id, %L::text[]))',
    tbl || '_staff_select', tbl, read_roles);
  if write_roles is not null then
    execute format(
      'create policy %I on public.%I for insert to gms_authenticated with check (gms.is_member(workspace_id, %L::text[]))',
      tbl || '_staff_insert', tbl, write_roles);
    execute format(
      'create policy %I on public.%I for update to gms_authenticated using (gms.is_member(workspace_id, %L::text[])) with check (gms.is_member(workspace_id, %L::text[]))',
      tbl || '_staff_update', tbl, write_roles, write_roles);
    execute format(
      'create policy %I on public.%I for delete to gms_authenticated using (gms.is_member(workspace_id, %L::text[]))',
      tbl || '_staff_delete', tbl, write_roles);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Tenancy & identity
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and length(slug) between 2 and 40),
  name text not null check (length(name) between 1 and 200),
  timezone text not null default 'America/Los_Angeles',
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  plan text not null default 'self_hosted' check (plan in ('self_hosted', 'free', 'standard', 'enterprise')),
  feature_flags jsonb not null default '{}'::jsonb,
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  public_contact_email text,
  about_md text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  scan_required boolean not null default false,
  retention_days int not null default 2555 check (retention_days >= 365),
  overdue_report_hold boolean not null default true,
  second_approval_threshold_cents bigint not null default 5000000 check (second_approval_threshold_cents >= 0),
  action_tier_overrides jsonb not null default '{}'::jsonb,
  transparency_enabled boolean not null default true,
  email_domain text,
  email_domain_status text not null default 'unverified' check (email_domain_status in ('unverified', 'pending', 'verified')),
  sso_enabled boolean not null default false,
  opengrants_syndication boolean not null default false,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);

create table public.workspace_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hostname text not null check (hostname = lower(hostname) and hostname ~ '^[a-z0-9.-]+$'),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (hostname)
);
create index on public.workspace_domains (workspace_id);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  locale text not null default 'en',
  notification_prefs jsonb not null default '{"email": true, "in_app": true, "digest": "daily"}'::jsonb,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create unique index profiles_email_idx on public.profiles (lower(email));

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'program_officer', 'finance', 'reviewer', 'board', 'auditor')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  title text,
  review_capacity int check (review_capacity is null or review_capacity >= 0),
  mfa_required boolean not null default true,
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'program_officer', 'finance', 'reviewer', 'board', 'auditor')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references public.profiles(id),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.invitations (workspace_id);
create index on public.invitations (lower(email));

create table public.workspace_brand (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  display_name text not null,
  logo_path text,
  logo_dark_path text,
  favicon_path text,
  primary_color text not null default '#1F4E79' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#C9822B' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  heading_font text not null default 'Inter' check (heading_font in ('Inter', 'Source Serif 4', 'Atkinson Hyperlegible', 'Figtree')),
  email_sender_name text,
  email_reply_to text,
  contrast_warnings jsonb not null default '[]'::jsonb,
  resolved_tokens jsonb not null default '{}'::jsonb,
  version int not null default 1,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  owner_id uuid references public.profiles(id),
  agent_client_id uuid,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.api_keys (workspace_id);

create table public.platform_operators (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'operator' check (role in ('operator', 'support')),
  created_at timestamptz not null default now()
);

create table public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  operator_user_id uuid not null references public.profiles(id),
  granted_by uuid references public.profiles(id),
  reason text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '72 hours')
);
create index on public.support_access_grants (workspace_id);

-- ---------------------------------------------------------------------------
-- Applicant commons (global; not workspace-owned)
-- ---------------------------------------------------------------------------
create table public.applicant_orgs (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(legal_name) between 1 and 300),
  dba_name text,
  ein text check (ein is null or ein ~ '^[0-9]{2}-[0-9]{7}$'),
  uei text check (uei is null or uei ~ '^[A-Z0-9]{12}$'),
  org_type text not null default 'nonprofit_501c3' check (org_type in (
    'nonprofit_501c3', 'fiscally_sponsored', 'nonprofit_other', 'government', 'tribal', 'school', 'for_profit', 'individual')),
  mission text,
  annual_budget_cents bigint check (annual_budget_cents is null or annual_budget_cents >= 0),
  website text,
  phone text,
  email text,
  counties text[] not null default '{}',
  fiscal_sponsor_name text,
  fiscal_sponsor_ein text check (fiscal_sponsor_ein is null or fiscal_sponsor_ein ~ '^[0-9]{2}-[0-9]{7}$'),
  ein_verified_at timestamptz,
  irs_status jsonb,
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create unique index applicant_orgs_ein_idx on public.applicant_orgs (ein) where ein is not null;
create index applicant_orgs_name_trgm on public.applicant_orgs using gin (legal_name gin_trgm_ops);

create table public.applicant_org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.applicant_orgs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'collaborator' check (role in ('org_admin', 'collaborator')),
  title text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on public.applicant_org_members (user_id);

create table public.org_addresses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.applicant_orgs(id) on delete cascade,
  kind text not null default 'mailing' check (kind in ('mailing', 'physical')),
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'US',
  county text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (org_id, kind)
);

create table public.org_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.applicant_orgs(id) on delete cascade,
  doc_type text not null check (doc_type in (
    'determination_letter', 'audit', 'financial_statement', 'form_990', 'budget', 'board_list', 'fiscal_sponsor_agreement', 'w9', 'other')),
  title text not null,
  storage_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text,
  expires_on date,
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'infected', 'not_scanned')),
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.org_documents (org_id);

-- ---------------------------------------------------------------------------
-- Platform
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_type text not null check (actor_type in ('human', 'agent', 'system')),
  actor_id uuid,
  actor_name text,
  agent_client_id uuid,
  on_behalf_of uuid,
  on_behalf_of_name text,
  action text not null,
  entity_type text,
  entity_id uuid,
  before jsonb,
  after jsonb,
  risk_tier text check (risk_tier in ('R0', 'R1', 'R2', 'R3')),
  approval_request_id uuid,
  ip inet,
  user_agent text,
  request_id text
);
create index on public.audit_log (workspace_id, occurred_at desc);
create index on public.audit_log (entity_type, entity_id);
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function gms_private.append_only();

create table public.outbox (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index outbox_unprocessed_idx on public.outbox (id) where processed_at is null;

create table public.dev_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  to_email text not null,
  from_email text not null,
  subject text not null,
  html text,
  text text,
  tags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.dev_outbox (lower(to_email), created_at desc);

create table public.idempotency_keys (
  key text not null,
  workspace_id uuid,
  actor_id uuid,
  action_id text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (action_id, key)
);

create table public.rate_limit_buckets (
  key text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  description text,
  events text[] not null default '{}',
  secret_ref text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.webhook_endpoints (workspace_id);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  attempt int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  response_status int,
  response_snippet text,
  next_attempt_at timestamptz default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.webhook_deliveries (workspace_id, created_at desc);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status = 'pending';

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  format text not null default 'csv' check (format in ('csv', 'xlsx', 'json', 'zip', 'pdf')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  file_path text,
  error text,
  requested_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.exports (workspace_id, created_at desc);

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity text not null check (entity in ('application', 'org', 'award', 'opportunity')),
  key text not null check (key ~ '^[a-z][a-zA-Z0-9_]*$'),
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'select', 'boolean', 'currency')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (workspace_id, entity, key)
);

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  surface text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.saved_views (workspace_id, surface);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('application', 'org', 'award', 'payment')),
  entity_id uuid not null,
  author_id uuid references public.profiles(id),
  body text not null check (length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.internal_notes (workspace_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Agents
-- ---------------------------------------------------------------------------
create table public.agent_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  client_id text not null unique,
  client_secret_hash text,
  name text not null,
  logo_url text,
  homepage_url text,
  cimd_url text,
  owner_user_id uuid references public.profiles(id),
  kind text not null check (kind in ('oauth_client', 'agent_account', 'pat_client', 'a2a_peer')),
  registration text not null default 'manual' check (registration in ('manual', 'dcr', 'cimd', 'supabase')),
  redirect_uris text[] not null default '{}',
  scopes text[] not null default '{}',
  tool_allowlist text[],
  rate_limit_per_min int not null default 60 check (rate_limit_per_min between 1 and 10000),
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.agent_clients (workspace_id);
create index on public.agent_clients (owner_user_id);

alter table public.api_keys add constraint api_keys_agent_client_fk
  foreign key (agent_client_id) references public.agent_clients(id) on delete cascade;

create table public.agent_grants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.agent_clients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.agent_grants (user_id);
create index on public.agent_grants (client_id);

create table public.personal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  agent_client_id uuid references public.agent_clients(id) on delete cascade,
  name text not null,
  prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default '{}',
  audience text[] not null default '{}',
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.personal_access_tokens (user_id);

create table public.oauth_authorization_codes (
  code_hash text primary key,
  client_id uuid not null references public.agent_clients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null,
  resource text,
  code_challenge text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.oauth_pending_authorizations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.agent_clients(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null,
  resource text,
  state text,
  code_challenge text not null,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  client_id uuid references public.agent_clients(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  protocol text not null check (protocol in ('a2a', 'mcp')),
  skill text not null,
  context_id text,
  state text not null default 'submitted' check (state in (
    'submitted', 'working', 'input_required', 'auth_required', 'completed', 'failed', 'canceled', 'rejected')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.agent_tasks (workspace_id, created_at desc);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_id text not null,
  input jsonb not null,
  preview jsonb not null,
  risk_tier text not null check (risk_tier in ('R2')),
  requested_by_client_id uuid references public.agent_clients(id) on delete set null,
  requester_name text not null,
  on_behalf_of uuid not null references public.profiles(id) on delete cascade,
  audience text not null default 'applicant' check (audience in ('applicant', 'staff')),
  status text not null default 'awaiting_confirmation' check (status in (
    'proposed', 'awaiting_confirmation', 'confirmed', 'rejected', 'expired', 'failed')),
  entity_type text,
  entity_id uuid,
  token_hash text,
  expires_at timestamptz not null default now() + interval '72 hours',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.approval_requests (workspace_id, status);
create index on public.approval_requests (on_behalf_of, status);

create table public.agent_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  ai_use text not null default 'disclosure' check (ai_use in ('allowed', 'disclosure', 'prohibited')),
  disclosure_prompt text not null default 'Did you use AI tools to help write this application? If so, tell us how.',
  reviewer_assist boolean not null default false,
  agent_submissions_enabled boolean not null default true,
  mcp_enabled boolean not null default true,
  a2a_enabled boolean not null default true,
  llm_provider text check (llm_provider in ('anthropic', 'openai')),
  llm_key_ref text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS helper functions
-- ---------------------------------------------------------------------------
create or replace function gms.is_member(ws uuid, roles text[] default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = gms.uid()
      and m.status = 'active'
      and (roles is null or m.role = any (roles))
  )
$$;

create or replace function gms.is_staff(ws uuid) returns boolean
language sql stable as $$
  select gms.is_member(ws, array['owner', 'admin', 'program_officer', 'finance', 'auditor'])
$$;

create or replace function gms.is_org_member(org uuid, roles text[] default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applicant_org_members m
    where m.org_id = org and m.user_id = gms.uid() and (roles is null or m.role = any (roles))
  )
$$;

create or replace function gms.is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_operators o where o.user_id = gms.uid())
$$;

-- Audit & outbox writers used by the action executor inside RLS transactions.
create or replace function gms_private.append_audit(entry jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
begin
  insert into public.audit_log (
    workspace_id, actor_type, actor_id, actor_name, agent_client_id, on_behalf_of, on_behalf_of_name,
    action, entity_type, entity_id, before, after, risk_tier, approval_request_id, ip, user_agent, request_id)
  values (
    nullif(entry ->> 'workspace_id', '')::uuid,
    entry ->> 'actor_type',
    nullif(entry ->> 'actor_id', '')::uuid,
    entry ->> 'actor_name',
    nullif(entry ->> 'agent_client_id', '')::uuid,
    nullif(entry ->> 'on_behalf_of', '')::uuid,
    entry ->> 'on_behalf_of_name',
    entry ->> 'action',
    entry ->> 'entity_type',
    nullif(entry ->> 'entity_id', '')::uuid,
    entry -> 'before',
    entry -> 'after',
    entry ->> 'risk_tier',
    nullif(entry ->> 'approval_request_id', '')::uuid,
    nullif(entry ->> 'ip', '')::inet,
    entry ->> 'user_agent',
    entry ->> 'request_id')
  returning id into new_id;
  return new_id;
end
$$;

create or replace function gms_private.enqueue_event(
  ws uuid, event_type text, entity_type text, entity_id uuid, payload jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  insert into public.outbox (workspace_id, event_type, entity_type, entity_id, payload)
  values (ws, event_type, entity_type, entity_id, coalesce(payload, '{}'::jsonb))
  returning id into new_id;
  perform pg_notify('gms_outbox', new_id::text);
  return new_id;
end
$$;

revoke all on function gms_private.append_audit(jsonb) from public;
revoke all on function gms_private.enqueue_event(uuid, text, text, uuid, jsonb) from public;
grant execute on function gms_private.append_audit(jsonb) to gms_authenticated, gms_anon;
grant execute on function gms_private.enqueue_event(uuid, text, text, uuid, jsonb) to gms_authenticated, gms_anon;
grant execute on all functions in schema gms to gms_anon, gms_authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
create policy workspaces_public_select on public.workspaces for select to gms_anon, gms_authenticated
  using (status = 'active' or gms.is_member(id));
create policy workspaces_admin_update on public.workspaces for update to gms_authenticated
  using (gms.is_member(id, array['owner', 'admin'])) with check (gms.is_member(id, array['owner', 'admin']));

alter table public.workspace_settings enable row level security;
create policy workspace_settings_select on public.workspace_settings for select to gms_authenticated
  using (gms.is_member(workspace_id, array['owner', 'admin', 'program_officer', 'finance', 'auditor']));
create policy workspace_settings_update on public.workspace_settings for update to gms_authenticated
  using (gms.is_member(workspace_id, array['owner', 'admin'])) with check (gms.is_member(workspace_id, array['owner', 'admin']));

select gms_private.staff_policies('workspace_domains', array['owner', 'admin', 'auditor'], array['owner', 'admin']);

alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to gms_authenticated using (id = gms.uid());
create policy profiles_self_update on public.profiles for update to gms_authenticated
  using (id = gms.uid()) with check (id = gms.uid());
-- Co-members of a workspace can see each other's profiles.
create policy profiles_co_member on public.profiles for select to gms_authenticated using (
  exists (
    select 1 from public.workspace_members m
    where m.user_id = profiles.id and gms.is_member(m.workspace_id)
  )
);
-- Members of the same applicant org can see each other.
create policy profiles_co_org on public.profiles for select to gms_authenticated using (
  exists (
    select 1 from public.applicant_org_members m
    where m.user_id = profiles.id and gms.is_org_member(m.org_id)
  )
);

alter table public.workspace_members enable row level security;
create policy members_select on public.workspace_members for select to gms_authenticated
  using (user_id = gms.uid() or gms.is_member(workspace_id));
create policy members_admin_insert on public.workspace_members for insert to gms_authenticated
  with check (gms.is_member(workspace_id, array['owner', 'admin']));
create policy members_admin_update on public.workspace_members for update to gms_authenticated
  using (gms.is_member(workspace_id, array['owner', 'admin'])) with check (gms.is_member(workspace_id, array['owner', 'admin']));
create policy members_admin_delete on public.workspace_members for delete to gms_authenticated
  using (gms.is_member(workspace_id, array['owner', 'admin']));

select gms_private.staff_policies('invitations', array['owner', 'admin', 'auditor'], array['owner', 'admin']);
create policy invitations_invitee_select on public.invitations for select to gms_authenticated
  using (lower(email) = gms.email() and status = 'pending');

alter table public.workspace_brand enable row level security;
create policy brand_public_select on public.workspace_brand for select to gms_anon, gms_authenticated using (true);
create policy brand_admin_update on public.workspace_brand for update to gms_authenticated
  using (gms.is_member(workspace_id, array['owner', 'admin'])) with check (gms.is_member(workspace_id, array['owner', 'admin']));
create policy brand_admin_insert on public.workspace_brand for insert to gms_authenticated
  with check (gms.is_member(workspace_id, array['owner', 'admin']));

select gms_private.staff_policies('api_keys', array['owner', 'admin', 'auditor'], array['owner', 'admin']);

alter table public.platform_operators enable row level security;
create policy operators_self on public.platform_operators for select to gms_authenticated using (user_id = gms.uid());

select gms_private.staff_policies('support_access_grants', array['owner', 'admin', 'auditor'], array['owner', 'admin']);

-- Applicant commons
alter table public.applicant_orgs enable row level security;
create policy orgs_member_select on public.applicant_orgs for select to gms_authenticated
  using (gms.is_org_member(id) or created_by = gms.uid());
create policy orgs_insert on public.applicant_orgs for insert to gms_authenticated
  with check (created_by = gms.uid());
create policy orgs_admin_update on public.applicant_orgs for update to gms_authenticated
  using (gms.is_org_member(id, array['org_admin'])) with check (gms.is_org_member(id, array['org_admin']));

alter table public.applicant_org_members enable row level security;
create policy org_members_select on public.applicant_org_members for select to gms_authenticated
  using (user_id = gms.uid() or gms.is_org_member(org_id));
create policy org_members_insert on public.applicant_org_members for insert to gms_authenticated
  with check (
    gms.is_org_member(org_id, array['org_admin'])
    or (
      user_id = gms.uid() and role = 'org_admin'
      and exists (select 1 from public.applicant_orgs o where o.id = org_id and o.created_by = gms.uid())
      and not exists (select 1 from public.applicant_org_members x where x.org_id = applicant_org_members.org_id)
    )
  );
create policy org_members_update on public.applicant_org_members for update to gms_authenticated
  using (gms.is_org_member(org_id, array['org_admin'])) with check (gms.is_org_member(org_id, array['org_admin']));
create policy org_members_delete on public.applicant_org_members for delete to gms_authenticated
  using (gms.is_org_member(org_id, array['org_admin']) or user_id = gms.uid());

alter table public.org_addresses enable row level security;
create policy org_addresses_select on public.org_addresses for select to gms_authenticated using (gms.is_org_member(org_id));
create policy org_addresses_write on public.org_addresses for all to gms_authenticated
  using (gms.is_org_member(org_id, array['org_admin'])) with check (gms.is_org_member(org_id, array['org_admin']));

alter table public.org_documents enable row level security;
create policy org_documents_select on public.org_documents for select to gms_authenticated using (gms.is_org_member(org_id));
create policy org_documents_insert on public.org_documents for insert to gms_authenticated with check (gms.is_org_member(org_id));
create policy org_documents_update on public.org_documents for update to gms_authenticated
  using (gms.is_org_member(org_id, array['org_admin'])) with check (gms.is_org_member(org_id, array['org_admin']));
create policy org_documents_delete on public.org_documents for delete to gms_authenticated
  using (gms.is_org_member(org_id, array['org_admin']));

-- Platform
alter table public.audit_log enable row level security;
create policy audit_staff_select on public.audit_log for select to gms_authenticated
  using (workspace_id is not null and gms.is_staff(workspace_id));

alter table public.outbox enable row level security;          -- service only
alter table public.dev_outbox enable row level security;      -- service only
alter table public.idempotency_keys enable row level security; -- service only
alter table public.rate_limit_buckets enable row level security; -- service only

select gms_private.staff_policies('webhook_endpoints', array['owner', 'admin', 'auditor'], array['owner', 'admin']);
select gms_private.staff_policies('webhook_deliveries', array['owner', 'admin', 'auditor'], null);

alter table public.exports enable row level security;
create policy exports_select on public.exports for select to gms_authenticated
  using (requested_by = gms.uid() or gms.is_member(workspace_id, array['owner', 'admin', 'auditor']));
create policy exports_insert on public.exports for insert to gms_authenticated
  with check (requested_by = gms.uid() and gms.is_staff(workspace_id));

select gms_private.staff_policies('custom_field_definitions',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin']);

alter table public.saved_views enable row level security;
create policy saved_views_select on public.saved_views for select to gms_authenticated
  using (user_id = gms.uid() or (shared and gms.is_staff(workspace_id)));
create policy saved_views_write on public.saved_views for all to gms_authenticated
  using (user_id = gms.uid()) with check (user_id = gms.uid() and gms.is_staff(workspace_id));

alter table public.notifications enable row level security;
create policy notifications_self on public.notifications for select to gms_authenticated using (user_id = gms.uid());
create policy notifications_self_update on public.notifications for update to gms_authenticated
  using (user_id = gms.uid()) with check (user_id = gms.uid());

select gms_private.staff_policies('internal_notes',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer', 'finance']);

-- Agents
alter table public.agent_clients enable row level security;
create policy agent_clients_select on public.agent_clients for select to gms_authenticated using (
  owner_user_id = gms.uid()
  or (workspace_id is not null and gms.is_staff(workspace_id))
  or exists (select 1 from public.agent_grants g where g.client_id = agent_clients.id and g.user_id = gms.uid())
  or exists (select 1 from public.personal_access_tokens p where p.agent_client_id = agent_clients.id and p.user_id = gms.uid())
);
create policy agent_clients_insert on public.agent_clients for insert to gms_authenticated with check (
  (workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin']))
  or (kind = 'pat_client' and owner_user_id = gms.uid())
);
create policy agent_clients_update on public.agent_clients for update to gms_authenticated
  using ((workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin'])) or owner_user_id = gms.uid())
  with check ((workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin'])) or owner_user_id = gms.uid());

alter table public.agent_grants enable row level security;
create policy agent_grants_self on public.agent_grants for select to gms_authenticated
  using (user_id = gms.uid() or (workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin', 'auditor'])));
create policy agent_grants_self_update on public.agent_grants for update to gms_authenticated
  using (user_id = gms.uid()) with check (user_id = gms.uid());
create policy agent_grants_self_insert on public.agent_grants for insert to gms_authenticated with check (user_id = gms.uid());

alter table public.personal_access_tokens enable row level security;
create policy pats_self on public.personal_access_tokens for select to gms_authenticated using (user_id = gms.uid());
create policy pats_self_insert on public.personal_access_tokens for insert to gms_authenticated with check (user_id = gms.uid());
create policy pats_self_update on public.personal_access_tokens for update to gms_authenticated
  using (user_id = gms.uid()) with check (user_id = gms.uid());

alter table public.oauth_authorization_codes enable row level security;   -- service only
alter table public.oauth_pending_authorizations enable row level security; -- service only

alter table public.agent_tasks enable row level security;
create policy agent_tasks_select on public.agent_tasks for select to gms_authenticated
  using (user_id = gms.uid() or (workspace_id is not null and gms.is_staff(workspace_id)));

alter table public.approval_requests enable row level security;
create policy approvals_select on public.approval_requests for select to gms_authenticated
  using (on_behalf_of = gms.uid() or gms.is_member(workspace_id, array['owner', 'admin', 'auditor']));
create policy approvals_insert on public.approval_requests for insert to gms_authenticated
  with check (on_behalf_of = gms.uid());
create policy approvals_update on public.approval_requests for update to gms_authenticated
  using (on_behalf_of = gms.uid()) with check (on_behalf_of = gms.uid());

alter table public.agent_policies enable row level security;
create policy agent_policies_public on public.agent_policies for select to gms_anon, gms_authenticated using (true);
create policy agent_policies_admin_update on public.agent_policies for update to gms_authenticated
  using (gms.is_member(workspace_id, array['owner', 'admin'])) with check (gms.is_member(workspace_id, array['owner', 'admin']));

-- The agent_policies public policy exposes llm_key_ref; it is a SecretStore reference, never a key.
-- Column-level: hide it from anon anyway.
revoke select on public.agent_policies from gms_anon;
grant select (workspace_id, ai_use, disclosure_prompt, reviewer_assist, agent_submissions_enabled, mcp_enabled, a2a_enabled)
  on public.agent_policies to gms_anon;

select gms_private.install_touch_triggers();
