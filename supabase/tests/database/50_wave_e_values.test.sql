-- Wave E across its migrations (v1.12.0 integration): 0046 replaces checks that 0044 widened in
-- the same tables, so on a database migrated 0001-0049 in order every value each migration added
-- must still be accepted, together: the connected apps' providers and Salesforce as a source (0044)
-- beside the imported history targets, entities, the CyberGrants adapter and the history data set
-- (0046), a program as a social post's subject (0048) and the translation assistant (0049). One row
-- with each new value, then the values no migration added are still refused.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, aud, role) values
  ('50000000-0000-4000-8000-0000000000f1', 'admin@wave-e-funder.example', 'authenticated', 'authenticated');
insert into public.workspaces (id, kind, handle, display_name) values
  ('50000000-0000-7000-8000-000000000003', 'funder', 'wave-e-funder', 'Wave E Funder'),
  ('50000000-0000-7000-8000-000000000001', 'applicant', 'wave-e-grantee', 'Wave E Grantee');
insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('50000000-0000-7000-8000-000000000003', '50000000-0000-4000-8000-0000000000f1', 'admin', '{}');
insert into public.programs (id, workspace_id, name) values ('50100000-0000-7000-8000-000000000003', '50000000-0000-7000-8000-000000000003', 'Health');

set local role service_role;

-- 0044: the providers of the connected apps, on both kinds of workspace.
select lives_ok($$
  insert into public.connector_accounts (workspace_id, provider, status, external_id, scopes)
  values ('50000000-0000-7000-8000-000000000003', 'slack', 'active', '50000000-0000-7000-8000-000000000003', '{chat:write,channels:read}'),
         ('50000000-0000-7000-8000-000000000001', 'google_drive', 'active', '50000000-0000-7000-8000-000000000001', '{drive.file}'),
         ('50000000-0000-7000-8000-000000000003', 'salesforce', 'active', '50000000-0000-7000-8000-000000000003', '{api}')
$$, 'slack, google_drive and salesforce are providers after 0046 too');

-- 0044 + 0046: Salesforce as the source of each new history target, with a saved mapping.
select lives_ok($$
  insert into public.import_mappings (workspace_id, target, source, source_ref, mapping)
  values ('50000000-0000-7000-8000-000000000003', 'history_applications', 'salesforce', 'preset:npsp_grants', '{"title":"Application title"}'),
         ('50000000-0000-7000-8000-000000000003', 'award_history', 'salesforce', 'preset:npsp_grants', '{"title":"Grant name"}')
$$, 'a Salesforce mapping is kept for a history target and for grant history');

select lives_ok($$
  insert into public.import_runs (id, workspace_id, target, source, source_ref, mapping, rows_total, expires_at)
  values ('50300000-0000-7000-8000-000000000001', '50000000-0000-7000-8000-000000000003', 'history_applications', 'salesforce', 'preset:npsp_grants', '{"title":"Application title"}', 2, now() + interval '1 day'),
         ('50300000-0000-7000-8000-000000000002', '50000000-0000-7000-8000-000000000003', 'history_reviews', 'salesforce', 'soql:0123456789abcdef', '{}', 1, now() + interval '1 day'),
         ('50300000-0000-7000-8000-000000000003', '50000000-0000-7000-8000-000000000003', 'history_reports', 'salesforce', 'soql:fedcba9876543210', '{}', 1, now() + interval '1 day')
$$, 'a Salesforce run imports past applications, reviews and reports');

-- 0046: the CyberGrants adapter and Fluxx's reports, on history targets.
select lives_ok($$
  insert into public.import_runs (id, workspace_id, target, source, adapter, mapping, rows_total, expires_at)
  values ('50300000-0000-7000-8000-000000000004', '50000000-0000-7000-8000-000000000003', 'history_reports', 'xlsx', 'cybergrants', '{}', 1, now() + interval '1 day'),
         ('50300000-0000-7000-8000-000000000005', '50000000-0000-7000-8000-000000000003', 'history_reports', 'fluxx', 'fluxx', '{}', 1, now() + interval '1 day')
$$, 'the CyberGrants and Fluxx adapters read past reports');

select lives_ok($$
  insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, title, entity_type, entity_id)
  values ('50000000-0000-7000-8000-000000000003', '50300000-0000-7000-8000-000000000001', 'history_applications', 2, repeat('a', 64), 'create', 'Clinic van', 'history_application', gen_random_uuid()),
         ('50000000-0000-7000-8000-000000000003', '50300000-0000-7000-8000-000000000002', 'history_reviews', 2, repeat('b', 64), 'create', 'Clinic van', 'history_review', gen_random_uuid()),
         ('50000000-0000-7000-8000-000000000003', '50300000-0000-7000-8000-000000000003', 'history_reports', 2, repeat('c', 64), 'create', 'Final report', 'history_report', gen_random_uuid())
$$, 'the run log names each new kind of record');

-- 0046: the report builder's Imported history data set.
select lives_ok($$
  insert into public.report_views (workspace_id, name, data_set, definition, visibility, owner_user_id)
  values ('50000000-0000-7000-8000-000000000003', 'Past cycles', 'history', '{"columns":["record"]}', 'workspace', '50000000-0000-4000-8000-0000000000f1')
$$, 'a saved view reads the history data set');

-- 0048: a program as a social post's subject (Meet our grantees).
select lives_ok($$
  insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, targets, created_by)
  values ('50000000-0000-7000-8000-000000000003', 'program', '50100000-0000-7000-8000-000000000003', '50000000-0000-4000-8000-00000000aa01', repeat('d', 64), array['linkedin'], '[]', '50000000-0000-4000-8000-0000000000f1')
$$, 'a post may be about a program');

-- 0049: the translation assistant against the quota.
select lives_ok($$
  insert into public.assist_calls (workspace_id, tool) values ('50000000-0000-7000-8000-000000000003', 'translate')
$$, 'translate is an assistant tool');

-- Values no migration added stay refused.
select throws_ok($$
  insert into public.connector_accounts (workspace_id, provider, status) values ('50000000-0000-7000-8000-000000000003', 'dropbox', 'active')
$$, '23514', null, 'any other provider is still refused');
select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at)
  values ('50000000-0000-7000-8000-000000000003', 'history_applications', 'hubspot', '{}', 1, now() + interval '1 day')
$$, '23514', null, 'any other source is still refused');
select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at)
  values ('50000000-0000-7000-8000-000000000003', 'history_grants', 'salesforce', '{}', 1, now() + interval '1 day')
$$, '23514', null, 'any other target is still refused');
-- 0046's workspace rule still holds for Salesforce: history belongs to funder workspaces.
select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at)
  values ('50000000-0000-7000-8000-000000000001', 'history_applications', 'salesforce', '{}', 1, now() + interval '1 day')
$$, '23514', null, 'an applicant workspace imports no history, from Salesforce either');

select * from finish();
rollback;
