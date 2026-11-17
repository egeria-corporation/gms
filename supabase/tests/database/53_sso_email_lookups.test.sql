-- The email lookups behind Sign in with Passport never return an account single sign-on made
-- (0053): a SAML identity provider can assert any address, so its account is not found by it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- An identity provider asserted the address first; the person's own account came later.
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, is_sso_user, raw_app_meta_data) values
  ('53000000-0000-4000-8000-0000000000a1', 'dana@sso-lookups.example', 'authenticated', 'authenticated', now() - interval '2 days', now() - interval '2 days', true, '{"provider":"sso:5a5a5a5a-1111-4111-8111-5a5a5a5a5a5a"}'),
  ('53000000-0000-4000-8000-0000000000a2', 'Dana@SSO-lookups.example', 'authenticated', 'authenticated', now() - interval '1 day', now() - interval '1 day', false, '{"passport_user_id":"7b7b7b7b-0053-47b7-87b7-7b7b7b7b7b7b"}'),
  -- Only an SSO account holds this address.
  ('53000000-0000-4000-8000-0000000000b1', 'helen@sso-lookups.example', 'authenticated', 'authenticated', now(), now(), true, '{}'),
  -- An ordinary account, for the unchanged case.
  ('53000000-0000-4000-8000-0000000000c1', 'sam@sso-lookups.example', 'authenticated', 'authenticated', now(), now(), false, '{}');

select is(public.gms_user_id_by_email(' DANA@sso-lookups.example '), '53000000-0000-4000-8000-0000000000a2'::uuid, 'the person''s own account, not the older one single sign-on made');
select results_eq(
  $$ select id, email_confirmed, passport_user_id from public.gms_account_by_email('dana@sso-lookups.example') $$,
  $$ values ('53000000-0000-4000-8000-0000000000a2'::uuid, true, '7b7b7b7b-0053-47b7-87b7-7b7b7b7b7b7b'::text) $$,
  'the account Sign in with Passport adopts is the person''s own'
);
select is(public.gms_user_id_by_email('helen@sso-lookups.example'), null, 'an address only an SSO account holds has no account to find');
select is_empty($$ select * from public.gms_account_by_email('helen@sso-lookups.example') $$, 'and none to adopt');
select is(public.gms_user_id_by_email('sam@sso-lookups.example'), '53000000-0000-4000-8000-0000000000c1'::uuid, 'other addresses are found as before');
select is(public.gms_user_id_by_email('nobody@sso-lookups.example'), null, 'an unknown address finds nothing');

-- Still the service role's alone.
select ok(not has_function_privilege('authenticated', 'public.gms_user_id_by_email(text)', 'execute'), 'signed-in people cannot look accounts up by email');
select ok(not has_function_privilege('anon', 'public.gms_account_by_email(text)', 'execute'), 'nor can visitors');
select ok(has_function_privilege('service_role', 'public.gms_account_by_email(text)', 'execute'), 'the service role can');

select * from finish();
rollback;
