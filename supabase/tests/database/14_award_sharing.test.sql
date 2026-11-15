-- Award sharing (0037): the confidential flag and the program default, the grantee's "Don't list
-- us publicly", the public slug, and the copy of the open-data exclusions. Writes run as the
-- service role (the API's role); reads are checked as the funder's staff, the recipient's staff, a
-- reviewer, another workspace, and anon. What is shown publicly is decided in the API
-- (services/award-sharing.ts); here the columns stay members-only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('14000000-0000-4000-8000-0000000000f1', 'admin@share-funder.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000f2', 'reviewer@share-funder.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000a1', 'admin@share-grantee.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000b1', 'admin@share-other.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name, settings) values
  ('14000000-0000-7000-8000-000000000001', 'funder', 'share-funder', 'Share Funder', '{}'),
  ('14000000-0000-7000-8000-000000000002', 'applicant', 'share-grantee', 'Share Grantee', '{}'),
  ('14000000-0000-7000-8000-000000000003', 'funder', 'share-other', 'Share Other', '{}');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('14000000-0000-7000-8000-000000000001', '14000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('14000000-0000-7000-8000-000000000001', '14000000-0000-4000-8000-0000000000f2', 'reviewer', '{}'),
  ('14000000-0000-7000-8000-000000000002', '14000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('14000000-0000-7000-8000-000000000003', '14000000-0000-4000-8000-0000000000b1', 'admin', '{}');

insert into public.programs (id, workspace_id, name, awards_confidential) values
  ('14000000-0000-7000-8000-0000000000c1', '14000000-0000-7000-8000-000000000001', 'Quiet program', true),
  ('14000000-0000-7000-8000-0000000000c2', '14000000-0000-7000-8000-000000000001', 'Open program', false);

-- ---------------------------------------------------------------- schema
select col_not_null('public', 'awards', 'confidential', 'awards.confidential is not null');
select col_default_is('public', 'awards', 'confidential', 'false', 'awards are not confidential unless set');
select col_not_null('public', 'awards', 'recipient_unlisted', 'awards.recipient_unlisted is not null');
select col_default_is('public', 'awards', 'recipient_unlisted', 'false', 'a grantee has made no choice until it does');
select col_not_null('public', 'awards', 'public_slug', 'every award has a public slug');
select col_not_null('public', 'programs', 'awards_confidential', 'programs.awards_confidential is not null');
select col_default_is('public', 'programs', 'awards_confidential', 'false', 'a program makes awards confidential only when set');
select has_trigger('public', 'awards', 'awards_confidential_default', 'new awards take the program default');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

insert into public.awards (id, workspace_id, recipient_workspace_id, title, status, program_id) values
  ('14000000-0000-7000-8000-0000000000d1', '14000000-0000-7000-8000-000000000001', '14000000-0000-7000-8000-000000000002', 'In the quiet program', 'active', '14000000-0000-7000-8000-0000000000c1'),
  ('14000000-0000-7000-8000-0000000000d2', '14000000-0000-7000-8000-000000000001', '14000000-0000-7000-8000-000000000002', 'In the open program', 'active', '14000000-0000-7000-8000-0000000000c2'),
  ('14000000-0000-7000-8000-0000000000d3', '14000000-0000-7000-8000-000000000001', '14000000-0000-7000-8000-000000000002', 'No program', 'accepted', null),
  ('14000000-0000-7000-8000-0000000000d4', '14000000-0000-7000-8000-000000000003', '14000000-0000-7000-8000-000000000002', 'Another funder', 'active', null);

select is((select confidential from public.awards where id = '14000000-0000-7000-8000-0000000000d1'), true, 'an award in a program whose awards are confidential starts confidential');
select is((select confidential from public.awards where id = '14000000-0000-7000-8000-0000000000d2'), false, 'an award in a program without the default does not');
select is((select confidential from public.awards where id = '14000000-0000-7000-8000-0000000000d3'), false, 'an award with no program does not');
insert into public.awards (id, workspace_id, recipient_workspace_id, title, status, program_id, confidential) values
  ('14000000-0000-7000-8000-0000000000d5', '14000000-0000-7000-8000-000000000001', '14000000-0000-7000-8000-000000000002', 'Set by the funder', 'active', '14000000-0000-7000-8000-0000000000c2', true);
select is((select confidential from public.awards where id = '14000000-0000-7000-8000-0000000000d5'), true, 'the funder can make any award confidential from the start');

update public.programs set awards_confidential = false where id = '14000000-0000-7000-8000-0000000000c1';
select is((select confidential from public.awards where id = '14000000-0000-7000-8000-0000000000d1'), true, 'changing the program default leaves awards already made as they are');

select ok((select bool_and(public_slug ~ '^[0-9a-f]{12}$') from public.awards where id::text like '14000000%'), 'each award gets a random 12-character slug');
select is((select count(distinct public_slug)::int from public.awards where id::text like '14000000%'), 5, 'no two awards share a slug');
select throws_ok(
  $$ update public.awards set public_slug = (select public_slug from public.awards where id = '14000000-0000-7000-8000-0000000000d2') where id = '14000000-0000-7000-8000-0000000000d3' $$,
  '23505', null, 'a slug names one award'
);
select throws_ok(
  $$ update public.awards set public_slug = 'Not A Slug!' where id = '14000000-0000-7000-8000-0000000000d3' $$,
  '23514', null, 'a slug is lowercase letters and digits only'
);

update public.awards set recipient_unlisted = true where id = '14000000-0000-7000-8000-0000000000d3';
select is((select recipient_unlisted from public.awards where id = '14000000-0000-7000-8000-0000000000d3'), true, 'the grantee''s choice to stay unlisted is kept on the award');

-- ---------------------------------------------------------------- open-data exclusions
update public.workspaces
   set settings = '{"openData":{"excludedAwardIds":["14000000-0000-7000-8000-0000000000d2","AWD_14000000-0000-7000-8000-0000000000D3","14000000-0000-7000-8000-0000000000d4",7,"nope"]}}'
 where id = '14000000-0000-7000-8000-000000000001';
select is(gms.confidential_from_open_data(), 2, 'the copy marks the excluded awards of the workspace (bare or prefixed ids)');
select is((select array_agg(id::text order by id) from public.awards where id::text like '14000000%' and confidential),
          array['14000000-0000-7000-8000-0000000000d1', '14000000-0000-7000-8000-0000000000d2', '14000000-0000-7000-8000-0000000000d3', '14000000-0000-7000-8000-0000000000d5'],
          'another funder''s award listed in this workspace''s setting is left alone');
select is(gms.confidential_from_open_data(), 0, 'running the copy again changes nothing');
update public.workspaces set settings = '{"openData":{"excludedAwardIds":{"not":"a list"}}}' where id = '14000000-0000-7000-8000-000000000003';
select lives_ok($$ select gms.confidential_from_open_data() $$, 'a value that is not a list is ignored');
reset role;

-- ---------------------------------------------------------------- who reads the new columns
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.awards where id::text like '14000000%' and confidential), 4, 'the funder''s staff read the confidential flag on its awards');
select is((select awards_confidential from public.programs where id = '14000000-0000-7000-8000-0000000000c2'), false, 'the funder''s staff read the program default');
select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select recipient_unlisted from public.awards where id = '14000000-0000-7000-8000-0000000000d3'), true, 'the recipient''s staff read their own choice');
select is((select count(*)::int from public.programs where id::text like '14000000%'), 0, 'the recipient does not read the funder''s programs');
select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from public.awards where id::text like '14000000%'), 0, 'a reviewer does not read awards');
select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.awards where id::text like '14000000%' and workspace_id = '14000000-0000-7000-8000-000000000001'), 0, 'another workspace reads none of them');
select ok(not has_column_privilege('authenticated', 'public.awards', 'confidential', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.awards', 'recipient_unlisted', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.programs', 'awards_confidential', 'UPDATE'),
          'signed-in users cannot write the flags directly; the API does');
reset role;

select ok(not has_table_privilege('anon', 'public.awards', 'SELECT'), 'anon reads no awards');
select ok(not has_function_privilege('authenticated', 'gms.confidential_from_open_data()', 'EXECUTE')
          and not has_function_privilege('anon', 'gms.confidential_from_open_data()', 'EXECUTE')
          and not has_function_privilege('authenticated', 'gms.new_public_slug()', 'EXECUTE'),
          'only the service role runs the new functions');

select * from finish();
rollback;
