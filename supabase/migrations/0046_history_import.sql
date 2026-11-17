-- 0046_history_import.sql
-- Imported history (v1.12.0): a funder moving from another grants system brings its past
-- applications, the reviews of them and the reports on its past grants, next to the grant history
-- of 0031 and 0042. Every run still goes through the import framework of 0031 (sensitive columns
-- dropped first, a dry run, then the commit in batches, each source row at most once).
--
-- History is read-only and is not live: these rows are written once by the import (service role)
-- and never reviewed, decided or paid. No live table (applications, review_assignments, reviews,
-- decisions, tranches, requirements) points at them, and they feed no competition.
--
-- Privacy: readable only by the funder workspace's staff (gms.is_staff: reviewers, external
-- reviewers, consultants and fund advisors excluded; the API gives fund advisors the rows of
-- their funds' awards and programs). No signed-in user may write them. A reviewer's name is kept
-- as text and never their contact details (a name holding an "@" is refused here too). Answers are
-- plain text questions and answers; the API removes email addresses and bank or identity numbers
-- from them before they are stored. The export's own ids are kept only as SHA-256 hashes
-- (source_key, application_key), used to link records and never shown. No bank or identity data
-- is stored.
--
-- What this changes on a live database:
--   * adds three tables, each with RLS on, `updated_at` kept by gms.touch_updated_at(), the
--     workspace-immutable trigger and a trigger that keeps every link in the same funder workspace
--     (gms.history_same_workspace()):
--       history_applications  a past application: organization, program and call, submitted date,
--                             outcome, requested and awarded amounts, answers, and the award and
--                             organization it was linked to (by the export's id, then exact name);
--       history_reviews       a review of a past application: reviewer name, criterion scores,
--                             total, recommendation, comment;
--       history_reports       a report on a past grant: title, due and submitted dates, where it
--                             stood, and the award it was linked to. Its file, when imported, is a
--                             document of the funder's own workspace (subject 'history_report_file'),
--                             readable by its staff under documents' existing policy.
--   * import_mappings.target, import_runs.target and import_rows.target: the checks gain
--     'history_applications', 'history_reviews' and 'history_reports'. Every existing value is
--     still allowed; no row is touched.
--   * import_rows.entity_type: the check gains 'history_application', 'history_review' and
--     'history_report'. Every existing value is still allowed.
--   * import_runs.adapter: the check gains 'cybergrants' (Bonterra CyberGrants). Every existing
--     value is still allowed. import_runs_adapter_target_check now allows an adapter on any funder
--     target (grant history and the three above), not only grant history; every existing row
--     still passes (all have target 'award_history' or no adapter).
--   * report_views.data_set: the check gains 'history' (the report builder's "Imported history"
--     data set). Every existing value is still allowed; no saved view is touched.
--   * gms.import_target_workspace() (0031) is replaced: the three new targets belong to funder
--     workspaces, as grant history does. Existing targets keep their rule.
-- No existing row is changed or removed. No backfill. If another migration after 0042 changes
-- import_runs_adapter_check, the target checks or report_views_data_set_check, keep both lists.

-- ---------------------------------------------------------------------------------------------
-- Import framework: the new targets, entities and adapter
-- ---------------------------------------------------------------------------------------------

alter table public.import_mappings drop constraint import_mappings_target_check;
alter table public.import_mappings add constraint import_mappings_target_check
  check (target in ('outside_applications', 'award_history', 'history_applications', 'history_reviews', 'history_reports'));

alter table public.import_runs drop constraint import_runs_target_check;
alter table public.import_runs add constraint import_runs_target_check
  check (target in ('outside_applications', 'award_history', 'history_applications', 'history_reviews', 'history_reports'));

alter table public.import_rows drop constraint import_rows_target_check;
alter table public.import_rows add constraint import_rows_target_check
  check (target in ('outside_applications', 'award_history', 'history_applications', 'history_reviews', 'history_reports'));

alter table public.import_rows drop constraint import_rows_entity_type_check;
alter table public.import_rows add constraint import_rows_entity_type_check
  check (entity_type is null or entity_type in ('outside_application', 'award', 'history_application', 'history_review', 'history_report'));

alter table public.import_runs drop constraint import_runs_adapter_check;
alter table public.import_runs add constraint import_runs_adapter_check
  check (adapter is null or adapter in ('good_grants', 'sm_apply', 'submittable', 'foundant_glm', 'smartsimple', 'openwater', 'cybergrants', 'fluxx', 'zengine'));

alter table public.import_runs drop constraint import_runs_adapter_target_check;
alter table public.import_runs add constraint import_runs_adapter_target_check
  -- Adapters map to a funder's targets: grant history and imported history.
  check (adapter is null or target in ('award_history', 'history_applications', 'history_reviews', 'history_reports'));

-- The report builder's data sets (0034), with imported history.
alter table public.report_views drop constraint report_views_data_set_check;
alter table public.report_views add constraint report_views_data_set_check
  check (data_set in ('applications', 'awards', 'payments', 'requirements', 'organizations', 'history'));

-- Each target belongs to one kind of workspace (0031's rule, with the history targets).
create or replace function gms.import_target_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  wanted text;
begin
  select w.kind into k from public.workspaces w where w.id = new.workspace_id;
  wanted := case when new.target = 'outside_applications' then 'applicant' else 'funder' end;
  if k is distinct from wanted then
    raise exception '%: % imports belong to % workspaces', tg_table_name, new.target, wanted using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.import_target_workspace() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Answers: [{ question, answer }], at most 150, plain text, at most 200,000 characters in all.
create or replace function gms.history_answers_ok(a jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(a) = 'array'
     and pg_catalog.jsonb_array_length(a) <= 150
     and pg_catalog.length(a::text) <= 200000
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(a) e(v)
        where pg_catalog.jsonb_typeof(e.v) <> 'object'
           or pg_catalog.jsonb_typeof(e.v -> 'question') is distinct from 'string'
           or pg_catalog.jsonb_typeof(e.v -> 'answer') is distinct from 'string'
           or pg_catalog.length(e.v ->> 'question') not between 1 and 300
           or pg_catalog.length(e.v ->> 'answer') not between 1 and 4000
           or exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k where k not in ('question', 'answer'))
     );
$$;

-- Criterion scores: [{ criterion, score, outOf }], at most 50; outOf a positive number or null.
create or replace function gms.history_scores_ok(s jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(s) = 'array'
     and pg_catalog.jsonb_array_length(s) <= 50
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(s) e(v)
        where pg_catalog.jsonb_typeof(e.v) <> 'object'
           or pg_catalog.jsonb_typeof(e.v -> 'criterion') is distinct from 'string'
           or pg_catalog.length(e.v ->> 'criterion') not between 1 and 200
           or pg_catalog.jsonb_typeof(e.v -> 'score') is distinct from 'number'
           or abs((e.v ->> 'score')::numeric) > 1000000
           or (e.v ? 'outOf' and pg_catalog.jsonb_typeof(e.v -> 'outOf') not in ('number', 'null'))
           or (pg_catalog.jsonb_typeof(e.v -> 'outOf') = 'number' and (e.v ->> 'outOf')::numeric <= 0)
           or exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k where k not in ('criterion', 'score', 'outOf'))
     );
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.history_applications (
  id                         uuid primary key default gms.uuid_v7(),
  workspace_id               uuid not null references public.workspaces (id) on delete cascade,
  -- The organization as the export named it, and the applicant workspace it was linked to
  -- (through its award, else by EIN or exact name among the funder's connected organizations).
  organization_name          text not null check (length(btrim(organization_name)) between 1 and 200),
  organization_workspace_id  uuid references public.workspaces (id) on delete set null,
  -- The award it led to: by the export's own id, then by exact title and organization.
  award_id                   uuid references public.awards (id) on delete set null,
  -- The funder's program of the same name, if any; the export's name is kept either way.
  program_id                 uuid references public.programs (id) on delete set null,
  program_name               text check (program_name is null or length(program_name) between 1 and 300),
  title                      text not null check (length(btrim(title)) between 1 and 300),
  -- The call, round or form it was sent to, as the other system named it.
  call_title                 text check (call_title is null or length(call_title) between 1 and 300),
  submitted_on               date,
  -- What was decided, read from the export's words; the words themselves in outcome_label.
  -- Written once by the import and never changed: history has no lifecycle.
  outcome                    text not null check (outcome in ('awarded', 'declined', 'withdrawn', 'undecided', 'unknown')),
  outcome_label              text check (outcome_label is null or length(outcome_label) between 1 and 100),
  currency                   text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  requested_amount_minor     bigint check (requested_amount_minor is null or requested_amount_minor >= 0),
  awarded_amount_minor       bigint check (awarded_amount_minor is null or awarded_amount_minor >= 0),
  answers                    jsonb not null default '[]'::jsonb check (gms.history_answers_ok(answers)),
  -- SHA-256 of the export's own id for the application: links its reviews. Never shown.
  source_key                 text check (source_key is null or source_key ~ '^[0-9a-f]{64}$'),
  -- Which system's export it came from (an importer adapter's key), when known.
  source_system              text check (source_system is null or source_system in ('good_grants', 'sm_apply', 'submittable', 'foundant_glm', 'smartsimple', 'openwater', 'cybergrants', 'fluxx', 'zengine')),
  import_run_id              uuid references public.import_runs (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
comment on table public.history_applications is 'A past application imported from another grants system. Read-only history: never reviewed, decided or paid, never part of a live competition. Funder staff only.';
create index history_applications_workspace_idx on public.history_applications (workspace_id, submitted_on desc nulls last);
create index history_applications_organization_idx on public.history_applications (organization_workspace_id) where organization_workspace_id is not null;
create index history_applications_award_idx on public.history_applications (award_id) where award_id is not null;
create index history_applications_source_idx on public.history_applications (workspace_id, source_key) where source_key is not null;

create table public.history_reviews (
  id                 uuid primary key default gms.uuid_v7(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  -- The past application reviewed: by the export's own id (application_key), then by exact
  -- title (and organization, when the export gives one).
  application_id     uuid references public.history_applications (id) on delete set null,
  -- SHA-256 of the export's own id for the application: links a review imported before its application.
  application_key    text check (application_key is null or application_key ~ '^[0-9a-f]{64}$'),
  application_title  text check (application_title is null or length(application_title) between 1 and 300),
  organization_name  text check (organization_name is null or length(organization_name) between 1 and 200),
  -- A name as text, never contact details.
  reviewer_name      text check (reviewer_name is null or (length(btrim(reviewer_name)) between 1 and 120 and position('@' in reviewer_name) = 0)),
  scores             jsonb not null default '[]'::jsonb check (gms.history_scores_ok(scores)),
  total_score        numeric check (total_score is null or abs(total_score) <= 1000000),
  recommendation     text check (recommendation is null or length(recommendation) between 1 and 200),
  comment            text check (comment is null or length(comment) between 1 and 5000),
  reviewed_on        date,
  source_key         text check (source_key is null or source_key ~ '^[0-9a-f]{64}$'),
  source_system      text check (source_system is null or source_system in ('good_grants', 'sm_apply', 'submittable', 'foundant_glm', 'smartsimple', 'openwater', 'cybergrants', 'fluxx', 'zengine')),
  import_run_id      uuid references public.import_runs (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (application_id is not null or application_key is not null or application_title is not null)
);
comment on table public.history_reviews is 'A review of a past application, imported from another grants system. Never counts toward a live review or decision. Funder staff only; reviewers never see it.';
create index history_reviews_application_idx on public.history_reviews (application_id) where application_id is not null;
create index history_reviews_pending_idx on public.history_reviews (workspace_id, application_key) where application_id is null and application_key is not null;

create table public.history_reports (
  id                         uuid primary key default gms.uuid_v7(),
  workspace_id               uuid not null references public.workspaces (id) on delete cascade,
  -- The award the report is on: by the export's own id, then by exact title (and organization).
  award_id                   uuid references public.awards (id) on delete set null,
  organization_workspace_id  uuid references public.workspaces (id) on delete set null,
  award_title                text check (award_title is null or length(award_title) between 1 and 300),
  organization_name          text check (organization_name is null or length(organization_name) between 1 and 200),
  title                      text not null check (length(btrim(title)) between 1 and 300),
  due_on                     date,
  submitted_on               date,
  -- Where it stood in the other system, from the export's words (report_state_label). Written
  -- once by the import and never changed: an imported report is not a live requirement.
  report_state               text not null check (report_state in ('approved', 'submitted', 'late', 'not_submitted', 'unknown')),
  report_state_label         text check (report_state_label is null or length(report_state_label) between 1 and 100),
  source_key                 text check (source_key is null or source_key ~ '^[0-9a-f]{64}$'),
  source_system              text check (source_system is null or source_system in ('good_grants', 'sm_apply', 'submittable', 'foundant_glm', 'smartsimple', 'openwater', 'cybergrants', 'fluxx', 'zengine')),
  import_run_id              uuid references public.import_runs (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
comment on table public.history_reports is 'A report on a past grant, imported from another grants system. Not a requirement of a live award: it gates no payment and sends no reminder. Funder staff only.';
create index history_reports_workspace_idx on public.history_reports (workspace_id, due_on desc nulls last);
create index history_reports_award_idx on public.history_reports (award_id) where award_id is not null;
create index history_reports_organization_idx on public.history_reports (organization_workspace_id) where organization_workspace_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Every link stays in the funder's own workspace
-- ---------------------------------------------------------------------------------------------

-- A link is checked when it is set or changed. Links cleared by `on delete set null` (an award, a
-- program or an organization deleted, or the whole workspace) are not checked again, so deleting
-- a workspace is never blocked by its history.
create or replace function gms.history_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := pg_catalog.to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) else '{}'::jsonb end;
  changed text[];
begin
  if tg_op = 'INSERT' and not exists (select 1 from public.workspaces w where w.id = new.workspace_id and w.kind = 'funder') then
    raise exception '%: imported history belongs to funder workspaces', tg_table_name using errcode = '23514';
  end if;
  select pg_catalog.array_agg(k) into changed
    from pg_catalog.unnest(array['award_id', 'program_id', 'application_id', 'organization_workspace_id', 'import_run_id']) k
   where (r ->> k) is not null and (r ->> k) is distinct from (o ->> k);
  if changed is null then
    return new;
  end if;
  if 'award_id' = any (changed) and not exists (select 1 from public.awards a where a.id = (r ->> 'award_id')::uuid and a.workspace_id = new.workspace_id) then
    raise exception '%: the award belongs to another workspace', tg_table_name using errcode = '23514';
  end if;
  if 'program_id' = any (changed) and not exists (select 1 from public.programs p where p.id = (r ->> 'program_id')::uuid and p.workspace_id = new.workspace_id) then
    raise exception '%: the program belongs to another workspace', tg_table_name using errcode = '23514';
  end if;
  if 'application_id' = any (changed) and not exists (select 1 from public.history_applications h where h.id = (r ->> 'application_id')::uuid and h.workspace_id = new.workspace_id) then
    raise exception '%: the application belongs to another workspace', tg_table_name using errcode = '23514';
  end if;
  if 'organization_workspace_id' = any (changed) and not exists (select 1 from public.workspaces w where w.id = (r ->> 'organization_workspace_id')::uuid and w.kind = 'applicant') then
    raise exception '%: the organization is not an applicant workspace', tg_table_name using errcode = '23514';
  end if;
  if 'import_run_id' = any (changed) and not exists (select 1 from public.import_runs i where i.id = (r ->> 'import_run_id')::uuid and i.workspace_id = new.workspace_id) then
    raise exception '%: the import run belongs to another workspace', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.history_same_workspace() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers
-- ---------------------------------------------------------------------------------------------

alter table public.history_applications enable row level security;
alter table public.history_reviews enable row level security;
alter table public.history_reports enable row level security;

revoke all on public.history_applications, public.history_reviews, public.history_reports from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.history_applications, public.history_reviews, public.history_reports to service_role;
grant select on public.history_applications, public.history_reviews, public.history_reports to authenticated;

create policy history_applications_select on public.history_applications for select to authenticated
  using (gms.is_staff(workspace_id));
create policy history_reviews_select on public.history_reviews for select to authenticated
  using (gms.is_staff(workspace_id));
create policy history_reports_select on public.history_reports for select to authenticated
  using (gms.is_staff(workspace_id));

do $$
declare
  t text;
begin
  foreach t in array array['history_applications', 'history_reviews', 'history_reports'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
    execute pg_catalog.format('create trigger %I before insert or update on public.%I for each row execute function gms.history_same_workspace()', t || '_same_workspace', t);
  end loop;
end;
$$;
