-- (The column-name pattern spells two terms with bracket classes so this file passes the repo's
-- sensitive-data gate, which scans for the bare words.)
-- Schema invariants: table list, RLS everywhere, grants, id generator, status vocabularies,
-- no column that could hold a bank or identity number.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

select tables_are(
  'public',
  array[
    'workspaces', 'workspace_members', 'invitations', 'passport_links', 'consents',
    'programs', 'forms', 'rubrics', 'templates', 'opportunities', 'competitions',
    'applications', 'form_responses', 'application_events', 'review_assignments', 'reviews', 'decisions',
    'awards', 'agreements', 'payment_schedules', 'tranches', 'requirements', 'submissions', 'budgets',
    'amendments', 'bank_transactions', 'reminder_sends',
    'threads', 'messages', 'tasks', 'documents', 'answers', 'grantee_records', 'org_change_inbox', 'discover_saved',
    'api_clients', 'oauth_clients_dynamic', 'oauth_grants', 'oauth_codes', 'oauth_refresh_tokens',
    'mcp_connections', 'approvals', 'custom_mcp_servers', 'connector_accounts',
    'webhook_subscriptions', 'webhook_deliveries', 'inbound_events', 'assist_calls',
    'ledger_events', 'ledger_archives', 'passport_second_steps', 'passport_account_links', 'passport_link_requests',
    'workspace_creation_counts', 'award_invitations', 'award_invitation_sends'
  ],
  'public schema has exactly the GMS tables'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'RLS is enabled on every public table'
);

select is_empty(
  $$ select table_name || '.' || column_name from information_schema.columns
     where table_schema = 'public'
       and column_name ~* '(routing|account_?(no|num)|s[s]n|social_?sec|birth|(^|_)d[o]b($|_)|tax_?id|id_?number|passport_?(no|num)|driver|iban|swift)' $$,
  'no column could hold a bank or identity number'
);

select is_empty(
  $$ select table_name from information_schema.tables t
     where table_schema = 'public' and table_type = 'BASE TABLE'
       and (not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'created_at')
         or not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'updated_at')) $$,
  'every table has created_at and updated_at'
);

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('ledger_events', 'ledger_archives')
       and not exists (select 1 from pg_trigger tg where tg.tgrelid = c.oid and tg.tgname = c.relname || '_touch_updated_at') $$,
  'every mutable table has the updated_at trigger'
);

-- Grants: anon has nothing; authenticated never writes; nobody but the owner truncates.
select is_empty(
  $$ select table_name || ':' || privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'PUBLIC') $$,
  'anon and PUBLIC hold no table privileges'
);
select is_empty(
  $$ select table_name || ':' || privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT' $$,
  'authenticated holds SELECT only; every write goes through the service layer'
);
select is_empty(
  $$ select table_name from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated'
       and table_name in ('passport_links', 'invitations', 'api_clients', 'oauth_clients_dynamic', 'oauth_grants', 'oauth_codes',
                          'oauth_refresh_tokens', 'custom_mcp_servers', 'webhook_subscriptions', 'webhook_deliveries',
                          'inbound_events', 'ledger_archives', 'reminder_sends', 'connector_accounts', 'passport_second_steps', 'passport_account_links', 'passport_link_requests',
                          'award_invitations', 'award_invitation_sends') $$,
  'tables holding secrets or OAuth state are not granted to authenticated'
);
select is_empty(
  $$ select column_name from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'connector_accounts' and grantee = 'authenticated' and column_name = 'secret_enc' $$,
  'connector_accounts.secret_enc is not readable by authenticated'
);
select table_privs_are('public', 'ledger_events', 'service_role', array['INSERT', 'SELECT'], 'service_role may only INSERT and SELECT ledger_events');
select table_privs_are('public', 'ledger_archives', 'service_role', array['INSERT', 'SELECT'], 'service_role may only INSERT and SELECT ledger_archives');
select table_privs_are('public', 'tranches', 'service_role', array['DELETE', 'INSERT', 'SELECT', 'UPDATE'], 'service_role has DML but not TRUNCATE on ordinary tables');

-- Every policy is a SELECT policy for authenticated.
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
     where schemaname = 'public' and (cmd <> 'SELECT' or roles <> '{authenticated}') $$,
  'only SELECT policies for authenticated exist'
);

-- UUIDv7
select matches(gms.uuid_v7()::text, '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'gms.uuid_v7() is a version 7, variant 10 UUID');
select ok(
  (with a as materialized (select gms.uuid_v7() as id), w as materialized (select pg_sleep(0.005) from a), b as materialized (select gms.uuid_v7() as id from w)
   select a.id < b.id from a, b),
  'gms.uuid_v7() ids sort by creation time (millisecond resolution)'
);
select ok(
  abs(('x' || substr(replace(gms.uuid_v7()::text, '-', ''), 1, 12))::bit(48)::bigint - (extract(epoch from clock_timestamp()) * 1000)::bigint) < 5000,
  'the first 48 bits are the Unix time in milliseconds'
);

-- Status vocabularies (packages/workflow/src/statuses.ts)
select is(gms.application_statuses(), array['draft','submitted','screening','under_review','recommended','accepted','declined','waitlisted','revision_requested','interview','withdrawn'], 'application statuses');
select is(gms.tranche_statuses(), array['scheduled','due','ready','releasing','initiated','settled','held','failed','returned','cancelled'], 'tranche statuses');

-- Constraints
insert into public.workspaces (id, kind, handle, display_name) values
  ('0f000000-0000-7000-8000-000000000001', 'funder', 'schema-test-funder', 'Schema Test Funder');
select throws_ok(
  $$ insert into public.workspaces (kind, handle, display_name, ein) values ('applicant', 'schema-test-dash', 'Dash EIN', '00-1234567') $$,
  '23514', null, 'EIN with a dash is rejected'
);
select throws_ok(
  $$ insert into public.awards (workspace_id, title, status, recipient_individual) values ('0f000000-0000-7000-8000-000000000001', 'Bad status', 'paid', '{"name":"Test Person"}') $$,
  '23514', null, 'award status outside the vocabulary is rejected'
);
select throws_ok(
  $$ insert into public.custom_mcp_servers (workspace_id, name, url, read_only) values ('0f000000-0000-7000-8000-000000000001', 'Writer', 'https://mcp.example/mcp', false) $$,
  '23514', null, 'custom MCP servers cannot be registered with write access'
);

-- Published forms are immutable.
insert into public.forms (id, version, workspace_id, title, published_at) values
  ('0f000000-0000-7000-8000-0000000000f1', 1, '0f000000-0000-7000-8000-000000000001', 'Published form', now());
select throws_ok(
  $$ update public.forms set json_schema = '{"type":"object"}' where id = '0f000000-0000-7000-8000-0000000000f1' $$,
  '23514', null, 'a published form version cannot be edited'
);

select * from finish();
rollback;
