-- Write faster and win and keep it (0030): the answer library's new columns, the document vault,
-- required documents, go/no-go, closeout, comment threads on outside applications and the
-- obligations of an outside award. Writes run as the service role (the API's role); reads are
-- checked as members of the owning workspace, another applicant, a funder and a consultant.
begin;
create extension if not exists pgtap with schema extensions;

select plan(54);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('12000000-0000-4000-8000-0000000000a1', 'admin@wk-applicant-x.example',  'authenticated', 'authenticated'),
  ('12000000-0000-4000-8000-0000000000a2', 'viewer@wk-applicant-x.example', 'authenticated', 'authenticated'),
  ('12000000-0000-4000-8000-0000000000a3', 'writer@wk-consultants.example', 'authenticated', 'authenticated'),
  ('12000000-0000-4000-8000-0000000000b1', 'admin@wk-applicant-y.example',  'authenticated', 'authenticated'),
  ('12000000-0000-4000-8000-0000000000f1', 'admin@wk-funder.example',       'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('12000000-0000-7000-8000-000000000001', 'applicant', 'wk-applicant-x', 'WK Applicant X'),
  ('12000000-0000-7000-8000-000000000002', 'applicant', 'wk-applicant-y', 'WK Applicant Y'),
  ('12000000-0000-7000-8000-000000000003', 'funder',    'wk-funder',      'WK Funder');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('12000000-0000-7000-8000-000000000001', '12000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('12000000-0000-7000-8000-000000000001', '12000000-0000-4000-8000-0000000000a2', 'viewer', '{}'),
  ('12000000-0000-7000-8000-000000000001', '12000000-0000-4000-8000-0000000000a3', 'consultant', '{"applicationIds":[]}'),
  ('12000000-0000-7000-8000-000000000002', '12000000-0000-4000-8000-0000000000b1', 'admin', '{}'),
  ('12000000-0000-7000-8000-000000000003', '12000000-0000-4000-8000-0000000000f1', 'admin', '{}');

set local role service_role;

-- ---------------------------------------------------------------- answer library
insert into public.answers (id, workspace_id, key, title, body) values
  ('12000000-0000-7000-8000-0000000000e1', '12000000-0000-7000-8000-000000000001', 'mission', 'Mission', 'We run rural clinics.');
select is(
  (select row(last_verified_at, variants, tags)::text from public.answers where id = '12000000-0000-7000-8000-0000000000e1'),
  row(null::timestamptz, '{}'::jsonb, '{}'::text[])::text,
  'a new answer is never verified, with no variants and no tags'
);
select lives_ok(
  $$ update public.answers set last_verified_at = now(), variants = '{"short":"Clinics.","long":"We run rural clinics in three counties."}', tags = array['mission', 'health']
     where id = '12000000-0000-7000-8000-0000000000e1' $$,
  'an answer takes a verified date, short and long variants and tags'
);
select throws_ok($$ update public.answers set variants = '{"tiny":"x"}' where id = '12000000-0000-7000-8000-0000000000e1' $$, '23514', null, 'variants are short, medium or long only');
select throws_ok($$ update public.answers set variants = '{"short":5}' where id = '12000000-0000-7000-8000-0000000000e1' $$, '23514', null, 'a variant is text');
select throws_ok($$ update public.answers set tags = array[' padded'] where id = '12000000-0000-7000-8000-0000000000e1' $$, '23514', null, 'a tag has no outer spaces');
select throws_ok($$ update public.answers set tags = (select array_agg('t' || i) from generate_series(1, 21) i) where id = '12000000-0000-7000-8000-0000000000e1' $$, '23514', null, 'at most 20 tags');

-- ---------------------------------------------------------------- document vault
insert into public.documents (id, workspace_id, owner_workspace_id, subject_type, name, mime, size, sha256, storage, path, doc_type, expires_on) values
  ('12000000-0000-7000-8000-0000000000d1', '12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-000000000001', 'vault', 'IRS letter.pdf', 'application/pdf', 10, repeat('a', 64), 'r2', 'vault/1', 'irs_letter', null),
  ('12000000-0000-7000-8000-0000000000d2', '12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-000000000001', 'vault', 'Audit 2025.pdf', 'application/pdf', 10, repeat('b', 64), 'r2', 'vault/2', 'audit', '2027-06-30'),
  ('12000000-0000-7000-8000-0000000000d3', '12000000-0000-7000-8000-000000000002', '12000000-0000-7000-8000-000000000002', 'vault', 'Y budget.xlsx', 'application/octet-stream', 10, repeat('c', 64), 'r2', 'vault/3', 'budget', null);
select pass('the service role keeps vault documents with a type and an expiry');
select throws_ok(
  $$ insert into public.documents (workspace_id, owner_workspace_id, subject_type, name, mime, size, sha256, storage, path) values
     ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-000000000001', 'vault', 'Untyped.pdf', 'application/pdf', 1, repeat('d', 64), 'r2', 'p') $$,
  '23514', null, 'a vault document has a type'
);
select throws_ok(
  $$ insert into public.documents (workspace_id, owner_workspace_id, subject_type, name, mime, size, sha256, storage, path, doc_type) values
     ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-000000000001', 'vault', 'Bank letter.pdf', 'application/pdf', 1, repeat('d', 64), 'r2', 'p', 'bank_letter') $$,
  '23514', null, 'there is no vault type for bank letters'
);
select throws_ok(
  $$ insert into public.documents (workspace_id, owner_workspace_id, subject_type, name, mime, size, sha256, storage, path, doc_type) values
     ('12000000-0000-7000-8000-000000000003', '12000000-0000-7000-8000-000000000003', 'vault', 'Funder file.pdf', 'application/pdf', 1, repeat('d', 64), 'r2', 'p', 'other') $$,
  '23514', null, 'the vault belongs to applicant workspaces'
);
select throws_ok(
  $$ insert into public.documents (workspace_id, owner_workspace_id, subject_type, name, mime, size, sha256, storage, path, doc_type) values
     ('12000000-0000-7000-8000-000000000003', '12000000-0000-7000-8000-000000000001', 'vault', 'Shared.pdf', 'application/pdf', 1, repeat('d', 64), 'r2', 'p', 'other') $$,
  '23514', null, 'a vault document is kept in the workspace that owns it'
);
select throws_ok(
  $$ insert into public.documents (workspace_id, owner_workspace_id, subject_type, subject_id, name, mime, size, sha256, storage, path, doc_type) values
     ('12000000-0000-7000-8000-000000000003', '12000000-0000-7000-8000-000000000001', 'application', gen_random_uuid(), 'Typed.pdf', 'application/pdf', 1, repeat('d', 64), 'r2', 'p', 'audit') $$,
  '23514', null, 'a document outside the vault has no vault type'
);
select throws_ok(
  $$ insert into public.documents (workspace_id, owner_workspace_id, subject_type, subject_id, name, mime, size, sha256, storage, path, expires_on) values
     ('12000000-0000-7000-8000-000000000003', '12000000-0000-7000-8000-000000000001', 'application', gen_random_uuid(), 'Expiring.pdf', 'application/pdf', 1, repeat('d', 64), 'r2', 'p', '2030-01-01') $$,
  '23514', null, 'only vault documents expire'
);

-- ---------------------------------------------------------------- outside applications: checklist, go/no-go, closeout
insert into public.outside_applications (id, workspace_id, title, funder_name, stage, submitted_at, submission_method, awarded_amount_minor, grant_start, grant_end, required_documents) values
  ('12000000-0000-7000-8000-0000000000a1', '12000000-0000-7000-8000-000000000001', 'Clinic grant', 'Northwind', 'awarded', now(), 'portal', 6000000, '2027-01-01', '2028-12-31',
   '[{"label":"IRS determination letter","docType":"irs_letter","documentId":"12000000-0000-7000-8000-0000000000d1","status":"attached"},{"label":"Board list","docType":"board_list","status":"needed"}]'),
  ('12000000-0000-7000-8000-0000000000a2', '12000000-0000-7000-8000-000000000001', 'Deciding one', 'Southwind', 'deciding', null, null, null, null, null, '[]'),
  ('12000000-0000-7000-8000-0000000000b1', '12000000-0000-7000-8000-000000000002', 'Y''s award', 'Northwind', 'awarded', now(), 'email', 100, null, null, '[]');
select pass('outside applications keep required documents');
select is((select required_documents from public.outside_applications where id = '12000000-0000-7000-8000-0000000000a2'), '[]'::jsonb, 'required documents default to none');
select throws_ok(
  $$ update public.outside_applications set required_documents = '[{"label":"Letter","status":"attached"}]' where id = '12000000-0000-7000-8000-0000000000a2' $$,
  '23514', null, 'an attached required document names its document'
);
select throws_ok(
  $$ update public.outside_applications set required_documents = '[{"label":"Voided check","docType":"voided_check","status":"needed"}]' where id = '12000000-0000-7000-8000-0000000000a2' $$,
  '23514', null, 'a required document matches only the vault types'
);
select throws_ok(
  $$ update public.outside_applications set required_documents = (select jsonb_agg(jsonb_build_object('label', 'Doc ' || i, 'status', 'needed')) from generate_series(1, 51) i) where id = '12000000-0000-7000-8000-0000000000a2' $$,
  '23514', null, 'at most 50 required documents'
);
select lives_ok(
  $$ update public.outside_applications set go_no_go = '{"scores":{"eligibility":"pass","fit":4,"capacity":3,"effort":3,"relationship":2},"weights":{"fit":3,"capacity":2,"effort":2,"relationship":1},"total":0.68,"decision":"go","decidedBy":"12000000-0000-4000-8000-0000000000a1","decidedAt":"2026-11-14T12:00:00Z","reason":null}'
     where id = '12000000-0000-7000-8000-0000000000a2' $$,
  'an application keeps its go/no-go scorecard'
);
select throws_ok(
  $$ update public.outside_applications set go_no_go = '{"scores":{},"total":1,"decision":"maybe"}' where id = '12000000-0000-7000-8000-0000000000a2' $$,
  '23514', null, 'the decision is go or no_go'
);
select throws_ok(
  $$ update public.outside_applications set go_no_go = '{"scores":{},"total":1}' where id = '12000000-0000-7000-8000-0000000000a2' $$,
  '23514', null, 'a scorecard is kept with its decision'
);
select throws_ok(
  $$ update public.outside_applications set closed_out_at = now() where id = '12000000-0000-7000-8000-0000000000a2' $$,
  '23514', null, 'only an awarded application is closed out'
);
select lives_ok(
  $$ update public.outside_applications set closed_out_at = now() where id = '12000000-0000-7000-8000-0000000000a1' $$,
  'an awarded application is closed out'
);
update public.outside_applications set closed_out_at = null where id = '12000000-0000-7000-8000-0000000000a1';

insert into public.documents (id, workspace_id, owner_workspace_id, subject_type, subject_id, name, mime, size, sha256, storage, path, doc_type) values
  ('12000000-0000-7000-8000-0000000000d4', '12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-000000000001', 'outside_application', '12000000-0000-7000-8000-0000000000a1', 'Guidelines.pdf', 'application/pdf', 1, repeat('e', 64), 'r2', 'g', 'funder_guidelines');
select pass('an outside application keeps the funder''s guidelines as a typed document');

-- ---------------------------------------------------------------- obligations
insert into public.outside_obligation_series (id, workspace_id, outside_application_id, kind, title, every_months, start_on, end_on) values
  ('12000000-0000-7000-8000-0000000000c1', '12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'report', 'Progress report', 6, '2027-01-01', '2028-12-31');
insert into public.outside_obligations (id, workspace_id, outside_application_id, kind, title, due_on, status, series_id) values
  ('12000000-0000-7000-8000-0000000000f1', '12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'report', 'Progress report 1', '2027-07-01', 'upcoming', '12000000-0000-7000-8000-0000000000c1'),
  ('12000000-0000-7000-8000-0000000000f2', '12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'report', 'Progress report 2', '2028-01-01', 'upcoming', '12000000-0000-7000-8000-0000000000c1');
insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, due_on, amount_minor, status) values
  ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'payment_received', 'First payment', '2027-01-15', 3000000, 'received'),
  ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'payment_expected', 'Second payment', '2028-01-15', 3000000, 'upcoming'),
  ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'condition', 'Name the funder on signage', null, null, 'upcoming'),
  ('12000000-0000-7000-8000-000000000002', '12000000-0000-7000-8000-0000000000b1', 'condition', 'Y''s condition', null, null, 'upcoming');
select pass('the service role records reports, payments and conditions, in series or one by one');

select throws_ok(
  $$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, due_on, status) values ('12000000-0000-7000-8000-000000000003', '12000000-0000-7000-8000-0000000000a1', 'condition', 'Funder side', null, 'upcoming') $$,
  '23514', null, 'obligations belong to applicant workspaces'
);
select throws_ok(
  $$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, due_on, status) values ('12000000-0000-7000-8000-000000000002', '12000000-0000-7000-8000-0000000000a1', 'condition', 'Another workspace''s award', null, 'upcoming') $$,
  '23514', null, 'an obligation cannot hang off another workspace''s application'
);
select throws_ok(
  $$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, due_on, amount_minor, status) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'report', 'Report with money', '2027-01-01', 5, 'upcoming') $$,
  '23514', null, 'only payments carry an amount'
);
select throws_ok(
  $$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, due_on, status) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'payment_received', 'No amount', '2027-01-01', 'received') $$,
  '23514', null, 'a payment received has an amount and a date'
);
select throws_ok(
  $$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, due_on, amount_minor, status) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'payment_expected', 'Negative', '2027-01-01', -1, 'upcoming') $$,
  '23514', null, 'amounts are never negative'
);
select throws_ok(
  $$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, due_on, status) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'condition', 'Received condition', null, 'received') $$,
  '23514', null, 'a condition is never received'
);
select throws_ok(
  $$ update public.outside_obligations set status = 'submitted' where id = '12000000-0000-7000-8000-0000000000f1' $$,
  '23514', null, 'a submitted report has its submission time'
);
select throws_ok(
  $$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, status) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'report', 'Undated report', 'upcoming') $$,
  '23514', null, 'a report has a due date'
);
select throws_ok(
  $$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, due_on, status, series_id) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a2', 'report', 'Wrong series', '2027-01-01', 'upcoming', '12000000-0000-7000-8000-0000000000c1') $$,
  '23514', null, 'an obligation''s series belongs to the same application'
);
select throws_ok(
  $$ insert into public.outside_obligation_series (workspace_id, outside_application_id, kind, title, every_months, start_on, end_on) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'report', 'Backwards', 6, '2028-01-01', '2027-01-01') $$,
  '23514', null, 'a series ends after it starts'
);

