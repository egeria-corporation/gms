-- Linking a Passport user to an account (0023). A link is recorded only for an account the sign-in
-- has just created, or after a session that signed in with Passport has passed the account's own
-- second step; it is never re-pointed; Passport's second step is recorded only for a linked
-- account; and only the service role can ask. The last part is the one-time step for accounts
-- whose Passport sign-in predates the link record.
begin;
create extension if not exists pgtap with schema extensions;

select plan(61);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, raw_app_meta_data) values
  -- Two accounts made by emailed code that have never used Passport.
  ('9c000000-0000-4000-8000-0000000000a1', 'ana@link.example', 'authenticated', 'authenticated', now(), now() - interval '30 days', '{"provider":"email"}'),
  ('9c000000-0000-4000-8000-0000000000b1', 'ben@link.example', 'authenticated', 'authenticated', now(), now() - interval '30 days', '{"provider":"email"}'),
  -- Made a moment ago by a Passport sign-in.
  ('9c000000-0000-4000-8000-0000000000c1', 'cy@link.example', 'authenticated', 'authenticated', now(), now(), '{"passport_user_id":"pp-cy"}'),
  ('9c000000-0000-4000-8000-0000000000c2', 'gus@link.example', 'authenticated', 'authenticated', now(), now(), '{"passport_user_id":"pp-gus"}'),
  -- Tied to a Passport user before links were recorded, and not linked.
  ('9c000000-0000-4000-8000-0000000000d1', 'dee@link.example', 'authenticated', 'authenticated', now(), now() - interval '30 days', '{"provider":"email","passport_user_id":"pp-dee"}'),
  ('9c000000-0000-4000-8000-0000000000d2', 'fay@link.example', 'authenticated', 'authenticated', now(), now() - interval '30 days', '{"provider":"email","passport_user_id":"pp-fay"}'),
  -- Never confirmed.
  ('9c000000-0000-4000-8000-0000000000e1', 'eli@link.example', 'authenticated', 'authenticated', null, now(), '{"passport_user_id":"pp-eli"}');
insert into auth.sessions (id, user_id, created_at, aal) values
  ('9c500000-0000-4000-8000-0000000000a1', '9c000000-0000-4000-8000-0000000000a1', now(), 'aal1'),
  ('9c500000-0000-4000-8000-0000000000a2', '9c000000-0000-4000-8000-0000000000a1', now(), 'aal2'),
  ('9c500000-0000-4000-8000-0000000000b1', '9c000000-0000-4000-8000-0000000000b1', now(), 'aal2'),
  ('9c500000-0000-4000-8000-0000000000d1', '9c000000-0000-4000-8000-0000000000d1', now(), 'aal2');

