-- Operator measures (0052): each count of gms_operator_measures against fixtures, the window and
-- the 14-day switch rule, that only counts leave the function, and that only the service role can
-- run it or touch lost_deals and operator_settings.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- The window is the 30 days before 2027-04-30 12:00 UTC.
create temporary table t_now as select timestamptz '2027-04-30 12:00:00+00' as now;
create or replace function pg_temp.ago(days numeric) returns timestamptz language sql as
  $$ select timestamptz '2027-04-30 12:00:00+00' - make_interval(secs => days * 86400) $$;

-- Whatever the database already holds (the seed has an open call) is counted before the fixtures,
-- so each "open call" expectation below is that baseline plus the fixtures' own.
create temporary table t_base as select
  (public.gms_operator_measures(timestamptz '2027-04-30 12:00:00+00', 30, 14) ->> 'fundersWithOpenCall')::int as open30,
  (public.gms_operator_measures(timestamptz '2027-04-30 12:00:00+00', 7, 14) ->> 'fundersWithOpenCall')::int as open7;
grant select on t_base to service_role;

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into public.workspaces (id, kind, handle, display_name, status, created_at) values
  -- funders
  ('52000000-0000-7000-8000-0000000000f1', 'funder', 'm-open-long',      'Open for a while',          'active',    pg_temp.ago(300)),
  ('52000000-0000-7000-8000-0000000000f2', 'funder', 'm-closed-inside',  'Closed in the window',      'active',    pg_temp.ago(300)),
  ('52000000-0000-7000-8000-0000000000f3', 'funder', 'm-closed-before',  'Closed before the window',  'active',    pg_temp.ago(300)),
  ('52000000-0000-7000-8000-0000000000f4', 'funder', 'm-suspended',      'Suspended funder',          'suspended', pg_temp.ago(300)),
  ('52000000-0000-7000-8000-0000000000f5', 'funder', 'm-unpublished',    'Never published',           'active',    pg_temp.ago(300)),
  ('52000000-0000-7000-8000-0000000000f6', 'funder', 'm-switched-fast',  'Switched, call in 3 days',  'active',    pg_temp.ago(60)),
  ('52000000-0000-7000-8000-0000000000f7', 'funder', 'm-switched-slow',  'Switched, call in 20 days', 'active',    pg_temp.ago(60)),
  ('52000000-0000-7000-8000-0000000000f9', 'funder', 'm-joined-package', 'Joined from a package',     'onboarding', pg_temp.ago(4)),
  ('52000000-0000-7000-8000-0000000000fa', 'funder', 'm-joined-peer',    'Joined from a peer',        'active',    pg_temp.ago(4)),
  ('52000000-0000-7000-8000-0000000000fb', 'funder', 'm-joined-old',     'Joined long ago',           'active',    pg_temp.ago(45)),
  -- applicants
  ('52000000-0000-7000-8000-0000000000a1', 'applicant', 'm-new-active',  'New and active',            'active',    pg_temp.ago(10)),
  ('52000000-0000-7000-8000-0000000000a2', 'applicant', 'm-old-active',  'Old and active',            'active',    pg_temp.ago(100)),
  ('52000000-0000-7000-8000-0000000000a3', 'applicant', 'm-new-idle',    'New, never active',         'onboarding', pg_temp.ago(20)),
  ('52000000-0000-7000-8000-0000000000a4', 'applicant', 'm-old-idle',    'Old, idle',                 'active',    pg_temp.ago(200)),
  ('52000000-0000-7000-8000-0000000000a5', 'applicant', 'm-closed',      'Closed applicant',          'closed',    pg_temp.ago(3));

insert into auth.users (id, email, aud, role)
  select ('52000000-0000-4000-8000-00000000000' || n)::uuid, 'member' || n || '@m.example', 'authenticated', 'authenticated' from generate_series(1, 6) n;

insert into public.workspace_members (workspace_id, user_id, role, last_active_at) values
  ('52000000-0000-7000-8000-0000000000a1', '52000000-0000-4000-8000-000000000001', 'admin', pg_temp.ago(2)),
  ('52000000-0000-7000-8000-0000000000a2', '52000000-0000-4000-8000-000000000002', 'admin', pg_temp.ago(5)),
  ('52000000-0000-7000-8000-0000000000a2', '52000000-0000-4000-8000-000000000003', 'editor', pg_temp.ago(1)),
  ('52000000-0000-7000-8000-0000000000a3', '52000000-0000-4000-8000-000000000004', 'admin', null),
  ('52000000-0000-7000-8000-0000000000a4', '52000000-0000-4000-8000-000000000005', 'admin', pg_temp.ago(40)),
  ('52000000-0000-7000-8000-0000000000a5', '52000000-0000-4000-8000-000000000006', 'admin', pg_temp.ago(1));

