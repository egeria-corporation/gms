-- 0027_workspace_creation_counts.sql
-- Daily caps on creating workspaces, counted in the database (review NP-07).
--
-- Since a workspace no longer needs Passport, anyone signed in can make one, so creation is capped
-- per account and per network address per day. The caps were counters in Workers KV, read before
-- the insert and written after it: parallel requests all passed the read, KV is eventually
-- consistent across locations, and a burst was barely counted. Here one statement per key both
-- checks and counts, under the row lock of a unique daily row, so concurrent requests cannot both
-- take the last place, and the count is the same from every Worker.
--
-- What this changes on a live database: adds one table (service role only: RLS on, no policy, no
-- grant to signed-in users) and two functions only the service role may run. No existing row
-- changes. Rows older than two days are deleted as new ones are claimed.

create table public.workspace_creation_counts (
  id          uuid primary key default gms.uuid_v7(),
  -- `user:<uuid>` or `addr:<IPv4 address or IPv6 /64 prefix>`. Never an email address.
  key         text not null check (key ~ '^(user|addr):[0-9A-Za-z:./-]{1,80}$'),
  day         date not null,
  used        integer not null default 0 check (used >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (key, day)
);
comment on table public.workspace_creation_counts is 'Workspaces created per account and per network address per day (caps in apps/api/src/lib/rate-limit.ts). Service role only.';

alter table public.workspace_creation_counts enable row level security;
revoke all on public.workspace_creation_counts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.workspace_creation_counts to service_role;
create trigger workspace_creation_counts_touch_updated_at before update on public.workspace_creation_counts
  for each row execute function gms.touch_updated_at();

-- Count one creation against every key, or against none: false when any key is at its limit.
-- Callers pass the keys in a fixed order so two claims never wait on each other's rows.
create or replace function public.gms_claim_workspace_creation(p_keys text[], p_limits integer[])
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  i integer;
begin
  if coalesce(array_length(p_keys, 1), 0) <> coalesce(array_length(p_limits, 1), 0) then
    raise exception 'keys and limits differ in length';
  end if;
  delete from public.workspace_creation_counts c where c.day < current_date - 2;
  begin
    for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
      insert into public.workspace_creation_counts as c (key, day, used)
        values (p_keys[i], current_date, 1)
        on conflict (key, day) do update set used = c.used + 1 where c.used < p_limits[i];
      if not found then
        raise exception using errcode = 'P0001', message = 'too_many_workspaces';
      end if;
    end loop;
  exception when sqlstate 'P0001' then
    -- The block's increments are rolled back with it: nothing is counted.
    return false;
  end;
  return true;
end;
$$;

-- Give back a claim when the creation it was for did not happen (a taken handle, say).
create or replace function public.gms_release_workspace_creation(p_keys text[])
returns void
language sql security definer set search_path = ''
as $$
  update public.workspace_creation_counts c set used = greatest(c.used - 1, 0)
   where c.key = any (p_keys) and c.day = current_date;
$$;

revoke all on function public.gms_claim_workspace_creation(text[], integer[]) from public, anon, authenticated;
revoke all on function public.gms_release_workspace_creation(text[]) from public, anon, authenticated;
grant execute on function public.gms_claim_workspace_creation(text[], integer[]) to service_role;
grant execute on function public.gms_release_workspace_creation(text[]) to service_role;
