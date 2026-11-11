-- 0015_launch_prep: program owners, member activity, budget category mapping, and a person's own
-- sign-in sessions.

-- A program has an owner on the funder's staff (shown in program lists).
alter table public.programs
  add column owner_user_id uuid references auth.users (id) on delete set null;
comment on column public.programs.owner_user_id is 'The staff member who owns the program. Display only; access comes from the role.';

-- When a member last used the workspace. Written at most once every 15 minutes per member.
alter table public.workspace_members
  add column last_active_at timestamptz;
comment on column public.workspace_members.last_active_at is 'Last authenticated request in this workspace, to the nearest 15 minutes.';

-- The grantee maps its own budget categories to the funder's, so variance compares like with like.
alter table public.awards
  add column budget_category_mapping jsonb not null default '{}'::jsonb
    check (jsonb_typeof(budget_category_mapping) = 'object');
comment on column public.awards.budget_category_mapping is '{ <grantee category>: <funder category key> }. Set by the grantee; the funder''s categories live in programs.defaults.budgetCategories.';

-- ---------------------------------------------------------------------------------------------
-- A person's own sign-in sessions (Account settings). Supabase Auth keeps them in auth.sessions,
-- which no API role can read. These functions return, and end, only the caller's own sessions.
-- plpgsql, so the reference to auth.sessions is resolved when the function runs.

create or replace function gms.my_sessions()
returns table (id uuid, created_at timestamptz, last_active_at timestamptz, user_agent text, ip text, aal text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  return query
    select s.id, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at), s.user_agent, host(s.ip), s.aal::text
    from auth.sessions s
    where s.user_id = auth.uid()
    order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc;
end;
$$;
comment on function gms.my_sessions() is 'The calling person''s own sign-in sessions. The network address is shown only to that person.';

create or replace function gms.end_my_session(session_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  ended integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  delete from auth.sessions s where s.id = session_id and s.user_id = auth.uid();
  get diagnostics ended = row_count;
  return ended > 0;
end;
$$;
comment on function gms.end_my_session(uuid) is 'Ends one of the calling person''s own sessions. Another person''s session is never touched.';

revoke all on function gms.my_sessions() from public;
revoke all on function gms.end_my_session(uuid) from public;
grant execute on function gms.my_sessions() to authenticated;
grant execute on function gms.end_my_session(uuid) to authenticated;

-- The API Worker runs as the service role and has already verified who the person is, so it names
-- the person. These live in `public` because PostgREST only exposes that schema; only the service
-- role may call them.
create or replace function public.gms_sessions_of(person uuid)
returns table (id uuid, created_at timestamptz, last_active_at timestamptz, user_agent text, ip text, aal text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
    select s.id, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at), s.user_agent, host(s.ip), s.aal::text
    from auth.sessions s
    where s.user_id = person
    order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc;
end;
$$;

create or replace function public.gms_end_session_of(person uuid, session_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  ended integer;
begin
  delete from auth.sessions s where s.id = session_id and s.user_id = person;
  get diagnostics ended = row_count;
  return ended > 0;
end;
$$;

revoke all on function public.gms_sessions_of(uuid) from public, anon, authenticated;
revoke all on function public.gms_end_session_of(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gms_sessions_of(uuid) to service_role;
grant execute on function public.gms_end_session_of(uuid, uuid) to service_role;
