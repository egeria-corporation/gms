-- Import from a spreadsheet (0031): saved mappings, runs and the run log are private to the
-- workspace that imports (its staff only), each target keeps to its kind of workspace, a row key
-- is written at most once per workspace and target, and a run keeps dropped columns by name only.
-- Writes run as the service role (the API's role); reads are checked as signed-in members of the
-- owning workspace, another workspace, a consultant, and anon.
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('13000000-0000-4000-8000-0000000000a1', 'admin@imp-applicant.example', 'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000a2', 'writer@imp-consultants.example', 'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000b1', 'admin@imp-other.example', 'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000f1', 'admin@imp-funder.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('13000000-0000-7000-8000-000000000001', 'applicant', 'imp-applicant', 'Import Applicant'),
  ('13000000-0000-7000-8000-000000000002', 'applicant', 'imp-other', 'Import Other'),
  ('13000000-0000-7000-8000-000000000003', 'funder', 'imp-funder', 'Import Funder');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000a2', 'consultant', '{"applicationIds":[]}'),
  ('13000000-0000-7000-8000-000000000002', '13000000-0000-4000-8000-0000000000b1', 'admin', '{}'),
  ('13000000-0000-7000-8000-000000000003', '13000000-0000-4000-8000-0000000000f1', 'admin', '{}');

-- ---------------------------------------------------------------- schema
select has_table('public', 'import_mappings', 'import_mappings exists');
select has_table('public', 'import_runs', 'import_runs exists');
select has_table('public', 'import_rows', 'import_rows exists');
select is((select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.import_mappings'::regclass, 'public.import_runs'::regclass, 'public.import_rows'::regclass)), true, 'RLS is on for all three tables');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('import_mappings', 'import_runs', 'import_rows') and cmd <> 'SELECT'), 0, 'signed-in users get no write policy');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

insert into public.import_mappings (workspace_id, target, source, source_ref, mapping) values
  ('13000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', 'columns:0123456789abcdef', '{"title":"Grant","funderName":"Funder"}');
select pass('a mapping is saved for a workspace, target and source');
select throws_ok(
  $$ insert into public.import_mappings (workspace_id, target, source, source_ref, mapping) values ('13000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', 'columns:0123456789abcdef', '{"title":"Other"}') $$,
  '23505', null, 'one saved mapping per workspace, target and source'
);
select throws_ok(
  $$ insert into public.import_mappings (workspace_id, target, source, source_ref, mapping) values ('13000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', 'x', '{"title":{"nested":true}}') $$,
  '23514', null, 'a mapping names a column per field, as text'
);
select throws_ok(
  $$ insert into public.import_mappings (workspace_id, target, source, source_ref, mapping) values ('13000000-0000-7000-8000-000000000001', 'outside_applications', 'dropbox', 'x', '{}') $$,
  '23514', null, 'only the four sources'
);
select throws_ok(
  $$ insert into public.import_mappings (workspace_id, target, source, source_ref, mapping) values ('13000000-0000-7000-8000-000000000003', 'outside_applications', 'csv', 'x', '{}') $$,
  '23514', null, 'outside applications are imported into applicant workspaces only'
);
select throws_ok(
  $$ insert into public.import_mappings (workspace_id, target, source, source_ref, mapping) values ('13000000-0000-7000-8000-000000000001', 'award_history', 'csv', 'x', '{}') $$,
  '23514', null, 'grant history is imported into funder workspaces only'
);

insert into public.import_runs (id, workspace_id, target, source, source_label, mapping, dropped_columns, reconciliation, rows_total, expires_at) values
  ('13000000-0000-7000-8000-0000000000d1', '13000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', 'pipeline.csv', '{"title":"Grant","funderName":"Funder"}', '[{"column":"Memo","reason":"identity_number"}]', '{"rows":3,"create":2,"skip":0,"error":1}', 3, now() + interval '1 day'),
  ('13000000-0000-7000-8000-0000000000d2', '13000000-0000-7000-8000-000000000003', 'award_history', 'google_sheets', 'Grants 2024', '{"title":"Grant"}', '[]', '{}', 1, now() + interval '1 day'),
  ('13000000-0000-7000-8000-0000000000d3', '13000000-0000-7000-8000-000000000002', 'outside_applications', 'airtable', 'Pipeline', '{}', '[]', '{}', 1, now() + interval '1 day');
select pass('runs are written for each kind of workspace');
select throws_ok(
  $$ insert into public.import_runs (workspace_id, target, source, mapping, dropped_columns, rows_total, expires_at) values ('13000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', '{}', '[{"column":"Memo","reason":"header","value":"x"}]', 1, now()) $$,
  '23514', null, 'a dropped column is kept by name and reason only, never a value'
);
select throws_ok(
  $$ insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at) values ('13000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', '{}', 5001, now()) $$,
  '23514', null, 'at most 5,000 rows per run'
);
select throws_ok(
  $$ update public.import_runs set finished_at = now() where id = '13000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'a run finishes only once it is committed'
);

insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, record, title, subtitle) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000d1', 'outside_applications', 2, repeat('a', 64), 'create', '{"title":"Capacity"}', 'Capacity', 'Cascade Trust'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000d1', 'outside_applications', 3, repeat('b', 64), 'create', '{"title":"Camp"}', 'Camp', 'Pine Fund'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000d1', 'outside_applications', 4, repeat('c', 64), 'error', null, 'Bad row', null);
update public.import_rows set problems = '[{"field":"funderName","message":"No funder"}]' where line = 4 and run_id = '13000000-0000-7000-8000-0000000000d1';
select pass('the run log keeps one row per source row');

select throws_ok(
  $$ insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, title) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000d1', 'outside_applications', 9, 'not-a-hash', 'create', 'x') $$,
  '23514', null, 'a row key is a SHA-256 hex digest'
);
select throws_ok(
  $$ insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, record, title) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000d1', 'outside_applications', 9, repeat('d', 64), 'skip', '{"title":"x"}', 'x') $$,
  '23514', null, 'only a row to create carries a record'
);
select throws_ok(
  $$ insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, title, problems) values ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000d1', 'outside_applications', 9, repeat('d', 64), 'error', 'x', '[{"message":"m","value":"secret"}]') $$,
  '23514', null, 'a problem is a field and a message only'
);
select throws_ok(
  $$ insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, title) values ('13000000-0000-7000-8000-000000000002', '13000000-0000-7000-8000-0000000000d1', 'outside_applications', 9, repeat('d', 64), 'create', 'x') $$,
  '23503', null, 'a row sits in its run''s workspace'
);
select throws_ok(
  $$ update public.import_rows set written_at = now() where line = 2 and run_id = '13000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'a row is written only after its entity is chosen'
);

