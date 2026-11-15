-- The report builder (0034): saved views, their schedules and the CSV files a schedule writes.
-- Writes run as the service role (the API's role); reads are checked as an admin, an observer, a
-- reviewer of the funder, a member of another funder and a member of an applicant.
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('34000000-0000-4000-8000-0000000000f1', 'admin@rb-funder.example',    'authenticated', 'authenticated'),
  ('34000000-0000-4000-8000-0000000000f2', 'observer@rb-funder.example', 'authenticated', 'authenticated'),
  ('34000000-0000-4000-8000-0000000000f3', 'reviewer@rb-funder.example', 'authenticated', 'authenticated'),
  ('34000000-0000-4000-8000-0000000000f4', 'finance@rb-funder.example',  'authenticated', 'authenticated'),
  ('34000000-0000-4000-8000-0000000000e1', 'admin@rb-other.example',     'authenticated', 'authenticated'),
  ('34000000-0000-4000-8000-0000000000a1', 'admin@rb-applicant.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('34000000-0000-7000-8000-000000000001', 'funder',    'rb-funder',    'RB Funder'),
  ('34000000-0000-7000-8000-000000000002', 'funder',    'rb-other',     'RB Other Funder'),
  ('34000000-0000-7000-8000-000000000003', 'applicant', 'rb-applicant', 'RB Applicant');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('34000000-0000-7000-8000-000000000001', '34000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('34000000-0000-7000-8000-000000000001', '34000000-0000-4000-8000-0000000000f2', 'observer', '{}'),
  ('34000000-0000-7000-8000-000000000001', '34000000-0000-4000-8000-0000000000f3', 'reviewer', '{}'),
  ('34000000-0000-7000-8000-000000000001', '34000000-0000-4000-8000-0000000000f4', 'finance', '{}'),
  ('34000000-0000-7000-8000-000000000002', '34000000-0000-4000-8000-0000000000e1', 'admin', '{}'),
  ('34000000-0000-7000-8000-000000000003', '34000000-0000-4000-8000-0000000000a1', 'admin', '{}');

set local role service_role;

-- ---------------------------------------------------------------- views
insert into public.report_views (id, workspace_id, name, data_set, definition, visibility, owner_user_id) values
  ('34000000-0000-7000-8000-0000000000b1', '34000000-0000-7000-8000-000000000001', 'Awards by program', 'awards', '{"columns":["program","amount"]}', 'workspace', '34000000-0000-4000-8000-0000000000f1'),
  ('34000000-0000-7000-8000-0000000000b2', '34000000-0000-7000-8000-000000000001', 'My overdue reports', 'requirements', '{"columns":["title"]}', 'private', '34000000-0000-4000-8000-0000000000f1'),
  ('34000000-0000-7000-8000-0000000000b3', '34000000-0000-7000-8000-000000000002', 'Other funder view', 'payments', '{"columns":["amount"]}', 'workspace', '34000000-0000-4000-8000-0000000000e1');
select is((select visibility from public.report_views where id = '34000000-0000-7000-8000-0000000000b2'), 'private', 'the service role keeps a private and a shared view');
insert into public.report_views (id, workspace_id, name, data_set, definition, owner_user_id) values
  ('34000000-0000-7000-8000-0000000000b4', '34000000-0000-7000-8000-000000000001', 'Defaults', 'payments', '{}', '34000000-0000-4000-8000-0000000000f4');
select is((select visibility from public.report_views where id = '34000000-0000-7000-8000-0000000000b4'), 'private', 'a view is private unless it is shared');
delete from public.report_views where id = '34000000-0000-7000-8000-0000000000b4';
select throws_ok(
  $$ insert into public.report_views (workspace_id, name, data_set, definition, owner_user_id) values ('34000000-0000-7000-8000-000000000003', 'Applicant view', 'awards', '{}', '34000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'report views belong to funder workspaces'
);
select throws_ok(
  $$ insert into public.report_views (workspace_id, name, data_set, definition, owner_user_id) values ('34000000-0000-7000-8000-000000000001', 'Raw SQL', 'workspace_members', '{}', '34000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a view names one of the five data sets'
);
select throws_ok(
  $$ insert into public.report_views (workspace_id, name, data_set, definition, owner_user_id) values ('34000000-0000-7000-8000-000000000001', 'List', 'awards', '[]', '34000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a definition is a JSON object'
);
select throws_ok(
  $$ insert into public.report_views (workspace_id, name, data_set, definition, owner_user_id) values ('34000000-0000-7000-8000-000000000001', '  ', 'awards', '{}', '34000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a view has a name'
);
select throws_ok(
  $$ insert into public.report_views (workspace_id, name, data_set, definition, visibility, owner_user_id) values ('34000000-0000-7000-8000-000000000001', 'Public', 'awards', '{}', 'public', '34000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a view is private or shared with the workspace, never public'
);
select throws_ok(
  $$ update public.report_views set workspace_id = '34000000-0000-7000-8000-000000000002' where id = '34000000-0000-7000-8000-0000000000b1' $$,
  '23514', null, 'a view cannot move to another workspace'
);

-- ---------------------------------------------------------------- schedules
insert into public.report_schedules (id, workspace_id, view_id, cadence, weekday, recipient_user_ids, created_by) values
  ('34000000-0000-7000-8000-0000000000c1', '34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b1', 'weekly', 1, array['34000000-0000-4000-8000-0000000000f1', '34000000-0000-4000-8000-0000000000f2']::uuid[], '34000000-0000-4000-8000-0000000000f1');
insert into public.report_schedules (id, workspace_id, view_id, cadence, day_of_month, recipient_user_ids, created_by) values
  ('34000000-0000-7000-8000-0000000000c2', '34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b2', 'monthly', 1, array['34000000-0000-4000-8000-0000000000f1']::uuid[], '34000000-0000-4000-8000-0000000000f1');
select is((select count(*)::int from public.report_schedules), 2, 'a view is scheduled weekly or monthly');
select throws_ok(
  $$ insert into public.report_schedules (workspace_id, view_id, cadence, day_of_month, recipient_user_ids, created_by) values ('34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b1', 'monthly', 3, array['34000000-0000-4000-8000-0000000000f1']::uuid[], '34000000-0000-4000-8000-0000000000f1') $$,
  '23505', null, 'a view has at most one schedule'
);
select throws_ok(
  $$ insert into public.report_schedules (workspace_id, view_id, cadence, weekday, recipient_user_ids, created_by) values ('34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b3', 'weekly', 2, array['34000000-0000-4000-8000-0000000000f1']::uuid[], '34000000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a schedule is in the workspace of its view'
);
select throws_ok(
  $$ update public.report_schedules set weekday = null where id = '34000000-0000-7000-8000-0000000000c1' $$,
  '23514', null, 'a weekly schedule names its weekday'
);
select throws_ok(
  $$ update public.report_schedules set day_of_month = 31 where id = '34000000-0000-7000-8000-0000000000c2' $$,
  '23514', null, 'a monthly schedule is on a day every month has'
);
select throws_ok(
  $$ update public.report_schedules set recipient_user_ids = '{}' where id = '34000000-0000-7000-8000-0000000000c1' $$,
  '23514', null, 'a schedule has at least one recipient'
);
select throws_ok(
  $$ update public.report_schedules set recipient_user_ids = (select array_agg(gen_random_uuid()) from generate_series(1, 21)) where id = '34000000-0000-7000-8000-0000000000c1' $$,
  '23514', null, 'a schedule has at most 20 recipients'
);
select throws_ok(
  $$ update public.report_schedules set active = false where id = '34000000-0000-7000-8000-0000000000c1' $$,
  '23514', null, 'a stopped schedule says why'
);

-- ---------------------------------------------------------------- files
insert into public.report_files (id, workspace_id, view_id, schedule_id, period_key, storage_key, row_count, recipient_user_ids, expires_at) values
  ('34000000-0000-7000-8000-0000000000d1', '34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b1', '34000000-0000-7000-8000-0000000000c1', '2027-W16',
   'exports/34000000-0000-7000-8000-000000000001/reports/34000000-0000-7000-8000-0000000000b1/2027-W16.csv', 12, array['34000000-0000-4000-8000-0000000000f2']::uuid[], now() + interval '30 days');
select is((select row_count from public.report_files where id = '34000000-0000-7000-8000-0000000000d1'), 12, 'a schedule writes a file for one period');
select throws_ok(
  $$ insert into public.report_files (workspace_id, view_id, schedule_id, period_key, storage_key, row_count, recipient_user_ids, expires_at) values
     ('34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b1', '34000000-0000-7000-8000-0000000000c1', '2027-W16',
      'exports/34000000-0000-7000-8000-000000000001/reports/34000000-0000-7000-8000-0000000000b1/2027-W16.csv', 3, '{}', now() + interval '30 days') $$,
  '23505', null, 'one file per view and period'
);
select throws_ok(
  $$ insert into public.report_files (workspace_id, view_id, period_key, storage_key, row_count, recipient_user_ids, expires_at) values
     ('34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b1', '2027-W17',
      'exports/34000000-0000-7000-8000-000000000002/reports/34000000-0000-7000-8000-0000000000b1/2027-W17.csv', 3, '{}', now() + interval '30 days') $$,
  '23514', null, 'a file is stored under its own workspace'
);
select throws_ok(
  $$ insert into public.report_files (workspace_id, view_id, schedule_id, period_key, storage_key, row_count, recipient_user_ids, expires_at) values
     ('34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b1', '34000000-0000-7000-8000-0000000000c2', '2027-W17',
      'exports/34000000-0000-7000-8000-000000000001/reports/34000000-0000-7000-8000-0000000000b1/2027-W17.csv', 3, '{}', now() + interval '30 days') $$,
  '23514', null, 'a file names the schedule of its own view'
);
select throws_ok(
  $$ insert into public.report_files (workspace_id, view_id, period_key, storage_key, row_count, recipient_user_ids, expires_at) values
     ('34000000-0000-7000-8000-000000000001', '34000000-0000-7000-8000-0000000000b1', '2027-W18',
      'exports/34000000-0000-7000-8000-000000000001/reports/34000000-0000-7000-8000-0000000000b1/2027-W18.csv', 50001, '{}', now() + interval '30 days') $$,
  '23514', null, 'a file holds at most 50,000 rows'
);

-- ---------------------------------------------------------------- reads (RLS)
reset role;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.report_views), 2, 'the owner reads the shared view and the private one');
select is((select count(*)::int from public.report_schedules), 2, 'the owner reads both schedules');
select is((select count(*)::int from public.report_files), 0, 'a file is read only by the people it was sent to');

select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select is((select array_agg(name)::text from public.report_views), '{"Awards by program"}', 'an observer reads shared views only, never another member''s private view');
select is((select count(*)::int from public.report_schedules), 1, 'an observer reads the schedule of a view it can read, not of a private one');
select is((select count(*)::int from public.report_files), 1, 'a recipient reads the file sent to it');

select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
select is((select count(*)::int from public.report_views) + (select count(*)::int from public.report_schedules) + (select count(*)::int from public.report_files), 0, 'a reviewer reads no report');

select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
select is((select array_agg(name)::text from public.report_views), '{"Other funder view"}', 'another funder reads only its own views');

select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.report_views) + (select count(*)::int from public.report_files), 0, 'an applicant reads no report');

select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.report_views (workspace_id, name, data_set, definition, owner_user_id) values ('34000000-0000-7000-8000-000000000001', 'Direct', 'awards', '{}', '34000000-0000-4000-8000-0000000000f1') $$,
  '42501', null, 'an admin cannot write a view directly: writes go through the API'
);

reset role;
set local role anon;
select throws_ok($$ select count(*) from public.report_views $$, '42501', null, 'anon reads no report view');

-- A view removed: its schedule and files go with it.
reset role;
set local role service_role;
delete from public.report_views where id = '34000000-0000-7000-8000-0000000000b1';
select is((select count(*)::int from public.report_schedules where view_id = '34000000-0000-7000-8000-0000000000b1') + (select count(*)::int from public.report_files where view_id = '34000000-0000-7000-8000-0000000000b1'), 0, 'removing a view stops its schedule and removes its files');

select * from finish();
rollback;
