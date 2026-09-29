-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Programs, taxonomy, forms (versioned JSON Schema), opportunities, competitions, eligibility.

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  cause_area text,
  lead_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index on public.programs (workspace_id);

create table public.program_budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  fiscal_year int not null check (fiscal_year between 2000 and 2100),
  amount_cents bigint not null check (amount_cents >= 0),
  currency char(3) not null default 'USD',
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (program_id, fiscal_year)
);
create index on public.program_budgets (workspace_id);

create table public.taxonomy_terms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('cause', 'geography', 'population')),
  code text not null,
  label text not null,
  parent_id uuid references public.taxonomy_terms(id) on delete set null,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (workspace_id, kind, code)
);
create index on public.taxonomy_terms (workspace_id);

-- Forms ---------------------------------------------------------------------
create table public.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  kind text not null default 'application' check (kind in ('application', 'loi', 'report', 'eligibility', 'other')),
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.forms (workspace_id);

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  version int not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  builder_model jsonb not null default '{}'::jsonb,
  json_schema jsonb not null default '{}'::jsonb,
  ui_schema jsonb not null default '{}'::jsonb,
  mapping_to_cg jsonb not null default '{}'::jsonb,
  mapping_from_cg jsonb not null default '{}'::jsonb,
  field_meta jsonb not null default '{}'::jsonb,
  change_note text,
  published_at timestamptz,
  published_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (form_id, version)
);
create index on public.form_versions (workspace_id);

alter table public.forms add constraint forms_current_version_fk
  foreign key (current_version_id) references public.form_versions(id) on delete set null;

-- Published versions are immutable (only published -> retired is allowed).
create or replace function gms_private.form_version_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'published form versions cannot be deleted' using errcode = 'P0001', hint = 'immutable_form_version';
    end if;
    return old;
  end if;
  if old.status = 'draft' then
    return new;
  end if;
  if old.status = 'published' and new.status = 'retired'
     and new.json_schema = old.json_schema and new.ui_schema = old.ui_schema
     and new.builder_model = old.builder_model and new.mapping_to_cg = old.mapping_to_cg
     and new.mapping_from_cg = old.mapping_from_cg and new.field_meta = old.field_meta
     and new.version = old.version and new.form_id = old.form_id then
    return new;
  end if;
  raise exception 'published form versions are immutable' using errcode = 'P0001', hint = 'immutable_form_version';
end
$$;
create trigger form_versions_immutable before update or delete on public.form_versions
  for each row execute function gms_private.form_version_immutable();

create table public.question_bank_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  label text not null,
  field jsonb not null,
  tags text[] not null default '{}',
  cg_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.question_bank_items (workspace_id);

create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  kind text not null default 'application' check (kind in ('application', 'loi', 'report', 'eligibility', 'other')),
  builder_model jsonb not null,
  source text not null default 'gms' check (source in ('gms', 'commongrants-form-library', 'workspace')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.form_templates (workspace_id);

-- Opportunities -------------------------------------------------------------
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  program_id uuid references public.programs(id) on delete set null,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  title text not null check (length(title) between 1 and 300),
  status text not null default 'draft' check (status in ('draft', 'forecasted', 'open', 'closed', 'archived')),
  visibility text not null default 'public' check (visibility in ('public', 'unlisted')),
  summary text,
  description_md text,
  eligibility_md text,
  guidelines_md text,
  faq jsonb not null default '[]'::jsonb,
  funding_total_cents bigint check (funding_total_cents is null or funding_total_cents >= 0),
  award_min_cents bigint check (award_min_cents is null or award_min_cents >= 0),
  award_max_cents bigint check (award_max_cents is null or award_max_cents >= 0),
  expected_award_count int,
  currency char(3) not null default 'USD',
  applicant_types text[] not null default '{}',
  cause_terms text[] not null default '{}',
  geography_terms text[] not null default '{}',
  population_terms text[] not null default '{}',
  forecast_at timestamptz,
  opens_at timestamptz,
  closes_at timestamptz,
  decision_expected_on date,
  contact_email text,
  distribution jsonb not null default '{"site": true, "embed": true, "cgFeed": true, "openGrants": false}'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(summary, '')), 'B')
    || setweight(to_tsvector('english', coalesce(description_md, '')), 'C')
  ) stored,
  unique (workspace_id, slug),
  check (award_min_cents is null or award_max_cents is null or award_min_cents <= award_max_cents)
);
create index on public.opportunities (workspace_id, status);
create index on public.opportunities (last_modified_at);
create index opportunities_search_idx on public.opportunities using gin (search);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  name text not null,
  description text,
  stage_order int not null default 1 check (stage_order >= 1),
  access text not null default 'public' check (access in ('public', 'invite')),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'open', 'closed')),
  opens_at timestamptz,
  closes_at timestamptz,
  grace_minutes int not null default 0 check (grace_minutes between 0 and 1440),
  submission_cap int check (submission_cap is null or submission_cap > 0),
  per_org_limit int not null default 1 check (per_org_limit >= 1),
  allow_extensions boolean not null default true,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (opportunity_id, stage_order),
  check (opens_at is null or closes_at is null or opens_at < closes_at)
);
create index on public.competitions (workspace_id);

