-- 0038_social_posting.sql
-- Social posting through Zernio (v1.8.0): a funder announces an open call or an award on its own
-- social accounts, a grantee shares its award, and a reach report shows what each post did. A
-- person sees the exact post and presses Post; nothing posts on its own.
--
-- Each workspace is its own Zernio profile (externalId = the workspace id). The GMS keeps only
-- Zernio ids, platform names, usernames, post links, statuses and counts: never a token, never an
-- inbox message, never a follower list, and not the text of a post (it lives at Zernio and on the
-- platform; a SHA-256 of the exact body sent is kept for idempotent retries).
--
-- Privacy: every row belongs to one workspace and is readable only by that workspace's staff
-- (gms.is_staff: consultants and reviewers, whose access is limited to assigned records, are
-- excluded). Signed-in users get SELECT through the policies below; every write goes through the
-- API's service role, which lets admins and editors (funder: admin, program officer; applicant:
-- admin, editor) post, and admins connect accounts.
--
-- What this changes on a live database:
--   * adds three tables, each with RLS on, `updated_at` kept by gms.touch_updated_at() and the
--     workspace-immutable trigger:
--       social_profiles  the workspace's Zernio profile id (one per workspace);
--       social_accounts  connected accounts: Zernio account id, platform, username, status;
--       social_posts     one post: its subject (an opportunity or an award), Zernio post id,
--                        platforms, per-account status and link, schedule, counts, who sent it.
--     A post's subject must belong to its workspace (an award: as funder or as recipient), and
--     every account it names must be one of that workspace's accounts (trigger).
--   * inbound_events: the provider check gains 'zernio' (verified Zernio webhook deliveries,
--     deduplicated on their event id). Every existing value is still allowed; existing rows are
--     not touched.
-- No existing row is changed or removed. No backfill.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Per-account outcome of a post: [{ accountId, platform, username?, status, url? }], at most 20.
create or replace function gms.social_targets_ok(t jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(t) = 'array'
     and pg_catalog.jsonb_array_length(t) <= 20
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(t) e(v)
        where pg_catalog.jsonb_typeof(e.v) <> 'object'
           or (e.v ->> 'accountId') is null
           or (e.v ->> 'accountId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or (e.v ->> 'platform') is null
           or (e.v ->> 'platform') not in ('linkedin', 'facebook', 'instagram', 'twitter', 'bluesky', 'threads')
           or (e.v ->> 'status') is null
           or (e.v ->> 'status') not in ('sending', 'scheduled', 'published', 'failed')
           or (e.v ? 'username' and pg_catalog.jsonb_typeof(e.v -> 'username') not in ('string', 'null'))
           or pg_catalog.length(coalesce(e.v ->> 'username', '')) > 200
           or (e.v ? 'url' and pg_catalog.jsonb_typeof(e.v -> 'url') <> 'null' and ((e.v ->> 'url') !~ '^https://' or pg_catalog.length(e.v ->> 'url') > 500))
           or exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k where k not in ('accountId', 'platform', 'username', 'status', 'url'))
     );
$$;

