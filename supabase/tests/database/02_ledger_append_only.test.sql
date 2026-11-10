-- ledger_events and ledger_archives are append-only for every role, including service_role and
-- the table owner.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email, aud, role) values
  ('f0000000-0000-4000-8000-0000000000f1', 'admin@ledger-test.example', 'authenticated', 'authenticated'),
  ('f0000000-0000-4000-8000-0000000000f2', 'auditor@ledger-test.example', 'authenticated', 'authenticated');
insert into public.workspaces (id, kind, handle, display_name) values
  ('0e000000-0000-7000-8000-000000000001', 'funder', 'ledger-test-funder', 'Ledger Test Funder');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('0e000000-0000-7000-8000-000000000001', 'f0000000-0000-4000-8000-0000000000f1', 'admin'),
  ('0e000000-0000-7000-8000-000000000001', 'f0000000-0000-4000-8000-0000000000f2', 'auditor');
insert into public.ledger_events (id, workspace_id, actor, event_type, data) values
  ('0e000000-0000-7000-8000-0000000000e1', '0e000000-0000-7000-8000-000000000001', 'system:test', 'workspace.created', '{"n":1}');
insert into public.ledger_archives (id, day, object_key, events, sha256) values
  ('0e000000-0000-7000-8000-0000000000a1', '2027-01-01', 'ledger/2027/01/01.jsonl', 1, repeat('a', 64));

-- Actor format
select lives_ok(
  $$ insert into public.ledger_events (workspace_id, actor, event_type) values
       ('0e000000-0000-7000-8000-000000000001', 'user:f0000000-0000-4000-8000-0000000000f1/client:claude', 'approval.requested'),
       ('0e000000-0000-7000-8000-000000000001', 'passport', 'disbursement.status.changed') $$,
  'agent-on-behalf-of-user and passport actors are accepted'
);
select throws_ok(
  $$ insert into public.ledger_events (workspace_id, actor, event_type) values ('0e000000-0000-7000-8000-000000000001', 'somebody', 'x.y') $$,
  '23514', null, 'an unattributed actor is rejected'
);

-- service_role
set local role service_role;
select lives_ok(
  $$ insert into public.ledger_events (workspace_id, actor, event_type) values ('0e000000-0000-7000-8000-000000000001', 'client:abc', 'tranche.status.changed') $$,
  'service_role can append'
);
select throws_ok(
  $$ update public.ledger_events set data = '{"n":2}' where id = '0e000000-0000-7000-8000-0000000000e1' $$,
  '42501', null, 'service_role cannot UPDATE ledger_events'
);
select throws_ok(
  $$ delete from public.ledger_events where id = '0e000000-0000-7000-8000-0000000000e1' $$,
  '42501', null, 'service_role cannot DELETE ledger_events'
);
select throws_ok($$ truncate public.ledger_events $$, '42501', null, 'service_role cannot TRUNCATE ledger_events');
select throws_ok(
  $$ update public.ledger_archives set events = 0 where id = '0e000000-0000-7000-8000-0000000000a1' $$,
  '42501', null, 'service_role cannot UPDATE ledger_archives'
);

-- authenticated members
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select isnt_empty($$ select 1 from public.ledger_events where workspace_id = '0e000000-0000-7000-8000-000000000001' $$, 'an auditor can read the workspace ledger');
select throws_ok($$ update public.ledger_events set data = '{}' $$, '42501', null, 'authenticated cannot UPDATE ledger_events');
select throws_ok($$ delete from public.ledger_events $$, '42501', null, 'authenticated cannot DELETE ledger_events');
select throws_ok(
  $$ insert into public.ledger_events (workspace_id, actor, event_type) values ('0e000000-0000-7000-8000-000000000001', 'user:me', 'forged.event') $$,
  '42501', null, 'users cannot write ledger events directly'
);
select throws_ok($$ select 1 from public.ledger_archives $$, '42501', null, 'the archive manifest is not readable with a user key');

-- table owner (privileges do not apply; the triggers do)
reset role;
select throws_ok(
  $$ update public.ledger_events set data = '{}' where id = '0e000000-0000-7000-8000-0000000000e1' $$,
  '42501', 'ledger_events is append-only (UPDATE rejected)', 'the trigger rejects UPDATE even for the owner'
);
select throws_ok(
  $$ delete from public.ledger_events where id = '0e000000-0000-7000-8000-0000000000e1' $$,
  '42501', 'ledger_events is append-only (DELETE rejected)', 'the trigger rejects DELETE even for the owner'
);
select throws_ok($$ truncate public.ledger_events $$, '42501', 'ledger_events is append-only (TRUNCATE rejected)', 'the trigger rejects TRUNCATE even for the owner');
select throws_ok(
  $$ delete from public.ledger_archives where id = '0e000000-0000-7000-8000-0000000000a1' $$,
  '42501', 'ledger_archives is append-only (DELETE rejected)', 'archives cannot be deleted'
);
select is(
  (select data ->> 'n' from public.ledger_events where id = '0e000000-0000-7000-8000-0000000000e1'), '1',
  'the original event is unchanged'
);

select * from finish();
rollback;
