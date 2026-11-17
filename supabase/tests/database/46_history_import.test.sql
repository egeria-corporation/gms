-- Imported history (0046): past applications, reviews and reports are written by the service role
-- only, stay in the funder's own workspace and link only to its own awards, programs and runs;
-- a reviewer's contact details are refused; the import framework takes the three new targets in
-- funder workspaces only; and only the funder's staff read them (reviewers, external reviewers,
-- fund advisors, the grantee and other workspaces see none). Deleting an award, or the whole
-- workspace, is never blocked by its history.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('46000000-0000-4000-8000-0000000000f1', 'admin@hist-funder.example', 'authenticated', 'authenticated'),
  ('46000000-0000-4000-8000-0000000000f2', 'finance@hist-funder.example', 'authenticated', 'authenticated'),
  ('46000000-0000-4000-8000-0000000000f3', 'reviewer@hist-funder.example', 'authenticated', 'authenticated'),
  ('46000000-0000-4000-8000-0000000000f4', 'guest@hist-funder.example', 'authenticated', 'authenticated'),
  ('46000000-0000-4000-8000-0000000000f5', 'advisor@hist-funder.example', 'authenticated', 'authenticated'),
  ('46000000-0000-4000-8000-0000000000a1', 'admin@hist-grantee.example', 'authenticated', 'authenticated'),
  ('46000000-0000-4000-8000-0000000000b1', 'admin@hist-other.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('46000000-0000-7000-8000-000000000003', 'funder', 'hist-funder', 'History Funder'),
  ('46000000-0000-7000-8000-000000000004', 'funder', 'hist-other', 'Other Funder'),
  ('46000000-0000-7000-8000-000000000001', 'applicant', 'hist-grantee', 'History Grantee');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('46000000-0000-7000-8000-000000000003', '46000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('46000000-0000-7000-8000-000000000003', '46000000-0000-4000-8000-0000000000f2', 'finance', '{}'),
  ('46000000-0000-7000-8000-000000000003', '46000000-0000-4000-8000-0000000000f3', 'reviewer', '{}'),
  ('46000000-0000-7000-8000-000000000003', '46000000-0000-4000-8000-0000000000f4', 'external_reviewer', '{}'),
  ('46000000-0000-7000-8000-000000000003', '46000000-0000-4000-8000-0000000000f5', 'program_officer', '{"fundIds":[]}'),
  ('46000000-0000-7000-8000-000000000001', '46000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('46000000-0000-7000-8000-000000000004', '46000000-0000-4000-8000-0000000000b1', 'admin', '{}');

insert into public.programs (id, workspace_id, name) values ('46100000-0000-7000-8000-000000000003', '46000000-0000-7000-8000-000000000003', 'Health');
insert into public.awards (id, workspace_id, recipient_workspace_id, recipient_individual, title) values
  ('46200000-0000-7000-8000-000000000003', '46000000-0000-7000-8000-000000000003', '46000000-0000-7000-8000-000000000001', null, 'Clinic van'),
  ('46200000-0000-7000-8000-000000000004', '46000000-0000-7000-8000-000000000004', null, '{"name":"Test Person"}', 'Other award');

-- ---------------------------------------------------------------- schema
select has_table('public', 'history_applications', 'history_applications exists');
select has_table('public', 'history_reviews', 'history_reviews exists');
select has_table('public', 'history_reports', 'history_reports exists');
select hasnt_column('public', 'history_reviews', 'reviewer_email', 'a review keeps no reviewer email');

-- ---------------------------------------------------------------- the import framework
set local role service_role;

select lives_ok($$
  insert into public.import_runs (id, workspace_id, target, source, adapter, mapping, rows_total, expires_at)
  values ('46300000-0000-7000-8000-000000000001', '46000000-0000-7000-8000-000000000003', 'history_applications', 'csv', 'submittable', '{"title":"Title"}', 3, now() + interval '1 day'),
         ('46300000-0000-7000-8000-000000000002', '46000000-0000-7000-8000-000000000003', 'history_reviews', 'csv', 'submittable', '{"applicationRef":"Submission ID"}', 4, now() + interval '1 day'),
         ('46300000-0000-7000-8000-000000000003', '46000000-0000-7000-8000-000000000003', 'history_reports', 'xlsx', 'cybergrants', '{"title":"Impact Report Type"}', 3, now() + interval '1 day')
$$, 'a funder imports past applications, reviews and reports, from a known system');

select lives_ok($$
  insert into public.import_rows (workspace_id, run_id, target, line, row_key, outcome, title, entity_type, entity_id)
  values ('46000000-0000-7000-8000-000000000003', '46300000-0000-7000-8000-000000000001', 'history_applications', 2, repeat('a', 64), 'create', 'Clinic van', 'history_application', gen_random_uuid())
$$, 'the run log names a past application it wrote');

select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at)
  values ('46000000-0000-7000-8000-000000000001', 'history_applications', 'csv', '{"title":"Title"}', 1, now() + interval '1 day')
$$, '23514', null, 'imported history belongs to funder workspaces');

select lives_ok($$
  insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at)
  values ('46000000-0000-7000-8000-000000000001', 'outside_applications', 'csv', '{"title":"Title"}', 1, now() + interval '1 day')
$$, 'an applicant still imports its outside applications');

