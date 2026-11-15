-- 0039_funds.sql
-- Funds: one funder workspace, many funds (v1.8.0). Community foundations, fiscal sponsors and
-- intermediaries run many funds from one office, each with its own advisors, budget and public face.
--
-- A fund holds programs. Opportunities, competitions, applications and awards belong to a fund
-- through their program: there is no fund column on them. A member whose `scope` names `fundIds`
-- (a fund advisor: a reviewer or program officer with a fund scope) sees only those funds; the API
-- enforces it in its one authorization path (apps/api/src/services/context.ts, fundScopeOf).
--
-- What this changes on a live database:
--   * adds `funds` (RLS on, members only), with one "Default fund" (slug `default`) created for every
--     existing funder workspace, and a trigger that creates it for funder workspaces made later.
--   * programs: adds `fund_id` (references funds, on delete restrict) and fills it, for every existing
--     program, with its workspace's default fund. Nothing else on the row changes: the updated_at
--     trigger is held for this one update, so "Updated" dates stay as they were. A new or edited
--     program must name a fund (check constraint, NOT VALID so no existing row is re-checked); an
--     insert that names none gets its workspace's default fund. A program outside a funder
--     workspace (there should be none) keeps a null fund and is reported by a WARNING below.
--   * programs.fund_id must name a fund of the program's own workspace (0020's same-workspace rule,
--     extended), and a fund never moves to another workspace.
--   * gms.is_staff(): a member whose scope names fundIds is no longer "staff" for row-level security
--     (admins always are). Through RLS a fund advisor reads their funds and those funds' programs
--     only; everything else reaches them through the API, which filters by fund. The Workers use
--     the service role, so no request the GMS serves today changes.

-- ---------------------------------------------------------------------------------------------
-- Funds
-- ---------------------------------------------------------------------------------------------
create table public.funds (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  -- The fund's public address: /f/{handle}/{slug}. Reserved words are refused by the API.
  slug          text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  description   text check (description is null or length(description) <= 500),
  -- { color?: one of the theme palette names, logoUrl?: https URL }. Theme tokens only, never a hex value.
  brand         jsonb not null default '{}' check (jsonb_typeof(brand) = 'object' and length(brand::text) <= 2000),
  -- The fund's own budget per fiscal year: [{ fiscalYear, amountMinor, currency }], one per year.
  budgets       jsonb not null default '[]' check (jsonb_typeof(budgets) = 'array' and jsonb_array_length(budgets) <= 50),
  -- The fund that holds existing programs and any program created without naming a fund.
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, slug)
);
comment on table public.funds is 'A funder''s funds. Programs belong to one fund; everything under a program belongs to its fund. Written by the API (apps/api/src/services/funds.ts).';
create unique index funds_one_default_idx on public.funds (workspace_id) where is_default;

alter table public.funds enable row level security;
revoke all on public.funds from public, anon, authenticated, service_role;
grant select on public.funds to authenticated;
grant select, insert, update, delete on public.funds to service_role;
create trigger funds_touch_updated_at before update on public.funds
  for each row execute function gms.touch_updated_at();
create trigger funds_workspace_immutable before update of workspace_id on public.funds
  for each row execute function gms.workspace_id_immutable();

-- Funds belong to funder workspaces only.
create or replace function gms.fund_in_funder_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = new.workspace_id and w.kind = 'funder') then
    raise exception 'funds: only a funder workspace has funds' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.fund_in_funder_workspace() from public, anon, authenticated;
create trigger funds_in_funder_workspace before insert or update of workspace_id on public.funds
  for each row execute function gms.fund_in_funder_workspace();

