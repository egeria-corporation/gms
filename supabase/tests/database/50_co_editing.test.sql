-- Live co-editing (0050): presence passes and Realtime Authorization on realtime.messages.
-- Passes are written by the service role (the API's role) after the API's own access check; the
-- realtime policies admit a draft channel's join, presence and broadcast only to the session that
-- holds a live pass for that topic, while its membership stands. Checked the way Realtime checks a
-- join: as `authenticated`, with the token's claims and `realtime.topic` set, reading and writing
-- realtime.messages inside the transaction.
--
-- The Realtime half (19 tests) needs Supabase Realtime's `realtime.messages`, which Realtime creates
-- when it starts; where it is not running (CI starts Supabase without it) migration 0050 skips its
-- policies and that half is skipped here too, with psql's \if.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);
select to_regclass('realtime.messages') is not null as has_realtime \gset

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('50000000-0000-4000-8000-0000000000a1', 'admin@coedit-applicant.example',   'authenticated', 'authenticated'),
  ('50000000-0000-4000-8000-0000000000a2', 'viewer@coedit-applicant.example',  'authenticated', 'authenticated'),
  ('50000000-0000-4000-8000-0000000000a3', 'cowriter@coedit-consult.example',  'authenticated', 'authenticated'),
  ('50000000-0000-4000-8000-0000000000b1', 'officer@coedit-funder.example',    'authenticated', 'authenticated'),
  ('50000000-0000-4000-8000-0000000000c1', 'admin@coedit-other.example',       'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('50000000-0000-7000-8000-000000000001', 'applicant', 'coedit-applicant', 'Co-edit Applicant'),
  ('50000000-0000-7000-8000-000000000002', 'funder',    'coedit-funder',    'Co-edit Funder'),
  ('50000000-0000-7000-8000-000000000003', 'applicant', 'coedit-other',     'Co-edit Other Applicant');

insert into public.workspace_members (workspace_id, user_id, role, scope, expires_at) values
  ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a1', 'admin', '{}', null),
  ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a2', 'viewer', '{}', null),
  ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a3', 'consultant', '{"applicationIds":["50000000-0000-7000-8000-0000000000a1"]}', now() + interval '30 days'),
  ('50000000-0000-7000-8000-000000000002', '50000000-0000-4000-8000-0000000000b1', 'program_officer', '{}', null),
  ('50000000-0000-7000-8000-000000000003', '50000000-0000-4000-8000-0000000000c1', 'admin', '{}', null);

insert into public.opportunities (id, workspace_id, slug, title, status, published_at) values
  ('50000000-0000-7000-8000-0000000000e1', '50000000-0000-7000-8000-000000000002', 'coedit-open', 'Co-edit call', 'open', now());
insert into public.competitions (id, workspace_id, opportunity_id, title, status) values
  ('50000000-0000-7000-8000-0000000000c1', '50000000-0000-7000-8000-000000000002', '50000000-0000-7000-8000-0000000000e1', 'Co-edit competition', 'open');
insert into public.applications (id, workspace_id, applicant_workspace_id, competition_id, opportunity_id, title, stage, status, cg_status, cg_custom_value, tags) values
  ('50000000-0000-7000-8000-0000000000a1', '50000000-0000-7000-8000-000000000002', '50000000-0000-7000-8000-000000000001',
   '50000000-0000-7000-8000-0000000000c1', '50000000-0000-7000-8000-0000000000e1', 'Shared draft', 'full', 'draft', 'inProgress', null, '{}');
insert into public.outside_applications (id, workspace_id, title, funder_name) values
  ('50000000-0000-7000-8000-0000000000d1', '50000000-0000-7000-8000-000000000001', 'Outside draft', 'Northwind Family Foundation'),
  ('50000000-0000-7000-8000-0000000000d2', '50000000-0000-7000-8000-000000000003', 'Someone else''s draft', 'Northwind Family Foundation');

-- One message of each kind on the draft's topic, as Realtime's own check does (it writes and reads
-- inside a transaction it rolls back).
\if :has_realtime
insert into realtime.messages (topic, extension, payload, event, private) values
  ('draft:application:50000000-0000-7000-8000-0000000000a1', 'presence', '{}', 'presence', true),
  ('draft:application:50000000-0000-7000-8000-0000000000a1', 'broadcast', '{}', 'saved', true),
  ('room:lobby', 'broadcast', '{}', 'hello', true);
\endif

-- ---------------------------------------------------------------- the service role writes passes
set local role service_role;
insert into public.presence_passes (workspace_id, user_id, session_id, topic, can_write, expires_at) values
  ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a1', 'draft:application:50000000-0000-7000-8000-0000000000a1', true,  now() + interval '10 minutes'),
  ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-9000-0000000000a2', 'draft:application:50000000-0000-7000-8000-0000000000a1', false, now() + interval '10 minutes'),
  ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a3', '50000000-0000-4000-9000-0000000000a3', 'draft:application:50000000-0000-7000-8000-0000000000a1', true,  now() - interval '1 minute'),
  ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a1', 'draft:outside:50000000-0000-7000-8000-0000000000d1', true, now() + interval '10 minutes');
select pass('the service role records passes for a built-in and an outside draft');

select throws_ok(
  $$ insert into public.presence_passes (workspace_id, user_id, session_id, topic, expires_at) values
     ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a1', 'draft:application:50000000-0000-7000-8000-0000000000a1', now() + interval '5 minutes') $$,
  '23505', null, 'one pass per session and draft (renewing updates it)'
);
select throws_ok(
  $$ insert into public.presence_passes (workspace_id, user_id, session_id, topic, expires_at) values
     ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a1', 'draft:outside:50000000-0000-7000-8000-0000000000d2', now() + interval '5 minutes') $$,
  '23514', null, 'a pass never names another workspace''s draft'
);
select throws_ok(
  $$ insert into public.presence_passes (workspace_id, user_id, session_id, topic, expires_at) values
     ('50000000-0000-7000-8000-000000000003', '50000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-9000-0000000000c1', 'draft:application:50000000-0000-7000-8000-0000000000a1', now() + interval '5 minutes') $$,
  '23514', null, 'a built-in draft''s pass belongs to the applicant''s workspace'
);
select throws_ok(
  $$ insert into public.presence_passes (workspace_id, user_id, session_id, topic, expires_at) values
     ('50000000-0000-7000-8000-000000000002', '50000000-0000-4000-8000-0000000000b1', '50000000-0000-4000-9000-0000000000b1', 'draft:application:50000000-0000-7000-8000-0000000000a1', now() + interval '5 minutes') $$,
  '23514', null, 'the funder''s workspace never holds a pass to the applicant''s draft'
);
select throws_ok(
  $$ insert into public.presence_passes (workspace_id, user_id, session_id, topic, expires_at) values
     ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a9', 'room:lobby', now() + interval '5 minutes') $$,
  '23514', null, 'a pass names a draft topic only'
);
select throws_ok(
  $$ insert into public.presence_passes (workspace_id, user_id, session_id, topic, expires_at) values
     ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a9', 'draft:application:50000000-0000-7000-8000-0000000000a1', now() + interval '2 hours') $$,
  '23514', null, 'a pass lives at most 30 minutes past its last write'
);
select lives_ok(
  $$ update public.presence_passes set expires_at = now() + interval '20 minutes'
     where user_id = '50000000-0000-4000-8000-0000000000a1' and topic like 'draft:outside:%' $$,
  'a pass is renewed in place'
);
reset role;

-- ---------------------------------------------------------------- nobody else touches passes
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-0000000000a1","session_id":"50000000-0000-4000-9000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.presence_passes $$, '42501', null, 'signed-in people cannot read passes');
select throws_ok(
  $$ insert into public.presence_passes (workspace_id, user_id, session_id, topic, expires_at) values
     ('50000000-0000-7000-8000-000000000001', '50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a8', 'draft:application:50000000-0000-7000-8000-0000000000a1', now() + interval '5 minutes') $$,
  '42501', null, 'signed-in people cannot write a pass for themselves'
);
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.presence_passes $$, '42501', null, 'visitors cannot read passes');
reset role;

