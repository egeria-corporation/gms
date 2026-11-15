-- 0031_imports.sql
-- Import from a spreadsheet (v1.7.0): a funder brings its grant history and an applicant its
-- applications from a CSV or XLSX file, a Google Sheets spreadsheet or an Airtable base. Every run
-- is checked first (a dry run with a reconciliation), then committed in batches; every source row
-- is imported at most once per workspace.
--
-- Privacy: every row below belongs to one workspace and is readable only by that workspace's staff
-- (gms.is_staff: consultants and reviewers excluded). Signed-in users get SELECT through the
-- policies below; every write goes through the API's service role. Columns that look like bank or
-- identity data are dropped in the API before anything is stored: a run keeps the dropped
-- columns' names only, never their values.
--
-- What this changes on a live database:
--   * adds three tables, each with RLS on, `updated_at` kept by gms.touch_updated_at(), the
--     workspace-immutable trigger, and a trigger that keeps each target to its kind of workspace
--     (outside applications: applicant workspaces; grant history: funder workspaces):
--       import_mappings  the column mapping saved per workspace, target and source;
--       import_runs      one import run: its source, mapping, dropped column names, reconciliation;
--       import_rows      the run log: one row per source row, its key, outcome and what it created.
--     A row's key may be written (an entity created) once per workspace and target: a partial
--     unique index makes a re-run, or two runs at once, idempotent.
--   * connector_accounts: the provider check gains 'google_sheets' and 'airtable' (the import
--     sources connected through Composio). Every existing value is still allowed; existing rows
--     are not touched.
-- No existing row is changed or removed. No backfill.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- A mapping: an object of at most 40 field names (letters only), each naming a column (≤ 300 chars).
create or replace function gms.import_mapping_ok(m jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(m) = 'object'
     and (select count(*) from pg_catalog.jsonb_object_keys(m)) <= 40
     and not exists (
       select 1 from pg_catalog.jsonb_each(m) f
        where f.key !~ '^[A-Za-z]{1,40}$'
           or pg_catalog.jsonb_typeof(f.value) <> 'string'
           or pg_catalog.length(f.value #>> '{}') not between 1 and 300
     );
$$;

-- Dropped columns: [{ column, reason }], at most 200, the column's name only.
create or replace function gms.import_dropped_ok(d jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(d) = 'array'
     and pg_catalog.jsonb_array_length(d) <= 200
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(d) e(v)
        where pg_catalog.jsonb_typeof(e.v) <> 'object'
           or pg_catalog.jsonb_typeof(e.v -> 'column') is distinct from 'string'
           or pg_catalog.length(e.v ->> 'column') > 300
           or (e.v ->> 'reason') is null
           or (e.v ->> 'reason') not in ('header', 'bank_routing', 'identity_number', 'long_number')
           or exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k where k not in ('column', 'reason'))
     );
$$;

-- Problems of a row: [{ field?, message }], at most 30, messages only (never a cell's value
-- beyond the short quote a message may carry).
create or replace function gms.import_problems_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p) = 'array'
     and pg_catalog.jsonb_array_length(p) <= 30
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(p) e(v)
        where pg_catalog.jsonb_typeof(e.v) <> 'object'
           or pg_catalog.jsonb_typeof(e.v -> 'message') is distinct from 'string'
           or pg_catalog.length(e.v ->> 'message') > 300
           or (e.v ? 'field' and (pg_catalog.jsonb_typeof(e.v -> 'field') <> 'string' or (e.v ->> 'field') !~ '^[A-Za-z]{1,40}$'))
           or exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k where k not in ('field', 'message'))
     );
$$;

-- Each target belongs to one kind of workspace.
create or replace function gms.import_target_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
begin
  select w.kind into k from public.workspaces w where w.id = new.workspace_id;
  if (new.target = 'outside_applications' and k is distinct from 'applicant')
     or (new.target = 'award_history' and k is distinct from 'funder') then
    raise exception '%: % imports belong to % workspaces', tg_table_name, new.target,
      case new.target when 'outside_applications' then 'applicant' else 'funder' end using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.import_mappings (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  target        text not null check (target in ('outside_applications', 'award_history')),
  source        text not null check (source in ('csv', 'xlsx', 'google_sheets', 'airtable')),
  -- Which source the mapping is for: `columns:<hash>` for files with the same columns, the
  -- spreadsheet and tab for Google Sheets, the base and table for Airtable.
  source_ref    text not null check (length(source_ref) between 1 and 300),
  mapping       jsonb not null check (gms.import_mapping_ok(mapping)),
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, target, source, source_ref)
);
comment on table public.import_mappings is 'The column mapping saved per workspace, target and source, offered again next time. Field name to column header only.';