insert into public.opportunities (id, workspace_id, slug, title, status, published_at) values
  ('52000000-0000-7000-8000-000000000101', '52000000-0000-7000-8000-0000000000f1', 'open-long',     'Open for a while',        'open',       pg_temp.ago(60)),
  ('52000000-0000-7000-8000-000000000102', '52000000-0000-7000-8000-0000000000f2', 'closed-inside', 'Closed in the window',    'closed',     pg_temp.ago(50)),
  ('52000000-0000-7000-8000-000000000103', '52000000-0000-7000-8000-0000000000f3', 'closed-before', 'Closed before',           'closed',     pg_temp.ago(90)),
  ('52000000-0000-7000-8000-000000000104', '52000000-0000-7000-8000-0000000000f4', 'suspended',     'Suspended funder''s call', 'open',       pg_temp.ago(5)),
  ('52000000-0000-7000-8000-000000000105', '52000000-0000-7000-8000-0000000000f5', 'unpublished',   'Not published',           'forecasted', null),
  ('52000000-0000-7000-8000-000000000106', '52000000-0000-7000-8000-0000000000f6', 'switched-fast', 'Three days after import', 'open',       pg_temp.ago(20)),
  ('52000000-0000-7000-8000-000000000107', '52000000-0000-7000-8000-0000000000f7', 'switched-slow', 'Twenty days after import','open',       pg_temp.ago(15));

insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, occurred_at) values
  ('52000000-0000-7000-8000-0000000000f2', 'user:52000000-0000-4000-8000-0000000000f2', 'opportunity.closed', 'opportunity', '52000000-0000-7000-8000-000000000102', pg_temp.ago(10)),
  ('52000000-0000-7000-8000-0000000000f3', 'user:52000000-0000-4000-8000-0000000000f3', 'opportunity.closed', 'opportunity', '52000000-0000-7000-8000-000000000103', pg_temp.ago(40));

insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at, committed_at, created_at) values
  ('52000000-0000-7000-8000-0000000000f6', 'award_history',        'csv', '{}', 3, pg_temp.ago(0), pg_temp.ago(23), pg_temp.ago(23)),
  ('52000000-0000-7000-8000-0000000000f7', 'history_applications', 'csv', '{}', 3, pg_temp.ago(0), pg_temp.ago(35), pg_temp.ago(35)),
  -- a preview never committed counts for nothing
  ('52000000-0000-7000-8000-0000000000f1', 'award_history',        'csv', '{}', 3, pg_temp.ago(0), null,            pg_temp.ago(61));

insert into public.referral_joins (joined_workspace_id, joined_kind, joined_by, source, source_workspace_id, created_at) values
  ('52000000-0000-7000-8000-0000000000f9', 'funder', '52000000-0000-4000-8000-000000000009', 'package',         '52000000-0000-7000-8000-0000000000a2', pg_temp.ago(4)),
  ('52000000-0000-7000-8000-0000000000fa', 'funder', '52000000-0000-4000-8000-00000000000a', 'peer_invitation', '52000000-0000-7000-8000-0000000000f1', pg_temp.ago(4)),
  ('52000000-0000-7000-8000-0000000000fb', 'funder', '52000000-0000-4000-8000-00000000000b', 'package',         '52000000-0000-7000-8000-0000000000a2', pg_temp.ago(45));

insert into public.awards (id, workspace_id, title, status, confidential, recipient_workspace_id, recipient_individual, created_at) values
  ('52000000-0000-7000-8000-000000000201', '52000000-0000-7000-8000-0000000000f1', 'Shared award',            'accepted',  false, '52000000-0000-7000-8000-0000000000a2', null, pg_temp.ago(5)),
  ('52000000-0000-7000-8000-000000000202', '52000000-0000-7000-8000-0000000000f1', 'Not shared',              'active',    false, '52000000-0000-7000-8000-0000000000a2', null, pg_temp.ago(6)),
  ('52000000-0000-7000-8000-000000000203', '52000000-0000-7000-8000-0000000000f1', 'Confidential',            'accepted',  true,  '52000000-0000-7000-8000-0000000000a2', null, pg_temp.ago(7)),
  ('52000000-0000-7000-8000-000000000204', '52000000-0000-7000-8000-0000000000f1', 'Only offered',            'offered',   false, '52000000-0000-7000-8000-0000000000a2', null, pg_temp.ago(2)),
  ('52000000-0000-7000-8000-000000000205', '52000000-0000-7000-8000-0000000000f1', 'Made before the window',  'completed', false, '52000000-0000-7000-8000-0000000000a2', null, pg_temp.ago(50)),
  ('52000000-0000-7000-8000-000000000206', '52000000-0000-7000-8000-0000000000f1', 'To a person',             'accepted',  false, null, '{"name":"A person"}', pg_temp.ago(3));

