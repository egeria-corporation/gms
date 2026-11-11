-- A Passport identity waiting to be linked to an existing account (0023): the request verifies
-- nothing, only the session that claims it with the right token holds it, only in time, and only
-- the service role can ask. The Passport-user lookups read app metadata and nothing else.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email, aud, role, email_confirmed_at, raw_app_meta_data) values
  ('9c000000-0000-4000-8000-0000000000a1', 'ana@link.example', 'authenticated', 'authenticated', now(), '{"provider":"email"}'),
  ('9c000000-0000-4000-8000-0000000000b1', 'ben@link.example', 'authenticated', 'authenticated', now(), '{"provider":"email","passport_user_id":"pp-ben"}'),
  ('9c000000-0000-4000-8000-0000000000c1', 'cy@link.example', 'authenticated', 'authenticated', null, '{"passport_user_id":"pp-unconfirmed"}');
insert into auth.sessions (id, user_id, created_at) values
  ('9c500000-0000-4000-8000-0000000000a1', '9c000000-0000-4000-8000-0000000000a1', now()),
  ('9c500000-0000-4000-8000-0000000000a2', '9c000000-0000-4000-8000-0000000000a1', now()),
  ('9c500000-0000-4000-8000-0000000000b1', '9c000000-0000-4000-8000-0000000000b1', now());

-- Nobody but the service role.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9c000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000a1', repeat('a', 64), 'pp-mine', now() + interval '10 minutes', now() + interval '1 hour') $$, '42501', null, 'a signed-in person cannot make a link request');
select throws_ok($$ select public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000a1', repeat('a', 64), '9c500000-0000-4000-8000-0000000000a1') $$, '42501', null, 'or claim one');
select throws_ok($$ select public.gms_passport_link_pending('9c000000-0000-4000-8000-0000000000a1', '9c500000-0000-4000-8000-0000000000a1') $$, '42501', null, 'or read one');
select throws_ok($$ select public.gms_passport_link_settle('9c000000-0000-4000-8000-0000000000a1') $$, '42501', null, 'or clear them');
select throws_ok($$ select public.gms_user_id_by_passport_user('pp-ben') $$, '42501', null, 'or look an account up by its Passport user');
select throws_ok($$ select public.gms_account_passport_user('9c000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'or read an account''s Passport user');
select throws_ok($$ select count(*) from public.passport_link_requests $$, '42501', null, 'or read the table');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.passport_link_requests $$, '42501', null, 'nor can an anonymous caller');
reset role;

set local role service_role;
select lives_ok($$ select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000a1', repeat('a', 64), 'pp-someone', now() + interval '10 minutes', now() + interval '1 hour') $$, 'the service role records a link request');
select is(public.gms_passport_link_pending('9c000000-0000-4000-8000-0000000000a1', '9c500000-0000-4000-8000-0000000000a1'), null, 'an unclaimed request waits on no session');
select is(public.gms_passport_second_step_ok('9c000000-0000-4000-8000-0000000000a1', '9c500000-0000-4000-8000-0000000000a1'), false, 'and it is not a second step');

select is(public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000a1', repeat('f', 64), '9c500000-0000-4000-8000-0000000000a1'), false, 'the wrong token claims nothing');
select is(public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000b1', repeat('a', 64), '9c500000-0000-4000-8000-0000000000b1'), false, 'another person cannot claim it with the right token');
select is(public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000a1', repeat('a', 64), '9c500000-0000-4000-8000-0000000000b1'), false, 'nor can it be bound to another person''s session');
select is(public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000a1', repeat('a', 64), '9c500000-0000-4000-8000-0000000000a1'), true, 'the session that redeemed the sign-in claims it');
select is(public.gms_passport_link_pending('9c000000-0000-4000-8000-0000000000a1', '9c500000-0000-4000-8000-0000000000a1'), 'pp-someone', 'and that session now has the Passport user waiting');
select is(public.gms_passport_link_pending('9c000000-0000-4000-8000-0000000000a1', '9c500000-0000-4000-8000-0000000000a2'), null, 'the person''s other session does not');
select is(public.gms_passport_second_step_ok('9c000000-0000-4000-8000-0000000000a1', '9c500000-0000-4000-8000-0000000000a1'), false, 'a claimed request is still not a second step');

update public.passport_link_requests set valid_until = now() - interval '1 second' where token_digest = repeat('a', 64);
select is(public.gms_passport_link_pending('9c000000-0000-4000-8000-0000000000a1', '9c500000-0000-4000-8000-0000000000a1'), null, 'the request is dead after its window');

select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000a1', repeat('b', 64), 'pp-someone', now() + interval '10 minutes', now() + interval '1 hour');
select public.gms_passport_link_settle('9c000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from public.passport_link_requests where user_id = '9c000000-0000-4000-8000-0000000000a1'), 0, 'settling clears every request of the person');

-- The lookups.
select is(public.gms_user_id_by_passport_user('pp-ben'), '9c000000-0000-4000-8000-0000000000b1'::uuid, 'a linked Passport user resolves to its account');
select is(
  array[public.gms_user_id_by_passport_user('pp-nobody')::text, public.gms_user_id_by_passport_user('')::text, public.gms_user_id_by_passport_user('pp-unconfirmed')::text, public.gms_account_passport_user('9c000000-0000-4000-8000-0000000000a1'), public.gms_account_passport_user('9c000000-0000-4000-8000-0000000000b1')],
  array[null, null, null, null, 'pp-ben'],
  'an unknown, empty or never-confirmed one resolves to nothing; an account reports its own link'
);
reset role;

select * from finish();
rollback;
