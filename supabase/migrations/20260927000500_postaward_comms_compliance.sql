-- SPDX-License-Identifier: AGPL-3.0-only
-- Post-award reporting, change requests, site visits, communications, due diligence & sanctions.

create table public.report_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  award_id uuid not null references public.awards(id) on delete cascade,
  form_id uuid references public.forms(id) on delete set null,
  title text not null,
  kind text not null default 'interim' check (kind in ('interim', 'final', 'financial', 'narrative')),
  due_date date not null,
  status text not null default 'upcoming' check (status in (
    'upcoming', 'due', 'overdue', 'submitted', 'accepted', 'revisions_requested')),
  holds_payments boolean not null default true,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.report_requirements (workspace_id, due_date);
create index on public.report_requirements (award_id);

create table public.report_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requirement_id uuid not null references public.report_requirements(id) on delete cascade,
  award_id uuid not null references public.awards(id) on delete cascade,
  form_version_id uuid references public.form_versions(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'accepted', 'revisions_requested')),
  submitted_by uuid references public.profiles(id),
  submitted_by_agent_client_id uuid references public.agent_clients(id) on delete set null,
  submitted_at timestamptz,
  reviewer_id uuid references public.profiles(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.report_submissions (requirement_id);
create index on public.report_submissions (workspace_id);

alter table public.attachments add constraint attachments_report_fk
  foreign key (report_submission_id) references public.report_submissions(id) on delete cascade;

create table public.indicators (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  program_id uuid references public.programs(id) on delete set null,
  name text not null,
  unit text not null default 'count',
  description text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.indicators (workspace_id);

create table public.indicator_values (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  indicator_id uuid not null references public.indicators(id) on delete cascade,
  award_id uuid not null references public.awards(id) on delete cascade,
  report_submission_id uuid references public.report_submissions(id) on delete set null,
  value numeric not null,
  period_end date,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.indicator_values (workspace_id);

create table public.site_visits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  applicant_org_id uuid not null references public.applicant_orgs(id) on delete cascade,
  award_id uuid references public.awards(id) on delete set null,
  visited_on date not null,
  visited_by uuid references public.profiles(id),
  summary text not null,
  follow_ups text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.site_visits (workspace_id);

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  award_id uuid not null references public.awards(id) on delete cascade,
  requirement_id uuid references public.report_requirements(id) on delete set null,
  kind text not null check (kind in ('extension', 'amendment', 'budget_change')),
  details jsonb not null default '{}'::jsonb,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  requested_by uuid references public.profiles(id),
  requested_by_agent_client_id uuid references public.agent_clients(id) on delete set null,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.change_requests (workspace_id, status);

-- Communications ---------------------------------------------------------------------
create table public.threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  award_id uuid references public.awards(id) on delete cascade,
  subject text not null,
  created_by uuid references public.profiles(id),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.threads (application_id);
create index on public.threads (workspace_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  author_id uuid references public.profiles(id),
  author_side text not null check (author_side in ('staff', 'applicant', 'system')),
  agent_client_id uuid references public.agent_clients(id) on delete set null,
  body text not null check (length(body) between 1 and 20000),
  read_by_applicant_at timestamptz,
  read_by_staff_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.messages (thread_id, created_at);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  name text not null,
  subject text not null,
  body_md text not null,
  merge_fields text[] not null default '{}',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (workspace_id, key)
);

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  channel text not null check (channel in ('email', 'in_app')),
  audience text not null check (audience in ('applicant', 'program_officer', 'finance', 'admins', 'reviewers', 'board')),
  template_key text,
  offset_days int,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.notification_rules (workspace_id, event_type);

create table public.bulk_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_key text,
  segment jsonb not null default '{}'::jsonb,
  subject text not null,
  body_md text not null,
  recipient_count int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  created_by uuid references public.profiles(id),
  created_by_agent_client_id uuid references public.agent_clients(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.bulk_messages (workspace_id);

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  bulk_message_id uuid references public.bulk_messages(id) on delete cascade,
  template_key text,
  to_email text not null,
  subject text not null,
  provider text not null,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.email_deliveries (workspace_id, created_at desc);
create index on public.email_deliveries (provider_message_id);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  delivery_id uuid references public.email_deliveries(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  event text not null check (event in ('sent', 'delivered', 'bounced', 'complained', 'opened', 'clicked', 'failed')),
  recipient text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index on public.email_events (workspace_id);

-- Compliance ---------------------------------------------------------------------------
create table public.irs_exempt_orgs (
  ein text primary key check (ein ~ '^[0-9]{2}-[0-9]{7}$'),
  name text not null,
  city text,
  state text,
  subsection text,
  foundation_code text,
  deductibility text,
  status text not null default 'active' check (status in ('active', 'revoked', 'unknown')),
  ruling_date date,
  pub78 boolean not null default false,
  ntee text,
  source text not null default 'fixture' check (source in ('fixture', 'bmf', 'pub78')),
  imported_at timestamptz not null default now()
);
create index irs_exempt_orgs_name_trgm on public.irs_exempt_orgs using gin (name gin_trgm_ops);

create table public.sanctions_entries (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'ofac_sdn',
  source_uid text not null,
  name text not null,
  name_normalized text not null,
  entry_type text,
  programs text[] not null default '{}',
  remarks text,
  imported_at timestamptz not null default now(),
  unique (source, source_uid)
);
create index sanctions_entries_trgm on public.sanctions_entries using gin (name_normalized gin_trgm_ops);

create table public.sanctions_screenings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  applicant_org_id uuid references public.applicant_orgs(id) on delete cascade,
  award_id uuid references public.awards(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete cascade,
  context text not null check (context in ('award', 'payment', 'manual')),
  query_name text not null,
  best_score numeric(4, 3) not null default 0,
  matches jsonb not null default '[]'::jsonb,
  status text not null check (status in ('clear', 'potential_match', 'confirmed_match', 'false_positive')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.sanctions_screenings (workspace_id, status);

create table public.diligence_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  applicant_org_id uuid not null references public.applicant_orgs(id) on delete cascade,
  award_id uuid references public.awards(id) on delete cascade,
  kind text not null check (kind in ('irs_status', 'ofac', 'expenditure_responsibility', 'grants_to_individuals', 'documents')),
  status text not null check (status in ('pending', 'pass', 'review', 'fail')),
  result jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.diligence_checks (workspace_id, applicant_org_id);

-- Fuzzy sanctions search (trigram similarity), used by screening.
create or replace function gms.normalize_name(n text) returns text
language sql immutable as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(n, '')),
    '\m(inc|incorporated|llc|ltd|corp|corporation|co|the|foundation|fund|org)\M', ' ', 'g'), '[^a-z0-9 ]', ' ', 'g'))
$$;

create or replace function gms.sanctions_search(q text, min_score real default 0.45)
returns table (entry_id uuid, name text, score real, programs text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.name, similarity(e.name_normalized, gms.normalize_name(q)) as score, e.programs
  from public.sanctions_entries e
  where similarity(e.name_normalized, gms.normalize_name(q)) >= min_score
  order by score desc
  limit 10
$$;
grant execute on function gms.sanctions_search(text, real) to gms_authenticated;
grant execute on function gms.normalize_name(text) to gms_anon, gms_authenticated;

-- Policies -------------------------------------------------------------------------------
select gms_private.staff_policies('report_requirements',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy report_requirements_grantee on public.report_requirements for select to gms_authenticated using (
  exists (select 1 from public.awards a where a.id = award_id and a.status <> 'draft' and gms.is_org_member(a.applicant_org_id))
);

select gms_private.staff_policies('report_submissions',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy report_submissions_grantee_select on public.report_submissions for select to gms_authenticated using (
  exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id))
);
create policy report_submissions_grantee_insert on public.report_submissions for insert to gms_authenticated with check (
  exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id))
  and status in ('draft', 'submitted')
);
create policy report_submissions_grantee_update on public.report_submissions for update to gms_authenticated using (
  status in ('draft', 'revisions_requested')
  and exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id))
) with check (status in ('draft', 'submitted'));

