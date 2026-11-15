-- 0034_report_builder.sql
-- The report builder: a funder's saved report views, the weekly or monthly schedule of one, and
-- the CSV files a schedule writes. Every row belongs to one funder workspace and is read only by
-- that workspace's members who may read reports (admin, program officer, finance, observer,
-- auditor). Signed-in users get SELECT through the policies below; every write goes through the
-- API's service role, which builds a report's query from the columns the API allows, never from
-- column names or SQL a client sends.
--
-- What this changes on a live database:
--   * adds three tables, RLS on, each with the updated_at trigger, the workspace-immutable trigger
--     and a trigger that keeps them in funder workspaces and in the same workspace as their view:
--       report_views      a saved view: name, data set, definition (JSON the API validates against
--                         its column whitelist), private to its owner or shared with the workspace;
--       report_schedules  at most one per view: weekly (ISO weekday) or monthly (day 1-28), sent to
--                         1-20 members of the workspace (user ids, never an address);
--       report_files      one CSV per view and period (unique), kept 30 days in the EXPORTS bucket
--                         under exports/<workspace>/reports/; the row says who may download it.
--   * adds one trigger function, gms.report_rows_check(). No existing function is replaced.
-- No existing table, column or row is changed or removed. The tables are new and empty, so no
-- existing row can violate a constraint added here.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.report_views (
  id             uuid primary key default gms.uuid_v7(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 120),
  description    text check (description is null or length(description) <= 1000),
  data_set       text not null check (data_set in ('applications', 'awards', 'payments', 'requirements', 'organizations')),
  -- { columns[], filters[], groupBy[], aggregates[], sort[] } over whitelisted column keys; the API validates it.
  definition     jsonb not null check (pg_catalog.jsonb_typeof(definition) = 'object' and pg_catalog.pg_column_size(definition) <= 16384),
  visibility     text not null default 'private' check (visibility in ('private', 'workspace')),
  owner_user_id  uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.report_views is 'A saved report: a data set, columns, filters, grouping and sort over the columns the API allows. Private to its owner or shared with the funder workspace.';
create index report_views_workspace_idx on public.report_views (workspace_id, name);

create table public.report_schedules (
  id                  uuid primary key default gms.uuid_v7(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  -- One schedule per view: (view, period) is then the unit a file is written and mailed once for.
  view_id             uuid not null unique references public.report_views (id) on delete cascade,
  cadence             text not null check (cadence in ('weekly', 'monthly')),
  -- Weekly: ISO weekday, 1 = Monday. Monthly: the day of the month, 1-28 so every month has it.
  weekday             integer check (weekday between 1 and 7),
  day_of_month        integer check (day_of_month between 1 and 28),
  -- Members of the workspace (user ids). The API checks each one, at scheduling and at every send.
  recipient_user_ids  uuid[] not null check (pg_catalog.cardinality(recipient_user_ids) between 1 and 20 and pg_catalog.array_position(recipient_user_ids, null) is null),
  created_by          uuid not null,
  -- The first period sent is the first whose send time is after this.
  starts_at           timestamptz not null default now(),
  active              boolean not null default true,
  stopped_reason      text check (stopped_reason is null or stopped_reason in ('owner_left', 'no_recipients', 'view_private')),
  last_period         text check (last_period is null or last_period ~ '^[0-9]{4}-(W[0-9]{2}|[0-9]{2})$'),
  last_sent_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((cadence = 'weekly' and weekday is not null and day_of_month is null) or (cadence = 'monthly' and day_of_month is not null and weekday is null)),
  check (active or stopped_reason is not null)
);
comment on table public.report_schedules is 'When a saved report view is sent as a CSV, and to which members of the workspace. Never to an outside address.';
create index report_schedules_active_idx on public.report_schedules (workspace_id) where active;

create table public.report_files (
  id                  uuid primary key default gms.uuid_v7(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  view_id             uuid not null references public.report_views (id) on delete cascade,
  schedule_id         uuid references public.report_schedules (id) on delete set null,
  -- ISO week (2027-W16) or month (2027-04).
  period_key          text not null check (period_key ~ '^[0-9]{4}-(W[0-9]{2}|[0-9]{2})$'),
  storage_key         text not null check (storage_key ~ '^exports/[0-9a-f-]{36}/reports/[0-9a-f-]{36}/[0-9]{4}-(W[0-9]{2}|[0-9]{2})\.csv$'),
  row_count           integer not null check (row_count between 0 and 50000),
  truncated           boolean not null default false,
  -- Who may download it: the recipients it was sent to.
  recipient_user_ids  uuid[] not null check (pg_catalog.cardinality(recipient_user_ids) <= 20 and pg_catalog.array_position(recipient_user_ids, null) is null),
  sent_count          integer not null default 0 check (sent_count >= 0),
  -- Null until every email went out; a later run finishes a file it finds unsent.
  sent_at             timestamptz,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (view_id, period_key),
  check (expires_at > created_at)
);
comment on table public.report_files is 'A CSV written by a report schedule, once per view and period, kept 30 days. Downloaded only by its recipients, signed in.';
create index report_files_expiry_idx on public.report_files (expires_at);

-- ---------------------------------------------------------------------------------------------
-- Funder workspaces only, and in the workspace of the view (for every writer, the service role too)
-- ---------------------------------------------------------------------------------------------
create or replace function gms.report_rows_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select w.kind from public.workspaces w where w.id = new.workspace_id) is distinct from 'funder' then
    raise exception '%: rows belong to funder workspaces', tg_table_name using errcode = '23514';
  end if;
  -- Nested, so each table's own columns are only read on that table.
  if tg_table_name in ('report_schedules', 'report_files') then
    if not exists (select 1 from public.report_views v where v.id = new.view_id and v.workspace_id = new.workspace_id) then
      raise exception '%: the view belongs to another workspace', tg_table_name using errcode = '23514';
    end if;
  end if;
  if tg_table_name = 'report_files' then
    if new.schedule_id is not null
       and not exists (select 1 from public.report_schedules s where s.id = new.schedule_id and s.view_id = new.view_id and s.workspace_id = new.workspace_id) then
      raise exception 'report_files: the schedule belongs to another view or workspace' using errcode = '23514';
    end if;
    if new.storage_key not like 'exports/' || new.workspace_id::text || '/reports/' || new.view_id::text || '/%' then
      raise exception 'report_files: a file is stored under its own workspace and view' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gms.report_rows_check() from public, anon, authenticated;

create trigger report_views_funder_only before insert or update of workspace_id on public.report_views
  for each row execute function gms.report_rows_check();
create trigger report_schedules_funder_only before insert or update of workspace_id, view_id on public.report_schedules
  for each row execute function gms.report_rows_check();
create trigger report_files_funder_only before insert or update of workspace_id, view_id, schedule_id, storage_key on public.report_files
  for each row execute function gms.report_rows_check();

do $$
declare
  t text;
begin
  foreach t in array array['report_views', 'report_schedules', 'report_files'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- RLS: members who may read reports; a private view and its schedule to its owner only; a file
-- to the people it was sent to.
-- ---------------------------------------------------------------------------------------------
alter table public.report_views enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_files enable row level security;
revoke all on public.report_views, public.report_schedules, public.report_files from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.report_views, public.report_schedules, public.report_files to service_role;
grant select on public.report_views, public.report_schedules, public.report_files to authenticated;

create policy report_views_select on public.report_views for select to authenticated
  using (gms.has_role(workspace_id, array['admin', 'program_officer', 'finance', 'observer', 'auditor'])
         and (visibility = 'workspace' or owner_user_id = (select auth.uid())));
-- The view's own policy applies inside the subquery: a schedule shows only with a view the reader sees.
create policy report_schedules_select on public.report_schedules for select to authenticated
  using (gms.has_role(workspace_id, array['admin', 'program_officer', 'finance', 'observer', 'auditor'])
         and exists (select 1 from public.report_views v where v.id = view_id));
create policy report_files_select on public.report_files for select to authenticated
  using (gms.has_role(workspace_id, array['admin', 'program_officer', 'finance', 'observer', 'auditor'])
         and (select auth.uid()) = any (recipient_user_ids));
