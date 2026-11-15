-- Single sign-on domains (0035): who reads them, that signed-in users cannot write them, that a
-- domain is active for one workspace at most, the checks that keep a requirement from locking
-- people out, and the operator's activate, deactivate and recovery functions with their ledger rows.
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('13000000-0000-4000-8000-0000000000a1', 'admin@sso-funder-a.example',  'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000a2', 'officer@sso-funder-a.example', 'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000b1', 'admin@sso-funder-b.example',  'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000c1', 'admin@sso-applicant.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('13000000-0000-7000-8000-000000000001', 'funder',    'sso-funder-a',  'SSO Funder A'),
  ('13000000-0000-7000-8000-000000000002', 'funder',    'sso-funder-b',  'SSO Funder B'),
  ('13000000-0000-7000-8000-000000000003', 'applicant', 'sso-applicant', 'SSO Applicant');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000a1', 'admin'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000a2', 'program_officer'),
  ('13000000-0000-7000-8000-000000000002', '13000000-0000-4000-8000-0000000000b1', 'admin'),
  ('13000000-0000-7000-8000-000000000003', '13000000-0000-4000-8000-0000000000c1', 'admin');

-- ---------------------------------------------------------------- shape
select has_table('public', 'workspace_sso_domains', 'workspace_sso_domains exists');
select col_not_null('public', 'workspace_sso_domains', 'domain', 'a row names its domain');
select col_is_null('public', 'workspace_sso_domains', 'provider_id', 'the provider id is empty until the operator registers one');
select col_default_is('public', 'workspace_sso_domains', 'status', 'pending', 'a new domain is pending');
select col_default_is('public', 'workspace_sso_domains', 'require_sso', 'false', 'nothing is required by default');
select ok((select relrowsecurity from pg_class where oid = 'public.workspace_sso_domains'::regclass), 'RLS is on');

-- ---------------------------------------------------------------- writes as the API (service role)
set local role service_role;
insert into public.workspace_sso_domains (id, workspace_id, domain, verification_token) values
  ('13000000-0000-7000-8000-0000000000d1', '13000000-0000-7000-8000-000000000001', 'funder-a.example', repeat('a', 43)),
  ('13000000-0000-7000-8000-0000000000d2', '13000000-0000-7000-8000-000000000001', 'staff.funder-a.example', repeat('b', 43)),
  ('13000000-0000-7000-8000-0000000000d3', '13000000-0000-7000-8000-000000000002', 'funder-a.example', repeat('c', 43));
select pass('two workspaces may both hold a domain while it is pending');

select throws_ok(
  $$ insert into public.workspace_sso_domains (workspace_id, domain, verification_token) values ('13000000-0000-7000-8000-000000000001', 'funder-a.example', repeat('d', 43)) $$,
  '23505', null, 'a workspace lists a domain once'
);
select throws_ok(
  $$ insert into public.workspace_sso_domains (workspace_id, domain, verification_token) values ('13000000-0000-7000-8000-000000000003', 'applicant.example', repeat('e', 43)) $$,
  '23514', null, 'applicant workspaces have no single sign-on domains'
);
select throws_ok(
  $$ insert into public.workspace_sso_domains (workspace_id, domain, verification_token) values ('13000000-0000-7000-8000-000000000001', 'Funder-A.Example', repeat('f', 43)) $$,
  '23514', null, 'a domain is stored in lowercase'
);
select throws_ok(
  $$ insert into public.workspace_sso_domains (workspace_id, domain, verification_token) values ('13000000-0000-7000-8000-000000000001', 'other.example', 'short') $$,
  '23514', null, 'the challenge token has the generated shape'
);
select throws_ok(
  $$ update public.workspace_sso_domains set require_sso = true where id = '13000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'single sign-on cannot be required for a pending domain'
);
select throws_ok(
  $$ update public.workspace_sso_domains set status = 'active' where id = '13000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'a domain is not active without a provider'
);
select throws_ok(
  $$ update public.workspace_sso_domains set workspace_id = '13000000-0000-7000-8000-000000000002' where id = '13000000-0000-7000-8000-0000000000d2' $$,
  '23514', null, 'a domain never moves to another workspace'
);