select gms_private.staff_policies('indicators',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'board'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('indicator_values',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'board'], array['owner', 'admin', 'program_officer']);
create policy indicator_values_grantee on public.indicator_values for select to gms_authenticated using (
  exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id))
);
create policy indicator_values_grantee_insert on public.indicator_values for insert to gms_authenticated with check (
  exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id))
);
select gms_private.staff_policies('site_visits',
  array['owner', 'admin', 'program_officer', 'auditor'], array['owner', 'admin', 'program_officer']);

select gms_private.staff_policies('change_requests',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy change_requests_grantee_select on public.change_requests for select to gms_authenticated using (
  exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id))
);
create policy change_requests_grantee_insert on public.change_requests for insert to gms_authenticated with check (
  requested_by = gms.uid() and status = 'pending'
  and exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id))
);

select gms_private.staff_policies('threads',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer', 'finance']);
create policy threads_applicant_select on public.threads for select to gms_authenticated using (
  (application_id is not null and gms.is_applicant_for(application_id))
  or (award_id is not null and exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id)))
);
create policy threads_applicant_insert on public.threads for insert to gms_authenticated with check (
  created_by = gms.uid() and application_id is not null and gms.is_applicant_for(application_id)
);
create policy threads_applicant_update on public.threads for update to gms_authenticated using (
  application_id is not null and gms.is_applicant_for(application_id)
) with check (application_id is not null and gms.is_applicant_for(application_id));

