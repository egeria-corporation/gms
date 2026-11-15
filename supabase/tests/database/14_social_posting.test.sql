-- Social posting through Zernio (0038): profiles, accounts and posts are private to the workspace
-- that posts (its staff only); a post's subject and accounts belong to its workspace; nothing but
-- ids, platforms, usernames, links, statuses and counts is stored; Zernio deliveries are deduped.
-- Writes run as the service role (the API's role); reads are checked as signed-in members of the
-- owning workspace, another workspace, a consultant, and anon.
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('14000000-0000-4000-8000-0000000000f1', 'admin@soc-funder.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000f2', 'reviewer@soc-funder.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000a1', 'admin@soc-grantee.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000a2', 'writer@soc-consultants.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000b1', 'admin@soc-other.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('14000000-0000-7000-8000-000000000001', 'funder', 'soc-funder', 'Social Funder'),
  ('14000000-0000-7000-8000-000000000002', 'applicant', 'soc-grantee', 'Social Grantee'),
  ('14000000-0000-7000-8000-000000000003', 'funder', 'soc-other', 'Social Other');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('14000000-0000-7000-8000-000000000001', '14000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('14000000-0000-7000-8000-000000000001', '14000000-0000-4000-8000-0000000000f2', 'reviewer', '{}'),
  ('14000000-0000-7000-8000-000000000002', '14000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('14000000-0000-7000-8000-000000000002', '14000000-0000-4000-8000-0000000000a2', 'consultant', '{"outsideApplicationIds":[]}'),
  ('14000000-0000-7000-8000-000000000003', '14000000-0000-4000-8000-0000000000b1', 'admin', '{}');

insert into public.opportunities (id, workspace_id, slug, title) values
  ('14000000-0000-7000-8000-0000000000c1', '14000000-0000-7000-8000-000000000001', 'open-call', 'Open call'),
  ('14000000-0000-7000-8000-0000000000c3', '14000000-0000-7000-8000-000000000003', 'their-call', 'Their call');
insert into public.awards (id, workspace_id, title, recipient_workspace_id) values
  ('14000000-0000-7000-8000-0000000000e1', '14000000-0000-7000-8000-000000000001', 'Award to grantee', '14000000-0000-7000-8000-000000000002');

-- ---------------------------------------------------------------- schema
select has_table('public', 'social_profiles', 'social_profiles exists');
select has_table('public', 'social_accounts', 'social_accounts exists');
select has_table('public', 'social_posts', 'social_posts exists');
select is((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.social_profiles'::regclass, 'public.social_accounts'::regclass, 'public.social_posts'::regclass)), true, 'RLS is on for all three tables');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('social_profiles', 'social_accounts', 'social_posts') and cmd <> 'SELECT'), 0, 'signed-in users get no write policy');
select is_empty(
  $$ select column_name from information_schema.columns where table_schema = 'public' and table_name in ('social_profiles', 'social_accounts', 'social_posts') and column_name ~* '(token|secret|content|message|follower|body)' $$,
  'no column holds a token, a post''s text, an inbox message or a follower list'
);

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

insert into public.social_profiles (workspace_id, zernio_profile_id) values
  ('14000000-0000-7000-8000-000000000001', 'prof_funder1'),
  ('14000000-0000-7000-8000-000000000002', 'prof_grantee1'),
  ('14000000-0000-7000-8000-000000000003', 'prof_other1');
select pass('one Zernio profile per workspace');
select throws_ok(
  $$ insert into public.social_profiles (workspace_id, zernio_profile_id) values ('14000000-0000-7000-8000-000000000001', 'prof_second') $$,
  '23505', null, 'a workspace has one profile'
);
select throws_ok(
  $$ insert into public.social_profiles (workspace_id, zernio_profile_id) values ('14000000-0000-7000-8000-000000000001', 'not an id') $$,
  '23514', null, 'a profile id is a Zernio id'
);

insert into public.social_accounts (id, workspace_id, zernio_id, platform, username) values
  ('14000000-0000-7000-8000-0000000000a1', '14000000-0000-7000-8000-000000000001', 'acc_li_funder', 'linkedin', 'social-funder'),
  ('14000000-0000-7000-8000-0000000000a2', '14000000-0000-7000-8000-000000000002', 'acc_bs_grantee', 'bluesky', 'grantee.bsky.social'),
  ('14000000-0000-7000-8000-0000000000a3', '14000000-0000-7000-8000-000000000003', 'acc_x_other', 'twitter', 'other');
select pass('accounts are recorded by Zernio id, platform and username');
select throws_ok(
  $$ insert into public.social_accounts (workspace_id, zernio_id, platform) values ('14000000-0000-7000-8000-000000000003', 'acc_li_funder', 'linkedin') $$,
  '23505', null, 'one Zernio account belongs to one workspace'
);
select throws_ok(
  $$ insert into public.social_accounts (workspace_id, zernio_id, platform) values ('14000000-0000-7000-8000-000000000001', 'acc_tt', 'tiktok') $$,
  '23514', null, 'only the six platforms'
);
select throws_ok(
  $$ update public.social_accounts set status = 'disconnected' where id = '14000000-0000-7000-8000-0000000000a1' $$,
  '23514', null, 'a disconnected account says when'
);
update public.social_accounts set status = 'disconnected', disconnected_at = now() where id = '14000000-0000-7000-8000-0000000000a3';
select pass('an account is disconnected with its time');

insert into public.social_posts (id, workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, zernio_post_id, platforms, targets, status, created_by) values
  ('14000000-0000-7000-8000-0000000000d1', '14000000-0000-7000-8000-000000000001', 'opportunity', '14000000-0000-7000-8000-0000000000c1', '14000000-0000-4000-8000-000000000001', repeat('a', 64), 'post_1', '{linkedin}',
   '[{"accountId":"14000000-0000-7000-8000-0000000000a1","platform":"linkedin","username":"social-funder","status":"published","url":"https://www.linkedin.com/feed/update/1"}]', 'published', '14000000-0000-4000-8000-0000000000f1'),
  ('14000000-0000-7000-8000-0000000000d2', '14000000-0000-7000-8000-000000000002', 'award', '14000000-0000-7000-8000-0000000000e1', '14000000-0000-4000-8000-000000000002', repeat('b', 64), null, '{bluesky}',
   '[{"accountId":"14000000-0000-7000-8000-0000000000a2","platform":"bluesky","status":"sending"}]', 'sending', '14000000-0000-4000-8000-0000000000a1');
select pass('a funder posts about its call and a grantee about its award');
select throws_ok(
  $$ insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, created_by) values ('14000000-0000-7000-8000-000000000001', 'opportunity', '14000000-0000-7000-8000-0000000000c1', '14000000-0000-4000-8000-000000000001', repeat('c', 64), '{linkedin}', '14000000-0000-4000-8000-0000000000f1') $$,
  '23505', null, 'one post per workspace and Idempotency-Key'
);
select throws_ok(
  $$ insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, created_by) values ('14000000-0000-7000-8000-000000000001', 'opportunity', '14000000-0000-7000-8000-0000000000c3', gen_random_uuid(), repeat('c', 64), '{linkedin}', '14000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a workspace cannot post about another workspace''s call'
);
select throws_ok(
  $$ insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, created_by) values ('14000000-0000-7000-8000-000000000003', 'award', '14000000-0000-7000-8000-0000000000e1', gen_random_uuid(), repeat('c', 64), '{twitter}', '14000000-0000-4000-8000-0000000000b1') $$,
  '23514', null, 'nor about an award it neither made nor received'
);
select throws_ok(
  $$ insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, targets, created_by) values ('14000000-0000-7000-8000-000000000001', 'opportunity', '14000000-0000-7000-8000-0000000000c1', gen_random_uuid(), repeat('c', 64), '{twitter}', '[{"accountId":"14000000-0000-7000-8000-0000000000a3","platform":"twitter","status":"sending"}]', '14000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a post never names another workspace''s account'
);
select throws_ok(
  $$ update public.social_posts set targets = '[{"accountId":"14000000-0000-7000-8000-0000000000a1","platform":"linkedin","status":"published","accessToken":"x"}]' where id = '14000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'a post''s outcome per account holds ids, status and link only'
);
select throws_ok(
  $$ update public.social_posts set metrics = '{"impressions":10,"followers":["a"]}' where id = '14000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'counts only: no follower list'
);
update public.social_posts set metrics = '{"impressions":120,"clicks":7,"engagements":null}', metrics_at = now() where id = '14000000-0000-7000-8000-0000000000d1';
select pass('counts are stored');
select throws_ok(
  $$ update public.social_posts set status = 'deleted' where id = '14000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'post statuses are the five'
);
select throws_ok(
  $$ update public.social_posts set workspace_id = '14000000-0000-7000-8000-000000000003' where id = '14000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'a post cannot move to another workspace'
);

insert into public.inbound_events (provider, external_id, type, payload) values ('zernio', 'evt_1', 'post.published', '{"postId":"post_1"}');
select pass('verified Zernio deliveries are stored');
select throws_ok(
  $$ insert into public.inbound_events (provider, external_id, type, payload) values ('zernio', 'evt_1', 'post.published', '{}') $$,
  '23505', null, 'and a replayed delivery is refused'
);
reset role;

-- ---------------------------------------------------------------- who reads
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.social_posts), 1, 'a funder admin reads the workspace''s posts and no other');
select throws_ok(
  $$ insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, created_by) values ('14000000-0000-7000-8000-000000000001', 'opportunity', '14000000-0000-7000-8000-0000000000c1', gen_random_uuid(), repeat('c', 64), '{linkedin}', '14000000-0000-4000-8000-0000000000f1') $$,
  '42501', null, 'a member cannot post directly'
);

select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from public.social_accounts), 0, 'a reviewer reads no accounts');

select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.social_posts), 0, 'a consultant reads no posts');

select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.social_accounts where workspace_id <> '14000000-0000-7000-8000-000000000003'), 0, 'another workspace reads only its own accounts');
reset role;

set local role anon;
select throws_ok($$ select count(*) from public.social_posts $$, '42501', null, 'anon reads nothing');
reset role;

select * from finish();
rollback;
