-- Apply anywhere (0029): outside applications and everything around them are private to the
-- applicant workspace that owns them. Writes run as the service role (the API's role); reads are
-- checked as signed-in members of the owning workspace, another applicant, a funder and a consultant.
begin;
create extension if not exists pgtap with schema extensions;

select plan(68);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('11000000-0000-4000-8000-0000000000a1', 'admin@applicant-x.example',  'authenticated', 'authenticated'),
  ('11000000-0000-4000-8000-0000000000a2', 'viewer@applicant-x.example', 'authenticated', 'authenticated'),
  ('11000000-0000-4000-8000-0000000000a3', 'writer@consultants.example', 'authenticated', 'authenticated'),
  ('11000000-0000-4000-8000-0000000000b1', 'admin@applicant-y.example',  'authenticated', 'authenticated'),
  ('11000000-0000-4000-8000-0000000000f1', 'admin@funder.example',       'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('11000000-0000-7000-8000-000000000001', 'applicant', 'oa-applicant-x', 'OA Applicant X'),
  ('11000000-0000-7000-8000-000000000002', 'applicant', 'oa-applicant-y', 'OA Applicant Y'),
  ('11000000-0000-7000-8000-000000000003', 'funder',    'oa-funder',      'OA Funder');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('11000000-0000-7000-8000-000000000001', '11000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('11000000-0000-7000-8000-000000000001', '11000000-0000-4000-8000-0000000000a2', 'viewer', '{}'),
  ('11000000-0000-7000-8000-000000000001', '11000000-0000-4000-8000-0000000000a3', 'consultant', '{"applicationIds":[]}'),
  ('11000000-0000-7000-8000-000000000002', '11000000-0000-4000-8000-0000000000b1', 'admin', '{}'),
  ('11000000-0000-7000-8000-000000000003', '11000000-0000-4000-8000-0000000000f1', 'admin', '{}');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

insert into public.funder_records (id, workspace_id, name, contacts, portal_login_holder) values
  ('11000000-0000-7000-8000-0000000000c1', '11000000-0000-7000-8000-000000000001', 'Northwind Family Foundation',
   '[{"name":"Ana Ruiz","role":"Program officer","email":"ana@northwind.example"}]', 'Dana Ortiz'),
  ('11000000-0000-7000-8000-0000000000c2', '11000000-0000-7000-8000-000000000002', 'Northwind Family Foundation', '[]', null);
select pass('the service role writes funder records; the same name may exist in two workspaces');

select throws_ok(
  $$ insert into public.funder_records (workspace_id, name) values ('11000000-0000-7000-8000-000000000001', '  northwind family FOUNDATION ') $$,
  '23505', null, 'a funder record name is unique per workspace, ignoring case and outer spaces'
);
select throws_ok(
  $$ insert into public.funder_records (workspace_id, name) values ('11000000-0000-7000-8000-000000000003', 'A funder''s own record') $$,
  '23514', null, 'funder records belong to applicant workspaces'
);
select throws_ok(
  $$ insert into public.funder_records (workspace_id, name, contacts)
     select '11000000-0000-7000-8000-000000000001', 'Too many contacts', jsonb_agg(jsonb_build_object('name', 'Person ' || i)) from generate_series(1, 21) i $$,
  '23514', null, 'at most 20 contacts'
);
select throws_ok(
  $$ insert into public.funder_records (workspace_id, name, contacts) values ('11000000-0000-7000-8000-000000000001', 'Bad contact', '[{"role":"No name"}]') $$,
  '23514', null, 'every contact has a name'
);
select throws_ok(
  $$ insert into public.funder_records (workspace_id, name, contacts) values ('11000000-0000-7000-8000-000000000001', 'Extra key', '[{"name":"A","password":"x"}]') $$,
  '23514', null, 'a contact holds a name, role, email and phone only'
);

insert into public.outside_applications (id, workspace_id, title, funder_name, funder_record_id, source, stage, full_due, ask_amount_minor, ask_by_year, custom_fields) values
  ('11000000-0000-7000-8000-0000000000a1', '11000000-0000-7000-8000-000000000001', 'Rural clinics 2027', 'Northwind Family Foundation',
   '11000000-0000-7000-8000-0000000000c1', 'manual', 'drafting', '2027-05-01', 5000000, '[{"year":2027,"amountMinor":2500000},{"year":2028,"amountMinor":2500000}]', '{"region":"Valley","priority":2}'),
  ('11000000-0000-7000-8000-0000000000b1', '11000000-0000-7000-8000-000000000002', 'Y''s private application', 'Northwind Family Foundation',
   '11000000-0000-7000-8000-0000000000c2', 'manual', 'prospect', null, null, '[]', '{}');
select pass('the service role writes outside applications');

select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name) values ('11000000-0000-7000-8000-000000000003', 'Funder side', 'X') $$,
  '23514', null, 'outside applications belong to applicant workspaces'
);
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, funder_record_id) values ('11000000-0000-7000-8000-000000000001', 'Other record', 'X', '11000000-0000-7000-8000-0000000000c2') $$,
  '23514', null, 'an outside application cannot name another workspace''s funder record'
);
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, stage) values ('11000000-0000-7000-8000-000000000001', 'Bad stage', 'X', 'paid') $$,
  '23514', null, 'stage outside the vocabulary is rejected'
);
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, stage) values ('11000000-0000-7000-8000-000000000001', 'Submitted without a date', 'X', 'submitted') $$,
  '23514', null, 'submitted needs a submission date and method'
);
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, stage, submitted_at, submission_method) values ('11000000-0000-7000-8000-000000000001', 'Awarded without an amount', 'X', 'awarded', now(), 'portal') $$,
  '23514', null, 'awarded needs an amount'
);
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, ask_amount_minor) values ('11000000-0000-7000-8000-000000000001', 'Negative ask', 'X', -1) $$,
  '23514', null, 'amounts are never negative'
);
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, ask_by_year) values ('11000000-0000-7000-8000-000000000001', 'Bad years', 'X', '[{"year":"soon","amountMinor":1}]') $$,
  '23514', null, 'amounts by year are {year, amountMinor} numbers'
);
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, custom_fields) values ('11000000-0000-7000-8000-000000000001', 'Nested custom field', 'X', '{"a":{"b":1}}') $$,
  '23514', null, 'custom fields hold scalar values only'
);
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, custom_fields)
     select '11000000-0000-7000-8000-000000000001', 'Too many custom fields', 'X', jsonb_object_agg('k' || i, i) from generate_series(1, 31) i $$,
  '23514', null, 'at most 30 custom fields'
);
select throws_ok(
  $$ update public.outside_applications set workspace_id = '11000000-0000-7000-8000-000000000002' where id = '11000000-0000-7000-8000-0000000000a1' $$,
  '23514', null, 'an outside application never moves to another workspace'
);