create table public.import_runs (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  target           text not null check (target in ('outside_applications', 'award_history')),
  source           text not null check (source in ('csv', 'xlsx', 'google_sheets', 'airtable')),
  -- What the person sees: a file name, a spreadsheet tab, an Airtable table.
  source_label     text check (source_label is null or length(source_label) <= 300),
  source_ref       text check (source_ref is null or length(source_ref) <= 300),
  mapping          jsonb not null check (gms.import_mapping_ok(mapping)),
  -- Names only: the values of a dropped column are never stored.
  dropped_columns  jsonb not null default '[]'::jsonb check (gms.import_dropped_ok(dropped_columns)),
  reconciliation   jsonb not null default '{}'::jsonb check (jsonb_typeof(reconciliation) = 'object'),
  rows_total       integer not null check (rows_total between 0 and 5000),
  created_by       uuid,
  -- A run is a preview until it is committed, and finished once every row to create is written.
  committed_by     uuid,
  committed_at     timestamptz,
  finished_at      timestamptz,
  -- A preview that is not committed by then is deleted with its rows.
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- The run log points at (id, workspace_id, target), so a row sits in its run's workspace and target.
  unique (id, workspace_id, target),
  check (finished_at is null or committed_at is not null),
  check ((committed_at is null) = (committed_by is null))
);
comment on table public.import_runs is 'One import run (dry run, then commit). Dropped sensitive columns are kept by name only.';
create index import_runs_workspace_idx on public.import_runs (workspace_id, created_at desc);
create index import_runs_expires_idx on public.import_runs (expires_at) where committed_at is null;

create table public.import_rows (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  run_id        uuid not null,
  target        text not null check (target in ('outside_applications', 'award_history')),
  -- Where the row was in the source (spreadsheet row, or record position).
  line          integer not null check (line between 1 and 1000000),
  -- SHA-256 of the target and the row's id or content (packages/importers/src/plan.ts).
  row_key       text not null check (row_key ~ '^[0-9a-f]{64}$'),
  outcome       text not null check (outcome in ('create', 'skip', 'error')),
  reason        text check (reason is null or length(reason) <= 300),
  problems      jsonb not null default '[]'::jsonb check (gms.import_problems_ok(problems)),
  -- The checked record to create; emptied once it is written.
  record        jsonb check (record is null or jsonb_typeof(record) = 'object'),
  title         text not null check (length(title) between 1 and 300),
  subtitle      text check (subtitle is null or length(subtitle) <= 300),
  -- Chosen before the entity is written (the claim), so a retried batch finishes the same entity.
  entity_type   text check (entity_type is null or entity_type in ('outside_application', 'award')),
  entity_id     uuid,
  written_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (run_id, workspace_id, target) references public.import_runs (id, workspace_id, target) on delete cascade,
  unique (run_id, line),
  check ((entity_id is null) = (entity_type is null)),
  check (written_at is null or entity_id is not null),
  check (outcome = 'create' or (entity_id is null and record is null))
);
comment on table public.import_rows is 'The import run log: one row per source row. A row key is written at most once per workspace and target.';
-- Idempotency: one entity per row key, per workspace and target, across every run.
create unique index import_rows_claim_idx on public.import_rows (workspace_id, target, row_key) where entity_id is not null;
create index import_rows_pending_idx on public.import_rows (run_id, line) where outcome = 'create' and written_at is null;

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers
-- ---------------------------------------------------------------------------------------------

alter table public.import_mappings enable row level security;
alter table public.import_runs enable row level security;
alter table public.import_rows enable row level security;

revoke all on public.import_mappings, public.import_runs, public.import_rows from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.import_mappings, public.import_runs, public.import_rows to service_role;
grant select on public.import_mappings, public.import_runs, public.import_rows to authenticated;

create policy import_mappings_select on public.import_mappings for select to authenticated
  using (gms.is_staff(workspace_id));
create policy import_runs_select on public.import_runs for select to authenticated
  using (gms.is_staff(workspace_id));
create policy import_rows_select on public.import_rows for select to authenticated
  using (gms.is_staff(workspace_id));

do $$
declare
  t text;
begin
  foreach t in array array['import_mappings', 'import_runs', 'import_rows'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
    execute pg_catalog.format('create trigger %I before insert or update of workspace_id, target on public.%I for each row execute function gms.import_target_workspace()', t || '_target_workspace', t);
  end loop;
end;
$$;

revoke all on function gms.import_target_workspace() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Connector accounts: the import sources connected through Composio
-- ---------------------------------------------------------------------------------------------

alter table public.connector_accounts drop constraint connector_accounts_provider_check;
alter table public.connector_accounts add constraint connector_accounts_provider_check
  check (provider in ('google_workspace', 'mercury', 'google_sheets', 'airtable'));
comment on column public.connector_accounts.secret_enc is 'Mercury read-only token as ciphertext. Composio holds Google, Google Sheets and Airtable credentials; nothing is stored for them here.';
