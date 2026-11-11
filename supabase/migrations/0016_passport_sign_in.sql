-- 0016_passport_sign_in: Sign in with Passport (2026-11-11).
-- The API Worker (service role) has just verified a person's email with Passport's ID token and
-- needs to know whether that email already has an account, without creating one. `auth.users` is
-- not exposed through PostgREST, so the lookup lives in `public` and only the service role may call
-- it, like the session helpers in 0015.
create or replace function public.gms_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  -- One account per email in practice; if there were ever two, always the same one: a confirmed
  -- account before an unconfirmed one, then the oldest.
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) and u.deleted_at is null
  order by (u.email_confirmed_at is not null) desc, u.created_at, u.id limit 1;
$$;

revoke all on function public.gms_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.gms_user_id_by_email(text) to service_role;