-- The claim: the first run to choose an entity for a key holds it; another row with that key cannot.
update public.import_rows set entity_type = 'outside_application', entity_id = '13000000-0000-7000-8000-0000000000e1' where line = 2 and run_id = '13000000-0000-7000-8000-0000000000d1';
insert into public.import_runs (id, workspace_id, target, source, mapping, rows_total, expires_at) values
  ('13000000-0000-7000-8000-0000000000d4', '13000000-0000-7000-8000-000000000001', 'outside_applications', 'xlsx', '{}', 1, now() + interval '1 day');
insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, record, title) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000d4', 'outside_applications', 2, repeat('a', 64), 'create', '{"title":"Capacity"}', 'Capacity');
select pass('a second run may plan the same row key');
select throws_ok(
  $$ update public.import_rows set entity_type = 'outside_application', entity_id = '13000000-0000-7000-8000-0000000000e2' where run_id = '13000000-0000-7000-8000-0000000000d4' $$,
  '23505', null, 'but cannot write it again: one entity per row key, workspace and target'
);
insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, record, title, entity_type, entity_id) values
  ('13000000-0000-7000-8000-000000000002', '13000000-0000-7000-8000-0000000000d3', 'outside_applications', 2, repeat('a', 64), 'create', '{}', 'Capacity', 'outside_application', '13000000-0000-7000-8000-0000000000e3');
select pass('another workspace may write the same row key');
select throws_ok(
  $$ update public.import_runs set workspace_id = '13000000-0000-7000-8000-000000000002' where id = '13000000-0000-7000-8000-0000000000d4' $$,
  '23514', null, 'a run cannot move to another workspace'
);

-- Connector accounts take the two import sources.
insert into public.connector_accounts (workspace_id, provider, status, scopes) values
  ('13000000-0000-7000-8000-000000000001', 'google_sheets', 'active', '{spreadsheets.readonly}'),
  ('13000000-0000-7000-8000-000000000001', 'airtable', 'pending', '{data.records:read,schema.bases:read}');
select pass('connector accounts take google_sheets and airtable');
select throws_ok(
  $$ insert into public.connector_accounts (workspace_id, provider) values ('13000000-0000-7000-8000-000000000001', 'dropbox') $$,
  '23514', null, 'and no other new provider'
);

reset role;

-- ---------------------------------------------------------------- who reads
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.import_mappings), 1, 'a member reads the workspace''s saved mapping');
select is((select count(*)::int from public.import_runs), 2, 'a member reads the workspace''s runs');
select is((select count(*)::int from public.import_rows), 4, 'a member reads the workspace''s run log');
select throws_ok(
  $$ insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at) values ('13000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', '{}', 1, now()) $$,
  '42501', null, 'a member cannot write a run directly'
);
select throws_ok(
  $$ update public.import_rows set outcome = 'skip' $$,
  '42501', null, 'a member cannot change the run log'
);

select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.import_runs where workspace_id = '13000000-0000-7000-8000-000000000001'), 0, 'another workspace reads none of them');
select is((select count(*)::int from public.import_rows), 1, 'another workspace reads only its own run log');

select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.import_runs), 0, 'a consultant reads no runs');
select is((select count(*)::int from public.import_mappings), 0, 'a consultant reads no saved mappings');

select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.import_runs), 1, 'the funder reads its own grant history run and nothing of the applicants''');
reset role;

set local role anon;
select throws_ok($$ select count(*) from public.import_rows $$, '42501', null, 'anon reads nothing');
reset role;

select * from finish();
rollback;
