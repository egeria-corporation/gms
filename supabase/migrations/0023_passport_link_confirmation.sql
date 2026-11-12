-- 0023_passport_link_confirmation: Passport's authenticator counts for an account only once a link
-- between that account and that Passport user has been recorded, and the first link to an account
-- that already existed needs that account's own second step (red team G1, 2026-11-11).
--
-- Until now the first Passport sign-in for an existing account tied the Passport user to it by
-- verified email and, in the same request, took Passport's authenticator as this app's second
-- step. Whoever controlled the mailbox could make a Passport account for that address with their
-- own authenticator and get a two-step verified session without the account's authenticator.
--
-- From here on:
--   * `passport_account_links` is the link record: one account, one Passport user, how it was made.
--     Passport's second step is recorded only for an account that has a row (the Worker checks,
--     and `gms_passport_second_step_record` below refuses without one).
--   * An account a Passport sign-in creates is linked at once (`account_created`).
--   * For an account that already existed, the sign-in links nothing. The Worker
--       1. records a link request against the SHA-256 of the one-time sign-in token it hands the
--          web app (`passport_link_requests`; it verifies nothing);
--       2. the web app redeems the token for a session and presents the token once more, which
--          binds the request to that session;
--       3. when that same session has passed the account's own second step (Supabase `aal2`,
--          checked here against `auth.sessions`, not only in the token), the link is recorded
--          (`own_second_step`) and the Worker writes the ledger entry.
--   * A link is keyed by account id and Passport user id, never by email, and is never re-pointed:
--     both columns are unique and no role may update the table.
--
-- Applying this to a database that already holds accounts: it creates two tables and their
-- functions, replaces one function (0018's record step, same signature and grants), and runs the
-- one-time step at the end, which INSERTS link rows and ledger entries for accounts whose Passport
-- sign-in predates the link record. It updates and deletes no existing row and writes nothing in
-- the `auth` schema. Apply it BEFORE deploying the Worker that needs it: the older Worker keeps
-- working against the new schema, the newer Worker fails Passport sign-in without it.
--
-- Service role only, like 0018: no policy, no grant to signed-in users.

-- ---------------------------------------------------------------------------------------------
-- The link record.
create table public.passport_account_links (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  -- The Passport user (the ID token's `sub`). One account here per Passport user.
  passport_user_id text not null unique check (char_length(passport_user_id) between 1 and 200),
  -- How the link came to be: the sign-in created the account; the account's own second step was
  -- passed in the session that signed in with Passport; or the link predates this table (below).
  basis            text not null check (basis in ('account_created', 'own_second_step', 'predates_link_record')),
  -- created_at is when the link was recorded. Rows are never updated.
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.passport_account_links is 'An account explicitly linked to a Passport user. Passport''s second step counts only for these. Written by service-role functions only; never updated.';

alter table public.passport_account_links enable row level security;
revoke all on public.passport_account_links from public, anon, authenticated, service_role;
grant select on public.passport_account_links to service_role;
create trigger passport_account_links_touch_updated_at before update on public.passport_account_links
  for each row execute function gms.touch_updated_at();

-- A Passport sign-in for an existing, unlinked account, waiting for that account's own second step.
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

-- ---------------------------------------------------------------------------------------------
-- What the sign-in callback decides on: the Passport user this account is linked to, and the
-- account this Passport user is linked to. Either may be null.
create or replace function public.gms_passport_link_state(p_user uuid, p_passport_user text)
returns table (account_passport_user text, passport_user_account uuid)
language sql stable security definer set search_path = ''
as $$
  select
    (select l.passport_user_id from public.passport_account_links l where l.user_id = p_user),
    (select l.user_id from public.passport_account_links l where l.passport_user_id = p_passport_user);
$$;

-- The sign-in has just created this account for this Passport user: link them. Only for an account
-- made in the last ten minutes whose app metadata names that Passport user (the Worker sets it
-- when it creates the account), so an older account can never be linked this way.
create or replace function public.gms_passport_link_created(p_user uuid, p_passport_user text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  fresh boolean;
  mine text;
begin
  select true into fresh from auth.users u
    where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
      and u.created_at > now() - interval '10 minutes'
      and u.raw_app_meta_data ->> 'passport_user_id' = p_passport_user;
  if fresh is not true or coalesce(p_passport_user, '') = '' then
    return 'refused';
  end if;
  insert into public.passport_account_links (user_id, passport_user_id, basis)
    values (p_user, p_passport_user, 'account_created')
    on conflict do nothing;
  if found then
    return 'recorded';
  end if;
  select l.passport_user_id into mine from public.passport_account_links l where l.user_id = p_user;
  return case when mine = p_passport_user then 'already' else 'refused' end;
end;
$$;

-- Step 1 for an existing account. Also clears out what can no longer be used, so the table stays small.
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

-- Step 3 writes: the session has passed the account's own second step, so the Passport user
-- waiting on it is linked. Nothing here is taken on the caller's word: the request must be this
-- session's and still valid, the session row itself must say `aal2`, an account first tied to a
-- different Passport user (app metadata written before this table existed) is refused, and the
-- unique columns refuse an account or a Passport user that is already linked elsewhere.
-- Returns 'recorded', 'already' (this very link exists) or 'refused'.
create or replace function public.gms_passport_link_record(p_user uuid, p_passport_user text, p_session uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  tie text;
  mine text;
begin
  select l.passport_user_id into mine from public.passport_account_links l where l.user_id = p_user;
  if mine is not null then
    return case when mine = p_passport_user then 'already' else 'refused' end;
  end if;
  if not exists (
    select 1 from public.passport_link_requests r
    where r.user_id = p_user and r.session_id = p_session and r.passport_user_id = p_passport_user and r.valid_until > now()
  ) then
    return 'refused';
  end if;
  if not exists (select 1 from auth.sessions a where a.id = p_session and a.user_id = p_user and a.aal::text = 'aal2') then
    return 'refused';
  end if;
  select nullif(u.raw_app_meta_data ->> 'passport_user_id', '') into tie
    from auth.users u where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null;
  if not found or (tie is not null and tie <> p_passport_user) then
    return 'refused';
  end if;
  insert into public.passport_account_links (user_id, passport_user_id, basis)
    values (p_user, p_passport_user, 'own_second_step')
    on conflict do nothing;
  if found then
    return 'recorded';
  end if;
  -- Lost a race: either this link was just made, or the Passport user went to another account.
  select l.passport_user_id into mine from public.passport_account_links l where l.user_id = p_user;
  return case when mine = p_passport_user then 'already' else 'refused' end;
end;
$$;

-- Step 3 ends: the link is recorded and ledgered. Every request of the person is spent.
create or replace function public.gms_passport_link_settle(p_user uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.passport_link_requests r where r.user_id = p_user;
$$;

revoke all on function public.gms_passport_link_state(uuid, text) from public, anon, authenticated;
revoke all on function public.gms_passport_link_created(uuid, text) from public, anon, authenticated;
revoke all on function public.gms_passport_link_request(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.gms_passport_link_claim(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.gms_passport_link_pending(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gms_passport_link_record(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.gms_passport_link_settle(uuid) from public, anon, authenticated;
grant execute on function public.gms_passport_link_state(uuid, text) to service_role;
grant execute on function public.gms_passport_link_created(uuid, text) to service_role;
grant execute on function public.gms_passport_link_request(uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.gms_passport_link_claim(uuid, text, uuid) to service_role;
grant execute on function public.gms_passport_link_pending(uuid, uuid) to service_role;
grant execute on function public.gms_passport_link_record(uuid, text, uuid) to service_role;
grant execute on function public.gms_passport_link_settle(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 0018's record step, with one more rule: Passport's second step is recorded only for an account
-- that has a link record. The Worker decides the same thing before it calls; this is the backstop,
-- and it holds for a Worker deployed before this migration too. Same signature, so the grants made
-- in 0018 stay as they are.
create or replace function public.gms_passport_second_step_record(p_user uuid, p_digest text, p_acr text, p_auth_time timestamptz, p_claim_by timestamptz, p_valid_until timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.passport_second_steps s
    where s.valid_until <= now() or (s.session_id is null and s.expires_at <= now());
  if not exists (select 1 from public.passport_account_links l where l.user_id = p_user) then
    return;
  end if;
  insert into public.passport_second_steps (user_id, token_digest, acr, auth_time, expires_at, valid_until)
    values (p_user, p_digest, p_acr, p_auth_time, p_claim_by, p_valid_until);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- One time: accounts whose Passport sign-in predates the link record.
--
-- Such an account carries the Passport user in its app metadata (`passport_user_id`, written by
-- the Worker at the first Passport sign-in and never replaced). It is recorded as linked, with a
-- ledger entry, when one of these is true:
--   b. the ledger shows a Passport sign-in created the account: the rule for new accounts;
--   c. it has no verified second factor of its own: there is nothing of the account's that
--      Passport's authenticator would be standing in for, and the new rule would only have asked
--      the person to enrol one in the session they were already in.
-- That Passport's second step was honoured for an account before (rule a, kept as evidence only)
-- is NOT enough on its own: it is exactly what the hole this migration closes leaves behind, so
-- for an account with its own authenticator it would make a past takeover permanent (red team
-- re-review, 2026-11-12). Every other such account is left as it is: its Passport sign-in keeps
-- working, the Passport user in its app metadata is still the only one that may ever be linked
-- to it, and the link is recorded the first time a session that signed in with Passport passes
-- the account's own second step (one authenticator code, once). A Passport user found on more
-- than one account is linked to none of them here.
--
-- Not security definer and granted to nobody: only the database owner can run it. It is kept so
-- the rule is tested with the schema; running it again later links only accounts that still carry
-- an unrecorded Passport user and meet a rule above, so it is not something to re-run casually.
create or replace function gms.passport_links_backfill()
returns table (linked integer, left_for_own_second_step integer)
language plpgsql set search_path = ''
as $$
declare
  n_linked integer := 0;
  n_all integer := 0;
begin
  create temporary table gms_0023_candidates on commit drop as
    select u.id as user_id,
           u.raw_app_meta_data ->> 'passport_user_id' as passport_user_id,
           (exists (select 1 from public.ledger_events e
                    where e.subject_type = 'user' and e.subject_id = u.id::text and e.event_type = 'auth.second_step_from_passport')
            or exists (select 1 from public.passport_second_steps s where s.user_id = u.id and s.session_id is not null)) as second_step_honoured,
           exists (select 1 from public.ledger_events e
                   where e.subject_type = 'user' and e.subject_id = u.id::text and e.event_type = 'auth.passport_signin'
                     and e.data ->> 'created' = 'true') as created_by_passport,
           false as no_second_step_of_its_own
    from auth.users u
    where u.deleted_at is null and u.email_confirmed_at is not null
      and char_length(coalesce(u.raw_app_meta_data ->> 'passport_user_id', '')) between 1 and 200
      and not exists (select 1 from public.passport_account_links l where l.user_id = u.id);
  select count(*) into n_all from pg_temp.gms_0023_candidates;

  -- Rule c reads Supabase Auth's factor table. If this role may not read it, the rule is skipped:
  -- fewer accounts are linked here, never more.
  begin
    update pg_temp.gms_0023_candidates c
      set no_second_step_of_its_own = not exists (select 1 from auth.mfa_factors f where f.user_id = c.user_id and f.status::text = 'verified');
  exception when insufficient_privilege or undefined_table or undefined_column then
    raise notice '0023: auth.mfa_factors could not be read; accounts are linked on rules a and b only';
  end;

  with chosen as (
    select c.* from pg_temp.gms_0023_candidates c
    where (c.created_by_passport or c.no_second_step_of_its_own)
      and (select count(*) from pg_temp.gms_0023_candidates o where o.passport_user_id = c.passport_user_id) = 1
      and not exists (select 1 from public.passport_account_links l where l.passport_user_id = c.passport_user_id)
  ), made as (
    insert into public.passport_account_links (user_id, passport_user_id, basis)
      select ch.user_id, ch.passport_user_id, 'predates_link_record' from chosen ch
    returning user_id
  ), ledgered as (
    insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data)
      select null, 'system:migration_0023', 'auth.passport_linked', 'user', ch.user_id::text,
             jsonb_build_object(
               'passportUserId', ch.passport_user_id,
               'confirmedBy', 'predates_link_record',
               'evidence', to_jsonb(array_remove(array[
                 case when ch.second_step_honoured then 'passport_second_step_honoured_before' end,
                 case when ch.created_by_passport then 'account_created_by_passport_sign_in' end,
                 case when ch.no_second_step_of_its_own then 'no_second_step_of_its_own' end], null)))
      from chosen ch join made m on m.user_id = ch.user_id
    returning 1
  )
  select count(*) into n_linked from ledgered;

  drop table pg_temp.gms_0023_candidates;
  return query select n_linked, n_all - n_linked;
end;
$$;
revoke all on function gms.passport_links_backfill() from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  select * into r from gms.passport_links_backfill();
  raise notice '0023: % account(s) already signed in to with Passport were recorded as linked; % keep their Passport sign-in and are linked after their own second step', r.linked, r.left_for_own_second_step;
end;
$$;