-- A report's questions.
insert into public.outside_questions (id, workspace_id, outside_application_id, phase, prompt, obligation_id) values
  ('12000000-0000-7000-8000-0000000000aa', '12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'report', 'What changed this period?', '12000000-0000-7000-8000-0000000000f1');
select pass('a report obligation holds its own questions');
select throws_ok(
  $$ insert into public.outside_questions (workspace_id, outside_application_id, phase, prompt, obligation_id) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'full', 'Not a report question', '12000000-0000-7000-8000-0000000000f1') $$,
  '23514', null, 'a question of a report is phase report'
);
select throws_ok(
  $$ insert into public.outside_questions (workspace_id, outside_application_id, phase, prompt, obligation_id) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a2', 'report', 'Other application', '12000000-0000-7000-8000-0000000000f1') $$,
  '23514', null, 'a report''s question belongs to the report''s application'
);

-- Provenance 'assist'.
insert into public.outside_answers (workspace_id, question_id, version, body, provenance) values
  ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000aa', 1, 'Drafted with the assistant and accepted.', 'assist');
select pass('an accepted assistant draft is saved with provenance assist');
select throws_ok(
  $$ insert into public.outside_answers (workspace_id, question_id, version, body, provenance) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000aa', 2, 'x', 'ai') $$,
  '23514', null, 'provenance stays a fixed vocabulary'
);
insert into public.assist_calls (workspace_id, tool) values ('12000000-0000-7000-8000-000000000001', 'draft_answer'), ('12000000-0000-7000-8000-000000000001', 'parse_guidelines');
select pass('the assistant log records drafting answers and reading guidelines');

