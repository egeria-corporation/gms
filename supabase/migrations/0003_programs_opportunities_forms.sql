-- 0003_programs_opportunities_forms: what a funder designs before anyone applies.

create table public.programs (
  id                   uuid primary key default gms.uuid_v7(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 1 and 200),
  description          text,
  fiscal_year          integer check (fiscal_year between 1990 and 2200),
  budget_amount_minor  bigint check (budget_amount_minor >= 0),
  currency             text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  defaults             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on column public.programs.defaults is 'rubric_id, template ids, requirement plan, reminder plan.';
create index programs_workspace_id_idx on public.programs (workspace_id);

-- CG FormBase, versioned. A published version is immutable; editing creates the next draft.
create table public.forms (
  id                      uuid not null default gms.uuid_v7(),
  version                 integer not null default 1 check (version >= 1),
  workspace_id            uuid references public.workspaces (id) on delete cascade,
  title                   text not null check (length(btrim(title)) between 1 and 300),
  description             text,
  instructions            text,
  json_schema             jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  ui_schema               jsonb not null default '{"type":"VerticalLayout","elements":[]}'::jsonb,
  mapping_from_cg         jsonb not null default '{}'::jsonb,
  mapping_to_cg           jsonb not null default '{}'::jsonb,
  field_meta              jsonb not null default '{}'::jsonb,
  purpose                 text not null default 'application'
                            check (purpose in ('application', 'report', 'loi', 'amendment', 'site_visit', 'other')),
  published_at            timestamptz,
  supersedes_form_version integer,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  primary key (id, version)
);
comment on table public.forms is 'CG FormBase. workspace_id null = shared library. field_meta: reviewer visibility, PII flags, limits.';
create index forms_workspace_id_idx on public.forms (workspace_id);

create or replace function gms.forms_published_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null and (
       new.json_schema is distinct from old.json_schema
    or new.ui_schema is distinct from old.ui_schema
    or new.mapping_from_cg is distinct from old.mapping_from_cg
    or new.mapping_to_cg is distinct from old.mapping_to_cg
    or new.field_meta is distinct from old.field_meta
    or new.published_at is distinct from old.published_at
    or new.purpose is distinct from old.purpose) then
    raise exception 'form % version % is published and immutable; create the next version', old.id, old.version
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger forms_published_immutable before update on public.forms
  for each row execute function gms.forms_published_immutable();

create table public.rubrics (
  id            uuid not null default gms.uuid_v7(),
  version       integer not null default 1 check (version >= 1),
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  criteria      jsonb not null default '[]'::jsonb,
  overall       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (id, version)
);
comment on column public.rubrics.criteria is 'key, label, description, weight, scale numeric(min,max) | categorical[...], guidance.';
create index rubrics_workspace_id_idx on public.rubrics (workspace_id);

create table public.templates (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  kind          text not null check (kind in ('letter', 'agreement', 'email')),
  name          text not null check (length(btrim(name)) between 1 and 200),
  body          text not null,
  version       integer not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.templates is 'Letters, agreements, emails: markdown with merge fields. workspace_id null = shared library.';
create index templates_workspace_id_idx on public.templates (workspace_id);

create table public.opportunities (
  id                        uuid primary key default gms.uuid_v7(),
  workspace_id              uuid not null references public.workspaces (id) on delete cascade,
  program_id                uuid references public.programs (id) on delete set null,
  slug                      text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$'),
  title                     text not null check (length(btrim(title)) between 1 and 300),
  description               text not null default '',
  status                    text not null default 'forecasted' check (status in ('forecasted', 'open', 'closed')),
  funding                   jsonb not null default '{}'::jsonb,
  key_dates                 jsonb not null default '{}'::jsonb,
  accepted_applicant_types  text[] not null default '{}',
  eligibility_rules         jsonb not null default '{"all":[]}'::jsonb,
  publish                   jsonb not null default '{"publicPage":true,"openGrantsIndex":true,"sitemap":true}'::jsonb,
  custom_fields             jsonb not null default '{}'::jsonb,
  cg                        jsonb,
  published_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (workspace_id, slug)
);
comment on column public.opportunities.cg is 'Regenerated CommonGrants OpportunityBase projection, validated with @common-grants/sdk before it is stored.';
create index opportunities_workspace_id_idx on public.opportunities (workspace_id);
create index opportunities_program_id_idx on public.opportunities (program_id);
create index opportunities_published_idx on public.opportunities (status, published_at) where published_at is not null;

create table public.competitions (
  id                        uuid primary key default gms.uuid_v7(),
  workspace_id              uuid not null references public.workspaces (id) on delete cascade,
  opportunity_id            uuid not null references public.opportunities (id) on delete cascade,
  title                     text not null check (length(btrim(title)) between 1 and 300),
  description               text,
  instructions              text,
  status                    text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  key_dates                 jsonb not null default '{}'::jsonb,
  stages                    jsonb not null default '[]'::jsonb check (jsonb_typeof(stages) = 'array'),
  forms                     jsonb not null default '{}'::jsonb,
  validation                jsonb not null default '{}'::jsonb,
  accepted_applicant_types  text[] not null default '{}',
  cg                        jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
comment on column public.competitions.stages is 'GMS stages (key, label, forms, opens, closes, rubricId, entryFrom, requiresSubmission, decisionRequired); exposed to CG as customFields.gms.stages.';
comment on column public.competitions.forms is 'CG CompetitionForms: the union of stage forms, formId -> pinned version.';
create index competitions_workspace_id_idx on public.competitions (workspace_id);
create index competitions_opportunity_id_idx on public.competitions (opportunity_id);
