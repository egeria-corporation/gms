-- Review parity (0033): a competition's conflict-of-interest policy and the reviewers' signatures
-- belong to the funder workspace. Writes run as the service role (the API's role); reads are
-- checked as staff, a reviewer who signed, a reviewer who did not, an external reviewer inside and
-- outside their competition, an applicant and another funder. Rows never change once written, and
-- a stage's `anonymized` setting is true or false.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('13000000-0000-4000-8000-0000000000f1', 'admin@funder.example',      'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000f2', 'auditor@funder.example',    'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000c1', 'one@reviewers.example',     'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000c2', 'two@reviewers.example',     'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000e1', 'ext@university.example',    'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000a1', 'admin@applicant.example',   'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000b1', 'admin@other-funder.example','authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('13000000-0000-7000-8000-000000000001', 'funder',    'rp-funder',       'RP Funder'),
  ('13000000-0000-7000-8000-000000000002', 'funder',    'rp-other-funder', 'RP Other Funder'),
  ('13000000-0000-7000-8000-000000000003', 'applicant', 'rp-applicant',    'RP Applicant');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f2', 'auditor', '{}'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000c1', 'reviewer', '{}'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000c2', 'reviewer', '{}'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000e1', 'external_reviewer', '{"competitionIds":["13000000-0000-7000-8000-0000000000c1"]}'),
  ('13000000-0000-7000-8000-000000000003', '13000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('13000000-0000-7000-8000-000000000002', '13000000-0000-4000-8000-0000000000b1', 'admin', '{}');

insert into public.opportunities (id, workspace_id, slug, title) values
  ('13000000-0000-7000-8000-0000000000a1', '13000000-0000-7000-8000-000000000001', 'rp-opportunity', 'RP Opportunity'),
  ('13000000-0000-7000-8000-0000000000a2', '13000000-0000-7000-8000-000000000002', 'rp-other-opportunity', 'RP Other Opportunity');
insert into public.competitions (id, workspace_id, opportunity_id, title, stages) values
  ('13000000-0000-7000-8000-0000000000c1', '13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000a1', 'Spring round', '[{"key":"full","label":"Full proposal","anonymized":true}]'),
  ('13000000-0000-7000-8000-0000000000c2', '13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000a1', 'Fall round', '[{"key":"full","label":"Full proposal"}]'),
  ('13000000-0000-7000-8000-0000000000c3', '13000000-0000-7000-8000-000000000002', '13000000-0000-7000-8000-0000000000a2', 'Elsewhere', '[]');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

insert into public.coi_policies (workspace_id, competition_id, version, policy_text, is_default) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', 1, 'Tell us about any conflict before you read an application.', true),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', 2, 'Our own policy: declare every organization you work with.', false),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c2', 1, 'Fall policy.', true);
select pass('the service role writes policy versions');

insert into public.coi_signatures (workspace_id, competition_id, reviewer_user_id, policy_version, signed_name, declared_org_ids, declared_orgs) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-4000-8000-0000000000c1', 2, 'Morgan Reviewer', array['13000000-0000-7000-8000-000000000003']::uuid[], '[{"name":"RP Applicant","website":"rp-applicant.example"},{"name":"Somewhere Else"}]'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-4000-8000-0000000000e1', 2, 'Ellis External', '{}', '[]');
select pass('the service role writes signatures');

select throws_ok($$ insert into public.coi_signatures (workspace_id, competition_id, reviewer_user_id, policy_version, signed_name) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-4000-8000-0000000000c1', 2, 'Morgan Reviewer') $$,
  '23505', null, 'a reviewer signs a policy version once');
select throws_ok($$ insert into public.coi_signatures (workspace_id, competition_id, reviewer_user_id, policy_version, signed_name) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-4000-8000-0000000000c2', 9, 'Two Reviewer') $$,
  '23503', null, 'a signature names a policy version that exists');
select throws_ok($$ insert into public.coi_signatures (workspace_id, competition_id, reviewer_user_id, policy_version, signed_name) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-4000-8000-0000000000c2', 2, ' ') $$,
  '23514', null, 'a signature carries a typed name');
select throws_ok($$ insert into public.coi_signatures (workspace_id, competition_id, reviewer_user_id, policy_version, signed_name, declared_orgs) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-4000-8000-0000000000c2', 2, 'Two Reviewer', '[{"name":"X","note":"anything else"}]') $$,
  '23514', null, 'declared organizations hold a name and a website only');