-- One prospect per OpenGrants listing per workspace.
insert into public.outside_applications (workspace_id, title, funder_name, source, source_ref, stage) values
  ('11000000-0000-7000-8000-000000000001', 'Listing og-9', 'Funder', 'opengrants', 'og-9', 'prospect');
select throws_ok(
  $$ insert into public.outside_applications (workspace_id, title, funder_name, source, source_ref, stage) values ('11000000-0000-7000-8000-000000000001', 'Listing og-9 again', 'Funder', 'opengrants', 'og-9', 'prospect') $$,
  '23505', null, 'the same OpenGrants listing is one prospect per workspace'
);
insert into public.outside_applications (workspace_id, title, funder_name, source, source_ref, stage) values
  ('11000000-0000-7000-8000-000000000002', 'Listing og-9 in Y', 'Funder', 'opengrants', 'og-9', 'prospect');
select pass('another workspace may track the same listing');

insert into public.outside_questions (id, workspace_id, outside_application_id, phase, position, prompt, limit_kind, limit_value) values
  ('11000000-0000-7000-8000-0000000000d1', '11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', 'full', 0, 'Describe the need.', 'words', 250),
  ('11000000-0000-7000-8000-0000000000d2', '11000000-0000-7000-8000-000000000002', '11000000-0000-7000-8000-0000000000b1', 'full', 0, 'Y''s question', null, null);
select throws_ok(
  $$ insert into public.outside_questions (workspace_id, outside_application_id, prompt) values ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000b1', 'Into Y''s application') $$,
  '23514', null, 'a question cannot hang off another workspace''s application'
);
select throws_ok(
  $$ insert into public.outside_questions (workspace_id, outside_application_id, prompt, limit_kind) values ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', 'Half a limit', 'words') $$,
  '23514', null, 'a limit has a kind and a value, or neither'
);

