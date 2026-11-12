-- 0020_same_workspace_as_parent.sql
-- A child row belongs to the workspace of the row it hangs off.
--
-- Every table below carries its own `workspace_id` and a foreign key to a parent. The foreign key
-- only says the parent exists; nothing said it is the same funder's. A row could therefore sit in
-- workspace E and name an award, an application or an opportunity of workspace F, and the services
-- authorized on the child's workspace while acting on the parent (red team 2026-11: a tranche in a
-- self-made workspace, pointed at another funder's award, was released with that funder's Passport
-- client). The services now check the parent too; this makes the row itself impossible, for every
-- writer including the service role.
--
-- What it adds: one trigger function, a BEFORE INSERT OR UPDATE trigger on each child table, a
-- guard against moving a row to another workspace, and `gms.cross_workspace_children()` to list
-- rows that already break the rule. No row is changed. Existing rows are not re-checked by a
-- trigger until one of the named columns is written, so a row that breaks the rule today stays
-- readable (the services answer 404 for it) and is reported by the WARNING at the end of this
-- migration. None should exist; for one that does, read the ledger of both workspaces around its
-- created_at, decide with the affected funder, and remove the child row as the database owner.

-- column → parent table, per child table. Kept in one place so the trigger, the listing function
-- and the in-memory repository used by the tests (apps/api/src/services/repos/memory.ts) agree.
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
    ('bank_transactions', 'matched_tranche_id', 'tranches')
$$;

-- SECURITY DEFINER so the parent is always visible to the check, whoever writes the child: with the
-- writer's own rights, row-level security on the parent could hide it and the check would pass.
create or replace function gms.same_workspace_as_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  row_json jsonb := to_jsonb(new);
  parent_id uuid;
  parent_ws uuid;
begin
  for r in select col, parent from gms.same_workspace_rules() where child = tg_table_name loop
    parent_id := (row_json ->> r.col)::uuid;
    if parent_id is null then
      continue;
    end if;
    execute pg_catalog.format('select workspace_id from public.%I where id = $1', r.parent) into parent_ws using parent_id;
    -- A parent that does not exist is the foreign key's to refuse.
    if parent_ws is not null and parent_ws is distinct from new.workspace_id then
      raise exception '%.% names a row of another workspace', tg_table_name, r.col using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

-- A row never moves to another workspace: its children would be left behind in the old one.
create or replace function gms.workspace_id_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception '%: a row cannot be moved to another workspace', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare
  t record;
  cols text;
begin
  for t in select child, pg_catalog.string_agg(pg_catalog.quote_ident(col), ', ' order by col) as cols from gms.same_workspace_rules() group by child loop
    execute pg_catalog.format('drop trigger if exists %I on public.%I', t.child || '_same_workspace', t.child);
    execute pg_catalog.format(
      'create trigger %I before insert or update of %s, workspace_id on public.%I for each row execute function gms.same_workspace_as_parent()',
      t.child || '_same_workspace', t.cols, t.child
    );
  end loop;
  -- Parents and children alike keep the workspace they were created in.
  for t in select distinct name as child from (select child as name from gms.same_workspace_rules() union select parent from gms.same_workspace_rules()) x loop
    execute pg_catalog.format('drop trigger if exists %I on public.%I', t.child || '_workspace_immutable', t.child);
    execute pg_catalog.format(
      'create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()',
      t.child || '_workspace_immutable', t.child
    );
  end loop;
end;
$$;

-- Rows that already break the rule (there should be none). For the operator; never for a tenant.
create or replace function gms.cross_workspace_children()
returns table (child_table text, child_id uuid, column_name text, parent_table text, parent_id uuid, child_workspace uuid, parent_workspace uuid)
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
begin
  for r in select child, col, parent from gms.same_workspace_rules() loop
    return query execute pg_catalog.format(
      'select %L::text, c.id, %L::text, %L::text, p.id, c.workspace_id, p.workspace_id from public.%I c join public.%I p on p.id = c.%I where p.workspace_id is distinct from c.workspace_id',
      r.child, r.col, r.parent, r.child, r.parent, r.col
    );
  end loop;
end;
$$;

revoke all on function gms.same_workspace_rules() from public, anon, authenticated;
revoke all on function gms.same_workspace_as_parent() from public, anon, authenticated;
revoke all on function gms.workspace_id_immutable() from public, anon, authenticated;
revoke all on function gms.cross_workspace_children() from public, anon, authenticated;
grant execute on function gms.same_workspace_rules() to service_role;
grant execute on function gms.cross_workspace_children() to service_role;

do $$
declare
  n integer;
begin
  select count(*) into n from gms.cross_workspace_children();
  if n > 0 then
    raise warning 'gms: % existing row(s) name a parent in another workspace. They are inert (the API answers 404 for them). List them with: select * from gms.cross_workspace_children();', n;
  end if;
end;
$$;