-- ---------------------------------------------------------------- operator: activate
select throws_ok(
  $$ select gms.activate_sso_domain('13000000-0000-7000-8000-000000000001', 'funder-a.example', '13000000-0000-4000-8000-00000000ffa1') $$,
  '55000', null, 'a domain without DNS proof cannot be activated'
);
update public.workspace_sso_domains set verified_at = now(), last_check_result = 'matched' where id in ('13000000-0000-7000-8000-0000000000d1', '13000000-0000-7000-8000-0000000000d3');
select is(
  gms.activate_sso_domain('13000000-0000-7000-8000-000000000001', ' FUNDER-A.example ', '13000000-0000-4000-8000-00000000ffa1'),
  '13000000-0000-7000-8000-0000000000d1'::uuid,
  'the operator activates a proved domain with its provider'
);
select is(
  (select row(status, provider_id::text, activated_at is not null)::text from public.workspace_sso_domains where id = '13000000-0000-7000-8000-0000000000d1'),
  row('active', '13000000-0000-4000-8000-00000000ffa1', true)::text,
  'the domain is active with its provider and the time'
);
select is(
  (select count(*)::int from public.ledger_events where event_type = 'sso_domain.activated' and subject_id = '13000000-0000-7000-8000-0000000000d1' and actor = 'system:operator'),
  1,
  'the activation is in the ledger'
);
select throws_ok(
  $$ select gms.activate_sso_domain('13000000-0000-7000-8000-000000000002', 'funder-a.example', '13000000-0000-4000-8000-00000000ffb1') $$,
  '23505', null, 'a domain is active for one workspace at most'
);
select throws_ok(
  $$ update public.workspace_sso_domains set status = 'active', provider_id = '13000000-0000-4000-8000-00000000ffb1', activated_at = now() where id = '13000000-0000-7000-8000-0000000000d3' $$,
  '23505', null, 'the unique index holds against a direct write too'
);
select lives_ok(
  $$ update public.workspace_sso_domains set require_sso = true where id = '13000000-0000-7000-8000-0000000000d1' $$,
  'an active domain can be required'
);

-- ---------------------------------------------------------------- reads as signed-in people
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.workspace_sso_domains), 2, 'a member reads their workspace''s domains');
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select results_eq(
  $$ select id from public.workspace_sso_domains $$,
  $$ values ('13000000-0000-7000-8000-0000000000d3'::uuid) $$,
  'another workspace''s admin reads only their own'
);
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.workspace_sso_domains), 0, 'a non-member reads nothing');

-- Admins change single sign-on through the API only (the admin check, the DNS proof, the SSO rule and the ledger).
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000a1","role":"authenticated","amr":[{"method":"sso/saml","timestamp":1,"provider":"13000000-0000-4000-8000-00000000ffa1"}]}', true);
select throws_ok(
  $$ update public.workspace_sso_domains set require_sso = false where id = '13000000-0000-7000-8000-0000000000d1' $$,
  '42501', null, 'even an admin cannot write directly'
);
select throws_ok(
  $$ insert into public.workspace_sso_domains (workspace_id, domain, verification_token) values ('13000000-0000-7000-8000-000000000001', 'direct.example', repeat('g', 43)) $$,
  '42501', null, 'nor add a domain directly'
);
select throws_ok(
  $$ select gms.lift_sso_requirement('13000000-0000-7000-8000-000000000001', 'not mine to call') $$,
  '42501', null, 'signed-in users cannot call the operator functions'
);

-- ---------------------------------------------------------------- operator: recovery and deactivate
reset role;
set local role service_role;
select throws_ok(
  $$ select gms.lift_sso_requirement('13000000-0000-7000-8000-000000000001', '  ') $$,
  '22023', null, 'lifting the requirement needs a reason'
);
select is(gms.lift_sso_requirement('13000000-0000-7000-8000-000000000001', 'Identity provider outage, ticket 42'), 1, 'recovery lifts the requirement');
select ok(
  (select not require_sso from public.workspace_sso_domains where id = '13000000-0000-7000-8000-0000000000d1')
  and exists (select 1 from public.ledger_events where event_type = 'sso.requirement_lifted' and workspace_id = '13000000-0000-7000-8000-000000000001' and data ->> 'reason' = 'Identity provider outage, ticket 42'),
  'the domain is no longer required, and the ledger says why'
);
update public.workspace_sso_domains set require_sso = true where id = '13000000-0000-7000-8000-0000000000d1';
select is(gms.deactivate_sso_domain('13000000-0000-7000-8000-000000000001', 'funder-a.example'), '13000000-0000-7000-8000-0000000000d1'::uuid, 'the operator deactivates a domain');
select is(
  (select row(status, provider_id is null, require_sso)::text from public.workspace_sso_domains where id = '13000000-0000-7000-8000-0000000000d1'),
  row('pending', true, false)::text,
  'deactivating returns it to pending and lifts the requirement'
);

select * from finish();
rollback;