-- ---------------------------------------------------------------- joining the draft's channel
\if :has_realtime
-- `as_session(user, session, topic)`: what Realtime sets before it checks a join.
create function pg_temp.as_session(who text, sid text, topic text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'session_id', sid, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', topic, true);
end;
$$;
create function pg_temp.reads() returns int language sql as $$ select count(*)::int from realtime.messages where topic = realtime.topic() $$;

set local role authenticated;

select pg_temp.as_session('50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a1', 'draft:application:50000000-0000-7000-8000-0000000000a1');
select is(pg_temp.reads(), 2, 'a writer with a live pass receives the draft''s presence and broadcasts');
select lives_ok($$ insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'presence', '{}', 'presence', true) $$, 'and tracks presence');
select lives_ok($$ insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'broadcast', '{}', 'lock', true) $$, 'and sends a lock or a saved nudge');

select pg_temp.as_session('50000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-9000-0000000000a2', 'draft:application:50000000-0000-7000-8000-0000000000a1');
select ok(pg_temp.reads() >= 2, 'a reader with a live pass receives them');
select lives_ok($$ insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'presence', '{}', 'presence', true) $$, 'a reader is shown as present');
select throws_ok($$ insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'broadcast', '{}', 'lock', true) $$, '42501', null, 'a reader cannot send locks or saved nudges');

