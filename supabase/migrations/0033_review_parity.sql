-- 0033_review_parity.sql
-- Review parity (v1.8.0): a conflict-of-interest policy per competition that every reviewer signs
-- before any application in it opens for them, and anonymized review as a per-stage setting.
-- Funders moving from other grant systems expect both. Per-assignment conflict declarations,
-- recusal and blind scoring already exist (0004) and are unchanged.
--
-- Privacy: both new tables belong to one funder workspace. Signed-in users get SELECT through the
-- policies below; every write goes through the API's service role (a reviewer signs through the
-- API, never through the data API, and an agent cannot sign at all). A policy's text is readable by
-- the workspace's staff and by its reviewers (an external reviewer only for the competitions they
-- were invited to); a signature is readable by staff and by the reviewer who signed it. No other
-- reviewer, no applicant and no other workspace reads either.
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * adds coi_policies: the policy text of a competition, one row per version. A new version is
--     a new row; a row never changes (the text a reviewer signed stays readable as signed).
--   * adds coi_signatures: one row per reviewer, competition and policy version, with the name they
--     typed, when they signed, and the organizations they declared a conflict with (what they typed,
--     and the applicant workspaces it matched). A signature never changes.
--   * both tables: RLS on, the updated_at trigger, a same-workspace trigger (the competition and,
--     for a signature, the policy version are the workspace's own), workspace_id immutable.
--     gms.same_workspace_rules() is NOT replaced: these tables carry their own check, so no other
--     migration's list is touched.
--   * competitions: a check that a stage's `anonymized` setting, where present, is true or false.
--     Stage settings live in competitions.stages (jsonb), as the rubric, review mode and panel
--     settings already do, so the flag is a JSON key with no new column. No existing stage has the
--     key, so every existing row passes; the constraint is added NOT VALID and then validated, which
--     checks existing rows without blocking writes for longer than the scan.
-- No existing row is changed or removed.

-- ---------------------------------------------------------------------------------------------
-- Helpers (immutable checks on jsonb)
-- ---------------------------------------------------------------------------------------------

-- Stage review settings: `anonymized`, when a stage has it, is a boolean.
create or replace function gms.stage_review_settings_ok(stages jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select stages is null
      or pg_catalog.jsonb_typeof(stages) <> 'array'
      or not exists (
        select 1 from pg_catalog.jsonb_array_elements(stages) s
         where pg_catalog.jsonb_typeof(s) = 'object'
           and s ? 'anonymized'
           and pg_catalog.jsonb_typeof(s -> 'anonymized') <> 'boolean'
      );
$$;

-- What a reviewer typed when declaring conflicts: at most 50 entries of { name, website? }, short.
create or replace function gms.declared_orgs_ok(d jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(d) = 'array'
     and pg_catalog.jsonb_array_length(d) <= 50
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(d) e
        where pg_catalog.jsonb_typeof(e) <> 'object'
           or exists (select 1 from pg_catalog.jsonb_object_keys(e) k where k not in ('name', 'website'))
           or pg_catalog.jsonb_typeof(e -> 'name') <> 'string'
           or pg_catalog.length(e ->> 'name') not between 1 and 200
           or (e ? 'website' and (pg_catalog.jsonb_typeof(e -> 'website') <> 'string' or pg_catalog.length(e ->> 'website') > 300))
     );
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.coi_policies (
  id              uuid primary key default gms.uuid_v7(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  competition_id  uuid not null references public.competitions (id) on delete cascade,
  version         integer not null check (version >= 1),
  policy_text     text not null check (pg_catalog.length(pg_catalog.btrim(policy_text)) between 1 and 20000),
  -- True when the text is the plain-language default rather than the funder's own.
  is_default      boolean not null default false,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (competition_id, version)
);
comment on table public.coi_policies is 'The conflict-of-interest policy reviewers sign, per competition; a new version is a new row.';
create index coi_policies_workspace_idx on public.coi_policies (workspace_id);

create table public.coi_signatures (
  id                uuid primary key default gms.uuid_v7(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  competition_id    uuid not null references public.competitions (id) on delete cascade,
  reviewer_user_id  uuid not null references auth.users (id) on delete cascade,
  policy_version    integer not null,
  signed_name       text not null check (pg_catalog.length(pg_catalog.btrim(signed_name)) between 2 and 200),
  signed_at         timestamptz not null default now(),
  -- Applicant workspaces the declared organizations matched when the reviewer signed.
  declared_org_ids  uuid[] not null default '{}',
  -- What the reviewer typed, matched or not.
  declared_orgs     jsonb not null default '[]'::jsonb check (gms.declared_orgs_ok(declared_orgs)),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (competition_id, policy_version) references public.coi_policies (competition_id, version) on delete restrict,
  unique (competition_id, reviewer_user_id, policy_version)
);
comment on table public.coi_signatures is 'A reviewer''s signature of a competition''s conflict-of-interest policy version, with the conflicts they declared.';
create index coi_signatures_workspace_idx on public.coi_signatures (workspace_id);
create index coi_signatures_reviewer_idx on public.coi_signatures (reviewer_user_id, competition_id);

-- ---------------------------------------------------------------------------------------------
-- Integrity: same workspace as the competition, rows never change
-- ---------------------------------------------------------------------------------------------

-- SECURITY DEFINER so the competition is always visible to the check, whoever writes the row.
create or replace function gms.coi_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.competitions c where c.id = new.competition_id and c.workspace_id = new.workspace_id) then
    raise exception '%: the competition is not in this workspace', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A policy version and a signature are records of what was agreed: neither is edited.
create or replace function gms.coi_rows_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: a signed or published record cannot be changed', tg_table_name using errcode = '23514';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['coi_policies', 'coi_signatures'] loop
    execute pg_catalog.format('alter table public.%I enable row level security', t);
    execute pg_catalog.format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute pg_catalog.format('grant select, insert, update, delete on public.%I to service_role', t);
    execute pg_catalog.format('grant select on public.%I to authenticated', t);
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before insert or update of competition_id, workspace_id on public.%I for each row execute function gms.coi_same_workspace()', t || '_same_workspace', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.coi_rows_immutable()', t || '_immutable', t);
  end loop;
end;
$$;

revoke all on function gms.coi_same_workspace() from public, anon, authenticated;
revoke all on function gms.coi_rows_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Policies (SELECT for authenticated)
-- ---------------------------------------------------------------------------------------------

-- Staff, the workspace's reviewers, and an external reviewer for the competitions they were invited to.
create policy coi_policies_select on public.coi_policies for select to authenticated
  using (gms.is_staff(workspace_id)
         or gms.has_role(workspace_id, array['reviewer'])
         or gms.scope_has(workspace_id, 'competitionIds', competition_id));

-- Staff, and the reviewer who signed.
create policy coi_signatures_select on public.coi_signatures for select to authenticated
  using (gms.is_staff(workspace_id) or reviewer_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Anonymized review: a stage setting
-- ---------------------------------------------------------------------------------------------

alter table public.competitions
  add constraint competitions_stage_review_settings_check check (gms.stage_review_settings_ok(stages)) not valid;
alter table public.competitions validate constraint competitions_stage_review_settings_check;
comment on column public.competitions.stages is 'Stage list (key, label, forms, dates, rubricId, reviewMode, panelOpen, anonymized, ...). anonymized: reviewers in the stage do not see who applied.';
