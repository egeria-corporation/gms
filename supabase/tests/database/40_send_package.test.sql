-- Send to the funder (0040): package_sends is private to the applicant workspace that owns the
-- outside application. Writes run as the service role (the API's role); reads are checked as
-- signed-in members of the owning workspace, another applicant, a funder and a consultant.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('40000000-0000-4000-8000-0000000000a1', 'admin@pkg-applicant-x.example',  'authenticated', 'authenticated'),
  ('40000000-0000-4000-8000-0000000000a2', 'viewer@pkg-applicant-x.example', 'authenticated', 'authenticated'),
  ('40000000-0000-4000-8000-0000000000a3', 'writer@pkg-consultants.example', 'authenticated', 'authenticated'),
  ('40000000-0000-4000-8000-0000000000b1', 'admin@pkg-applicant-y.example',  'authenticated', 'authenticated'),
  ('40000000-0000-4000-8000-0000000000f1', 'admin@pkg-funder.example',       'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('40000000-0000-7000-8000-000000000001', 'applicant', 'pkg-applicant-x', 'Package Applicant X'),
  ('40000000-0000-7000-8000-000000000002', 'applicant', 'pkg-applicant-y', 'Package Applicant Y'),
  ('40000000-0000-7000-8000-000000000003', 'funder',    'pkg-funder',      'Package Funder');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('40000000-0000-7000-8000-000000000001', '40000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('40000000-0000-7000-8000-000000000001', '40000000-0000-4000-8000-0000000000a2', 'viewer', '{}'),
  ('40000000-0000-7000-8000-000000000001', '40000000-0000-4000-8000-0000000000a3', 'consultant', '{"applicationIds":[]}'),
  ('40000000-0000-7000-8000-000000000002', '40000000-0000-4000-8000-0000000000b1', 'admin', '{}'),
  ('40000000-0000-7000-8000-000000000003', '40000000-0000-4000-8000-0000000000f1', 'admin', '{}');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

insert into public.outside_applications (id, workspace_id, title, funder_name) values
  ('40000000-0000-7000-8000-0000000000a1', '40000000-0000-7000-8000-000000000001', 'Rural clinics 2027', 'Northwind Family Foundation'),
  ('40000000-0000-7000-8000-0000000000b1', '40000000-0000-7000-8000-000000000002', 'Y''s application', 'Northwind Family Foundation');

insert into public.package_sends (workspace_id, outside_application_id, day, slot, sent_by, to_masked, package_sha256, attachment_count, sent_at) values
  ('40000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-0000000000a1', '2027-04-20', 1, '40000000-0000-4000-8000-0000000000a1', 'l…@northwind.example', repeat('a', 64), 2, now()),
  ('40000000-0000-7000-8000-000000000002', '40000000-0000-7000-8000-0000000000b1', '2027-04-20', 1, '40000000-0000-4000-8000-0000000000b1', 'l…@northwind.example', repeat('b', 64), 0, now());
select pass('the service role records a send');

select throws_ok(
  $$ insert into public.package_sends (workspace_id, outside_application_id, day, slot, sent_by, to_masked, package_sha256, attachment_count)
     values ('40000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-0000000000a1', '2027-04-20', 1, '40000000-0000-4000-8000-0000000000a1', 'l…@northwind.example', repeat('c', 64), 0) $$,
  '23505', null, 'one application cannot take the same place twice on one day'
);
select lives_ok(
  $$ insert into public.package_sends (workspace_id, outside_application_id, day, slot, sent_by, to_masked, package_sha256, attachment_count)
     values ('40000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-0000000000a1', '2027-04-21', 1, '40000000-0000-4000-8000-0000000000a1', 'l…@northwind.example', repeat('c', 64), 0) $$,
  'the next day starts again at the first place'
);
select throws_ok(
  $$ insert into public.package_sends (workspace_id, outside_application_id, day, slot, sent_by, to_masked, package_sha256, attachment_count)
     values ('40000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-0000000000b1', '2027-04-20', 2, '40000000-0000-4000-8000-0000000000a1', 'l…@northwind.example', repeat('c', 64), 0) $$,
  '23514', null, 'a send cannot name another workspace''s outside application'
);
select throws_ok(
  $$ insert into public.package_sends (workspace_id, outside_application_id, day, slot, sent_by, to_masked, package_sha256, attachment_count)
     values ('40000000-0000-7000-8000-000000000003', '40000000-0000-7000-8000-0000000000a1', '2027-04-20', 3, '40000000-0000-4000-8000-0000000000f1', 'l…@northwind.example', repeat('c', 64), 0) $$,
  '23514', null, 'sends belong to applicant workspaces'
);
select throws_ok(
  $$ insert into public.package_sends (workspace_id, outside_application_id, day, slot, sent_by, to_masked, package_sha256, attachment_count)
     values ('40000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-0000000000a1', '2027-04-20', 4, '40000000-0000-4000-8000-0000000000a1', 'lee@northwind.example', repeat('c', 64), 0) $$,
  '23514', null, 'the recipient is stored masked only'
);
select throws_ok(
  $$ insert into public.package_sends (workspace_id, outside_application_id, day, slot, sent_by, to_masked, package_sha256, attachment_count)
     values ('40000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-0000000000a1', '2027-04-20', 0, '40000000-0000-4000-8000-0000000000a1', 'l…@northwind.example', repeat('c', 64), 0) $$,
  '23514', null, 'places start at one'
);
select throws_ok(
  $$ update public.package_sends set workspace_id = '40000000-0000-7000-8000-000000000002' where outside_application_id = '40000000-0000-7000-8000-0000000000a1' $$,
  null, null, 'a send never moves to another workspace'
);

-- ---------------------------------------------------------------- signed-in people read
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.package_sends), 2, 'a viewer of the workspace reads its sends');
select is((select count(*)::int from public.package_sends where workspace_id <> '40000000-0000-7000-8000-000000000001'), 0, 'and no other workspace''s');

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.package_sends where workspace_id = '40000000-0000-7000-8000-000000000001'), 0, 'another applicant reads none of them');

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.package_sends), 0, 'a funder reads none');

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is((select count(*)::int from public.package_sends), 0, 'a consultant in the workspace reads none');

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.package_sends (workspace_id, outside_application_id, day, slot, sent_by, to_masked, package_sha256, attachment_count)
     values ('40000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-0000000000a1', '2027-04-22', 1, '40000000-0000-4000-8000-0000000000a1', 'l…@northwind.example', repeat('c', 64), 0) $$,
  '42501', null, 'a signed-in admin cannot write a send directly (only the API does)'
);
select throws_ok($$ delete from public.package_sends $$, '42501', null, 'nor remove one');

set local role anon;
select throws_ok($$ select count(*) from public.package_sends $$, '42501', null, 'anonymous visitors read nothing');

select * from finish();
rollback;
