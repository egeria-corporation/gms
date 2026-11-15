-- 0041_content_digests.sql
-- Opt-in content digests (v1.8.0): new matches and deadlines for applicants, the week's activity
-- for funder staff. Each is off until the person turns it on, per person and workspace, and goes
-- out on Mondays (apps/jobs/src/content-digests.ts, apps/api/src/services/content-digests.ts).
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * adds digest_subscriptions: one row per membership that has touched these settings. A member
--     without a row gets none of the three digests (off is the default, so every existing member
--     stays opted out). The row is removed with the membership, so a person removed from a
--     workspace stops getting its digests and starts again from off if they are added back.
--   * adds digest_sends: one row per person, digest and ISO week that was sent, with the keys of
--     the matches it listed, so a week is never sent twice and a match is never sent again.
--   * both tables: RLS on, written by the service role only; a member reads their own rows.

-- ---------------------------------------------------------------------------------------------
-- What each member chose
-- ---------------------------------------------------------------------------------------------
create table public.digest_subscriptions (
  id                   uuid primary key default gms.uuid_v7(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  -- The membership the choice belongs to; gone with it.
  member_id            uuid not null unique references public.workspace_members (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  -- Applicant workspaces: new matches (OpenGrants and open opportunities here) and deadlines.
  new_matches          boolean not null default false,
  deadlines            boolean not null default false,
  -- Funder workspaces: new applications, reviews due, payments due, reports overdue.
  funder_activity      boolean not null default false,
  -- The one-time "Get new matches every Monday" prompt, once dismissed or acted on.
  prompt_dismissed_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.digest_subscriptions is 'Opt-in content digests per membership (all off without a row). Written by the API only (apps/api/src/services/content-digests.ts).';
create index digest_subscriptions_workspace_idx on public.digest_subscriptions (workspace_id);
create index digest_subscriptions_user_idx on public.digest_subscriptions (user_id);

-- The row names its membership's own workspace and person, and only the digests of that kind of workspace.
create or replace function gms.digest_subscription_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  kind text;
begin
  if not exists (select 1 from public.workspace_members m where m.id = new.member_id and m.workspace_id = new.workspace_id and m.user_id = new.user_id) then
    raise exception 'digest_subscriptions: the membership belongs to another workspace or person' using errcode = '23514';
  end if;
  select w.kind into kind from public.workspaces w where w.id = new.workspace_id;
  if kind = 'funder' and (new.new_matches or new.deadlines) then
    raise exception 'digest_subscriptions: new matches and deadlines are for applicant workspaces' using errcode = '23514';
  end if;
  if kind = 'applicant' and new.funder_activity then
    raise exception 'digest_subscriptions: funder activity is for funder workspaces' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.digest_subscription_check() from public, anon, authenticated;
create trigger digest_subscriptions_check before insert or update on public.digest_subscriptions
  for each row execute function gms.digest_subscription_check();

-- ---------------------------------------------------------------------------------------------
-- What was sent
-- ---------------------------------------------------------------------------------------------
create table public.digest_sends (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  digest        text not null check (digest in ('new_matches', 'deadlines', 'funder_activity')),
  -- The ISO week of the send, e.g. 2027-W16: one email per person, digest and week.
  iso_week      text not null check (iso_week ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'),
  -- New matches only: the listings it named (`gms:<opportunity uuid>`, `og:<listing id>`), never sent again.
  item_keys     text[] not null default '{}' check (cardinality(item_keys) <= 40 and array_position(item_keys, null) is null),
  -- The mail provider's id for the message.
  message_id    text check (message_id is null or length(message_id) between 1 and 200),
  sent_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, user_id, digest, iso_week)
);
comment on table public.digest_sends is 'One row per content digest sent (person, digest, ISO week), with the matches it listed. Written by the jobs Worker only.';
create index digest_sends_person_idx on public.digest_sends (workspace_id, user_id, digest, sent_at desc);

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers (0009's three steps for every new table)
-- ---------------------------------------------------------------------------------------------
alter table public.digest_subscriptions enable row level security;
alter table public.digest_sends enable row level security;

revoke all on public.digest_subscriptions, public.digest_sends from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.digest_subscriptions, public.digest_sends to service_role;
-- A member reads their own choices and sends in a workspace they still belong to; nobody else's.
grant select on public.digest_subscriptions, public.digest_sends to authenticated;

create policy digest_subscriptions_select on public.digest_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and gms.is_member(workspace_id));
create policy digest_sends_select on public.digest_sends for select to authenticated
  using (user_id = (select auth.uid()) and gms.is_member(workspace_id));

create trigger digest_subscriptions_touch_updated_at before update on public.digest_subscriptions
  for each row execute function gms.touch_updated_at();
create trigger digest_sends_touch_updated_at before update on public.digest_sends
  for each row execute function gms.touch_updated_at();