select throws_ok($$
  insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at)
  values ('46000000-0000-7000-8000-000000000003', 'history_payments', 'csv', '{"title":"Title"}', 1, now() + interval '1 day')
$$, '23514', null, 'any other target is refused');

-- ---------------------------------------------------------------- history rows
select lives_ok($$
  insert into public.history_applications (id, workspace_id, organization_name, organization_workspace_id, award_id, program_id, program_name, title, call_title, submitted_on, outcome, outcome_label, requested_amount_minor, awarded_amount_minor, answers, source_key, source_system, import_run_id)
  values ('46400000-0000-7000-8000-000000000001', '46000000-0000-7000-8000-000000000003', 'River Clinic', '46000000-0000-7000-8000-000000000001', '46200000-0000-7000-8000-000000000003', '46100000-0000-7000-8000-000000000003', 'Health', 'Clinic van', 'Health 2024', '2024-01-10', 'awarded', 'Accepted', 4500000, 4000000,
          '[{"question":"Project summary","answer":"A mobile clinic"}]', repeat('b', 64), 'submittable', '46300000-0000-7000-8000-000000000001'),
         ('46400000-0000-7000-8000-000000000002', '46000000-0000-7000-8000-000000000003', 'Alder Creek', null, null, null, null, 'Tutors', null, null, 'declined', 'Declined', 1500000, null, '[]', null, null, null)
$$, 'the service role writes past applications linked to the funder''s own award, program and organization');

select throws_ok($$
  insert into public.history_applications (workspace_id, organization_name, title, outcome, award_id)
  values ('46000000-0000-7000-8000-000000000003', 'X', 'Y', 'unknown', '46200000-0000-7000-8000-000000000004')
$$, '23514', null, 'a past application never links to another funder''s award');

select throws_ok($$
  insert into public.history_applications (workspace_id, organization_name, title, outcome)
  values ('46000000-0000-7000-8000-000000000001', 'X', 'Y', 'unknown')
$$, '23514', null, 'an applicant workspace holds no imported history');

select throws_ok($$
  insert into public.history_applications (workspace_id, organization_name, title, outcome, organization_workspace_id)
  values ('46000000-0000-7000-8000-000000000003', 'X', 'Y', 'unknown', '46000000-0000-7000-8000-000000000004')
$$, '23514', null, 'the organization linked is an applicant workspace');

select throws_ok($$
  insert into public.history_applications (workspace_id, organization_name, title, outcome)
  values ('46000000-0000-7000-8000-000000000003', 'X', 'Y', 'paid')
$$, '23514', null, 'an outcome outside the vocabulary is refused');

select throws_ok($$
  insert into public.history_applications (workspace_id, organization_name, title, outcome, answers)
  values ('46000000-0000-7000-8000-000000000003', 'X', 'Y', 'unknown', '[{"question":"Q","answer":"A","email":"x"}]')
$$, '23514', null, 'answers are questions and answers only');

select lives_ok($$
  insert into public.history_reviews (id, workspace_id, application_id, application_key, application_title, reviewer_name, scores, total_score, recommendation, comment, reviewed_on, source_system, import_run_id)
  values ('46500000-0000-7000-8000-000000000001', '46000000-0000-7000-8000-000000000003', '46400000-0000-7000-8000-000000000001', repeat('b', 64), 'Clinic van', 'Jo Park',
          '[{"criterion":"Impact score","score":5,"outOf":null},{"criterion":"Budget score","score":4,"outOf":5}]', 13, 'Fund', 'Strong plan', '2024-02-01', 'submittable', '46300000-0000-7000-8000-000000000002'),
         ('46500000-0000-7000-8000-000000000002', '46000000-0000-7000-8000-000000000003', null, repeat('c', 64), null, null, '[]', 9, null, null, null, null, null)
$$, 'the service role writes reviews, linked to a past application or waiting for it by its key');

