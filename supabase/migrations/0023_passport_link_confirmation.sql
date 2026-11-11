-- 0023_passport_link_confirmation: a Passport identity is linked to an account that already
-- existed here only after that account's own second step (red team G1, 2026-11-11).
--
-- Until now the first Passport sign-in for an existing account linked the Passport user by
-- verified email and, in the same request, took Passport's authenticator as this app's second
-- step. Whoever controlled the mailbox could make a Passport account for that address with their
-- own authenticator and get a two-step verified session without the account's authenticator.
--
-- From here on that first sign-in links nothing. The API Worker:
--   1. records a link request against the SHA-256 of the one-time sign-in token it hands the web
--      app (this table; it verifies nothing);
--   2. the web app redeems the token for a session and presents the token once more, which binds
--      the request to that session;
--   3. when that same session has passed this account's own second step (Supabase `aal2`), the
--      Worker records the Passport user in the account's app metadata and clears the requests.
-- Accounts already linked (app metadata carries `passport_user_id`) and accounts created by a
-- Passport sign-in are unaffected: nothing here changes an existing row.
--
-- Service role only, like 0018: no policy, no grant to signed-in users.

create table public.passport_link_requests (
  id               uuid primary key default gms.uuid_v7(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  -- SHA-256 (hex) of the one-time sign-in token. The token itself is never stored.
  token_digest     text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  -- The Passport user (the ID token's `sub`) that signed in.
  passport_user_id text not null check (char_length(passport_user_id) between 1 and 200),
  -- The session must claim the request before this.
  expires_at       timestamptz not null,
  -- The session that claimed it. One request per session; gone when the session is.
  session_id       uuid unique references auth.sessions (id) on delete cascade,
  claimed_at       timestamptz,
  -- The request is dead after this, whatever the session does.
  valid_until      timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint passport_link_requests_claim_pair check ((session_id is null) = (claimed_at is null))
);
create index passport_link_requests_user_id_idx on public.passport_link_requests (user_id);
comment on table public.passport_link_requests is 'A Passport sign-in for an existing, unlinked account, waiting for that account''s own second step. Verifies nothing. Service role only.';

alter table public.passport_link_requests enable row level security;
revoke all on public.passport_link_requests from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.passport_link_requests to service_role;
create trigger passport_link_requests_touch_updated_at before update on public.passport_link_requests
  for each row execute function gms.touch_updated_at();

-- Step 1. Also clears out what can no longer be used, so the table stays small.
create or replace function public.gms_passport_link_request(p_user uuid, p_digest text, p_passport_user text, p_claim_by timestamptz, p_valid_until timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.passport_link_requests r
    where r.valid_until <= now() or (r.session_id is null and r.expires_at <= now());
  insert into public.passport_link_requests (user_id, token_digest, passport_user_id, expires_at, valid_until)
    values (p_user, p_digest, p_passport_user, p_claim_by, p_valid_until);
end;
$$;

-- Step 2. One statement decides and claims. The session must be the caller's own and must not
-- already hold a request.
create or replace function public.gms_passport_link_claim(p_user uuid, p_digest text, p_session uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  claimed uuid;
begin
  if not exists (select 1 from auth.sessions a where a.id = p_session and a.user_id = p_user) then
    return false;
  end if;
  update public.passport_link_requests r
    set session_id = p_session, claimed_at = now()
    where r.user_id = p_user and r.token_digest = p_digest
      and r.session_id is null and r.expires_at > now() and r.valid_until > now()
      and not exists (select 1 from public.passport_link_requests o where o.session_id = p_session)
    returning r.id into claimed;
  return claimed is not null;
end;
$$;

-- Step 3 reads: the Passport user waiting on this session, if its request has not run out.
create or replace function public.gms_passport_link_pending(p_user uuid, p_session uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select r.passport_user_id from public.passport_link_requests r
  where r.user_id = p_user and r.session_id = p_session and r.valid_until > now()
  limit 1;
$$;

-- Step 3 ends: the link was recorded, or cannot be. Every request of the person is spent.
create or replace function public.gms_passport_link_settle(p_user uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.passport_link_requests r where r.user_id = p_user;
$$;

-- The account an already-linked Passport user belongs to: a Passport user is one account here, so
-- it is refused when it turns up under another email. (A scan of auth.users: fine at this size;
-- an index on auth.users would have to be made by its owner.)
create or replace function public.gms_user_id_by_passport_user(p_passport_user text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select u.id from auth.users u
  where u.raw_app_meta_data ->> 'passport_user_id' = p_passport_user
    and p_passport_user <> '' and u.deleted_at is null and u.email_confirmed_at is not null
  order by u.created_at, u.id
  limit 1;
$$;

-- The Passport user an account is linked to, by account id.
create or replace function public.gms_account_passport_user(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select nullif(u.raw_app_meta_data ->> 'passport_user_id', '') from auth.users u where u.id = p_user and u.deleted_at is null;
$$;

revoke all on function public.gms_passport_link_request(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.gms_passport_link_claim(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.gms_passport_link_pending(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gms_passport_link_settle(uuid) from public, anon, authenticated;
revoke all on function public.gms_user_id_by_passport_user(text) from public, anon, authenticated;
revoke all on function public.gms_account_passport_user(uuid) from public, anon, authenticated;
grant execute on function public.gms_passport_link_request(uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.gms_passport_link_claim(uuid, text, uuid) to service_role;
grant execute on function public.gms_passport_link_pending(uuid, uuid) to service_role;
grant execute on function public.gms_passport_link_settle(uuid) to service_role;
grant execute on function public.gms_user_id_by_passport_user(text) to service_role;
grant execute on function public.gms_account_passport_user(uuid) to service_role;