insert into public.social_posts (workspace_id, subject_type, subject_id, created_by, idempotency_key, payload_sha256, platforms, status, sent_at, metrics) values
  ('52000000-0000-7000-8000-0000000000f1', 'award', '52000000-0000-7000-8000-000000000201', '52000000-0000-4000-8000-0000000000f1', '52000000-0000-4000-8000-000000000991', repeat('a', 64), array['linkedin'], 'published', pg_temp.ago(3),  '{"clicks": 7, "impressions": 100}'),
  ('52000000-0000-7000-8000-0000000000a2', 'award', '52000000-0000-7000-8000-000000000205', '52000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000992', repeat('b', 64), array['linkedin'], 'published', pg_temp.ago(10), '{"clicks": 5}'),
  ('52000000-0000-7000-8000-0000000000f1', 'award', '52000000-0000-7000-8000-000000000202', '52000000-0000-4000-8000-0000000000f1', '52000000-0000-4000-8000-000000000993', repeat('c', 64), array['linkedin'], 'failed',    null,           '{}'),
  ('52000000-0000-7000-8000-0000000000f1', 'award', '52000000-0000-7000-8000-000000000201', '52000000-0000-4000-8000-0000000000f1', '52000000-0000-4000-8000-000000000994', repeat('d', 64), array['bluesky'],  'partial',   pg_temp.ago(2),  '{}'),
  ('52000000-0000-7000-8000-0000000000f1', 'award', '52000000-0000-7000-8000-000000000205', '52000000-0000-4000-8000-0000000000f1', '52000000-0000-4000-8000-000000000995', repeat('e', 64), array['linkedin'], 'published', pg_temp.ago(40), '{"clicks": 50}');

insert into public.invitations (workspace_id, email, role, token_hash, expires_at, accepted_at, created_at) values
  ('52000000-0000-7000-8000-0000000000f1', 'a@m.example', 'program_officer', repeat('1', 64), pg_temp.ago(-9), pg_temp.ago(4),  pg_temp.ago(5)),
  ('52000000-0000-7000-8000-0000000000f1', 'b@m.example', 'reviewer',        repeat('2', 64), pg_temp.ago(-8), null,            pg_temp.ago(6)),
  ('52000000-0000-7000-8000-0000000000a2', 'c@m.example', 'editor',          repeat('3', 64), pg_temp.ago(0),  null,            pg_temp.ago(20)),
  ('52000000-0000-7000-8000-0000000000f1', 'd@m.example', 'reviewer',        repeat('4', 64), pg_temp.ago(30), pg_temp.ago(39), pg_temp.ago(40));

-- ---------------------------------------------------------------- the service role writes and reads
set local role service_role;

insert into public.lost_deals (reason, lost_on, recorded_by) values
  ('forms',   (pg_temp.ago(3))::date,  '52000000-0000-4000-8000-0000000000ee'),
  ('forms',   (pg_temp.ago(10))::date, '52000000-0000-4000-8000-0000000000ee'),
  ('reviews', (pg_temp.ago(5))::date,  '52000000-0000-4000-8000-0000000000ee'),
  ('other',   (pg_temp.ago(45))::date, '52000000-0000-4000-8000-0000000000ee');
select pass('the service role records lost deals');
select throws_ok($$ insert into public.lost_deals (reason, lost_on, recorded_by) values ('they were Acme Foundation', current_date, gen_random_uuid()) $$, '23514', null, 'a reason is one of the fixed list, never free text');
select throws_ok($$ insert into public.lost_deals (reason, lost_on, recorded_by) values ('forms', date '2025-12-31', gen_random_uuid()) $$, '23514', null, 'a lost day before 2026 is refused');

insert into public.operator_settings (search_console_site, updated_by) values ('sc-domain:opengrants.io', '52000000-0000-4000-8000-0000000000ee');
select pass('the service role records the Search Console property');
select throws_ok($$ insert into public.operator_settings (search_console_site) values ('https://gms.opengrants.io/') $$, '23505', null, 'operator_settings holds one row');
select throws_ok($$ insert into public.operator_settings (id) values (false) $$, '23514', null, 'operator_settings has no second id');
select throws_ok($$ update public.operator_settings set search_console_site = 'https://gms.opengrants.io/f/private' $$, '23514', null, 'a property is a domain or a site root only');
select lives_ok($$ update public.operator_settings set search_console_site = 'https://gms.opengrants.io/' $$, 'a URL-prefix property at the site root is kept');

create temporary table t_m as select public.gms_operator_measures(timestamptz '2027-04-30 12:00:00+00', 30, 14) as m;
grant select on t_m to postgres;

