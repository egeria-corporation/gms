-- 0051_accounting.sql
-- QuickBooks Online sync through Composio (v1.13.0, docs/accounting.md). Record-keeping, not a money
-- path: when a grant payment is recorded in the GMS (paid elsewhere, or disbursed through Passport
-- and mirrored here), the jobs Worker writes one expense for it to the funder's QuickBooks, once.
-- Nothing here pays, schedules or moves money; Passport stays the only money path and nothing here
-- touches a payout destination or an award's disbursed amount.
--
-- Privacy: Composio holds the Intuit token; nothing here stores one. The funder's choices are kept
-- as QuickBooks record ids and names only (an expense account, the bank account in QuickBooks'
-- chart of accounts the money left from, a class or location per program, a vendor per grantee):
-- never a bank's own number, routing details, a tax number or an address. A name read from
-- QuickBooks has any run of five or more digits cut to its last four before it is stored. Signed-in
-- users only read, and only a funder's admins and finance staff. Every write goes through the API's
-- service role.
--
-- What this changes on a live database:
--   * connector_accounts: the provider check gains 'quickbooks'. Every existing value is still
--     allowed (the list of 0044 plus one); existing rows are not touched.
--   * adds two tables, each with RLS on, `updated_at` kept by gms.touch_updated_at() and the
--     workspace-immutable trigger:
--       accounting_links    one per funder workspace and provider: the accounts, the class or
--                           location per program, the vendor per grantee, whether a missing vendor
--                           is created (with the organization's name only), and the sync switch,
--                           which is off until a person turns it on (`sync_from` is that moment);
--       accounting_entries  one per payment (unique per workspace and tranche): the QuickBooks id
--                           and the GMS's own reference (DocNumber), what was posted (amount,
--                           currency, date, vendor, memo), and its status: posting, posted,
--                           needs_attention (the payment was changed or voided after it was
--                           posted; the books are never changed by the GMS), failed, handled.
--   * one helper (gms.accounting_ref_map_ok) and one trigger function
--     (gms.accounting_entry_same_workspace: an entry names a payment of its own workspace only).
-- No existing row is changed or removed. No backfill. If a later migration changes
-- connector_accounts_provider_check, keep these values.

-- ---------------------------------------------------------------------------------------------
-- Provider
-- ---------------------------------------------------------------------------------------------

alter table public.connector_accounts drop constraint connector_accounts_provider_check;
alter table public.connector_accounts add constraint connector_accounts_provider_check
  check (provider in ('google_workspace', 'mercury', 'google_sheets', 'airtable', 'fluxx', 'zengine', 'slack', 'google_drive', 'salesforce', 'quickbooks'));
comment on column public.connector_accounts.secret_enc is 'Ciphertext under CREDENTIALS_ENCRYPTION_KEY: the Mercury read-only token; the Fluxx OAuth client id and secret and the Zengine access token for an import (deleted when it is finished or the person disconnects). Composio holds Google, Google Sheets, Airtable, Slack, Google Drive, Salesforce and QuickBooks credentials; nothing is stored for them here.';
comment on column public.connector_accounts.external_id is 'Google Workspace, Slack, Google Drive, Salesforce, QuickBooks and the Composio import sources: the workspace id (the Composio entity). Fluxx: the instance address. Null otherwise.';

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- A map from a GMS record id (a program, a grantee workspace) to a QuickBooks record:
-- { "<uuid>": { "id": "<digits>", "name": "<1-100 characters>" } }, at most 5,000 entries.
create or replace function gms.accounting_ref_map_ok(m jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(m) = 'object'
     and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(m)) <= 5000
     and not exists (
       select 1 from pg_catalog.jsonb_each(m) f
        where f.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or pg_catalog.jsonb_typeof(f.value) <> 'object'
           or coalesce(f.value ->> 'id', '') !~ '^\d{1,20}$'
           or pg_catalog.length(coalesce(f.value ->> 'name', '')) not between 1 and 100
           or (f.value ->> 'name') ~ '\d{5,}'
           or exists (select 1 from pg_catalog.jsonb_object_keys(f.value) k where k not in ('id', 'name'))
     );
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.accounting_links (
  id              uuid primary key default gms.uuid_v7(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  provider        text not null default 'quickbooks' check (provider in ('quickbooks')),
  -- The expense account grants post to, and the bank account in QuickBooks' chart of accounts the
  -- payments leave from: QuickBooks record ids and names, never a bank's own number.
  expense_ref     text check (expense_ref is null or expense_ref ~ '^\d{1,20}$'),
  expense_name    text check (expense_name is null or (pg_catalog.length(expense_name) between 1 and 100 and expense_name !~ '\d{5,}')),
  paid_from_ref   text check (paid_from_ref is null or paid_from_ref ~ '^\d{1,20}$'),
  paid_from_name  text check (paid_from_name is null or (pg_catalog.length(paid_from_name) between 1 and 100 and paid_from_name !~ '\d{5,}')),
  -- How programs are tracked in QuickBooks, and the class or location of each program.
  tracking        text not null default 'none' check (tracking in ('none', 'class', 'department')),
  program_map     jsonb not null default '{}'::jsonb check (gms.accounting_ref_map_ok(program_map)),
  -- The vendor of each grantee (its workspace id), matched or chosen by the funder.
  vendor_map      jsonb not null default '{}'::jsonb check (gms.accounting_ref_map_ok(vendor_map)),
  -- A grantee with no vendor yet: create one with the organization's name only, or wait for a person.
  vendor_policy   text not null default 'create' check (vendor_policy in ('create', 'ask')),
  -- The company's home currency: payments in another currency are not posted.
  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- Off until a person turns it on. Payments recorded from `sync_from` on are posted.
  sync_enabled    boolean not null default false,
  sync_from       timestamptz,
  -- The language of the memo written on each entry: the person's when they turned sync on.
  locale          text not null default 'en' check (locale in ('en', 'es')),
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, provider),
  check ((expense_ref is null) = (expense_name is null)),
  check ((paid_from_ref is null) = (paid_from_name is null)),
  check (not sync_enabled or (expense_ref is not null and paid_from_ref is not null and sync_from is not null))
);
comment on table public.accounting_links is 'A funder''s QuickBooks mapping and sync switch: QuickBooks record ids and names only. No token, no bank number.';