insert into public.answers (id, workspace_id, key, title, body) values
  ('11000000-0000-7000-8000-0000000000e1', '11000000-0000-7000-8000-000000000001', 'need', 'Need', 'Families travel 46 miles.'),
  ('11000000-0000-7000-8000-0000000000e2', '11000000-0000-7000-8000-000000000002', 'need', 'Need', 'Y''s library answer.');
insert into public.outside_answers (workspace_id, question_id, version, body, provenance, library_answer_id) values
  ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000d1', 1, 'Families travel 46 miles.', 'library', '11000000-0000-7000-8000-0000000000e1'),
  ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000d1', 2, 'Families travel 46 miles to a clinic.', 'agent:claude-desktop', null),
  ('11000000-0000-7000-8000-000000000002', '11000000-0000-7000-8000-0000000000d2', 1, 'Y''s private answer', 'user', null);
select pass('answers are saved as versions with their provenance');
select throws_ok(
  $$ insert into public.outside_answers (workspace_id, question_id, version, body, provenance) values ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000d1', 2, 'Same version', 'user') $$,
  '23505', null, 'one answer per question and version'
);
select throws_ok(
  $$ insert into public.outside_answers (workspace_id, question_id, version, body, provenance, library_answer_id) values ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000d1', 3, 'x', 'library', '11000000-0000-7000-8000-0000000000e2') $$,
  '23514', null, 'an answer cannot name another workspace''s library answer'
);
select throws_ok(
  $$ insert into public.outside_answers (workspace_id, question_id, version, body, provenance) values ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000d1', 3, 'x', 'someone') $$,
  '23514', null, 'provenance comes from the forms vocabulary'
);
select throws_ok(
  $$ update public.answers set workspace_id = '11000000-0000-7000-8000-000000000002' where id = '11000000-0000-7000-8000-0000000000e1' $$,
  '23514', null, 'a library answer never moves to another workspace'
);

-- Documents and tasks about an outside application stay in its workspace.
insert into public.documents (id, workspace_id, owner_workspace_id, subject_type, subject_id, name, mime, size, sha256, storage, path) values
  ('11000000-0000-7000-8000-0000000000f1', '11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-000000000001', 'outside_application',
   '11000000-0000-7000-8000-0000000000a1', 'receipt.pdf', 'application/pdf', 10, repeat('a', 64), 'r2', 'outside/a1/receipt');
insert into public.tasks (workspace_id, subject_type, subject_id, title) values
  ('11000000-0000-7000-8000-000000000001', 'outside_application', '11000000-0000-7000-8000-0000000000a1', 'Collect the audit');
select pass('a document and a task can be about an outside application of their workspace');
select throws_ok(
  $$ insert into public.documents (workspace_id, owner_workspace_id, subject_type, subject_id, name, mime, size, sha256, storage, path) values
     ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-000000000001', 'outside_application', '11000000-0000-7000-8000-0000000000b1', 'x.pdf', 'application/pdf', 1, repeat('b', 64), 'r2', 'x') $$,
  '23514', null, 'a document cannot be about another workspace''s outside application'
);
select throws_ok(
  $$ insert into public.documents (workspace_id, owner_workspace_id, subject_type, subject_id, name, mime, size, sha256, storage, path) values
     ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-000000000003', 'outside_application', '11000000-0000-7000-8000-0000000000a1', 'x.pdf', 'application/pdf', 1, repeat('c', 64), 'r2', 'x') $$,
  '23514', null, 'a document about an outside application is uploaded by its own workspace'
);
select throws_ok(
  $$ insert into public.tasks (workspace_id, subject_type, subject_id, title) values ('11000000-0000-7000-8000-000000000003', 'outside_application', '11000000-0000-7000-8000-0000000000a1', 'A funder''s task') $$,
  '23514', null, 'a task cannot be about another workspace''s outside application'
);
select throws_ok(
  $$ update public.outside_applications set receipt_document_id = '11000000-0000-7000-8000-0000000000f1' where id = '11000000-0000-7000-8000-0000000000b1' $$,
  '23514', null, 'an outside application cannot name another workspace''s document as its receipt'
);
update public.outside_applications set receipt_document_id = '11000000-0000-7000-8000-0000000000f1' where id = '11000000-0000-7000-8000-0000000000a1';
select pass('the receipt is a document of the same workspace');

