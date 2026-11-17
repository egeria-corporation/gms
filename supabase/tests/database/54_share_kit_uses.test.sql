-- Share-kit downloads, counted only (0054), and measure 6 counting them: an award with a download
-- and no social post counts as shared; a count names no one and stays with the award's workspace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into public.workspaces (id, kind, handle, display_name, status, created_at) values
  ('54000000-0000-7000-8000-000000000001', 'funder',    'kit-uses-funder',  'Kit Uses Funder',  'active', now() - interval '200 days'),
  ('54000000-0000-7000-8000-000000000002', 'applicant', 'kit-uses-grantee', 'Kit Uses Grantee', 'active', now() - interval '200 days');
insert into public.programs (id, workspace_id, name, fiscal_year, currency) values
  ('54000000-0000-7000-8000-0000000000b1', '54000000-0000-7000-8000-000000000001', 'Kit uses', 2027, 'USD');
-- Three awards made in the window: one with a download only, one with a failed post only, one with nothing.
insert into public.awards (id, workspace_id, program_id, recipient_workspace_id, title, status, created_at) values
  ('54000000-0000-7000-8000-0000000000a1', '54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000b1', '54000000-0000-7000-8000-000000000002', 'Downloaded', 'active', now() - interval '3 days'),
  ('54000000-0000-7000-8000-0000000000a2', '54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000b1', '54000000-0000-7000-8000-000000000002', 'Failed post', 'active', now() - interval '3 days'),
  ('54000000-0000-7000-8000-0000000000a3', '54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000b1', '54000000-0000-7000-8000-000000000002', 'Nothing yet', 'active', now() - interval '3 days');

create temp table t_before as select public.gms_operator_measures(now(), 30, 14) as m;

-- ---------------------------------------------------------------- the service role counts uses
set local role service_role;
select lives_ok(
  $$ insert into public.share_kit_uses (workspace_id, award_id, kind, used_on) values
     ('54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000a1', 'carousel', current_date),
     ('54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000a1', 'portrait', current_date),
     ('54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000a1', 'press_release', current_date - 1) $$,
  'the carousel, the portrait card and the press release are counted'
);
select throws_ok(
  $$ insert into public.share_kit_uses (workspace_id, award_id, kind, used_on) values ('54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000a1', 'carousel', current_date) $$,
  '23505', null, 'once per award, part and day'
);
select throws_ok(
  $$ insert into public.share_kit_uses (workspace_id, award_id, kind, used_on) values ('54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000a2', 'social_post', current_date) $$,
  '23514', null, 'only the three parts of the kit'
);
select throws_ok(
  $$ insert into public.share_kit_uses (workspace_id, award_id, kind, used_on) values ('54000000-0000-7000-8000-000000000002', '54000000-0000-7000-8000-0000000000a2', 'portrait', current_date) $$,
  '23514', null, 'a count belongs to the award''s own workspace, whichever side downloaded'
);
select throws_ok(
  $$ update public.share_kit_uses set workspace_id = '54000000-0000-7000-8000-000000000002' where award_id = '54000000-0000-7000-8000-0000000000a1' $$,
  null, null, 'and is never moved to another'
);
reset role;
insert into public.social_posts (workspace_id, subject_type, subject_id, idempotency_key, payload_sha256, platforms, status, created_by)
  values ('54000000-0000-7000-8000-000000000001', 'award', '54000000-0000-7000-8000-0000000000a2', gen_random_uuid(), repeat('c', 64), array['linkedin'], 'failed', '54000000-0000-4000-8000-0000000000aa');

-- ---------------------------------------------------------------- what a count holds
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns where table_schema = 'public' and table_name = 'share_kit_uses'),
  array['award_id', 'created_at', 'id', 'kind', 'updated_at', 'used_on', 'workspace_id'],
  'a count names the award, the part and the day: no person'
);

-- ---------------------------------------------------------------- nobody else reads or writes counts
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"54000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.share_kit_uses $$, '42501', null, 'signed-in people cannot read counts');
select throws_ok($$ insert into public.share_kit_uses (workspace_id, award_id, kind, used_on) values ('54000000-0000-7000-8000-000000000001', '54000000-0000-7000-8000-0000000000a3', 'portrait', current_date) $$, '42501', null, 'nor write one');
reset role;

-- ---------------------------------------------------------------- measure 6 counts downloads
create temp table t_after as select public.gms_operator_measures(now(), 30, 14) as m;
select is((select (m ->> 'awardsShared')::int from t_after) - (select (m ->> 'awardsShared')::int from t_before), 1, '6. an award with a download and no post counts as shared; a failed post still does not');
select is((select (m ->> 'awardsEligibleForKit')::int from t_after) - (select (m ->> 'awardsEligibleForKit')::int from t_before), 0, 'the awards counted are the same');
select is((select (m ->> 'awardPosts')::int from t_after), (select (m ->> 'awardPosts')::int from t_before), 'and a download is not a post');

delete from public.awards where id = '54000000-0000-7000-8000-0000000000a1';
select is((select count(*)::int from public.share_kit_uses where award_id = '54000000-0000-7000-8000-0000000000a1'), 0, 'an award''s counts go with it');

select * from finish();
rollback;