-- Counts only: { impressions?, clicks?, engagements? }, each a whole number or null.
create or replace function gms.social_metrics_ok(m jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(m) = 'object'
     and not exists (
       select 1 from pg_catalog.jsonb_each(m) f
        where f.key not in ('impressions', 'clicks', 'engagements')
           or (pg_catalog.jsonb_typeof(f.value) <> 'null'
               and (pg_catalog.jsonb_typeof(f.value) <> 'number' or (f.value #>> '{}')::numeric < 0 or (f.value #>> '{}')::numeric <> pg_catalog.trunc((f.value #>> '{}')::numeric)))
     );
$$;

-- A post's subject belongs to its workspace, and every account it names is one of the workspace's.
create or replace function gms.social_post_owned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subject_type = 'opportunity' then
    if not exists (select 1 from public.opportunities o where o.id = new.subject_id and o.workspace_id = new.workspace_id) then
      raise exception 'social_posts: the opportunity belongs to another workspace' using errcode = '23514';
    end if;
  elsif new.subject_type = 'award' then
    if not exists (select 1 from public.awards a where a.id = new.subject_id and (a.workspace_id = new.workspace_id or a.recipient_workspace_id = new.workspace_id)) then
      raise exception 'social_posts: the award is not this workspace''s' using errcode = '23514';
    end if;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(new.targets) e(v)
     where not exists (select 1 from public.social_accounts s where s.id = (e.v ->> 'accountId')::uuid and s.workspace_id = new.workspace_id)
  ) then
    raise exception 'social_posts: every account must be one of this workspace''s' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.social_profiles (
  id                 uuid primary key default gms.uuid_v7(),
  workspace_id       uuid not null unique references public.workspaces (id) on delete cascade,
  zernio_profile_id  text not null unique check (zernio_profile_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.social_profiles is 'The workspace''s Zernio profile (externalId = workspace id). One per workspace.';

create table public.social_accounts (
  id                 uuid primary key default gms.uuid_v7(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  -- One Zernio account belongs to one workspace.
  zernio_account_id  text not null unique check (zernio_account_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  platform           text not null check (platform in ('linkedin', 'facebook', 'instagram', 'twitter', 'bluesky', 'threads')),
  username           text check (username is null or length(username) between 1 and 200),
  status             text not null default 'active' check (status in ('active', 'disconnected')),
  connected_by       uuid,
  connected_at       timestamptz not null default now(),
  disconnected_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((status = 'disconnected') = (disconnected_at is not null))
);
comment on table public.social_accounts is 'Social accounts connected through Zernio: ids, platform and username only. No token is stored.';
create index social_accounts_workspace_idx on public.social_accounts (workspace_id, status);

create table public.social_posts (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  subject_type     text not null check (subject_type in ('opportunity', 'award')),
  subject_id       uuid not null,
  -- One logical post: a retry with the same key never posts twice.
  idempotency_key  uuid not null,
  -- SHA-256 of the exact body sent to Zernio (canonical JSON); the text itself is not kept.
  payload_sha256   text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  zernio_post_id   text check (zernio_post_id is null or zernio_post_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  platforms        text[] not null check (cardinality(platforms) between 1 and 20 and platforms <@ array['linkedin', 'facebook', 'instagram', 'twitter', 'bluesky', 'threads']),
  targets          jsonb not null default '[]'::jsonb check (gms.social_targets_ok(targets)),
  status           text not null default 'sending' check (status in ('sending', 'scheduled', 'published', 'partial', 'failed')),
  scheduled_at     timestamptz,
  timezone         text check (timezone is null or length(timezone) between 1 and 64),
  -- A plain sentence for the person, never Zernio's own text.
  error            text check (error is null or length(error) <= 300),
  metrics          jsonb not null default '{}'::jsonb check (gms.social_metrics_ok(metrics)),
  metrics_at       timestamptz,
  created_by       uuid not null,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  check ((scheduled_at is null) = (timezone is null))
);
comment on table public.social_posts is 'Posts a person sent through Zernio: subject, ids, platforms, per-account status and link, counts. Not the text.';
create unique index social_posts_zernio_idx on public.social_posts (zernio_post_id) where zernio_post_id is not null;
create index social_posts_subject_idx on public.social_posts (workspace_id, subject_type, subject_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers
-- ---------------------------------------------------------------------------------------------

alter table public.social_profiles enable row level security;
alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;

revoke all on public.social_profiles, public.social_accounts, public.social_posts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.social_profiles, public.social_accounts, public.social_posts to service_role;
grant select on public.social_profiles, public.social_accounts, public.social_posts to authenticated;

create policy social_profiles_select on public.social_profiles for select to authenticated
  using (gms.is_staff(workspace_id));
create policy social_accounts_select on public.social_accounts for select to authenticated
  using (gms.is_staff(workspace_id));
create policy social_posts_select on public.social_posts for select to authenticated
  using (gms.is_staff(workspace_id));

do $$
declare
  t text;
begin
  foreach t in array array['social_profiles', 'social_accounts', 'social_posts'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
  end loop;
end;
$$;

create trigger social_posts_owned before insert or update of workspace_id, subject_type, subject_id, targets on public.social_posts
  for each row execute function gms.social_post_owned();

revoke all on function gms.social_post_owned() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Inbound webhooks: Zernio deliveries
-- ---------------------------------------------------------------------------------------------

alter table public.inbound_events drop constraint inbound_events_provider_check;
alter table public.inbound_events add constraint inbound_events_provider_check
  check (provider in ('passport', 'resend', 'mercury', 'zernio'));