select is((select (m ->> 'fundersWithOpenCall')::int from t_m), (select open30 from t_base) + 4, '1. funders with a call open in the window: open now, or closed inside it; not suspended, not unpublished');
select is((select (m ->> 'activeApplicantWorkspaces')::int from t_m), 2, '2. applicant workspaces whose members were active in the window (closed ones left out)');
select is((select (m ->> 'newApplicantWorkspaces')::int from t_m), 2, '3. applicant workspaces made in the window');
select is((select (m ->> 'callsPublished')::int from t_m), 2, '3. calls published in the window (a suspended funder''s left out)');
select is((select (m ->> 'fundersJoinedFromApplicantLinks')::int from t_m), 1, '4. funders who joined from an applicant''s package link in the window');
select is((select (m ->> 'switchedFundersWithCall')::int from t_m), 1, '5. funders with history imported and a call published within 14 days');
select is((select (m ->> 'awardsEligibleForKit')::int from t_m), 2, '6. awards made in the window, accepted or later, to an organization, not confidential');
select is((select (m ->> 'awardsShared')::int from t_m), 1, '6. of those, awards with a social post that did not fail');
select is((select (m ->> 'awardPosts')::int from t_m), 3, '6. award posts sent in the window, by funders and grantees');
select is((select (m ->> 'awardPostClicks')::int from t_m), 12, '6. the clicks those posts reported');
select is((select (m ->> 'awardPostsWithClicks')::int from t_m), 2, '6. posts that reported clicks at all');
select is((select (m ->> 'invitationsSent')::int from t_m), 3, '8. teammate invitations made in the window');
select is((select (m ->> 'invitationsAccepted')::int from t_m), 1, '8. of those, accepted');
select is((select m -> 'lostDeals' from t_m), '{"forms": 2, "reviews": 1}'::jsonb, '9. deals lost in the window, by reason');
select is((select (m ->> 'from')::timestamptz from t_m), timestamptz '2027-03-31 12:00:00+00', 'the window starts 30 days back');

select is(
  (select array_agg(k order by k) from t_m, jsonb_object_keys(m) k),
  array['activeApplicantWorkspaces', 'awardPostClicks', 'awardPosts', 'awardPostsWithClicks', 'awardsEligibleForKit', 'awardsShared',
        'callsPublished', 'from', 'fundersJoinedFromApplicantLinks', 'fundersWithOpenCall', 'invitationsAccepted', 'invitationsSent',
        'lostDeals', 'newApplicantWorkspaces', 'switchedFundersWithCall', 'to'],
  'the answer holds these counts and the window, nothing else'
);
select is_empty(
  $$ select v from t_m, jsonb_each(m) e(k, v) where k not in ('from', 'to', 'lostDeals') and jsonb_typeof(v) <> 'number' $$,
  'every measure is a number: no list, no name, no id'
);
select is_empty(
  $$ select k from t_m, jsonb_each(m -> 'lostDeals') e(k, v) where jsonb_typeof(v) <> 'number' $$,
  'lost deals are counts by reason'
);

select is((public.gms_operator_measures(timestamptz '2027-04-30 12:00:00+00', 30, 21) ->> 'switchedFundersWithCall')::int, 2, 'the switch rule follows its parameter (21 days takes the slower switch)');
select is((public.gms_operator_measures(timestamptz '2027-04-30 12:00:00+00', 7, 14) ->> 'newApplicantWorkspaces')::int, 0, 'a 7-day window counts only the last week''s workspaces');
select is((public.gms_operator_measures(timestamptz '2027-04-30 12:00:00+00', 7, 14) ->> 'fundersWithOpenCall')::int, (select open7 from t_base) + 3, 'a 7-day window leaves out the call closed 10 days ago');
select is((public.gms_operator_measures(timestamptz '2027-04-30 12:00:00+00', 0, 0) ->> 'from')::timestamptz, timestamptz '2027-04-29 12:00:00+00', 'a window under a day is held to one day');

reset role;

-- ---------------------------------------------------------------- who may
select ok(has_function_privilege('service_role', 'public.gms_operator_measures(timestamptz, integer, integer)', 'execute'), 'the service role may run the measures');
select ok(not has_function_privilege('authenticated', 'public.gms_operator_measures(timestamptz, integer, integer)', 'execute'), 'a signed-in person may not run the measures');
select ok(not has_function_privilege('anon', 'public.gms_operator_measures(timestamptz, integer, integer)', 'execute'), 'an anonymous visitor may not run the measures');
select ok(not has_table_privilege('authenticated', 'public.lost_deals', 'select'), 'signed-in people cannot read lost deals');
select ok(not has_table_privilege('authenticated', 'public.operator_settings', 'select'), 'signed-in people cannot read operator settings');
select ok(not has_table_privilege('anon', 'public.lost_deals', 'select'), 'anonymous visitors cannot read lost deals');
select is((select count(*)::int from pg_class where relname in ('lost_deals', 'operator_settings') and relnamespace = 'public'::regnamespace and relrowsecurity), 2, 'RLS is on for both tables');

select * from finish();
rollback;