select pg_temp.as_session('50000000-0000-4000-8000-0000000000a3', '50000000-0000-4000-9000-0000000000a3', 'draft:application:50000000-0000-7000-8000-0000000000a1');
select is(pg_temp.reads(), 0, 'an expired pass receives nothing');
select throws_ok($$ insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'presence', '{}', 'presence', true) $$, '42501', null, 'and cannot track presence');

select pg_temp.as_session('50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000ff', 'draft:application:50000000-0000-7000-8000-0000000000a1');
select is(pg_temp.reads(), 0, 'the same person''s other session, without a pass of its own, receives nothing');

select pg_temp.as_session('50000000-0000-4000-8000-0000000000b1', '50000000-0000-4000-9000-0000000000b1', 'draft:application:50000000-0000-7000-8000-0000000000a1');
select is(pg_temp.reads(), 0, 'the funder''s program officer never sees the applicant''s presence');
select throws_ok($$ insert into realtime.messages (topic, extension, payload, event, private) values (realtime.topic(), 'presence', '{}', 'presence', true) $$, '42501', null, 'nor joins it');

select pg_temp.as_session('50000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-9000-0000000000c1', 'draft:application:50000000-0000-7000-8000-0000000000a1');
select is(pg_temp.reads(), 0, 'another workspace''s admin receives nothing');

select pg_temp.as_session('50000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-9000-0000000000a2', 'draft:outside:50000000-0000-7000-8000-0000000000d1');
select is(pg_temp.reads(), 0, 'a pass for one draft opens no other draft');

select pg_temp.as_session('50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a1', 'room:lobby');
select is(pg_temp.reads(), 0, 'the draft policies admit nothing outside the draft topics');
select is(gms.presence_pass_ok(null, false), false, 'no topic, no pass');
reset role;

-- Leaving the team closes the channel at the next check, even while the pass has time left.
delete from public.workspace_members where workspace_id = '50000000-0000-7000-8000-000000000001' and user_id = '50000000-0000-4000-8000-0000000000a2';
set local role authenticated;
select pg_temp.as_session('50000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-9000-0000000000a2', 'draft:application:50000000-0000-7000-8000-0000000000a1');
select is(pg_temp.reads(), 0, 'a person removed from the team is refused with a live pass');
reset role;

update public.workspace_members set expires_at = now() - interval '1 minute' where workspace_id = '50000000-0000-7000-8000-000000000001' and user_id = '50000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select pg_temp.as_session('50000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-9000-0000000000a1', 'draft:application:50000000-0000-7000-8000-0000000000a1');
select is(pg_temp.reads(), 0, 'a membership that has expired is refused with a live pass');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from realtime.messages where topic like 'draft:%'), 0, 'visitors receive nothing of any draft');
reset role;

select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'gms_draft_%'), 3, 'three draft policies on realtime.messages');
\else
select skip('Supabase Realtime is not running here (no realtime.messages), so 0050 made no channel policies to check', 19);
\endif

select * from finish();
rollback;
