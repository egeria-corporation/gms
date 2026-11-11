-- Nothing set on an account before its email was proven survives the proof, and no account keeps
-- a password (0017).
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- A stranger starts a sign-up for someone else's address, with a password of their choosing.
insert into auth.users (id, email, aud, role, encrypted_password) values
  ('7a000000-0000-4000-8000-0000000000a1', 'victim@passwordless.example', 'authenticated', 'authenticated', '$2a$10$strangers.password.hash');
select is((select encrypted_password from auth.users where id = '7a000000-0000-4000-8000-0000000000a1'), null, 'a password set at sign-up is not kept');

-- A second factor and a session on the unconfirmed account (there should never be any: it cannot
-- be signed in to).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('7a100000-0000-4000-8000-0000000000a1', '7a000000-0000-4000-8000-0000000000a1', 'stranger''s app', 'totp', 'verified', now(), now(), 'not-a-real-seed');
insert into auth.sessions (id, user_id, created_at) values
  ('7a500000-0000-4000-8000-0000000000a1', '7a000000-0000-4000-8000-0000000000a1', now() - interval '1 hour');

-- The owner proves the email.
update auth.users set email_confirmed_at = now() where id = '7a000000-0000-4000-8000-0000000000a1';
select is((select encrypted_password from auth.users where id = '7a000000-0000-4000-8000-0000000000a1'), null, 'the confirmed account has no password');
select is((select count(*)::int from auth.mfa_factors where user_id = '7a000000-0000-4000-8000-0000000000a1'), 0, 'and removes any second factor set up before it');
select is((select count(*)::int from auth.sessions where user_id = '7a000000-0000-4000-8000-0000000000a1'), 0, 'and any session');

-- What the owner sets up afterwards stays.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('7a100000-0000-4000-8000-0000000000a2', '7a000000-0000-4000-8000-0000000000a1', 'owner''s app', 'totp', 'verified', now(), now(), 'not-a-real-seed');
insert into auth.sessions (id, user_id, created_at) values ('7a500000-0000-4000-8000-0000000000a2', '7a000000-0000-4000-8000-0000000000a1', now());
update auth.users set last_sign_in_at = now(), encrypted_password = '$2a$10$later.password.hash' where id = '7a000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from auth.mfa_factors where user_id = '7a000000-0000-4000-8000-0000000000a1'), 1, 'a factor enrolled after confirmation is kept through later updates');
select is((select count(*)::int from auth.sessions where user_id = '7a000000-0000-4000-8000-0000000000a1'), 1, 'and so is the session');
select is((select encrypted_password from auth.users where id = '7a000000-0000-4000-8000-0000000000a1'), null, 'a password set later is not kept either: the app has none');

-- The account lookup Sign in with Passport uses.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_app_meta_data) values
  ('7a000000-0000-4000-8000-0000000000b1', 'linked@passwordless.example', 'authenticated', 'authenticated', now(), '{"passport_user_id":"7b7b7b7b-7b7b-47b7-87b7-7b7b7b7b7b7b"}'),
  ('7a000000-0000-4000-8000-0000000000c1', 'pending@passwordless.example', 'authenticated', 'authenticated', null, '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"7a000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ select * from public.gms_account_by_email('linked@passwordless.example') $$, '42501', null, 'a signed-in person cannot look up an account by email');
reset role;
set local role anon;
select throws_ok($$ select * from public.gms_account_by_email('linked@passwordless.example') $$, '42501', null, 'nor can an anonymous caller');
reset role;

set local role service_role;
select is(
  (select row(email_confirmed, passport_user_id)::text from public.gms_account_by_email(' LINKED@passwordless.example ')),
  row(true, '7b7b7b7b-7b7b-47b7-87b7-7b7b7b7b7b7b'::text)::text,
  'the service role reads whether the email was proven and which Passport user the account is tied to');
select is((select email_confirmed from public.gms_account_by_email('pending@passwordless.example')), false, 'an unconfirmed account reads as unconfirmed');
select is((select count(*)::int from public.gms_account_by_email('nobody@passwordless.example')), 0, 'and no account reads as none');
reset role;

select * from finish();
rollback;