-- Comments per question: an applicant-internal thread in the application's own workspace.
insert into public.threads (id, workspace_id, applicant_workspace_id, subject_type, subject_id, visibility, title) values
  ('12000000-0000-7000-8000-0000000000ab', '12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-000000000001', 'outside_application', '12000000-0000-7000-8000-0000000000a1', 'applicant_internal', 'Team comments');
insert into public.messages (thread_id, author, author_user_id, body, field_ref) values
  ('12000000-0000-7000-8000-0000000000ab', 'user:12000000-0000-4000-8000-0000000000a1', '12000000-0000-4000-8000-0000000000a1', 'Can we cite the county numbers?', '{"questionId":"12000000-0000-7000-8000-0000000000aa"}');
select pass('a comment on an outside application''s question is a message in its internal thread');
select throws_ok(
  $$ insert into public.threads (workspace_id, funder_workspace_id, applicant_workspace_id, subject_type, subject_id, visibility) values
     ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-000000000003', '12000000-0000-7000-8000-000000000001', 'outside_application', '12000000-0000-7000-8000-0000000000a1', 'shared') $$,
  '23514', null, 'an outside application''s thread is never shared with a funder'
);
select throws_ok(
  $$ insert into public.threads (workspace_id, applicant_workspace_id, subject_type, subject_id, visibility) values
     ('12000000-0000-7000-8000-000000000002', '12000000-0000-7000-8000-000000000002', 'outside_application', '12000000-0000-7000-8000-0000000000a1', 'applicant_internal') $$,
  '23514', null, 'a thread about an outside application sits in that application''s workspace'
);

