-- A workspace without Passport keeps a self-declared profile (0026). The database bounds what the
-- API validates: the source vocabulary, a profile only when the source says so, Passport data only
-- with a Passport organization, the allowed keys and their types, an organization's EIN, and no
-- grant that lets a signed-in user write either column. (0026 run over rows that existed before it
-- is checked on a scratch database: migrations through 0025, stale rows, then 0026.)
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

select has_column('public', 'workspaces', 'profile_source', 'workspaces.profile_source exists');
select has_column('public', 'workspaces', 'self_declared_profile', 'workspaces.self_declared_profile exists');
select col_default_is('public', 'workspaces', 'profile_source', 'none', 'a new workspace has no profile');

insert into public.workspaces (id, kind, handle, display_name, profile_source, self_declared_profile) values
  ('7b000000-0000-4000-8000-000000000001', 'applicant', 'sd-ok', 'Self declared', 'self_declared',
   '{"legalName":"Lakeside Pantry Inc.","contactEmail":"office@lakeside.example","ein":"123456789","address":{"city":"Duluth","country":"US"}}');
select is((select profile_source from public.workspaces where id = '7b000000-0000-4000-8000-000000000001'), 'self_declared', 'a self-declared profile is stored');

-- The source and the Passport organization go together.
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source) values ('applicant', 'sd-bad-source', 'X', 'verified') $$,
  '23514', null, 'an unknown source is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source) values ('applicant', 'sd-no-org', 'X', 'passport') $$,
  '23514', null, 'passport as the source needs a Passport organization');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, passport_org_id) values ('applicant', 'sd-org-none', 'X', '7b900000-0000-4000-8000-000000000009') $$,
  '23514', null, 'a Passport organization makes Passport the source');
select throws_ok($$ update public.workspaces set passport_org_id = '7b900000-0000-4000-8000-000000000008' where id = '7b000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a self-declared workspace cannot carry a Passport organization beside its profile');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, verification_level) values ('applicant', 'sd-level', 'X', 'L3') $$,
  '23514', null, 'a Passport level needs a Passport organization');

-- A profile exists exactly with the self_declared source.
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source) values ('applicant', 'sd-empty', 'X', 'self_declared') $$,
  '23514', null, 'self_declared needs a profile');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, self_declared_profile) values ('applicant', 'sd-stray', 'X', '{"legalName":"X"}') $$,
  '23514', null, 'a profile without the self_declared source is refused');

-- The shape.
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-key', 'X', 'self_declared', '{"legalName":"X","taxpayerNumber":"1"}') $$,
  '23514', null, 'a key outside the profile shape is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-ein', 'X', 'self_declared', '{"legalName":"X","ein":"12-3456789"}') $$,
  '23514', null, 'an EIN that is not nine digits is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-ein-prefix', 'X', 'self_declared', '{"legalName":"X","ein":"071234567"}') $$,
  '23514', null, 'an EIN with a prefix the IRS never assigns is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-ein-person', 'X', 'self_declared', '{"legalName":"X","orgType":"individual","ein":"123456789"}') $$,
  '23514', null, 'an individual cannot give an EIN (it would be a Social Security number)');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-email', 'X', 'self_declared', '{"legalName":"X","contactEmail":{"to":"a@b.example"}}') $$,
  '23514', null, 'a contact address that is not a string is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-mission', 'X', 'self_declared', '{"legalName":"X","mission":["a"]}') $$,
  '23514', null, 'a mission that is not a string is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-big', 'X', 'self_declared', jsonb_build_object('legalName', 'X', 'mission', (select string_agg(md5(i::text), '') from generate_series(1, 1000) i))) $$,
  '23514', null, 'an oversized profile is refused');

-- A workspace with a Passport organization.
insert into public.workspaces (id, kind, handle, display_name, passport_org_id, profile_source, verification_level) values
  ('7b000000-0000-4000-8000-000000000002', 'applicant', 'sd-linked', 'Linked', '7b900000-0000-4000-8000-000000000002', 'passport', 'L2');
select is((select profile_source from public.workspaces where id = '7b000000-0000-4000-8000-000000000002'), 'passport', 'a workspace with a Passport organization reads its profile from Passport');
select throws_ok($$ update public.workspaces set passport_org_id = null where id = '7b000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'releasing the organization must release its source and level too');

-- No new way in for a signed-in user.
select ok(not has_table_privilege('authenticated', 'public.workspaces', 'INSERT'), 'a signed-in user cannot insert workspaces');
select ok(not has_column_privilege('authenticated', 'public.workspaces', 'self_declared_profile', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.workspaces', 'profile_source', 'UPDATE'),
  'a signed-in user cannot write the profile columns directly');
select ok(not has_table_privilege('anon', 'public.workspaces', 'SELECT'), 'anonymous callers read no workspace');
-- Reading stays under the existing workspaces_select policy (members, consented funders, related
-- funders); the self-declared profile is visible to exactly those, as the cached Passport record is.
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'workspaces'), 1, 'workspaces keep their one select policy');

select * from finish();
rollback;
