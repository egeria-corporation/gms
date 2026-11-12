-- A workspace without Passport keeps a self-declared profile (0026). The database bounds what the
-- API validates: the source vocabulary, a profile only when the source says so, the allowed keys,
-- and no grant that lets a signed-in user write either column.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

select has_column('public', 'workspaces', 'profile_source', 'workspaces.profile_source exists');
select has_column('public', 'workspaces', 'self_declared_profile', 'workspaces.self_declared_profile exists');
select col_default_is('public', 'workspaces', 'profile_source', 'none', 'a new workspace has no profile');

insert into public.workspaces (id, kind, handle, display_name, profile_source, self_declared_profile) values
  ('7b000000-0000-4000-8000-000000000001', 'applicant', 'sd-ok', 'Self declared', 'self_declared',
   '{"legalName":"Lakeside Pantry Inc.","contactEmail":"office@lakeside.example","ein":"123456789","address":{"city":"Duluth","country":"US"}}');
select is((select profile_source from public.workspaces where id = '7b000000-0000-4000-8000-000000000001'), 'self_declared', 'a self-declared profile is stored');

select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source) values ('applicant', 'sd-bad-source', 'X', 'verified') $$,
  '23514', null, 'an unknown source is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source) values ('applicant', 'sd-no-org', 'X', 'passport') $$,
  '23514', null, 'passport as the source needs a Passport organization');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source) values ('applicant', 'sd-empty', 'X', 'self_declared') $$,
  '23514', null, 'self_declared needs a profile');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, self_declared_profile) values ('applicant', 'sd-stray', 'X', '{"legalName":"X"}') $$,
  '23514', null, 'a profile without the self_declared source is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-key', 'X', 'self_declared', '{"legalName":"X","taxpayerNumber":"1"}') $$,
  '23514', null, 'a key outside the profile shape is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-ein', 'X', 'self_declared', '{"legalName":"X","ein":"12-3456789"}') $$,
  '23514', null, 'an EIN that is not nine digits is refused');
select throws_ok($$ insert into public.workspaces (kind, handle, display_name, profile_source, self_declared_profile) values ('applicant', 'sd-big', 'X', 'self_declared', jsonb_build_object('legalName', 'X', 'mission', (select string_agg(md5(i::text), '') from generate_series(1, 1000) i))) $$,
  '23514', null, 'an oversized profile is refused');

-- The backfill of 0026, run again on a row that carries a Passport id.
insert into public.workspaces (id, kind, handle, display_name, passport_org_id) values
  ('7b000000-0000-4000-8000-000000000002', 'applicant', 'sd-linked', 'Linked', '7b900000-0000-4000-8000-000000000002');
update public.workspaces set profile_source = 'passport' where passport_org_id is not null and id = '7b000000-0000-4000-8000-000000000002';
select is((select profile_source from public.workspaces where id = '7b000000-0000-4000-8000-000000000002'), 'passport', 'a workspace with a Passport organization reads its profile from Passport');

select ok(not has_column_privilege('authenticated', 'public.workspaces', 'self_declared_profile', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.workspaces', 'profile_source', 'UPDATE'),
  'a signed-in user cannot write the profile columns directly');

select * from finish();
rollback;
