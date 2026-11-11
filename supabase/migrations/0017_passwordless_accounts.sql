-- 0017_passwordless_accounts: nothing set on an account before its email was proven survives the
-- proof (2026-11-11, security review of Sign in with Passport).
--
-- The hole: Supabase Auth lets anyone start a sign-up for any address with a password of their
-- choosing. The account stays unconfirmed and cannot be signed in to, but the password stays on
-- it. When the address's real owner later proves the email (the emailed code, a magic link, or
-- Sign in with Passport), the account is confirmed and the password the stranger chose starts
-- working. Verified on the hosted project before this migration.
--
-- The GMS never uses passwords: people sign in with an emailed code or through Passport. So:
--   1. no account ever keeps a password (cleared on every insert and update), and
--   2. at the moment an email is first confirmed, any second factor or session that exists on the
--      account is removed. An unconfirmed account cannot be signed in to, so there should be none;
--      this is the second lock, in case a setting changes.
--
-- Both functions run as the role that changed the row. For Supabase Auth that is
-- `supabase_auth_admin`, which owns the `auth` tables, so no extra privilege is granted here and
-- neither function is callable through the API.

create or replace function public.gms_auth_user_passwordless()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- Supabase Auth reads a null as "this account has no password".
  new.encrypted_password := null;
  return new;
end;
$$;

create or replace function public.gms_auth_user_first_confirmation()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  begin
    delete from auth.mfa_factors f where f.user_id = new.id;
    -- Refresh tokens go with their session (foreign key, on delete cascade).
    delete from auth.sessions s where s.user_id = new.id;
  exception when insufficient_privilege then
    -- The password is already gone (the BEFORE trigger); never block a person confirming their email.
    raise warning 'gms_auth_user_first_confirmation: could not clear factors and sessions for a newly confirmed account';
  end;
  return null;
end;
$$;

revoke all on function public.gms_auth_user_passwordless() from public, anon, authenticated;
revoke all on function public.gms_auth_user_first_confirmation() from public, anon, authenticated;

drop trigger if exists gms_auth_user_passwordless on auth.users;
create trigger gms_auth_user_passwordless
  before insert or update on auth.users
  for each row execute function public.gms_auth_user_passwordless();

drop trigger if exists gms_auth_user_first_confirmation on auth.users;
create trigger gms_auth_user_first_confirmation
  after update on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.gms_auth_user_first_confirmation();

-- Accounts that already carry a password (none should: the app never set one).
update auth.users set encrypted_password = null where encrypted_password is not null;

-- What Sign in with Passport needs to know about the account an email belongs to: whether its
-- email was ever proven, and which Passport user it is tied to. Service role only, like 0016.
create or replace function public.gms_account_by_email(p_email text)
returns table (id uuid, email_confirmed boolean, passport_user_id text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.email_confirmed_at is not null, nullif(u.raw_app_meta_data ->> 'passport_user_id', '')
  from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.deleted_at is null
  order by (u.email_confirmed_at is not null) desc, u.created_at, u.id
  limit 1;
$$;

revoke all on function public.gms_account_by_email(text) from public, anon, authenticated;
grant execute on function public.gms_account_by_email(text) to service_role;
