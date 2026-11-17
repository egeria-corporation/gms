-- QuickBooks sync (0051): QuickBooks is a connector provider; one mapping per funder workspace,
-- holding QuickBooks ids and names only (no long digit runs, no extra keys); sync cannot be on
-- without both accounts and its start; one entry per payment, with the GMS's reference unique;
-- an entry's status says whether it is in QuickBooks and why not, or what changed; an entry names a
-- payment of its own workspace only and outlives a removed payment; signed-in admins and finance
-- staff read, nobody else does, and nobody signed in writes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('51000000-0000-4000-8000-0000000000f1', 'admin@qb-funder.example', 'authenticated', 'authenticated'),
  ('51000000-0000-4000-8000-0000000000f2', 'finance@qb-funder.example', 'authenticated', 'authenticated'),
  ('51000000-0000-4000-8000-0000000000f3', 'po@qb-funder.example', 'authenticated', 'authenticated'),
  ('51000000-0000-4000-8000-0000000000f4', 'admin@qb-other.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('51000000-0000-7000-8000-000000000001', 'funder', 'qb-funder', 'Books Funder'),
  ('51000000-0000-7000-8000-000000000002', 'funder', 'qb-other', 'Other Funder'),
  ('51000000-0000-7000-8000-000000000003', 'applicant', 'qb-grantee', 'Books Grantee');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('51000000-0000-7000-8000-000000000001', '51000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('51000000-0000-7000-8000-000000000001', '51000000-0000-4000-8000-0000000000f2', 'finance', '{}'),
  ('51000000-0000-7000-8000-000000000001', '51000000-0000-4000-8000-0000000000f3', 'program_officer', '{}'),
  ('51000000-0000-7000-8000-000000000002', '51000000-0000-4000-8000-0000000000f4', 'admin', '{}');

insert into public.awards (id, workspace_id, recipient_workspace_id, title) values
  ('51000000-0000-7000-8000-0000000000a1', '51000000-0000-7000-8000-000000000001', '51000000-0000-7000-8000-000000000003', 'Clean water'),
  ('51000000-0000-7000-8000-0000000000a2', '51000000-0000-7000-8000-000000000002', '51000000-0000-7000-8000-000000000003', 'Other award');
insert into public.payment_schedules (id, workspace_id, award_id) values
  ('51000000-0000-7000-8000-0000000000b1', '51000000-0000-7000-8000-000000000001', '51000000-0000-7000-8000-0000000000a1'),
  ('51000000-0000-7000-8000-0000000000b2', '51000000-0000-7000-8000-000000000002', '51000000-0000-7000-8000-0000000000a2');
insert into public.tranches (id, workspace_id, schedule_id, award_id, seq, amount_minor, status) values
  ('51000000-0000-7000-8000-0000000000c1', '51000000-0000-7000-8000-000000000001', '51000000-0000-7000-8000-0000000000b1', '51000000-0000-7000-8000-0000000000a1', 1, 500000, 'settled'),
  ('51000000-0000-7000-8000-0000000000c2', '51000000-0000-7000-8000-000000000001', '51000000-0000-7000-8000-0000000000b1', '51000000-0000-7000-8000-0000000000a1', 2, 500000, 'settled'),
  ('51000000-0000-7000-8000-0000000000c3', '51000000-0000-7000-8000-000000000002', '51000000-0000-7000-8000-0000000000b2', '51000000-0000-7000-8000-0000000000a2', 1, 100000, 'settled');

-- ---------------------------------------------------------------- schema
select has_table('public', 'accounting_links', 'accounting_links exists');
select has_table('public', 'accounting_entries', 'accounting_entries exists');
select ok((select relrowsecurity from pg_class where oid = 'public.accounting_links'::regclass), 'RLS is on for accounting_links');
select ok((select relrowsecurity from pg_class where oid = 'public.accounting_entries'::regclass), 'RLS is on for accounting_entries');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

select lives_ok($$
  insert into public.connector_accounts (workspace_id, provider, status, external_id, scopes)
  values ('51000000-0000-7000-8000-000000000001', 'quickbooks', 'active', '51000000-0000-7000-8000-000000000001', '{com.intuit.quickbooks.accounting}'),
         ('51000000-0000-7000-8000-000000000002', 'salesforce', 'active', '51000000-0000-7000-8000-000000000002', '{api}')
$$, 'QuickBooks is a connector provider, and the earlier ones still are');

select throws_ok($$
  insert into public.connector_accounts (workspace_id, provider, status) values ('51000000-0000-7000-8000-000000000002', 'xero', 'active')
$$, '23514', null, 'any other provider is refused');

select lives_ok($$
  insert into public.accounting_links (id, workspace_id, expense_ref, expense_name, paid_from_ref, paid_from_name, tracking, program_map, vendor_map)
  values ('51000000-0000-7000-8000-0000000000d1', '51000000-0000-7000-8000-000000000001', '61', 'Grants and assistance', '35', 'Operating checking •••6789', 'class',
          '{"51000000-0000-7000-8000-0000000000e1": {"id": "5000000000000012345", "name": "Community health"}}',
          '{"51000000-0000-7000-8000-000000000003": {"id": "56", "name": "Books Grantee"}}')
$$, 'a funder maps its accounts, a class per program and a vendor per grantee');

select is((select sync_enabled from public.accounting_links where id = '51000000-0000-7000-8000-0000000000d1'), false, 'sync is off until a person turns it on');

select throws_ok($$
  insert into public.accounting_links (workspace_id) values ('51000000-0000-7000-8000-000000000001')
$$, '23505', null, 'one mapping per workspace and provider');

select throws_ok($$
  update public.accounting_links set paid_from_name = 'Checking 000123456789' where id = '51000000-0000-7000-8000-0000000000d1'
$$, '23514', null, 'a name never holds a long run of digits');

select throws_ok($$
  update public.accounting_links set paid_from_ref = 'CHK-0001' where id = '51000000-0000-7000-8000-0000000000d1'
$$, '23514', null, 'an account is named by its QuickBooks id');

select throws_ok($$
  update public.accounting_links set vendor_map = '{"51000000-0000-7000-8000-000000000003": {"id": "56", "name": "Books Grantee", "bank": "x"}}' where id = '51000000-0000-7000-8000-0000000000d1'
$$, '23514', null, 'a vendor map holds an id and a name only');

select throws_ok($$
  update public.accounting_links set program_map = '{"not-a-program": {"id": "5", "name": "Health"}}' where id = '51000000-0000-7000-8000-0000000000d1'
$$, '23514', null, 'a program map is keyed by program id');

select throws_ok($$
  update public.accounting_links set sync_enabled = true where id = '51000000-0000-7000-8000-0000000000d1'
$$, '23514', null, 'sync is not on without the moment it starts from');

select throws_ok($$
  insert into public.accounting_links (workspace_id, sync_enabled, sync_from) values ('51000000-0000-7000-8000-000000000002', true, now())
$$, '23514', null, 'sync is not on without both accounts');

select lives_ok($$
  update public.accounting_links set sync_enabled = true, sync_from = now() where id = '51000000-0000-7000-8000-0000000000d1'
$$, 'sync turns on with both accounts and its start');

select lives_ok($$
  insert into public.accounting_entries (id, workspace_id, tranche_id, doc_number, amount_minor, currency, paid_on, memo)
  values ('51000000-0000-7000-8000-0000000000f1', '51000000-0000-7000-8000-000000000001', '51000000-0000-7000-8000-0000000000c1', 'GMS-51000000c1', 500000, 'USD', '2027-04-16', 'Grant payment 1: Clean water')
$$, 'a payment is claimed before it is posted');

select throws_ok($$
  insert into public.accounting_entries (workspace_id, tranche_id, doc_number, amount_minor, currency, paid_on, memo)
  values ('51000000-0000-7000-8000-000000000001', '51000000-0000-7000-8000-0000000000c1', 'GMS-51000000c9', 500000, 'USD', '2027-04-16', 'again')
$$, '23505', null, 'the same payment is never claimed twice');

select throws_ok($$
  insert into public.accounting_entries (workspace_id, tranche_id, doc_number, amount_minor, currency, paid_on, memo)
  values ('51000000-0000-7000-8000-000000000001', '51000000-0000-7000-8000-0000000000c2', 'GMS-51000000c1', 500000, 'USD', '2027-04-16', 'same reference')
$$, '23505', null, 'the GMS reference is unique in a workspace');

select throws_ok($$
  insert into public.accounting_entries (workspace_id, tranche_id, doc_number, amount_minor, currency, paid_on, memo)
  values ('51000000-0000-7000-8000-000000000001', '51000000-0000-7000-8000-0000000000c3', 'GMS-51000000c3', 100000, 'USD', '2027-04-16', 'not ours')
$$, '23503', null, 'an entry cannot name another workspace''s payment');

select throws_ok($$
  update public.accounting_entries set status = 'posted' where id = '51000000-0000-7000-8000-0000000000f1'
$$, '23514', null, 'posted means its QuickBooks id is known');

select lives_ok($$
  update public.accounting_entries set status = 'posted', external_id = '245', posted_at = now() where id = '51000000-0000-7000-8000-0000000000f1'
$$, 'an entry is posted with its QuickBooks id');

select throws_ok($$
  update public.accounting_entries set status = 'needs_attention' where id = '51000000-0000-7000-8000-0000000000f1'
$$, '23514', null, 'needing attention says what changed');

select lives_ok($$
  update public.accounting_entries set status = 'needs_attention', reason = 'voided', attention = '{"status": "returned"}', attention_at = now() where id = '51000000-0000-7000-8000-0000000000f1'
$$, 'a voided payment needs attention');

select throws_ok($$
  update public.accounting_entries set status = 'failed', reason = 'voided' where id = '51000000-0000-7000-8000-0000000000f1'
$$, '23514', null, 'a failure says why the payment is not in QuickBooks');

select throws_ok($$
  update public.accounting_entries set status = 'handled', reason = null where id = '51000000-0000-7000-8000-0000000000f1'
$$, '23514', null, 'handled says when');

select lives_ok($$ delete from public.tranches where id = '51000000-0000-7000-8000-0000000000c1' $$, 'a payment can still be removed');
select is((select tranche_id from public.accounting_entries where id = '51000000-0000-7000-8000-0000000000f1'), null, 'its entry is kept, so the one in the books is not forgotten');

-- ---------------------------------------------------------------- signed-in users read only
reset role;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
select is((select count(*)::int from public.accounting_entries) + (select count(*)::int from public.accounting_links), 2, 'finance staff read their workspace''s mapping and entries');

select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
select is((select count(*)::int from public.accounting_entries) + (select count(*)::int from public.accounting_links), 0, 'a program officer reads neither');

select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select throws_ok($$
  update public.accounting_links set sync_enabled = false
$$, '42501', null, 'a signed-in admin cannot write the mapping (the API does, for a person)');

select * from finish();
rollback;