-- ---------------------------------------------------------------- privacy: who reads what
reset role;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.outside_obligations), 5, 'a viewer of X reads X''s obligations, and only them');
select is((select count(*)::int from public.outside_obligation_series), 1, 'a viewer of X reads X''s series');
select is((select count(*)::int from public.documents where subject_type = 'vault'), 2, 'a viewer of X reads X''s vault, and only it');
select is((select count(*)::int from public.messages m join public.threads t on t.id = m.thread_id where t.subject_type = 'outside_application'), 1, 'a viewer of X reads the comments on X''s questions');

select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.outside_obligations where workspace_id = '12000000-0000-7000-8000-000000000001')
    + (select count(*)::int from public.outside_obligation_series where workspace_id = '12000000-0000-7000-8000-000000000001')
    + (select count(*)::int from public.documents where workspace_id = '12000000-0000-7000-8000-000000000001')
    + (select count(*)::int from public.threads where workspace_id = '12000000-0000-7000-8000-000000000001'),
  0, 'another applicant reads none of X''s obligations, series, vault or comment threads'
);

select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.outside_obligations) + (select count(*)::int from public.outside_obligation_series)
    + (select count(*)::int from public.documents where subject_type in ('vault', 'outside_application'))
    + (select count(*)::int from public.threads where subject_type = 'outside_application'),
  0, 'a funder reads no obligation, series, vault document, guidelines or comment thread'
);

select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.outside_obligations) + (select count(*)::int from public.outside_obligation_series)
    + (select count(*)::int from public.documents where subject_type = 'vault'),
  0, 'a consultant of X reads no obligation, series or vault document'
);
select is(
  (select count(*)::int from public.threads where subject_type = 'outside_application') + (select count(*)::int from public.messages),
  0, 'a consultant of X reads no comment thread or comment on an outside application'
);

select set_config('request.jwt.claims', '{"sub":"12000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ insert into public.outside_obligations (workspace_id, outside_application_id, kind, title, status) values ('12000000-0000-7000-8000-000000000001', '12000000-0000-7000-8000-0000000000a1', 'condition', 'Direct', 'upcoming') $$, '42501', null, 'an admin of X cannot write an obligation directly');

reset role;
set local role anon;
select throws_ok($$ select count(*) from public.outside_obligations $$, '42501', null, 'anon reads no obligations');

select * from finish();
rollback;
