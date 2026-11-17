-- 0053_sso_email_lookups.sql
-- The two email lookups behind Sign in with Passport leave out accounts Supabase Auth made
-- through single sign-on (docs/sso.md, "An identity provider speaks only for its own domains").
--
-- A SAML identity provider can assert any email address, and Supabase Auth gives each SSO sign-in
-- its own account (`auth.users.is_sso_user = true`), whatever address it was handed. The lookups
-- of 0016 and 0017 chose "a confirmed account before an unconfirmed one, then the oldest", so an
-- SSO account that asserted someone's address before that person first signed in here would have
-- been the one Sign in with Passport found, signed in to and linked an organization to. Supabase's
-- own email sign-ins already leave SSO accounts out; now the GMS's lookups do too. (The API also
-- refuses an SSO account if a lookup ever returns one: apps/api/src/services/ports.ts.)
--
-- What this changes on a live database (no table, column, policy, grant or row is changed):
--   * replaces public.gms_user_id_by_email(text) and public.gms_account_by_email(text) with the
--     same signature, result, ordering, security (definer, empty search_path) and grants (service
--     role only), adding `and not u.is_sso_user` to each. A project with no SSO account (production
--     had none on 2026-11-17) gets exactly the same answers as before.
-- Needs Supabase Auth's `is_sso_user` column (Supabase Auth since early 2023; every hosted project).
-- Run before the API.

create or replace function public.gms_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  -- One account per email in practice; if there were ever two, always the same one: a confirmed
  -- account before an unconfirmed one, then the oldest. Never an account single sign-on made.
  select u.id from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.deleted_at is null and not u.is_sso_user
  order by (u.email_confirmed_at is not null) desc, u.created_at, u.id limit 1;
$$;

revoke all on function public.gms_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.gms_user_id_by_email(text) to service_role;

create or replace function public.gms_account_by_email(p_email text)
returns table (id uuid, email_confirmed boolean, passport_user_id text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.email_confirmed_at is not null, nullif(u.raw_app_meta_data ->> 'passport_user_id', '')
  from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.deleted_at is null and not u.is_sso_user
  order by (u.email_confirmed_at is not null) desc, u.created_at, u.id
  limit 1;
$$;

revoke all on function public.gms_account_by_email(text) from public, anon, authenticated;
grant execute on function public.gms_account_by_email(text) to service_role;
