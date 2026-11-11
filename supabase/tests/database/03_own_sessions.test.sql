-- A person sees and ends only their own sign-in sessions; the service-role helpers are closed to
-- everyone else.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, aud, role) values
  ('5e000000-0000-4000-8000-0000000000a1', 'ana@sessions.example', 'authenticated', 'authenticated'),
  ('5e000000-0000-4000-8000-0000000000b1', 'ben@sessions.example', 'authenticated', 'authenticated');

insert into auth.sessions (id, user_id, created_at, user_agent, ip) values
  ('5e500000-0000-4000-8000-0000000000a1', '5e000000-0000-4000-8000-0000000000a1', now() - interval '2 days', 'Firefox on macOS', '203.0.113.10'),
  ('5e500000-0000-4000-8000-0000000000a2', '5e000000-0000-4000-8000-0000000000a1', now() - interval '1 hour', 'Safari on iPhone', '203.0.113.11'),
  ('5e500000-0000-4000-8000-0000000000b1', '5e000000-0000-4000-8000-0000000000b1', now() - interval '3 hours', 'Chrome on Windows', '198.51.100.20');

-- ---------------------------------------------------------------- as Ana
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5e000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

select is((select count(*)::int from gms.my_sessions()), 2, 'a person lists their own sessions');
select is((select count(*)::int from gms.my_sessions() where id = '5e500000-0000-4000-8000-0000000000b1'), 0, 'and never another person''s');
select is((select ip from gms.my_sessions() order by created_at limit 1), '203.0.113.10', 'with their own network address');
select is(gms.end_my_session('5e500000-0000-4000-8000-0000000000b1'), false, 'ending another person''s session does nothing');
select is(gms.end_my_session('5e500000-0000-4000-8000-0000000000a1'), true, 'ending their own session works');
select is((select count(*)::int from gms.my_sessions()), 1, 'and it is gone');
select throws_ok($$ select * from public.gms_sessions_of('5e000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'a signed-in person cannot call the service-role lookup');
select throws_ok($$ select public.gms_end_session_of('5e000000-0000-4000-8000-0000000000b1', '5e500000-0000-4000-8000-0000000000b1') $$, '42501', null, 'or the service-role removal');
select throws_ok($$ select public.gms_user_id_by_email('ben@sessions.example') $$, '42501', null, 'or look up another person''s account by email');

-- ---------------------------------------------------------------- signed out
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from gms.my_sessions() $$, '42501', null, 'anonymous callers cannot list sessions');

-- ---------------------------------------------------------------- the rows themselves
reset role;
select is((select count(*)::int from auth.sessions where user_id = '5e000000-0000-4000-8000-0000000000b1'), 1, 'the other person''s session is untouched');

-- ---------------------------------------------------------------- the service role (the API Worker)
reset role;
set local role service_role;
select is(public.gms_user_id_by_email(' BEN@sessions.example '), '5e000000-0000-4000-8000-0000000000b1'::uuid, 'the service role finds an account by email, ignoring case and spaces');
reset role;

select * from finish();
rollback;