create table public.accounting_entries (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  provider      text not null default 'quickbooks' check (provider in ('quickbooks')),
  -- The payment. Kept (as null) if the payment itself is ever removed, so the entry in the books is not forgotten.
  tranche_id    uuid references public.tranches (id) on delete set null,
  status        text not null default 'posting' check (status in ('posting', 'posted', 'needs_attention', 'failed', 'handled')),
  reason        text check (reason is null or reason in ('changed', 'voided', 'removed', 'vendor_unclear', 'vendor_refused', 'currency', 'refused', 'unreachable')),
  -- QuickBooks' id for the expense, and the GMS's own reference written on it (DocNumber).
  external_id   text check (external_id is null or external_id ~ '^\d{1,20}$'),
  doc_number    text not null check (doc_number ~ '^[A-Za-z0-9-]{1,21}$'),
  -- What was (or is being) written: compared with the payment on every run.
  amount_minor  bigint not null check (amount_minor > 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  paid_on       date not null,
  vendor_ref    text check (vendor_ref is null or vendor_ref ~ '^\d{1,20}$'),
  vendor_name   text check (vendor_name is null or (pg_catalog.length(vendor_name) between 1 and 100 and vendor_name !~ '\d{5,}')),
  memo          text not null check (pg_catalog.length(memo) between 1 and 1000),
  attempts      integer not null default 1 check (attempts between 1 and 20),
  posted_at     timestamptz,
  -- What changed after posting, and when the GMS noticed (needs_attention).
  attention     jsonb check (attention is null or pg_catalog.jsonb_typeof(attention) = 'object'),
  attention_at  timestamptz,
  handled_by    uuid,
  handled_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, tranche_id),
  unique (workspace_id, doc_number),
  -- Posted, needing attention or handled: it is in QuickBooks, so its id is known.
  check (status not in ('posted', 'needs_attention', 'handled') or external_id is not null),
  -- Needing attention says what changed after posting; failed says why it is not in QuickBooks; the rest say nothing.
  check ((status = 'needs_attention') = coalesce(reason in ('changed', 'voided', 'removed'), false)),
  check ((status = 'failed') = coalesce(reason in ('vendor_unclear', 'vendor_refused', 'currency', 'refused', 'unreachable'), false)),
  check (status <> 'handled' or handled_at is not null)
);
comment on table public.accounting_entries is 'One QuickBooks expense per grant payment, once: its QuickBooks id, what was posted, and whether the payment changed since. The GMS never changes the books.';
create index accounting_entries_status_idx on public.accounting_entries (workspace_id, status);
create index accounting_entries_tranche_idx on public.accounting_entries (tranche_id) where tranche_id is not null;

-- An entry names a payment of its own workspace only.
create or replace function gms.accounting_entry_same_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tranche_id is not null and not exists (select 1 from public.tranches t where t.id = new.tranche_id and t.workspace_id = new.workspace_id) then
    raise exception 'an accounting entry names a payment of its own workspace only' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger accounting_entries_same_workspace before insert or update of tranche_id, workspace_id on public.accounting_entries
  for each row execute function gms.accounting_entry_same_workspace();

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers
-- ---------------------------------------------------------------------------------------------

alter table public.accounting_links enable row level security;
alter table public.accounting_entries enable row level security;

revoke all on public.accounting_links, public.accounting_entries from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.accounting_links, public.accounting_entries to service_role;
grant select on public.accounting_links, public.accounting_entries to authenticated;

create policy accounting_links_select on public.accounting_links for select to authenticated
  using (gms.has_role(workspace_id, array['admin', 'finance']));
create policy accounting_entries_select on public.accounting_entries for select to authenticated
  using (gms.has_role(workspace_id, array['admin', 'finance']));

do $$
declare
  t text;
begin
  foreach t in array array['accounting_links', 'accounting_entries'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
  end loop;
end;
$$;
