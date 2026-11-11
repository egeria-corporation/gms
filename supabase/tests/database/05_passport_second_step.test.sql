-- Passport's authenticator as the second step for one session (0018): only the session that
-- claims with the right token, only once, only in time, and only the service role can ask.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('9a000000-0000-4000-8000-0000000000a1', 'ana@second-step.example', 'authenticated', 'authenticated', now()),
  ('9a000000-0000-4000-8000-0000000000b1', 'ben@second-step.example', 'authenticated', 'authenticated', now());
insert into auth.sessions (id, user_id, created_at) values
  ('9a500000-0000-4000-8000-0000000000a1', '9a000000-0000-4000-8000-0000000000a1', now()),
  ('9a500000-0000-4000-8000-0000000000a2', '9a000000-0000-4000-8000-0000000000a1', now()),
  ('9a500000-0000-4000-8000-0000000000b1', '9a000000-0000-4000-8000-0000000000b1', now());

-- Nobody but the service role.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9a000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ select public.gms_passport_second_step_ok('9a000000-0000-4000-8000-0000000000a1', '9a500000-0000-4000-8000-0000000000a1') $$, '42501', null, 'a signed-in person cannot ask whether a session is verified');
select throws_ok($$ select public.gms_passport_second_step_claim('9a000000-0000-4000-8000-0000000000a1', repeat('a', 64), '9a500000-0000-4000-8000-0000000000a1') $$, '42501', null, 'or claim a record');
select throws_ok($$ select public.gms_passport_second_step_record('9a000000-0000-4000-8000-0000000000a1', repeat('a', 64), 'aal2', now(), now() + interval '10 minutes', now() + interval '12 hours') $$, '42501', null, 'or make one');
select throws_ok($$ select count(*) from public.passport_second_steps $$, '42501', null, 'or read the table');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.passport_second_steps $$, '42501', null, 'nor can an anonymous caller');
reset role;

set local role service_role;
-- Ana signed in through Passport; the Worker recorded her second step against token A.
select lives_ok($$ select public.gms_passport_second_step_record('9a000000-0000-4000-8000-0000000000a1', repeat('a', 64), 'aal2', now(), now() + interval '10 minutes', now() + interval '12 hours') $$, 'the service role records a second step');
select is(public.gms_passport_second_step_ok('9a000000-0000-4000-8000-0000000000a1', '9a500000-0000-4000-8000-0000000000a1'), false, 'an unclaimed record verifies no session');

select is(public.gms_passport_second_step_claim('9a000000-0000-4000-8000-0000000000a1', repeat('f', 64), '9a500000-0000-4000-8000-0000000000a1'), null, 'the wrong token claims nothing');
select is(public.gms_passport_second_step_claim('9a000000-0000-4000-8000-0000000000b1', repeat('a', 64), '9a500000-0000-4000-8000-0000000000b1'), null, 'another person cannot claim it with the right token');
select is(public.gms_passport_second_step_claim('9a000000-0000-4000-8000-0000000000a1', repeat('a', 64), '9a500000-0000-4000-8000-0000000000b1'), null, 'nor can it be bound to another person''s session');

select isnt(public.gms_passport_second_step_claim('9a000000-0000-4000-8000-0000000000a1', repeat('a', 64), '9a500000-0000-4000-8000-0000000000a1'), null, 'her session claims it with the token');
select is(public.gms_passport_second_step_ok('9a000000-0000-4000-8000-0000000000a1', '9a500000-0000-4000-8000-0000000000a1'), true, 'and now counts as verified');
select is(public.gms_passport_second_step_claim('9a000000-0000-4000-8000-0000000000a1', repeat('a', 64), '9a500000-0000-4000-8000-0000000000a2'), null, 'the same token cannot be claimed a second time');
select is(public.gms_passport_second_step_ok('9a000000-0000-4000-8000-0000000000a1', '9a500000-0000-4000-8000-0000000000a2'), false, 'her other session does not inherit it');

-- A record whose time to claim has passed, and one whose trust has run out.
select public.gms_passport_second_step_record('9a000000-0000-4000-8000-0000000000b1', repeat('b', 64), 'aal2', now() - interval '1 hour', now() + interval '10 minutes', now() + interval '11 hours');
update public.passport_second_steps set expires_at = now() - interval '1 second' where token_digest = repeat('b', 64);
select is(public.gms_passport_second_step_claim('9a000000-0000-4000-8000-0000000000b1', repeat('b', 64), '9a500000-0000-4000-8000-0000000000b1'), null, 'a record cannot be claimed after its claim window');
update public.passport_second_steps set valid_until = now() - interval '1 second' where token_digest = repeat('a', 64);
select is(public.gms_passport_second_step_ok('9a000000-0000-4000-8000-0000000000a1', '9a500000-0000-4000-8000-0000000000a1'), false, 'and the trust ends at valid_until');
reset role;

-- Signing out removes it.
delete from auth.sessions where id = '9a500000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.passport_second_steps where token_digest = repeat('a', 64)), 0, 'ending the session removes its record');

select * from finish();
rollback;
