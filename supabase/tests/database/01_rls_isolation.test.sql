-- RLS isolation: two funders, two applicants, a reviewer, an external reviewer and a consultant.
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-0000000000a1', 'admin@funder-a.example',      'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-0000000000a2', 'reviewer@funder-a.example',   'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-0000000000a3', 'external@university.example', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-0000000000a4', 'finance@funder-a.example',    'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-0000000000b1', 'admin@funder-b.example',      'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-0000000000c1', 'admin@applicant-x.example',   'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-0000000000c2', 'consultant@writers.example',  'authenticated', 'authenticated'),
  ('d0000000-0000-4000-8000-0000000000d1', 'admin@applicant-y.example',   'authenticated', 'authenticated'),
  ('e0000000-0000-4000-8000-0000000000e1', 'expired@funder-a.example',    'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('0a000000-0000-7000-8000-000000000001', 'funder',    'rls-funder-a',    'RLS Funder A'),
  ('0b000000-0000-7000-8000-000000000001', 'funder',    'rls-funder-b',    'RLS Funder B'),
  ('0c000000-0000-7000-8000-000000000001', 'applicant', 'rls-applicant-x', 'RLS Applicant X'),
  ('0d000000-0000-7000-8000-000000000001', 'applicant', 'rls-applicant-y', 'RLS Applicant Y');

insert into public.workspace_members (workspace_id, user_id, role, scope, expires_at) values
  ('0a000000-0000-7000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a1', 'admin', '{}', null),
  ('0a000000-0000-7000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a2', 'reviewer', '{}', null),
  ('0a000000-0000-7000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a3', 'external_reviewer', '{}', null),
  ('0a000000-0000-7000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a4', 'finance', '{}', null),
  ('0a000000-0000-7000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000e1', 'admin', '{}', now() - interval '1 day'),
  ('0b000000-0000-7000-8000-000000000001', 'b0000000-0000-4000-8000-0000000000b1', 'admin', '{}', null),
  ('0c000000-0000-7000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1', 'admin', '{}', null),
  ('0c000000-0000-7000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c2', 'consultant',
   '{"applicationIds":["0a000000-0000-7000-8000-0000000000a1"]}', null),
  ('0d000000-0000-7000-8000-000000000001', 'd0000000-0000-4000-8000-0000000000d1', 'admin', '{}', null);

select throws_ok(
  $$ insert into public.workspace_members (workspace_id, user_id, role) values ('0c000000-0000-7000-8000-000000000001', 'b0000000-0000-4000-8000-0000000000b1', 'program_officer') $$,
  '23514', null, 'a funder role cannot be given on an applicant workspace'
);

insert into public.consents (applicant_workspace_id, funder_workspace_id, basis) values
  ('0c000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-000000000001', 'application'),
  ('0d000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-000000000001', 'application');

insert into public.forms (id, version, workspace_id, title) values
  ('0a000000-0000-7000-8000-0000000000f1', 1, '0a000000-0000-7000-8000-000000000001', 'A draft form');
insert into public.rubrics (id, version, workspace_id, name) values
  ('0a000000-0000-7000-8000-0000000000b1', 1, '0a000000-0000-7000-8000-000000000001', 'A rubric');
insert into public.opportunities (id, workspace_id, slug, title, status, published_at) values
  ('0a000000-0000-7000-8000-0000000000e1', '0a000000-0000-7000-8000-000000000001', 'rls-open', 'A published', 'open', now()),
  ('0b000000-0000-7000-8000-0000000000e1', '0b000000-0000-7000-8000-000000000001', 'rls-draft', 'B draft', 'forecasted', null);
insert into public.competitions (id, workspace_id, opportunity_id, title, status) values
  ('0a000000-0000-7000-8000-0000000000c1', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000e1', 'A competition', 'open'),
  ('0b000000-0000-7000-8000-0000000000c1', '0b000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-0000000000e1', 'B competition', 'draft');

insert into public.applications (id, workspace_id, applicant_workspace_id, competition_id, opportunity_id, title, stage, status, cg_status, cg_custom_value, tags) values
  ('0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-000000000001', '0c000000-0000-7000-8000-000000000001',
   '0a000000-0000-7000-8000-0000000000c1', '0a000000-0000-7000-8000-0000000000e1', 'X to A', 'full', 'draft', 'inProgress', null, '{}'),
  ('0a000000-0000-7000-8000-0000000000a2', '0a000000-0000-7000-8000-000000000001', '0d000000-0000-7000-8000-000000000001',
   '0a000000-0000-7000-8000-0000000000c1', '0a000000-0000-7000-8000-0000000000e1', 'Y to A', 'full', 'under_review', 'custom', 'underReview', '{}'),
  ('0b000000-0000-7000-8000-0000000000a3', '0b000000-0000-7000-8000-000000000001', '0d000000-0000-7000-8000-000000000001',
   '0b000000-0000-7000-8000-0000000000c1', '0b000000-0000-7000-8000-0000000000e1', 'Y to B', 'full', 'submitted', 'submitted', null, '{}');

insert into public.form_responses (workspace_id, application_id, form_id, form_version, response) values
  ('0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-0000000000f1', 1, '{"q":"x"}'),
  ('0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000a2', '0a000000-0000-7000-8000-0000000000f1', 1, '{"q":"y"}');

insert into public.review_assignments (id, workspace_id, application_id, stage, reviewer_user_id, rubric_id, rubric_version) values
  ('0a000000-0000-7000-8000-0000000000d1', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000a2', 'full',
   'a0000000-0000-4000-8000-0000000000a2', '0a000000-0000-7000-8000-0000000000b1', 1),
  ('0a000000-0000-7000-8000-0000000000d2', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000a1', 'full',
   'a0000000-0000-4000-8000-0000000000a3', '0a000000-0000-7000-8000-0000000000b1', 1);
insert into public.reviews (workspace_id, assignment_id, scores) values
  ('0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000d1', '{"need":{"value":4}}'),
  ('0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000d2', '{"need":{"value":2}}');

insert into public.awards (id, workspace_id, recipient_workspace_id, title) values
  ('0a000000-0000-7000-8000-0000000000aa', '0a000000-0000-7000-8000-000000000001', '0c000000-0000-7000-8000-000000000001', 'Award A to X'),
  ('0b000000-0000-7000-8000-0000000000aa', '0b000000-0000-7000-8000-000000000001', '0d000000-0000-7000-8000-000000000001', 'Award B to Y');
insert into public.payment_schedules (id, workspace_id, award_id) values
  ('0a000000-0000-7000-8000-0000000000ab', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000aa'),
  ('0b000000-0000-7000-8000-0000000000ab', '0b000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-0000000000aa');
insert into public.tranches (workspace_id, schedule_id, award_id, seq, amount_minor) values
  ('0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000ab', '0a000000-0000-7000-8000-0000000000aa', 1, 100000),
  ('0b000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-0000000000ab', '0b000000-0000-7000-8000-0000000000aa', 1, 200000);

insert into public.grantee_records (workspace_id, applicant_workspace_id, notes) values
  ('0a000000-0000-7000-8000-000000000001', '0c000000-0000-7000-8000-000000000001', 'internal note about X');
insert into public.threads (id, workspace_id, funder_workspace_id, applicant_workspace_id, subject_type, subject_id, visibility) values
  ('0a000000-0000-7000-8000-000000000071', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-000000000001', '0c000000-0000-7000-8000-000000000001', 'application', '0a000000-0000-7000-8000-0000000000a1', 'shared'),
  ('0a000000-0000-7000-8000-000000000072', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-000000000001', null, 'application', '0a000000-0000-7000-8000-0000000000a1', 'funder_internal');
insert into public.messages (thread_id, author, body) values
  ('0a000000-0000-7000-8000-000000000071', 'user:a0000000-0000-4000-8000-0000000000a1', 'shared hello'),
  ('0a000000-0000-7000-8000-000000000072', 'user:a0000000-0000-4000-8000-0000000000a1', 'internal note');
insert into public.passport_links (workspace_id, mode, client_id, client_secret_enc) values
  ('0a000000-0000-7000-8000-000000000001', 'funder_client', 'client-a', 'ciphertext-not-a-secret');
insert into public.bank_transactions (workspace_id, provider, external_txn_id, amount_minor, posted_at) values
  ('0a000000-0000-7000-8000-000000000001', 'mercury', 'rls-test-txn-1', -100000, now());
insert into public.ledger_events (workspace_id, actor, event_type) values
  ('0a000000-0000-7000-8000-000000000001', 'system:test', 'workspace.created'),
  ('0b000000-0000-7000-8000-000000000001', 'system:test', 'workspace.created');

-- ---------------------------------------------------------------- funder A admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

select results_eq(
  $$ select display_name from public.workspaces where handle like 'rls-%' order by 1 $$,
  array['RLS Applicant X', 'RLS Applicant Y', 'RLS Funder A'],
  'funder A admin sees its own workspace and the applicants that consented, not funder B'
);
select results_eq(
  $$ select title from public.applications where title like '% to %' order by 1 $$,
  array['X to A', 'Y to A'], 'funder A admin sees applications to A only'
);
select is_empty($$ select 1 from public.awards where workspace_id = '0b000000-0000-7000-8000-000000000001' $$, 'funder A admin cannot see funder B awards');
select is_empty($$ select 1 from public.tranches where workspace_id = '0b000000-0000-7000-8000-000000000001' $$, 'funder A admin cannot see funder B tranches');
select is_empty($$ select 1 from public.opportunities where id = '0b000000-0000-7000-8000-0000000000e1' $$, 'funder A admin cannot see funder B''s unpublished opportunity');
select is_empty($$ select 1 from public.competitions where id = '0b000000-0000-7000-8000-0000000000c1' $$, 'funder A admin cannot see funder B''s draft competition');
select is_empty($$ select 1 from public.workspace_members where workspace_id = '0b000000-0000-7000-8000-000000000001' $$, 'funder A admin cannot see funder B members');
select is((select count(*)::int from public.ledger_events where workspace_id in ('0a000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-000000000001')), 1, 'funder A admin reads only A''s ledger');
select is((select count(*)::int from public.messages m join public.threads t on t.id = m.thread_id where t.subject_id = '0a000000-0000-7000-8000-0000000000a1'), 2, 'funder A admin sees shared and internal messages');
select throws_ok($$ select 1 from public.passport_links $$, '42501', null, 'passport_links is not readable with a user key');
select throws_ok($$ select 1 from public.api_clients $$, '42501', null, 'api_clients is not readable with a user key');
select throws_ok($$ select 1 from public.oauth_grants $$, '42501', null, 'oauth_grants is not readable with a user key');
select throws_ok($$ select secret_enc from public.connector_accounts $$, '42501', null, 'connector secrets are not readable with a user key');
select throws_ok(
  $$ update public.applications set status = 'accepted' where id = '0a000000-0000-7000-8000-0000000000a1' $$,
  '42501', null, 'users cannot write a status column directly'
);
select throws_ok(
  $$ update public.tranches set status = 'settled' where workspace_id = '0a000000-0000-7000-8000-000000000001' $$,
  '42501', null, 'users cannot mark a tranche settled'
);
select throws_ok(
  $$ insert into public.workspace_members (workspace_id, user_id, role) values ('0b000000-0000-7000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a1', 'admin') $$,
  '42501', null, 'users cannot add themselves to another workspace'
);

-- ---------------------------------------------------------------- funder A finance vs. reviewer
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
select isnt_empty($$ select 1 from public.bank_transactions where external_txn_id = 'rls-test-txn-1' $$, 'finance sees bank transactions');
select is_empty($$ select 1 from public.ledger_events where workspace_id = '0a000000-0000-7000-8000-000000000001' $$, 'finance does not read the ledger (admin and auditor only)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select results_eq(
  $$ select title from public.applications where title like '% to %' order by 1 $$,
  array['Y to A'], 'an internal reviewer sees only the application assigned to them'
);
select is((select count(*)::int from public.reviews where workspace_id = '0a000000-0000-7000-8000-000000000001'), 1, 'a reviewer sees only their own review (blind until the panel)');
select is_empty($$ select 1 from public.form_responses where workspace_id = '0a000000-0000-7000-8000-000000000001' $$, 'reviewers get no direct read of form responses (masked through the API)');
select is_empty($$ select 1 from public.bank_transactions $$, 'reviewers cannot see bank transactions');
select is_empty($$ select 1 from public.grantee_records $$, 'reviewers cannot see grantee records');
select is_empty($$ select 1 from public.awards where workspace_id = '0a000000-0000-7000-8000-000000000001' $$, 'reviewers cannot see awards');

-- ---------------------------------------------------------------- applicant X admin
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select results_eq(
  $$ select title from public.applications where title like '% to %' order by 1 $$,
  array['X to A'], 'applicant X sees only its own application'
);
select results_eq(
  $$ select response ->> 'q' from public.form_responses where workspace_id = '0a000000-0000-7000-8000-000000000001' $$,
  array['x'], 'applicant X reads only its own form responses'
);
select results_eq(
  $$ select title from public.awards where title like 'Award %' $$, array['Award A to X'], 'applicant X sees its own award');
select is((select count(*)::int from public.tranches where award_id = '0a000000-0000-7000-8000-0000000000aa'), 1, 'applicant X sees the tranches of its award');
select results_eq(
  $$ select m.body from public.messages m join public.threads t on t.id = m.thread_id where t.subject_id = '0a000000-0000-7000-8000-0000000000a1' $$,
  array['shared hello'], 'applicant X sees the shared thread and not the funder-internal one'
);
select is_empty($$ select 1 from public.grantee_records $$, 'a grantee never sees the funder''s relationship notes');
select is_empty($$ select 1 from public.reviews $$, 'an applicant never sees reviews');
select is_empty($$ select 1 from public.review_assignments $$, 'an applicant never sees who reviews them');
select is_empty($$ select 1 from public.decisions $$, 'an applicant never reads decision rows');
select results_eq(
  $$ select display_name from public.workspaces where handle like 'rls-%' order by 1 $$,
  array['RLS Applicant X', 'RLS Funder A'], 'applicant X sees itself and the funder it applied to'
);

-- ---------------------------------------------------------------- consultant scoped to one application
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
select results_eq(
  $$ select title from public.applications where title like '% to %' $$, array['X to A'], 'a consultant sees the application in their scope');
select is_empty($$ select 1 from public.awards where title like 'Award %' $$, 'a consultant without an award scope sees no awards');

-- ---------------------------------------------------------------- expired member, anon
select set_config('request.jwt.claims', '{"sub":"e0000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
select is_empty($$ select 1 from public.applications where title like '% to %' $$, 'an expired membership grants nothing');

reset role;
set local role anon;
select throws_ok($$ select 1 from public.opportunities $$, '42501', null, 'anon has no table access, even to published opportunities');

select * from finish();
rollback;
