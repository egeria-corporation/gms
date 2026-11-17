-- The award kit, plus (0048): the federal share on awards (kept only while marked, numbers never
-- out of range), share-kit settings (a social page, consent to be tagged that needs a link, "funded
-- by" or "supported by" and never "sponsored"), one "Two weeks left" prompt per call that belongs to
-- the call's workspace, and posts about a program of the workspace's own. Writes run as the service
-- role; reads as the workspace's staff, a reviewer, another workspace and anon.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('48000000-0000-4000-8000-0000000000f1', 'admin@kit-funder.example', 'authenticated', 'authenticated'),
  ('48000000-0000-4000-8000-0000000000f2', 'reviewer@kit-funder.example', 'authenticated', 'authenticated'),
  ('48000000-0000-4000-8000-0000000000a1', 'admin@kit-grantee.example', 'authenticated', 'authenticated'),
  ('48000000-0000-4000-8000-0000000000b1', 'admin@kit-other.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('48000000-0000-7000-8000-000000000001', 'funder', 'kit-funder', 'Kit Funder'),
  ('48000000-0000-7000-8000-000000000002', 'applicant', 'kit-grantee', 'Kit Grantee'),
  ('48000000-0000-7000-8000-000000000003', 'funder', 'kit-other', 'Kit Other');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('48000000-0000-7000-8000-000000000001', '48000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('48000000-0000-7000-8000-000000000001', '48000000-0000-4000-8000-0000000000f2', 'reviewer', '{}'),
  ('48000000-0000-7000-8000-000000000002', '48000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('48000000-0000-7000-8000-000000000003', '48000000-0000-4000-8000-0000000000b1', 'admin', '{}');

insert into public.programs (id, workspace_id, name) values
  ('48000000-0000-7000-8000-0000000000d1', '48000000-0000-7000-8000-000000000001', 'Community Health'),
  ('48000000-0000-7000-8000-0000000000d3', '48000000-0000-7000-8000-000000000003', 'Their program');
insert into public.opportunities (id, workspace_id, slug, title) values
  ('48000000-0000-7000-8000-0000000000c1', '48000000-0000-7000-8000-000000000001', 'open-call', 'Open call'),
  ('48000000-0000-7000-8000-0000000000c3', '48000000-0000-7000-8000-000000000003', 'their-call', 'Their call');
-- An award made before 0048: it reads as not federally funded.
insert into public.awards (id, workspace_id, title, recipient_workspace_id) values
  ('48000000-0000-7000-8000-0000000000e1', '48000000-0000-7000-8000-000000000001', 'Award to grantee', '48000000-0000-7000-8000-000000000002');

-- ---------------------------------------------------------------- schema
select has_table('public', 'share_kit_profiles', 'share_kit_profiles exists');
select has_table('public', 'social_reminder_prompts', 'social_reminder_prompts exists');
select is((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.share_kit_profiles'::regclass, 'public.social_reminder_prompts'::regclass)), true, 'RLS is on for both tables');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('share_kit_profiles', 'social_reminder_prompts') and cmd <> 'SELECT'), 0, 'signed-in users get no write policy');
select results_eq(
  $$ select federally_funded, federal_amount, federal_percent, federal_source from public.awards where id = '48000000-0000-7000-8000-0000000000e1' $$,
  $$ values (false, null::numeric, null::numeric, null::text) $$,
  'an award made before 0048 is not marked federally funded'
);

-- ---------------------------------------------------------------- the federal share (service role)
set local role service_role;

update public.awards set federally_funded = true, federal_amount = 80000, federal_percent = 62.5, federal_source = 'U.S. Department of Health and Human Services' where id = '48000000-0000-7000-8000-0000000000e1';
select pass('a funder marks an award federally funded with both numbers');
update public.awards set federal_source = null, federal_percent = null where id = '48000000-0000-7000-8000-0000000000e1';
select pass('one number alone may be kept (the statement then does not appear)');
select throws_ok($$ update public.awards set federal_percent = 0 where id = '48000000-0000-7000-8000-0000000000e1' $$, '23514', null, 'a federal share of 0 percent is refused');
select throws_ok($$ update public.awards set federal_percent = 100.5 where id = '48000000-0000-7000-8000-0000000000e1' $$, '23514', null, 'a federal share above 100 percent is refused');
select throws_ok($$ update public.awards set federal_amount = -1 where id = '48000000-0000-7000-8000-0000000000e1' $$, '23514', null, 'a negative federal amount is refused');
select throws_ok($$ update public.awards set federally_funded = false where id = '48000000-0000-7000-8000-0000000000e1' $$, '23514', null, 'the numbers are kept only while the award is marked');
update public.awards set federally_funded = false, federal_amount = null, federal_percent = null, federal_source = null where id = '48000000-0000-7000-8000-0000000000e1';
select pass('unmarking clears the numbers with it');

-- ---------------------------------------------------------------- share-kit settings
insert into public.share_kit_profiles (workspace_id, page_url, tag_consent, consented_at, consented_by) values
  ('48000000-0000-7000-8000-000000000002', 'https://www.linkedin.com/company/kit-grantee', true, now(), '48000000-0000-4000-8000-0000000000a1');
insert into public.share_kit_profiles (workspace_id, credit_wording, standard_description) values
  ('48000000-0000-7000-8000-000000000001', 'supported_by', 'Kit Funder supports community health in the valley.');
select is((select credit_wording from public.share_kit_profiles where workspace_id = '48000000-0000-7000-8000-000000000002'), 'funded_by', 'credit wording defaults to "funded by"');
select throws_ok($$ update public.share_kit_profiles set credit_wording = 'sponsored_by' where workspace_id = '48000000-0000-7000-8000-000000000001' $$, '23514', null, '"sponsored" is never a credit wording');
select throws_ok($$ update public.share_kit_profiles set tag_consent = true, consented_at = now() where workspace_id = '48000000-0000-7000-8000-000000000001' $$, '23514', null, 'consent to be tagged needs a page link');
select throws_ok($$ update public.share_kit_profiles set page_url = 'http://example.org/page' where workspace_id = '48000000-0000-7000-8000-000000000001' $$, '23514', null, 'a page link is https');
select throws_ok($$ update public.share_kit_profiles set tag_consent = false where workspace_id = '48000000-0000-7000-8000-000000000002' $$, '23514', null, 'withdrawing consent clears when it was given');
select throws_ok($$ insert into public.share_kit_profiles (workspace_id) values ('48000000-0000-7000-8000-000000000002') $$, '23505', null, 'one row per workspace');

-- ---------------------------------------------------------------- the reminder prompt
insert into public.social_reminder_prompts (workspace_id, opportunity_id, deadline) values
  ('48000000-0000-7000-8000-000000000001', '48000000-0000-7000-8000-0000000000c1', '2027-06-30');
select throws_ok(
  $$ insert into public.social_reminder_prompts (workspace_id, opportunity_id, deadline) values ('48000000-0000-7000-8000-000000000001', '48000000-0000-7000-8000-0000000000c1', '2027-07-15') $$,
  '23505', null, 'one prompt per call, even when its deadline moves'
);
select throws_ok(
  $$ insert into public.social_reminder_prompts (workspace_id, opportunity_id, deadline) values ('48000000-0000-7000-8000-000000000001', '48000000-0000-7000-8000-0000000000c3', '2027-06-30') $$,
  '23514', null, 'a prompt is never made for another workspace''s call'
);
select throws_ok(
  $$ update public.social_reminder_prompts set dismissed_at = now() where opportunity_id = '48000000-0000-7000-8000-0000000000c1' $$,
  '23514', null, 'a dismissal says who dismissed it'
);
update public.social_reminder_prompts set dismissed_at = now(), dismissed_by = '48000000-0000-4000-8000-0000000000f1' where opportunity_id = '48000000-0000-7000-8000-0000000000c1';
select pass('a funder admin dismisses the prompt');

-- ---------------------------------------------------------------- posts about a program
insert into public.social_accounts (id, workspace_id, zernio_id, platform, connected_at) values
  ('48000000-0000-7000-8000-0000000000a9', '48000000-0000-7000-8000-000000000001', 'acc_kit1', 'linkedin', now());
insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, targets, created_by) values
  ('48000000-0000-7000-8000-000000000001', 'program', '48000000-0000-7000-8000-0000000000d1', '48000000-0000-4000-8000-00000000aa01', repeat('a', 64), array['linkedin'], '[{"accountId":"48000000-0000-7000-8000-0000000000a9","platform":"linkedin","status":"sending"}]', '48000000-0000-4000-8000-0000000000f1');
select pass('a funder posts about one of its programs ("Meet our grantees")');
select throws_ok(
  $$ insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, targets, created_by) values ('48000000-0000-7000-8000-000000000001', 'program', '48000000-0000-7000-8000-0000000000d3', '48000000-0000-4000-8000-00000000aa02', repeat('b', 64), array['linkedin'], '[]', '48000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'never about another workspace''s program'
);
select throws_ok(
  $$ insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, targets, created_by) values ('48000000-0000-7000-8000-000000000001', 'fund', '48000000-0000-7000-8000-0000000000d1', '48000000-0000-4000-8000-00000000aa03', repeat('c', 64), array['linkedin'], '[]', '48000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a subject is still an opportunity, an award or a program'
);

-- ---------------------------------------------------------------- what signed-in people see
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"48000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select results_eq($$ select workspace_id::text from public.share_kit_profiles $$, $$ values ('48000000-0000-7000-8000-000000000001') $$, 'a funder admin reads its own share-kit settings, not the grantee''s');
select is((select count(*)::int from public.social_reminder_prompts), 1, 'a funder admin reads its prompts');
select throws_ok($$ update public.social_reminder_prompts set dismissed_at = null, dismissed_by = null $$, '42501', null, 'a person cannot write a prompt directly: the API does');

select set_config('request.jwt.claims', '{"sub":"48000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from public.social_reminder_prompts) + (select count(*)::int from public.share_kit_profiles), 0, 'a reviewer reads neither');

select set_config('request.jwt.claims', '{"sub":"48000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.social_reminder_prompts) + (select count(*)::int from public.share_kit_profiles), 0, 'another workspace reads neither');

reset role;
set local role anon;
select throws_ok($$ select * from public.share_kit_profiles $$, '42501', null, 'a visitor reads nothing');

select * from finish();
rollback;