-- The workspace's default fund, created when it has none. One writer at a time per workspace.
create or replace function gms.default_fund_of(ws uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f uuid;
begin
  select id into f from public.funds where workspace_id = ws and is_default;
  if f is not null then
    return f;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gms.default_fund:' || ws::text, 0));
  select id into f from public.funds where workspace_id = ws and is_default;
  if f is null then
    -- `default` may already name another fund of this workspace; the default fund then takes a longer slug.
    insert into public.funds (workspace_id, name, slug, is_default)
    values (ws, 'Default fund', case when exists (select 1 from public.funds x where x.workspace_id = ws and x.slug = 'default') then 'default-fund-' || pg_catalog.substr(pg_catalog.md5(ws::text), 1, 6) else 'default' end, true)
    returning id into f;
  end if;
  return f;
end;
$$;
revoke all on function gms.default_fund_of(uuid) from public, anon, authenticated;
grant execute on function gms.default_fund_of(uuid) to service_role;

-- A funder workspace made from now on starts with its default fund.
create or replace function gms.workspace_default_fund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'funder' then
    perform gms.default_fund_of(new.id);
  end if;
  return null;
end;
$$;
revoke all on function gms.workspace_default_fund() from public, anon, authenticated;
create trigger workspaces_default_fund after insert on public.workspaces
  for each row execute function gms.workspace_default_fund();

-- Every existing funder workspace gets its default fund.
insert into public.funds (workspace_id, name, slug, is_default)
select w.id, 'Default fund', 'default', true
  from public.workspaces w
 where w.kind = 'funder'
   and not exists (select 1 from public.funds f where f.workspace_id = w.id and f.is_default);

-- ---------------------------------------------------------------------------------------------
-- Programs belong to one fund
-- ---------------------------------------------------------------------------------------------
alter table public.programs add column if not exists fund_id uuid references public.funds (id) on delete restrict;
create index if not exists programs_fund_id_idx on public.programs (fund_id);
comment on column public.programs.fund_id is 'The fund this program belongs to. Opportunities, competitions, applications and awards belong to it through the program.';

-- Existing programs move into their workspace's default fund. Only fund_id changes.
alter table public.programs disable trigger programs_touch_updated_at;
update public.programs p
   set fund_id = f.id
  from public.funds f
 where f.workspace_id = p.workspace_id and f.is_default and p.fund_id is null;
alter table public.programs enable trigger programs_touch_updated_at;

-- An insert that names no fund lands in the default fund (older clients, the seed, imports).
create or replace function gms.program_default_fund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fund_id is null then
    new.fund_id := gms.default_fund_of(new.workspace_id);
  end if;
  return new;
end;
$$;
revoke all on function gms.program_default_fund() from public, anon, authenticated;
create trigger programs_default_fund before insert on public.programs
  for each row execute function gms.program_default_fund();

-- New and edited programs name a fund. NOT VALID: existing rows are not re-checked.
alter table public.programs add constraint programs_fund_required check (fund_id is not null) not valid;

-- The fund is the program's own workspace's: 0030's list of same-workspace rules (0020) plus one row.
create or replace function gms.same_workspace_rules()
returns table (child text, col text, parent text)
language sql
immutable
set search_path = ''
as $$
  values
    ('opportunities', 'program_id', 'programs'),
    ('competitions', 'opportunity_id', 'opportunities'),
    ('applications', 'competition_id', 'competitions'),
    ('applications', 'opportunity_id', 'opportunities'),
    ('form_responses', 'application_id', 'applications'),
    ('form_responses', 'submission_id', 'submissions'),
    ('application_events', 'application_id', 'applications'),
    ('review_assignments', 'application_id', 'applications'),
    ('reviews', 'assignment_id', 'review_assignments'),
    ('decisions', 'application_id', 'applications'),
    ('decisions', 'competition_id', 'competitions'),
    ('awards', 'application_id', 'applications'),
    ('awards', 'opportunity_id', 'opportunities'),
    ('awards', 'program_id', 'programs'),
    ('awards', 'parent_award_id', 'awards'),
    ('agreements', 'award_id', 'awards'),
    ('payment_schedules', 'award_id', 'awards'),
    ('tranches', 'award_id', 'awards'),
    ('tranches', 'schedule_id', 'payment_schedules'),
    ('requirements', 'award_id', 'awards'),
    ('requirements', 'releases_tranche_id', 'tranches'),
    ('submissions', 'requirement_id', 'requirements'),
    ('submissions', 'award_id', 'awards'),
    ('budgets', 'award_id', 'awards'),
    ('budgets', 'application_id', 'applications'),
    ('amendments', 'award_id', 'awards'),
    ('amendments', 'child_award_id', 'awards'),
    ('bank_transactions', 'matched_tranche_id', 'tranches'),
    ('award_invitations', 'award_id', 'awards'),
    ('outside_applications', 'funder_record_id', 'funder_records'),
    ('outside_applications', 'receipt_document_id', 'documents'),
    ('outside_applications', 'snapshot_document_id', 'documents'),
    ('outside_questions', 'outside_application_id', 'outside_applications'),
    ('outside_questions', 'obligation_id', 'outside_obligations'),
    ('outside_answers', 'question_id', 'outside_questions'),
    ('outside_answers', 'library_answer_id', 'answers'),
    ('consulting_requests', 'outside_application_id', 'outside_applications'),
    ('outside_obligation_series', 'outside_application_id', 'outside_applications'),
    ('outside_obligations', 'outside_application_id', 'outside_applications'),
    ('outside_obligations', 'series_id', 'outside_obligation_series'),
    ('outside_obligations', 'document_id', 'documents'),
    ('programs', 'fund_id', 'funds')
$$;
revoke all on function gms.same_workspace_rules() from public, anon, authenticated;
grant execute on function gms.same_workspace_rules() to service_role;
-- Ordered after programs_default_fund (trigger names fire alphabetically), so the filled-in fund is checked too.
create trigger programs_same_workspace before insert or update of fund_id, workspace_id on public.programs
  for each row execute function gms.same_workspace_as_parent();

do $$
declare
  n integer;
begin
  select count(*) into n from public.programs where fund_id is null;
  if n > 0 then
    raise warning '0039: % program(s) sit outside a funder workspace and have no fund; they stay readable, and must be moved or removed before they can be edited', n;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security for fund advisors
-- ---------------------------------------------------------------------------------------------
-- A member is fund-scoped when their scope names fundIds (an array) and they are not an admin.
create or replace function gms.fund_scope_has(ws uuid, fund uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and (m.expires_at is null or m.expires_at > pg_catalog.now())
      and m.role <> 'admin'
      and pg_catalog.jsonb_typeof(m.scope -> 'fundIds') = 'array'
      and (m.scope -> 'fundIds') ? fund::text
  );
$$;
revoke all on function gms.fund_scope_has(uuid, uuid) from public, anon;
grant execute on function gms.fund_scope_has(uuid, uuid) to authenticated, service_role;

-- Staff = members whose access is not restricted to assigned or scoped records. A fund advisor is
-- restricted to their funds, so they are not staff (admins always are).
create or replace function gms.is_staff(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and m.role not in ('reviewer', 'external_reviewer', 'consultant')
      and (m.role = 'admin' or pg_catalog.jsonb_typeof(m.scope -> 'fundIds') is distinct from 'array')
      and (m.expires_at is null or m.expires_at > pg_catalog.now())
  );
$$;

create policy funds_select on public.funds for select to authenticated
  using (gms.is_staff(workspace_id) or gms.fund_scope_has(workspace_id, id));

drop policy if exists programs_select on public.programs;
create policy programs_select on public.programs for select to authenticated
  using (gms.is_staff(workspace_id) or (fund_id is not null and gms.fund_scope_has(workspace_id, fund_id)));
