-- Connected apps (0044): the new connector providers and the Salesforce import source are allowed
-- and nothing else is; a Slack channel per workspace with known events only; each event is alerted
-- once per subscription; a delivery cannot be filed under another workspace's subscription; a
-- calendar link's event map holds ids, dates and digests only; signed-in users read only their own.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('44000000-0000-4000-8000-0000000000f1', 'admin@ca-funder.example', 'authenticated', 'authenticated'),
  ('44000000-0000-4000-8000-0000000000f2', 'po@ca-funder.example', 'authenticated', 'authenticated'),
  ('44000000-0000-4000-8000-0000000000a1', 'admin@ca-grantee.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('44000000-0000-7000-8000-000000000003', 'funder', 'ca-funder', 'Connected Funder'),
  ('44000000-0000-7000-8000-000000000001', 'applicant', 'ca-grantee', 'Connected Grantee');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('44000000-0000-7000-8000-000000000003', '44000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('44000000-0000-7000-8000-000000000003', '44000000-0000-4000-8000-0000000000f2', 'program_officer', '{}'),
  ('44000000-0000-7000-8000-000000000001', '44000000-0000-4000-8000-0000000000a1', 'admin', '{}');

-- ---------------------------------------------------------------- schema
select has_table('public', 'alert_subscriptions', 'alert_subscriptions exists');
select has_table('public', 'alert_deliveries', 'alert_deliveries exists');
select has_table('public', 'calendar_links', 'calendar_links exists');
select ok((select relrowsecurity from pg_class where oid = 'public.calendar_links'::regclass), 'RLS is on for calendar_links');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

select lives_ok($$
  insert into public.connector_accounts (workspace_id, provider, status, external_id, scopes)
  values ('44000000-0000-7000-8000-000000000003', 'slack', 'active', '44000000-0000-7000-8000-000000000003', '{chat:write,channels:read}'),
         ('44000000-0000-7000-8000-000000000001', 'google_drive', 'active', '44000000-0000-7000-8000-000000000001', '{drive.file}'),
         ('44000000-0000-7000-8000-000000000003', 'salesforce', 'pending', '44000000-0000-7000-8000-000000000003', '{api}')
$$, 'Slack, Google Drive and Salesforce are connector providers');

select throws_ok($$
  insert into public.connector_accounts (workspace_id, provider, status) values ('44000000-0000-7000-8000-000000000001', 'dropbox', 'active')
$$, '23514', null, 'any other provider is refused');

select lives_ok($$
  insert into public.import_runs (workspace_id, target, source, mapping, rows_total, expires_at)
  values ('44000000-0000-7000-8000-000000000001', 'outside_applications', 'salesforce', '{"title":"Name"}', 12, now() + interval '1 day')
$$, 'Salesforce is an import source');

select lives_ok($$
  insert into public.import_mappings (workspace_id, target, source, source_ref, mapping)
  values ('44000000-0000-7000-8000-000000000003', 'award_history', 'salesforce', 'preset:npsp_grants', '{"title":"Name"}')
$$, 'a mapping is saved for a Salesforce preset');

select lives_ok($$
  insert into public.alert_subscriptions (id, workspace_id, channel_id, channel_name, events, created_by)
  values ('44000000-0000-7000-8000-0000000000b1', '44000000-0000-7000-8000-000000000003', 'C0GRANTS01', 'grants', '{new_application,payment_due}', '44000000-0000-4000-8000-0000000000f1'),
         ('44000000-0000-7000-8000-0000000000b2', '44000000-0000-7000-8000-000000000001', 'C0TEAM0001', 'team', '{deadline_soon,report_due}', '44000000-0000-4000-8000-0000000000a1')
$$, 'a funder and an applicant each choose a channel and events');

select throws_ok($$
  insert into public.alert_subscriptions (workspace_id, channel_id, channel_name, events)
  values ('44000000-0000-7000-8000-000000000003', 'C0OTHER001', 'other', '{new_application}')
$$, '23505', null, 'one Slack channel per workspace');

select throws_ok($$
  update public.alert_subscriptions set events = '{new_application,applicant_answers}' where id = '44000000-0000-7000-8000-0000000000b1'
$$, '23514', null, 'an unknown event is refused');

select throws_ok($$
  update public.alert_subscriptions set channel_id = '#general' where id = '44000000-0000-7000-8000-0000000000b1'
$$, '23514', null, 'a channel is named by its Slack id');

select lives_ok($$
  insert into public.alert_deliveries (subscription_id, workspace_id, event_key, event)
  values ('44000000-0000-7000-8000-0000000000b1', '44000000-0000-7000-8000-000000000003', 'new_application:44000000-0000-7000-8000-0000000000c1', 'new_application')
$$, 'an event is claimed before it is posted');

select throws_ok($$
  insert into public.alert_deliveries (subscription_id, workspace_id, event_key, event)
  values ('44000000-0000-7000-8000-0000000000b1', '44000000-0000-7000-8000-000000000003', 'new_application:44000000-0000-7000-8000-0000000000c1', 'new_application')
$$, '23505', null, 'the same event is never claimed twice');

select throws_ok($$
  insert into public.alert_deliveries (subscription_id, workspace_id, event_key, event)
  values ('44000000-0000-7000-8000-0000000000b1', '44000000-0000-7000-8000-000000000001', 'payment_due:44000000-0000-7000-8000-0000000000c2', 'payment_due')
$$, '23503', null, 'a delivery cannot be filed under another workspace''s subscription');

select lives_ok($$
  insert into public.calendar_links (workspace_id, user_id, composio_account_id, status, calendar_id, calendar_name, event_map)
  values ('44000000-0000-7000-8000-000000000001', '44000000-0000-4000-8000-0000000000a1', 'ca_person_1', 'active', 'primary', 'My calendar',
          '{"oa:44000000-0000-7000-8000-0000000000d1:full": {"eventId": "abc123def456", "date": "2026-12-01", "hash": "0123456789abcdef"}}')
$$, 'a person links a calendar and the event ids are kept');

select throws_ok($$
  update public.calendar_links set event_map = '{"oa:x:full": {"eventId": "abc123def456", "date": "2026-12-01", "title": "Clean water"}}' where user_id = '44000000-0000-4000-8000-0000000000a1'
$$, '23514', null, 'the event map holds ids, dates and digests only');

select throws_ok($$
  insert into public.calendar_links (workspace_id, user_id, composio_account_id)
  values ('44000000-0000-7000-8000-000000000001', '44000000-0000-4000-8000-0000000000a1', 'ca_person_2')
$$, '23505', null, 'one calendar link per person per workspace');

select throws_ok($$
  insert into public.calendar_links (workspace_id, user_id, composio_account_id, calendar_id)
  values ('44000000-0000-7000-8000-000000000003', '44000000-0000-4000-8000-0000000000f2', 'ca_person_3', 'primary')
$$, '23514', null, 'a calendar is kept with its name');

select throws_ok($$
  update public.alert_subscriptions set workspace_id = '44000000-0000-7000-8000-000000000001' where id = '44000000-0000-7000-8000-0000000000b1'
$$, null, null, 'a subscription never moves to another workspace');

-- ---------------------------------------------------------------- signed-in users read only
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);

select results_eq($$ select channel_name from public.alert_subscriptions order by channel_name $$, $$ values ('grants') $$, 'a funder admin reads their own workspace''s channel only');

select set_config('request.jwt.claims', '{"sub":"44000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from public.alert_subscriptions), 0, 'a program officer does not read the Slack settings');

select set_config('request.jwt.claims', '{"sub":"44000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.calendar_links), 1, 'a person reads their own calendar link');

select throws_ok($$
  update public.calendar_links set calendar_id = 'other' where user_id = '44000000-0000-4000-8000-0000000000a1'
$$, '42501', null, 'a signed-in user cannot write a calendar link');

select * from finish();
rollback;