-- Nobody but the service role.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9c000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000a1', repeat('a', 64), 'pp-mine', now() + interval '10 minutes', now() + interval '1 hour') $$, '42501', null, 'a signed-in person cannot make a link request');
select throws_ok($$ select public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000a1', repeat('a', 64), '9c500000-0000-4000-8000-0000000000a1') $$, '42501', null, 'or claim one');
select throws_ok($$ select public.gms_passport_link_pending('9c000000-0000-4000-8000-0000000000a1', '9c500000-0000-4000-8000-0000000000a1') $$, '42501', null, 'or read one');
select throws_ok($$ select public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000a1', 'pp-mine', '9c500000-0000-4000-8000-0000000000a2') $$, '42501', null, 'or record a link');
select throws_ok($$ select public.gms_passport_link_created('9c000000-0000-4000-8000-0000000000a1', 'pp-mine') $$, '42501', null, 'or record one as a new account');
select throws_ok($$ select public.gms_passport_link_settle('9c000000-0000-4000-8000-0000000000a1') $$, '42501', null, 'or clear requests');
select throws_ok($$ select * from public.gms_passport_link_state('9c000000-0000-4000-8000-0000000000a1', 'pp-mine') $$, '42501', null, 'or look a link up');
select throws_ok($$ select * from gms.passport_links_backfill() $$, '42501', null, 'or run the one-time step');
select throws_ok($$ select count(*) from public.passport_link_requests $$, '42501', null, 'or read the requests');
select throws_ok($$ select count(*) from public.passport_account_links $$, '42501', null, 'or read the links');
select throws_ok($$ insert into public.passport_account_links (user_id, passport_user_id, basis) values ('9c000000-0000-4000-8000-0000000000a1', 'pp-mine', 'own_second_step') $$, '42501', null, 'or write one');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.passport_link_requests $$, '42501', null, 'nor can an anonymous caller read the requests');
select throws_ok($$ select count(*) from public.passport_account_links $$, '42501', null, 'or the links');
reset role;

set local role service_role;
-- Even the service role writes a link only through the functions, and never changes one.
select throws_ok($$ insert into public.passport_account_links (user_id, passport_user_id, basis) values ('9c000000-0000-4000-8000-0000000000a1', 'pp-mine', 'own_second_step') $$, '42501', null, 'the service role cannot insert a link directly');
select throws_ok($$ update public.passport_account_links set passport_user_id = 'pp-other' $$, '42501', null, 'or re-point one');
select throws_ok($$ delete from public.passport_account_links $$, '42501', null, 'or delete one');
select throws_ok($$ select * from gms.passport_links_backfill() $$, '42501', null, 'or run the one-time step');

-- Ana's account existed. Someone signs in with Passport as pp-someone using her email.
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

-- The link itself: only once that same session has passed the account's own second step.
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000a1', 'pp-someone', '9c500000-0000-4000-8000-0000000000a1'), 'refused', 'no link while the session is single-step, whatever the caller says');
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000a1', 'pp-someone', '9c500000-0000-4000-8000-0000000000a2'), 'refused', 'and none through her other, verified session: it holds no request');
select is((select row(account_passport_user, passport_user_account)::text from public.gms_passport_link_state('9c000000-0000-4000-8000-0000000000a1', 'pp-someone')), '(,)', 'so nothing is linked');
select is((select count(*)::int from public.passport_second_steps where user_id = '9c000000-0000-4000-8000-0000000000a1'), 0, 'and Passport''s second step is not recorded for an account with no link');
select public.gms_passport_second_step_record('9c000000-0000-4000-8000-0000000000a1', repeat('1', 64), 'aal2', now(), now() + interval '10 minutes', now() + interval '12 hours');
select is((select count(*)::int from public.passport_second_steps where user_id = '9c000000-0000-4000-8000-0000000000a1'), 0, 'even when the Worker asks for it');
reset role;
-- She enters her own authenticator code: Supabase Auth raises that same session.
update auth.sessions set aal = 'aal2' where id = '9c500000-0000-4000-8000-0000000000a1';
set local role service_role;
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000a1', 'pp-other', '9c500000-0000-4000-8000-0000000000a1'), 'refused', 'the request names the Passport user; the caller cannot name another');
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000a1', 'pp-someone', '9c500000-0000-4000-8000-0000000000a1'), 'recorded', 'the link is recorded once the session has passed the account''s own second step');
select is((select basis from public.passport_account_links where user_id = '9c000000-0000-4000-8000-0000000000a1'), 'own_second_step', 'and says how it was made');
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000a1', 'pp-someone', '9c500000-0000-4000-8000-0000000000a1'), 'already', 'recording it again changes nothing');
select is((select row(account_passport_user, passport_user_account)::text from public.gms_passport_link_state('9c000000-0000-4000-8000-0000000000a1', 'pp-someone')), '(pp-someone,9c000000-0000-4000-8000-0000000000a1)', 'the account and the Passport user now resolve to each other');
select public.gms_passport_second_step_record('9c000000-0000-4000-8000-0000000000a1', repeat('2', 64), 'aal2', now(), now() + interval '10 minutes', now() + interval '12 hours');
select is((select count(*)::int from public.passport_second_steps where user_id = '9c000000-0000-4000-8000-0000000000a1'), 1, 'from now on Passport''s second step is recorded for her');
select public.gms_passport_link_settle('9c000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from public.passport_link_requests where user_id = '9c000000-0000-4000-8000-0000000000a1'), 0, 'settling clears every request of the person');

-- A link is never re-pointed, from either side.
select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000b1', repeat('b', 64), 'pp-someone', now() + interval '10 minutes', now() + interval '1 hour');
select public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000b1', repeat('b', 64), '9c500000-0000-4000-8000-0000000000b1');
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000b1', 'pp-someone', '9c500000-0000-4000-8000-0000000000b1'), 'refused', 'a Passport user linked to one account is not linked to a second, own second step or not');
select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000a1', repeat('c', 64), 'pp-new', now() + interval '10 minutes', now() + interval '1 hour');
select public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000a1', repeat('c', 64), '9c500000-0000-4000-8000-0000000000a2');
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000a1', 'pp-new', '9c500000-0000-4000-8000-0000000000a2'), 'refused', 'and a linked account is not linked to a second Passport user');
select is((select passport_user_id from public.passport_account_links where user_id = '9c000000-0000-4000-8000-0000000000a1'), 'pp-someone', 'the first link stands');

-- Dee's app metadata names pp-dee (written before links were recorded). Only pp-dee can be linked.
select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000d1', repeat('d', 64), 'pp-intruder', now() + interval '10 minutes', now() + interval '1 hour');
select public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000d1', repeat('d', 64), '9c500000-0000-4000-8000-0000000000d1');
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000d1', 'pp-intruder', '9c500000-0000-4000-8000-0000000000d1'), 'refused', 'an account first tied to one Passport user is not linked to another');
select public.gms_passport_link_settle('9c000000-0000-4000-8000-0000000000d1');
select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000d1', repeat('e', 64), 'pp-dee', now() + interval '10 minutes', now() + interval '1 hour');
select public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000d1', repeat('e', 64), '9c500000-0000-4000-8000-0000000000d1');
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000d1', 'pp-dee', '9c500000-0000-4000-8000-0000000000d1'), 'recorded', 'it is linked to that one, after its own second step');

-- A request that has run out links nothing.
select public.gms_passport_link_settle('9c000000-0000-4000-8000-0000000000b1');
select public.gms_passport_link_request('9c000000-0000-4000-8000-0000000000b1', repeat('f', 64), 'pp-free', now() + interval '10 minutes', now() + interval '1 hour');
select public.gms_passport_link_claim('9c000000-0000-4000-8000-0000000000b1', repeat('f', 64), '9c500000-0000-4000-8000-0000000000b1');
reset role;
update public.passport_link_requests set valid_until = now() - interval '1 second' where token_digest = repeat('f', 64);
set local role service_role;
select is(public.gms_passport_link_pending('9c000000-0000-4000-8000-0000000000b1', '9c500000-0000-4000-8000-0000000000b1'), null, 'a request is dead after its window');
select is(public.gms_passport_link_record('9c000000-0000-4000-8000-0000000000b1', 'pp-free', '9c500000-0000-4000-8000-0000000000b1'), 'refused', 'and records nothing, though the session is verified and the Passport user is free');

-- An account the sign-in has just created is linked at once; an older one never is this way.
select is(public.gms_passport_link_created('9c000000-0000-4000-8000-0000000000c1', 'pp-cy'), 'recorded', 'a new account is linked to the Passport user that made it');
select is((select basis from public.passport_account_links where user_id = '9c000000-0000-4000-8000-0000000000c1'), 'account_created', 'and says so');
select is(public.gms_passport_link_created('9c000000-0000-4000-8000-0000000000c1', 'pp-cy'), 'already', 'twice changes nothing');
select is(public.gms_passport_link_created('9c000000-0000-4000-8000-0000000000c2', 'pp-wrong'), 'refused', 'a new account is not linked to a Passport user its app metadata does not name');
select is(public.gms_passport_link_created('9c000000-0000-4000-8000-0000000000b1', 'pp-ben'), 'refused', 'an account that already existed is not linked as if it were new');
select is(public.gms_passport_link_created('9c000000-0000-4000-8000-0000000000d2', 'pp-fay'), 'refused', 'not even one whose app metadata names the Passport user');
select is(public.gms_passport_link_created('9c000000-0000-4000-8000-0000000000e1', 'pp-eli'), 'refused', 'nor one nobody confirmed');
reset role;

-- Gone with the account.
delete from auth.users where id in ('9c000000-0000-4000-8000-0000000000c1', '9c000000-0000-4000-8000-0000000000c2', '9c000000-0000-4000-8000-0000000000d2', '9c000000-0000-4000-8000-0000000000e1');
select is((select count(*)::int from public.passport_account_links where user_id = '9c000000-0000-4000-8000-0000000000c1'), 0, 'deleting the account removes its link');

-- ---------------------------------------------------------------------------------------------
-- The one-time step: accounts whose Passport sign-in predates the link record. Each carries the
-- Passport user in its app metadata and has no link row.
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, raw_app_meta_data) values
  -- Passport's second step was honoured before (ledger). Has its own authenticator.
  ('9c100000-0000-4000-8000-000000000001', 'h1@link.example', 'authenticated', 'authenticated', now(), now() - interval '9 days', '{"passport_user_id":"pp-h1"}'),
  -- Honoured before (a claimed record is still there). Has its own authenticator.
  ('9c100000-0000-4000-8000-000000000002', 'h2@link.example', 'authenticated', 'authenticated', now(), now() - interval '9 days', '{"passport_user_id":"pp-h2"}'),
  -- Created by a Passport sign-in (ledger). Enrolled its own authenticator later.
  ('9c100000-0000-4000-8000-000000000003', 'h3@link.example', 'authenticated', 'authenticated', now(), now() - interval '9 days', '{"passport_user_id":"pp-h3"}'),
  -- No second factor of its own; nothing else known.
  ('9c100000-0000-4000-8000-000000000004', 'h4@link.example', 'authenticated', 'authenticated', now(), now() - interval '9 days', '{"passport_user_id":"pp-h4"}'),
  -- Has its own authenticator, existed before its first Passport sign-in, Passport's never honoured.
  ('9c100000-0000-4000-8000-000000000005', 'h5@link.example', 'authenticated', 'authenticated', now(), now() - interval '9 days', '{"passport_user_id":"pp-h5"}'),
  -- One Passport user on two accounts.
  ('9c100000-0000-4000-8000-000000000006', 'h6@link.example', 'authenticated', 'authenticated', now(), now() - interval '9 days', '{"passport_user_id":"pp-twice"}'),
  ('9c100000-0000-4000-8000-000000000007', 'h7@link.example', 'authenticated', 'authenticated', now(), now() - interval '9 days', '{"passport_user_id":"pp-twice"}'),
  -- Started setting up an authenticator and never finished: that is not a second step.
  ('9c100000-0000-4000-8000-000000000008', 'h8@link.example', 'authenticated', 'authenticated', now(), now() - interval '9 days', '{"passport_user_id":"pp-h8"}'),
  -- Never confirmed.
  ('9c100000-0000-4000-8000-000000000009', 'h9@link.example', 'authenticated', 'authenticated', null, now() - interval '9 days', '{"passport_user_id":"pp-h9"}');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('9c1f0000-0000-4000-8000-000000000001', '9c100000-0000-4000-8000-000000000001', 'Authenticator', 'totp', 'verified', now(), now(), 'test-secret'),
  ('9c1f0000-0000-4000-8000-000000000002', '9c100000-0000-4000-8000-000000000002', 'Authenticator', 'totp', 'verified', now(), now(), 'test-secret'),
  ('9c1f0000-0000-4000-8000-000000000003', '9c100000-0000-4000-8000-000000000003', 'Authenticator', 'totp', 'verified', now(), now(), 'test-secret'),
  ('9c1f0000-0000-4000-8000-000000000005', '9c100000-0000-4000-8000-000000000005', 'Authenticator', 'totp', 'verified', now(), now(), 'test-secret'),
  ('9c1f0000-0000-4000-8000-000000000008', '9c100000-0000-4000-8000-000000000008', 'Authenticator', 'totp', 'unverified', now(), now(), 'test-secret');
insert into public.ledger_events (actor, event_type, subject_type, subject_id, data) values
  ('user:9c100000-0000-4000-8000-000000000001', 'auth.second_step_from_passport', 'user', '9c100000-0000-4000-8000-000000000001', '{}'),
  ('user:9c100000-0000-4000-8000-000000000003', 'auth.passport_signin', 'user', '9c100000-0000-4000-8000-000000000003', '{"created":true,"acr":"aal1"}'),
  ('user:9c100000-0000-4000-8000-000000000005', 'auth.passport_signin', 'user', '9c100000-0000-4000-8000-000000000005', '{"created":false,"acr":"aal1"}');
insert into auth.sessions (id, user_id, created_at, aal) values ('9c150000-0000-4000-8000-000000000002', '9c100000-0000-4000-8000-000000000002', now(), 'aal1');
insert into public.passport_second_steps (user_id, token_digest, acr, auth_time, expires_at, session_id, claimed_at, valid_until) values
  ('9c100000-0000-4000-8000-000000000002', repeat('9', 64), 'aal2', now() - interval '1 day', now() - interval '1 day', '9c150000-0000-4000-8000-000000000002', now() - interval '1 day', now() - interval '12 hours');

select is((select row(linked, left_for_own_second_step)::text from gms.passport_links_backfill()), '(5,3)', 'the one-time step links five of the eight confirmed accounts');
select results_eq(
  $$ select right(user_id::text, 1), basis from public.passport_account_links where user_id::text like '9c100000-%' order by 1 $$,
  $$ values ('1', 'predates_link_record'), ('2', 'predates_link_record'), ('3', 'predates_link_record'), ('4', 'predates_link_record'), ('8', 'predates_link_record') $$,
  'those Passport''s second step was honoured for, those a Passport sign-in created, and those with no second step of their own'
);
select results_eq(
  $$ select right(subject_id, 1), actor, data ->> 'confirmedBy', data ->> 'passportUserId', data -> 'evidence' from public.ledger_events
     where event_type = 'auth.passport_linked' and subject_id like '9c100000-%' order by 1 $$,
  $$ values ('1', 'system:migration_0023', 'predates_link_record', 'pp-h1', '["passport_second_step_honoured_before"]'::jsonb),
            ('2', 'system:migration_0023', 'predates_link_record', 'pp-h2', '["passport_second_step_honoured_before"]'::jsonb),
            ('3', 'system:migration_0023', 'predates_link_record', 'pp-h3', '["account_created_by_passport_sign_in"]'::jsonb),
            ('4', 'system:migration_0023', 'predates_link_record', 'pp-h4', '["no_second_step_of_its_own"]'::jsonb),
            ('8', 'system:migration_0023', 'predates_link_record', 'pp-h8', '["no_second_step_of_its_own"]'::jsonb) $$,
  'each with a ledger entry that says why'
);
select is((select row(linked, left_for_own_second_step)::text from gms.passport_links_backfill()), '(0,3)', 'running it again links nobody else and writes nothing');
select is((select count(*)::int from public.ledger_events where event_type = 'auth.passport_linked' and subject_id like '9c100000-%'), 5, 'no second ledger entry');

set local role service_role;
-- The account with its own authenticator that Passport's was never honoured for keeps its Passport
-- sign-in, is still tied to the same Passport user, and is linked after its own second step.
select is((select row(account_passport_user, passport_user_account)::text from public.gms_passport_link_state('9c100000-0000-4000-8000-000000000005', 'pp-h5')), '(,)', 'the account left alone has no link');
select is((select passport_user_id from public.gms_account_by_email('h5@link.example')), 'pp-h5', 'and still names its Passport user, the only one that may ever be linked to it');
reset role;

select * from finish();
rollback;