insert into public.calendar_feeds (workspace_id, token_sha256) values ('11000000-0000-7000-8000-000000000001', repeat('d', 64));
select throws_ok(
  $$ insert into public.calendar_feeds (workspace_id, token_sha256) values ('11000000-0000-7000-8000-000000000001', repeat('e', 64)) $$,
  '23505', null, 'one calendar feed per workspace'
);
select throws_ok(
  $$ insert into public.calendar_feeds (workspace_id, token_sha256) values ('11000000-0000-7000-8000-000000000002', 'not-a-hash') $$,
  '23514', null, 'a calendar feed keeps a hex SHA-256 only'
);

-- Consulting requests: counted and recorded under one lock.
select is((select gms_claim_consulting_request('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@applicant-x.example', array['title', 'funder'], 3, 10) ->> 'outcome'), 'ok', 'a first consulting request is recorded');
select gms_claim_consulting_request('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@applicant-x.example', array['title'], 3, 10);
select gms_claim_consulting_request('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@applicant-x.example', array['title'], 3, 10);
select is((select gms_claim_consulting_request('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@applicant-x.example', array['title'], 3, 10) ->> 'outcome'), 'application', 'the fourth request for one application in a day is refused');
select is((select count(*)::int from public.consulting_requests where outside_application_id = '11000000-0000-7000-8000-0000000000a1'), 3, 'a refused request records nothing');
select is((select gms_claim_consulting_request('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000b1', '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@applicant-x.example', array['title'], 3, 10) ->> 'outcome'), 'not_found', 'a request names an application of its own workspace');
insert into public.outside_applications (workspace_id, title, funder_name) select '11000000-0000-7000-8000-000000000001', 'Bulk ' || i, 'Funder' from generate_series(1, 4) i;
select gms_claim_consulting_request('11000000-0000-7000-8000-000000000001', a.id, '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@applicant-x.example', array['title'], 3, 10)
  from public.outside_applications a, generate_series(1, 2) n where a.title like 'Bulk %' and a.workspace_id = '11000000-0000-7000-8000-000000000001';
select is((select count(*)::int from public.consulting_requests where workspace_id = '11000000-0000-7000-8000-000000000001'), 10, 'a workspace records at most ten requests in a day');
select is((select gms_claim_consulting_request('11000000-0000-7000-8000-000000000001', (select id from public.outside_applications where title = 'Rural clinics 2027'), '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@applicant-x.example', array['title'], 99, 10) ->> 'outcome'), 'workspace', 'the eleventh request in a workspace is refused');
select throws_ok(
  $$ insert into public.consulting_requests (workspace_id, outside_application_id, requested_by, contact_name, contact_email_masked) values
     ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1', 'Ana', 'ana@applicant-x.example') $$,
  '23514', null, 'a consulting request never keeps the full email address'
);
select throws_ok(
  $$ insert into public.consulting_requests (workspace_id, outside_application_id, requested_by, contact_name, contact_email_masked, fields_sent) values
     ('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@applicant-x.example', array['Families travel 46 miles.']) $$,
  '23514', null, 'a consulting request names the fields it sent, never their values'
);
select lives_ok(
  $$ select gms_release_consulting_request((select id from public.consulting_requests where workspace_id = '11000000-0000-7000-8000-000000000001' order by created_at limit 1)) $$,
  'the service role gives back an unsent request'
);
select is((select count(*)::int from public.consulting_requests where workspace_id = '11000000-0000-7000-8000-000000000001'), 9, 'the released request no longer counts');

-- ---------------------------------------------------------------- privacy: who reads what
reset role;
set local role authenticated;

-- A member of the owning workspace reads its rows, and only them.
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.outside_applications where workspace_id = '11000000-0000-7000-8000-000000000001'), 6, 'a viewer of X reads X''s outside applications');
select is((select count(*)::int from public.outside_applications where workspace_id <> '11000000-0000-7000-8000-000000000001'), 0, 'a member of X reads no other workspace''s');
select is((select count(*)::int from public.outside_answers), 2, 'a member of X reads X''s answer versions only');
select is((select count(*)::int from public.funder_records), 1, 'a member of X reads X''s funder records only');
select is((select count(*)::int from public.consulting_requests), 9, 'a member of X reads X''s consulting requests');
select throws_ok($$ select count(*) from public.calendar_feeds $$, '42501', null, 'a member cannot read calendar feeds at all (token hashes stay with the service role)');