select throws_ok($$ insert into public.coi_policies (workspace_id, competition_id, version, policy_text) values ('13000000-0000-7000-8000-000000000002', '13000000-0000-7000-8000-0000000000c1', 3, 'Cross-workspace') $$,
  '23514', null, 'a policy cannot name another workspace''s competition');
select throws_ok($$ insert into public.coi_signatures (workspace_id, competition_id, reviewer_user_id, policy_version, signed_name) values ('13000000-0000-7000-8000-000000000002', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-4000-8000-0000000000b1', 2, 'Other Admin') $$,
  '23514', null, 'a signature cannot name another workspace''s competition');
select throws_ok($$ update public.coi_signatures set signed_name = 'Someone Else' where reviewer_user_id = '13000000-0000-4000-8000-0000000000c1' $$,
  '23514', null, 'a signature is never edited');
select throws_ok($$ update public.coi_signatures set declared_org_ids = '{}' where reviewer_user_id = '13000000-0000-4000-8000-0000000000c1' $$,
  '23514', null, 'nor its declared conflicts');
select throws_ok($$ update public.coi_policies set policy_text = 'Rewritten' where competition_id = '13000000-0000-7000-8000-0000000000c1' and version = 2 $$,
  '23514', null, 'a policy version is never edited; a change is a new version');
select throws_ok($$ update public.competitions set stages = '[{"key":"full","label":"Full proposal","anonymized":"yes"}]' where id = '13000000-0000-7000-8000-0000000000c2' $$,
  '23514', null, 'a stage''s anonymized setting is true or false');
update public.competitions set stages = '[{"key":"full","label":"Full proposal","anonymized":false}]' where id = '13000000-0000-7000-8000-0000000000c2';
select is((select stages -> 0 ->> 'anonymized' from public.competitions where id = '13000000-0000-7000-8000-0000000000c2'), 'false', 'a boolean anonymized setting is stored with the stage');

-- ---------------------------------------------------------------- reads as signed-in people
reset role;
set local role authenticated;

-- Staff: the admin and the auditor see every version and every signature of their workspace.
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.coi_policies), 3, 'the admin sees every policy version');
select is((select count(*)::int from public.coi_signatures), 2, 'the admin sees every signature (the conflicts register)');
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from public.coi_signatures), 2, 'the auditor sees the register');

-- The reviewer who signed sees the policy and only their own signature.
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.coi_policies), 3, 'a reviewer reads the policies they are asked to sign');
select is((select string_agg(signed_name, ',') from public.coi_signatures), 'Morgan Reviewer', 'a reviewer sees their own signature only');
select is((select declared_org_ids from public.coi_signatures), array['13000000-0000-7000-8000-000000000003']::uuid[], 'with the conflicts they declared');

-- A reviewer who has not signed sees no signature, not even the count of others.
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
select is((select count(*)::int from public.coi_signatures), 0, 'another reviewer sees no one else''s signature');
select is((select count(*)::int from public.coi_policies), 3, 'but reads the policies');

-- An external reviewer: the policy of their own competition, and their own signature.
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
select is((select string_agg(distinct competition_id::text, ',') from public.coi_policies), '13000000-0000-7000-8000-0000000000c1', 'an external reviewer reads only the policy of the competition they were invited to');
select is((select string_agg(signed_name, ',') from public.coi_signatures), 'Ellis External', 'and only their own signature');

-- The applicant and another funder see nothing.
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.coi_policies), 0, 'an applicant reads no policy');
select is((select count(*)::int from public.coi_signatures), 0, 'an applicant reads no signature, so never learns who declared a conflict with it');
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.coi_policies), 0, 'another funder reads no policy');
select is((select count(*)::int from public.coi_signatures), 0, 'another funder reads no signature');

-- Nobody signs through the data API: signing goes through the API, which checks the person.
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
select throws_ok($$ insert into public.coi_signatures (workspace_id, competition_id, reviewer_user_id, policy_version, signed_name) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-4000-8000-0000000000c2', 2, 'Two Reviewer') $$,
  '42501', null, 'a signed-in reviewer cannot write a signature directly');
select throws_ok($$ insert into public.coi_policies (workspace_id, competition_id, version, policy_text) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', 3, 'No') $$,
  '42501', null, 'nor a policy');
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select throws_ok($$ delete from public.coi_signatures $$, '42501', null, 'staff cannot delete signatures through the data API');

reset role;
set local role anon;
select throws_ok($$ select count(*) from public.coi_signatures $$, '42501', null, 'anon reads nothing');

select * from finish();
rollback;