select throws_ok($$
  insert into public.history_reviews (workspace_id, application_title, reviewer_name)
  values ('46000000-0000-7000-8000-000000000003', 'Clinic van', 'jo@example.org')
$$, '23514', null, 'a reviewer''s email is never kept');

select throws_ok($$
  insert into public.history_reviews (workspace_id, comment) values ('46000000-0000-7000-8000-000000000003', 'Orphan')
$$, '23514', null, 'a review names the application it belongs to');

select throws_ok($$
  insert into public.history_reviews (workspace_id, application_title, scores)
  values ('46000000-0000-7000-8000-000000000003', 'Clinic van', '[{"criterion":"Impact","score":"high"}]')
$$, '23514', null, 'a criterion score is a number');

select throws_ok($$
  insert into public.history_reviews (workspace_id, application_id)
  values ('46000000-0000-7000-8000-000000000004', '46400000-0000-7000-8000-000000000001')
$$, '23514', null, 'a review never links to another funder''s application');

select lives_ok($$
  insert into public.history_reports (id, workspace_id, award_id, organization_workspace_id, award_title, title, due_on, submitted_on, report_state, report_state_label, source_system)
  values ('46600000-0000-7000-8000-000000000001', '46000000-0000-7000-8000-000000000003', '46200000-0000-7000-8000-000000000003', '46000000-0000-7000-8000-000000000001', 'Clinic van', 'Final report', '2025-06-30', '2025-06-20', 'submitted', 'Completed', 'cybergrants')
$$, 'the service role writes a past report on the funder''s own award');

select throws_ok($$
  insert into public.history_reports (workspace_id, title, report_state) values ('46000000-0000-7000-8000-000000000003', 'Report', 'overdue')
$$, '23514', null, 'a report state outside the vocabulary is refused');

insert into public.documents (workspace_id, owner_workspace_id, subject_type, subject_id, name, mime, size, sha256, storage, path)
values ('46000000-0000-7000-8000-000000000003', '46000000-0000-7000-8000-000000000003', 'history_report_file', '46600000-0000-7000-8000-000000000001', 'Report 9001.pdf', 'application/pdf', 13, repeat('d', 64), 'r2', 'imports/x/z');

reset role;

-- ---------------------------------------------------------------- reads as members
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"46000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.history_applications), 2, 'an admin reads the past applications');
select is((select count(*)::int from public.history_reviews), 2, 'an admin reads the past reviews');
select is((select count(*)::int from public.history_reports), 1, 'an admin reads the past reports');
select throws_ok($$ insert into public.history_applications (workspace_id, organization_name, title, outcome) values ('46000000-0000-7000-8000-000000000003', 'X', 'Y', 'unknown') $$, '42501', null, 'nobody signed in writes history');

select set_config('request.jwt.claims', '{"sub":"46000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from public.history_applications), 2, 'finance, staff, reads them too');

select set_config('request.jwt.claims', '{"sub":"46000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
select is((select count(*)::int from public.history_applications) + (select count(*)::int from public.history_reviews) + (select count(*)::int from public.history_reports), 0, 'a reviewer sees none of it');
select is((select count(*)::int from public.documents where subject_type = 'history_report_file'), 0, 'a reviewer sees no imported report file');

select set_config('request.jwt.claims', '{"sub":"46000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
select is((select count(*)::int from public.history_applications) + (select count(*)::int from public.history_reviews), 0, 'an external reviewer sees none of it');

select set_config('request.jwt.claims', '{"sub":"46000000-0000-4000-8000-0000000000f5","role":"authenticated"}', true);
select is((select count(*)::int from public.history_applications), 0, 'a fund advisor reads history through the API only');

select set_config('request.jwt.claims', '{"sub":"46000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.history_applications) + (select count(*)::int from public.history_reports), 0, 'the grantee never sees the funder''s history about it');

select set_config('request.jwt.claims', '{"sub":"46000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.history_applications), 0, 'another funder sees none of it');

reset role;

-- ---------------------------------------------------------------- deletes are never blocked
select lives_ok($$ delete from public.awards where id = '46200000-0000-7000-8000-000000000003' $$, 'an award can be deleted');
select is((select award_id from public.history_applications where id = '46400000-0000-7000-8000-000000000001'), null, 'its past application keeps its text and loses the link');
select lives_ok($$ delete from public.workspaces where id = '46000000-0000-7000-8000-000000000003' $$, 'a funder workspace with history can be deleted');

select * from finish();
rollback;