create table public.competition_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete restrict,
  form_version_id uuid references public.form_versions(id) on delete restrict,
  position int not null default 1,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (competition_id, form_id)
);
create index on public.competition_forms (workspace_id);

create table public.competition_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  applicant_org_id uuid references public.applicant_orgs(id) on delete cascade,
  email text,
  from_application_id uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  check (applicant_org_id is not null or email is not null)
);
create index on public.competition_invites (workspace_id);
create index on public.competition_invites (applicant_org_id);

create table public.eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  position int not null default 1,
  question text not null,
  help_text text,
  kind text not null check (kind in ('yes_no', 'number_max', 'number_min', 'select_in', 'multi_any')),
  config jsonb not null default '{}'::jsonb,
  knockout_message text not null,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.eligibility_rules (workspace_id);
create index on public.eligibility_rules (opportunity_id);

-- Public visibility helpers ----------------------------------------------------
create or replace function gms.opportunity_is_public(opp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.opportunities o
    join public.workspaces w on w.id = o.workspace_id
    where o.id = opp and o.status in ('forecasted', 'open', 'closed') and w.status = 'active'
  )
$$;
grant execute on function gms.opportunity_is_public(uuid) to gms_anon, gms_authenticated;

-- Policies -------------------------------------------------------------------
select gms_private.staff_policies('programs',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'board'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('program_budgets',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'board'], array['owner', 'admin', 'finance']);
select gms_private.staff_policies('taxonomy_terms',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin']);
create policy taxonomy_public on public.taxonomy_terms for select to gms_anon, gms_authenticated using (true);

select gms_private.staff_policies('forms',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('form_versions',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'reviewer'], array['owner', 'admin', 'program_officer']);
-- Applicants (any signed-in user) and anon can read published versions attached to public competitions.
create policy form_versions_public on public.form_versions for select to gms_anon, gms_authenticated using (
  status = 'published' and exists (
    select 1 from public.competition_forms cf
    join public.competitions c on c.id = cf.competition_id
    where cf.form_version_id = form_versions.id and gms.opportunity_is_public(c.opportunity_id)
  )
);
-- Report forms are readable by signed-in users (grantees); the form content is not sensitive.
create policy form_versions_report on public.form_versions for select to gms_authenticated using (
  status = 'published' and exists (select 1 from public.forms f where f.id = form_versions.form_id and f.kind = 'report')
);
create policy forms_public on public.forms for select to gms_anon, gms_authenticated using (
  exists (
    select 1 from public.competition_forms cf join public.competitions c on c.id = cf.competition_id
    where cf.form_id = forms.id and gms.opportunity_is_public(c.opportunity_id)
  ) or kind = 'report'
);

alter table public.question_bank_items enable row level security;
create policy qbank_select on public.question_bank_items for select to gms_authenticated
  using (workspace_id is null or gms.is_staff(workspace_id));
create policy qbank_write on public.question_bank_items for all to gms_authenticated
  using (workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin', 'program_officer']))
  with check (workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin', 'program_officer']));

alter table public.form_templates enable row level security;
create policy templates_select on public.form_templates for select to gms_authenticated
  using (workspace_id is null or gms.is_staff(workspace_id));
create policy templates_write on public.form_templates for all to gms_authenticated
  using (workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin', 'program_officer']))
  with check (workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin', 'program_officer']));

select gms_private.staff_policies('opportunities',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'board', 'reviewer'], array['owner', 'admin', 'program_officer']);
create policy opportunities_public on public.opportunities for select to gms_anon, gms_authenticated
  using (status in ('forecasted', 'open', 'closed') and gms.opportunity_is_public(id));

select gms_private.staff_policies('competitions',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'board', 'reviewer'], array['owner', 'admin', 'program_officer']);
create policy competitions_public on public.competitions for select to gms_anon, gms_authenticated
  using (status <> 'draft' and gms.opportunity_is_public(opportunity_id));

select gms_private.staff_policies('competition_forms',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy competition_forms_public on public.competition_forms for select to gms_anon, gms_authenticated using (
  exists (select 1 from public.competitions c where c.id = competition_id and c.status <> 'draft' and gms.opportunity_is_public(c.opportunity_id))
);

select gms_private.staff_policies('competition_invites',
  array['owner', 'admin', 'program_officer', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy competition_invites_invitee on public.competition_invites for select to gms_authenticated
  using ((applicant_org_id is not null and gms.is_org_member(applicant_org_id)) or lower(email) = gms.email());

select gms_private.staff_policies('eligibility_rules',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy eligibility_rules_public on public.eligibility_rules for select to gms_anon, gms_authenticated
  using (gms.opportunity_is_public(opportunity_id));

select gms_private.install_touch_triggers();