select gms_private.staff_policies('messages',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer', 'finance']);
create policy messages_applicant_select on public.messages for select to gms_authenticated using (
  exists (select 1 from public.threads t where t.id = thread_id and (
    (t.application_id is not null and gms.is_applicant_for(t.application_id))
    or (t.award_id is not null and exists (select 1 from public.awards a where a.id = t.award_id and gms.is_org_member(a.applicant_org_id)))))
);
create policy messages_applicant_insert on public.messages for insert to gms_authenticated with check (
  author_id = gms.uid() and author_side = 'applicant' and exists (
    select 1 from public.threads t where t.id = thread_id and (
      (t.application_id is not null and gms.is_applicant_for(t.application_id))
      or (t.award_id is not null and exists (select 1 from public.awards a where a.id = t.award_id and gms.is_org_member(a.applicant_org_id)))))
);
create policy messages_applicant_update on public.messages for update to gms_authenticated using (
  exists (select 1 from public.threads t where t.id = thread_id and t.application_id is not null and gms.is_applicant_for(t.application_id))
) with check (
  exists (select 1 from public.threads t where t.id = thread_id and t.application_id is not null and gms.is_applicant_for(t.application_id))
);

select gms_private.staff_policies('email_templates',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('notification_rules',
  array['owner', 'admin', 'program_officer', 'auditor'], array['owner', 'admin']);
select gms_private.staff_policies('bulk_messages',
  array['owner', 'admin', 'program_officer', 'auditor'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('email_deliveries', array['owner', 'admin', 'program_officer', 'auditor'], null);
select gms_private.staff_policies('email_events', array['owner', 'admin', 'program_officer', 'auditor'], null);

alter table public.irs_exempt_orgs enable row level security;
create policy irs_public on public.irs_exempt_orgs for select to gms_anon, gms_authenticated using (true);

alter table public.sanctions_entries enable row level security;
create policy sanctions_entries_staff on public.sanctions_entries for select to gms_authenticated using (
  exists (select 1 from public.workspace_members m where m.user_id = gms.uid()
    and m.role in ('owner', 'admin', 'program_officer', 'finance', 'auditor') and m.status = 'active')
);

select gms_private.staff_policies('sanctions_screenings',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer', 'finance']);
select gms_private.staff_policies('diligence_checks',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer', 'finance']);

select gms_private.install_touch_triggers();

-- Revoke everything on GMS tables from Supabase's Data API roles (defense in depth).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end
$$;
