-- Importer adapters (0042): runs record which system's export they read and where an API pull
-- continues; the new sources and connector providers are allowed and nothing else is; the Fluxx
-- and Zengine credentials stay unreadable to signed-in users; files from a system's zip are the
-- funder's own documents, never the grantee's. Writes as the service role, reads as members.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('42000000-0000-4000-8000-0000000000f1', 'admin@adp-funder.example', 'authenticated', 'authenticated'),
  ('42000000-0000-4000-8000-0000000000f2', 'finance@adp-funder.example', 'authenticated', 'authenticated'),
  ('42000000-0000-4000-8000-0000000000a1', 'admin@adp-grantee.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('42000000-0000-7000-8000-000000000003', 'funder', 'adp-funder', 'Adapter Funder'),
  ('42000000-0000-7000-8000-000000000001', 'applicant', 'adp-grantee', 'Adapter Grantee');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('42000000-0000-7000-8000-000000000003', '42000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('42000000-0000-7000-8000-000000000003', '42000000-0000-4000-8000-0000000000f2', 'finance', '{}'),
  ('42000000-0000-7000-8000-000000000001', '42000000-0000-4000-8000-0000000000a1', 'admin', '{}');

-- ---------------------------------------------------------------- schema
select has_column('public', 'import_runs', 'adapter', 'import_runs.adapter exists');
select has_column('public', 'import_runs', 'source_next_page', 'import_runs.source_next_page exists');
select col_is_null('public', 'import_runs', 'adapter', 'adapter is optional (null for a plain spreadsheet)');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

select lives_ok($$
  insert into public.import_runs (id, workspace_id, target, source, adapter, mapping, rows_total, expires_at)
  values ('42000000-0000-7000-8000-0000000000e1', '42000000-0000-7000-8000-000000000003', 'award_history', 'csv', 'submittable', '{"title":"Title"}', 5, now() + interval '1 day')
$$, 'a grant history run records the system its export came from');

select lives_ok($$
  insert into public.import_runs (id, workspace_id, target, source, adapter, source_next_page, mapping, rows_total, expires_at)
  values ('42000000-0000-7000-8000-0000000000e2', '42000000-0000-7000-8000-000000000003', 'award_history', 'fluxx', 'fluxx', 51, '{"title":"Project title"}', 5000, now() + interval '1 day')
$$, 'a Fluxx pull records where the next one starts');

select lives_ok($$
  insert into public.import_runs (workspace_id, target, source, adapter, mapping, rows_total, expires_at)
  values ('42000000-0000-7000-8000-000000000003', 'award_history', 'json', 'openwater', '{"title":"name"}', 3, now() + interval '1 day')
$$, 'an OpenWater JSON export is a source');

select lives_ok($$
  insert into public.import_mappings (workspace_id, target, source, source_ref, mapping)
  values ('42000000-0000-7000-8000-000000000003', 'award_history', 'zengine', 'form:42', '{"title":"Record name"}')
$$, 'a mapping is saved for a Zengine form');

select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, adapter, mapping, rows_total, expires_at)
  values ('42000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', 'submittable', '{"title":"Title"}', 1, now() + interval '1 day')
$$, '23514', null, 'an adapter maps to grant history only');

select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, adapter, mapping, rows_total, expires_at)
  values ('42000000-0000-7000-8000-000000000003', 'award_history', 'csv', 'bonterra', '{"title":"Title"}', 1, now() + interval '1 day')
$$, '23514', null, 'an unknown system is refused');

select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, adapter, source_next_page, mapping, rows_total, expires_at)
  values ('42000000-0000-7000-8000-000000000003', 'award_history', 'csv', 'submittable', 2, '{"title":"Title"}', 1, now() + interval '1 day')
$$, '23514', null, 'a file is never read in parts');

select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, adapter, mapping, rows_total, expires_at)
  values ('42000000-0000-7000-8000-000000000003', 'award_history', 'zengine', null, '{"title":"Title"}', 1, now() + interval '1 day')
$$, '23514', null, 'an API source is read through its own adapter');

select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at)
  values ('42000000-0000-7000-8000-000000000003', 'award_history', 'sharepoint', '{"title":"Title"}', 1, now() + interval '1 day')
$$, '23514', null, 'any other source is refused');

select lives_ok($$
  insert into public.connector_accounts (workspace_id, provider, status, external_id, scopes, secret_enc)
  values ('42000000-0000-7000-8000-000000000003', 'fluxx', 'active', 'https://adp.fluxx.io', '{grant_request:read}', 'v1.ciphertext-not-a-secret'),
         ('42000000-0000-7000-8000-000000000003', 'zengine', 'active', null, '{records:read}', 'v1.ciphertext-not-a-secret')
$$, 'Fluxx and Zengine credentials are stored as ciphertext');

select throws_ok($$
  insert into public.connector_accounts (workspace_id, provider, status) values ('42000000-0000-7000-8000-000000000003', 'dropbox', 'active')
$$, '23514', null, 'any other provider is refused');

insert into public.documents (id, workspace_id, owner_workspace_id, subject_type, subject_id, name, mime, size, sha256, storage, path)
values ('42000000-0000-7000-8000-0000000000d1', '42000000-0000-7000-8000-000000000003', '42000000-0000-7000-8000-000000000003', 'imported_award_file', gen_random_uuid(), 'Submission 70012345.pdf', 'application/pdf', 13, repeat('a', 64), 'r2', 'imports/x/y');

reset role;

-- ---------------------------------------------------------------- reads as members
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"42000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.import_runs where adapter is not null), 3, 'the funder''s staff see its runs and which system each read');
select is((select count(*)::int from public.connector_accounts where provider in ('fluxx', 'zengine')), 2, 'an admin sees that Fluxx and Zengine are connected');
select throws_ok($$ select secret_enc from public.connector_accounts where provider = 'fluxx' $$, '42501', null, 'nobody signed in reads the stored credentials');
select is((select count(*)::int from public.documents where subject_type = 'imported_award_file'), 1, 'the funder''s staff see the files imported with its grant history');

select set_config('request.jwt.claims', '{"sub":"42000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.import_runs), 0, 'another workspace sees no run');
select is((select count(*)::int from public.documents where subject_type = 'imported_award_file'), 0, 'a grantee never sees the funder''s imported files');

reset role;
select * from finish();
rollback;
