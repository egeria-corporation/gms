-- 0018_passport_second_step: Passport's authenticator, accepted as this app's second step for one
-- session (owner's decision, 2026-11-11).
--
-- A person who signs in through Passport has already passed Passport's authenticator; the owner
-- decided they are not asked for this app's as well. The API Worker verifies Passport's ID token
-- (`acr: aal2`) and then:
--   1. records that fact against the SHA-256 of the one-time sign-in token it hands the web app;
--   2. the web app redeems the token for a session and presents the same token once more;
--   3. the record is bound to that session's id, once.
-- From then until `valid_until` that one session counts as two-step verified. The record gives no
-- access by itself, cannot be claimed without the one-time token, and is not inherited by another
-- session of the same person. Signing out (or ending the session) removes it.
--
-- Service role only: no policy, no grant to signed-in users, and three functions only the API
-- Worker may call.

create table public.passport_second_steps (
  id            uuid primary key default gms.uuid_v7(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- SHA-256 (hex) of the one-time sign-in token. The token itself is never stored.
  token_digest  text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  acr           text not null check (acr = 'aal2'),
  -- When the person passed Passport's authenticator.
  auth_time     timestamptz not null,
  -- The session must claim the record before this.
  expires_at    timestamptz not null,
  -- The session that claimed it. One record per session; gone when the session is.
  session_id    uuid unique references auth.sessions (id) on delete cascade,
  claimed_at    timestamptz,
  -- The trust ends here, whatever the session does.
  valid_until   timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint passport_second_steps_claim_pair check ((session_id is null) = (claimed_at is null))
);
create index passport_second_steps_user_id_idx on public.passport_second_steps (user_id);
comment on table public.passport_second_steps is 'Passport''s authenticator accepted as the second step for one session. Service role only.';

alter table public.passport_second_steps enable row level security;
revoke all on public.passport_second_steps from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.passport_second_steps to service_role;
create trigger passport_second_steps_touch_updated_at before update on public.passport_second_steps
  for each row execute function gms.touch_updated_at();

-- Step 1. Also clears out what can no longer be used, so the table stays small.
create or replace function public.gms_passport_second_step_record(p_user uuid, p_digest text, p_acr text, p_auth_time timestamptz, p_claim_by timestamptz, p_valid_until timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.passport_second_steps s
    where s.valid_until <= now() or (s.session_id is null and s.expires_at <= now());
  insert into public.passport_second_steps (user_id, token_digest, acr, auth_time, expires_at, valid_until)
    values (p_user, p_digest, p_acr, p_auth_time, p_claim_by, p_valid_until);
end;
$$;

-- Step 3. One statement decides and claims, so two requests cannot both win. The session must be
-- the caller's own and must not already hold a record. Returns when the trust ends, or null.
create or replace function public.gms_passport_second_step_claim(p_user uuid, p_digest text, p_session uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  until timestamptz;
begin
  if not exists (select 1 from auth.sessions a where a.id = p_session and a.user_id = p_user) then
    return null;
  end if;
  update public.passport_second_steps s
    set session_id = p_session, claimed_at = now()
    where s.user_id = p_user and s.token_digest = p_digest
      and s.session_id is null and s.expires_at > now() and s.valid_until > now()
      and not exists (select 1 from public.passport_second_steps o where o.session_id = p_session)
    returning s.valid_until into until;
  return until;
end;
$$;

-- The rule every second-step check reads.
create or replace function public.gms_passport_second_step_ok(p_user uuid, p_session uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.passport_second_steps s
    where s.user_id = p_user and s.session_id = p_session and s.valid_until > now()
  );
$$;

revoke all on function public.gms_passport_second_step_record(uuid, text, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.gms_passport_second_step_claim(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.gms_passport_second_step_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gms_passport_second_step_record(uuid, text, text, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.gms_passport_second_step_claim(uuid, text, uuid) to service_role;
grant execute on function public.gms_passport_second_step_ok(uuid, uuid) to service_role;