-- Another applicant reads nothing of X.
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.outside_applications where workspace_id = '11000000-0000-7000-8000-000000000001'), 0, 'another applicant reads none of X''s outside applications');
select is((select count(*)::int from public.outside_questions where workspace_id = '11000000-0000-7000-8000-000000000001'), 0, 'another applicant reads none of X''s questions');
select is((select count(*)::int from public.outside_answers where workspace_id = '11000000-0000-7000-8000-000000000001'), 0, 'another applicant reads none of X''s answers');

-- A funder reads nothing, even of an applicant tracking that funder by name.
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.outside_applications) + (select count(*)::int from public.outside_questions) + (select count(*)::int from public.outside_answers)
    + (select count(*)::int from public.funder_records) + (select count(*)::int from public.consulting_requests),
  0, 'a funder reads no outside application, question, answer, funder record or consulting request'
);
select is((select count(*)::int from public.documents where subject_type = 'outside_application'), 0, 'a funder reads no document about an outside application');
select is((select count(*)::int from public.tasks where subject_type = 'outside_application'), 0, 'a funder reads no task about an outside application');

-- A consultant of X (scoped to named applications) reads none of X's outside records.
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is((select count(*)::int from public.outside_applications) + (select count(*)::int from public.outside_answers) + (select count(*)::int from public.funder_records), 0, 'a consultant of X reads no outside records');

-- Signed-in users never write and never run the service functions.
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ insert into public.outside_applications (workspace_id, title, funder_name) values ('11000000-0000-7000-8000-000000000001', 'Direct', 'X') $$, '42501', null, 'an admin of X cannot write an outside application directly');
select throws_ok($$ update public.outside_questions set prompt = 'x' $$, '42501', null, 'an admin of X cannot edit questions directly');
select throws_ok($$ select gms_claim_consulting_request('11000000-0000-7000-8000-000000000001', '11000000-0000-7000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1', 'Ana', 'a…@x.example', array['title'], 3, 10) $$, '42501', null, 'a signed-in user cannot count a consulting request');
select throws_ok($$ select gms.copy_saved_listings_to_prospects() $$, '42501', null, 'a signed-in user cannot run the prospect copy');

reset role;
set local role anon;
select throws_ok($$ select count(*) from public.outside_applications $$, '42501', null, 'anon reads nothing');

-- ---------------------------------------------------------------- saved listings become prospects (idempotent)
reset role;
insert into public.discover_saved (workspace_id, source, external_id, title, url, listing) values
  ('11000000-0000-7000-8000-000000000002', 'opengrants', 'og-41', 'Rural Health Access Fund', 'https://opengrants.example/grants/og-41', '{"funder":"Northwind","amount":"$25,000","deadline":"2027-06-01","summary":"Clinics"}'),
  ('11000000-0000-7000-8000-000000000002', 'opengrants', 'og-42', 'Bad date listing', null, '{"deadline":"2027-02-30"}'),
  ('11000000-0000-7000-8000-000000000002', 'gms', 'opp-1', 'A GMS listing', null, '{}'),
  ('11000000-0000-7000-8000-000000000002', 'alert', 'alert-1', 'An alert', null, '{}'),
  ('11000000-0000-7000-8000-000000000002', 'opengrants', 'alert:rural clinics', 'rural clinics', null, '{}');
set local role service_role;
select is(gms.copy_saved_listings_to_prospects(), 2, 'the copy makes one prospect per saved OpenGrants listing (gms rows, alert rows and alert: ids stay saved only)');
select is(gms.copy_saved_listings_to_prospects(), 0, 'running the copy again makes nothing');
select is(
  (select row(stage, source, funder_name, listing_url, full_due::text, listing ->> 'amount')::text from public.outside_applications where workspace_id = '11000000-0000-7000-8000-000000000002' and source_ref = 'og-41'),
  row('prospect', 'opengrants', 'Northwind', 'https://opengrants.example/grants/og-41', '2027-06-01', '$25,000')::text,
  'a prospect carries the listing''s title, funder, link, deadline and snapshot'
);
select is((select full_due from public.outside_applications where source_ref = 'og-42'), null::date, 'a listing deadline that is not a date is kept in the snapshot only');
select is((select count(*)::int from public.discover_saved where workspace_id = '11000000-0000-7000-8000-000000000002'), 5, 'saved rows stay in place');
select is((select count(*)::int from public.ledger_events where event_type = 'outside_application.created' and actor = 'system:migration' and workspace_id = '11000000-0000-7000-8000-000000000002'), 2, 'each copied prospect is ledgered once');

select * from finish();
rollback;
