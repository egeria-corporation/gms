-- Invites into a draft and AI summaries (0032): the daily invitation limit holds for every writer,
-- dismissed notes are kept per member, and an application's summary is the service role's alone,
-- one per response version, in the application's own workspace, never edited.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('13000000-0000-4000-8000-0000000000a1', 'admin@is-applicant.example', 'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000f1', 'officer@is-funder.example',  'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('13000000-0000-7000-8000-000000000001', 'applicant', 'is-applicant', 'IS Applicant'),
  ('13000000-0000-7000-8000-000000000002', 'applicant', 'is-applicant-b', 'IS Applicant B'),
  ('13000000-0000-7000-8000-000000000003', 'funder',    'is-funder',    'IS Funder'),
  ('13000000-0000-7000-8000-000000000004', 'funder',    'is-funder-b',  'IS Funder B');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000a1', 'admin'),
  ('13000000-0000-7000-8000-000000000003', '13000000-0000-4000-8000-0000000000f1', 'program_officer');

insert into public.opportunities (id, workspace_id, slug, title) values ('13000000-0000-7000-8000-0000000000b1', '13000000-0000-7000-8000-000000000003', 'is-opp', 'IS opportunity');
insert into public.competitions (id, workspace_id, opportunity_id, title) values ('13000000-0000-7000-8000-0000000000c1', '13000000-0000-7000-8000-000000000003', '13000000-0000-7000-8000-0000000000b1', 'IS competition');
insert into public.applications (id, workspace_id, applicant_workspace_id, competition_id, opportunity_id, stage) values
  ('13000000-0000-7000-8000-0000000000d1', '13000000-0000-7000-8000-000000000003', '13000000-0000-7000-8000-000000000001', '13000000-0000-7000-8000-0000000000c1', '13000000-0000-7000-8000-0000000000b1', 'loi');

set local role service_role;

-- ---------------------------------------------------------------- invitations: 20 a day per workspace
select is(gms.invitations_per_day(), 20, 'a workspace may create 20 invitations a day');
insert into public.invitations (workspace_id, email, role, scope, token_hash, expires_at)
  select '13000000-0000-7000-8000-000000000001', 'writer' || i || '@is-team.example', 'consultant',
         jsonb_build_object('draft', jsonb_build_object('kind', 'outside_application', 'id', gen_random_uuid())), 'hash-' || i, now() + interval '14 days'
    from generate_series(1, 20) i;
select is((select count(*)::int from public.invitations where workspace_id = '13000000-0000-7000-8000-000000000001'), 20, 'twenty invitations in one day are kept');
select throws_ok(
  $$ insert into public.invitations (workspace_id, email, role, token_hash, expires_at) values ('13000000-0000-7000-8000-000000000001', 'one-more@is-team.example', 'consultant', 'hash-21', now() + interval '14 days') $$,
  '23514', 'invitations: the daily invitation limit for this workspace is reached', 'the 21st invitation of the day is refused, the service role included'
);
select lives_ok(
  $$ insert into public.invitations (workspace_id, email, role, token_hash, expires_at) values ('13000000-0000-7000-8000-000000000002', 'first@is-team.example', 'editor', 'hash-b1', now() + interval '14 days') $$,
  'another workspace has its own count'
);
select lives_ok(
  $$ update public.invitations set accepted_at = now() where token_hash = 'hash-1' $$,
  'accepting an invitation is not limited'
);
-- Invitations older than a day no longer count.
reset role;
update public.invitations set created_at = now() - interval '25 hours' where token_hash in ('hash-1', 'hash-2');
set local role service_role;
select lives_ok(
  $$ insert into public.invitations (workspace_id, email, role, token_hash, expires_at) values ('13000000-0000-7000-8000-000000000001', 'next-day@is-team.example', 'consultant', 'hash-22', now() + interval '14 days') $$,
  'the day is rolling: invitations older than 24 hours give their place back'
);

-- ---------------------------------------------------------------- dismissed notes
select is(
  (select dismissed_notes from public.workspace_members where user_id = '13000000-0000-4000-8000-0000000000a1'),
  '{}'::text[],
  'a member starts with no dismissed notes'
);
select lives_ok(
  $$ update public.workspace_members set dismissed_notes = array['invite_teammate'] where user_id = '13000000-0000-4000-8000-0000000000a1' $$,
  'a member keeps the notes they dismissed'
);
select throws_ok(
  $$ update public.workspace_members set dismissed_notes = (select array_agg('note_' || i) from generate_series(1, 21) i) where user_id = '13000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'at most 20 dismissed notes'
);

-- ---------------------------------------------------------------- application summaries
select lives_ok(
  $$ insert into public.application_summaries (workspace_id, application_id, response_version, summary, model, generated_by)
     values ('13000000-0000-7000-8000-000000000003', '13000000-0000-7000-8000-0000000000d1', repeat('a', 64), '{"summary":"Asks for rides."}', 'test-model', '13000000-0000-4000-8000-0000000000f1') $$,
  'the service role keeps a summary in the application''s workspace'
);
select throws_ok(
  $$ insert into public.application_summaries (workspace_id, application_id, response_version, summary, model)
     values ('13000000-0000-7000-8000-000000000003', '13000000-0000-7000-8000-0000000000d1', repeat('a', 64), '{"summary":"Again."}', 'test-model') $$,
  '23505', null, 'one summary per application and response version'
);
select throws_ok(
  $$ insert into public.application_summaries (workspace_id, application_id, response_version, summary, model)
     values ('13000000-0000-7000-8000-000000000004', '13000000-0000-7000-8000-0000000000d1', repeat('b', 64), '{"summary":"Planted."}', 'test-model') $$,
  '23514', null, 'a summary cannot sit in another workspace than its application'
);
select throws_ok(
  $$ insert into public.application_summaries (workspace_id, application_id, response_version, summary, model)
     values ('13000000-0000-7000-8000-000000000003', '13000000-0000-7000-8000-0000000000d1', 'v2', '{"summary":"x"}', 'test-model') $$,
  '23514', null, 'the response version is a SHA-256 in hex'
);
select throws_ok(
  $$ update public.application_summaries set summary = '{"summary":"Edited."}' where application_id = '13000000-0000-7000-8000-0000000000d1' $$,
  '42501', null, 'a summary is never edited, not even by the service role'
);

-- Signed-in people never read summaries directly; they come through the API.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.application_summaries $$, '42501', null, 'a funder member cannot read summaries directly');
select throws_ok($$ select count(*) from public.invitations $$, '42501', null, 'nor invitations');

select * from finish();
rollback;
