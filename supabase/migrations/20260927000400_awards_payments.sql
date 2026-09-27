-- SPDX-License-Identifier: AGPL-3.0-only
-- Decisions, board dockets & votes, awards (with amendments), agreements & signatures,
-- bank connections, payees (no bank numbers ever), schedules, batches, payments, reconciliation.

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  outcome text not null check (outcome in ('approve', 'decline', 'defer')),
  reason text,
  recommended_amount_cents bigint check (recommended_amount_cents is null or recommended_amount_cents >= 0),
  is_final boolean not null default false,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  letter_sent_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.decisions (application_id);
create index on public.decisions (workspace_id);

create table public.dockets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  meeting_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'in_session', 'closed')),
  quorum int not null default 3 check (quorum >= 1),
  board_book_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.dockets (workspace_id);

create table public.docket_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  docket_id uuid not null references public.dockets(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  position int not null default 1,
  recommended_amount_cents bigint,
  recommendation text,
  outcome text check (outcome in ('approved', 'declined', 'deferred', 'no_quorum')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (docket_id, application_id)
);
create index on public.docket_items (workspace_id);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  docket_item_id uuid not null references public.docket_items(id) on delete cascade,
  voter_id uuid not null references public.profiles(id),
  vote text not null check (vote in ('approve', 'decline', 'abstain', 'recuse')),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (docket_item_id, voter_id)
);
create index on public.votes (workspace_id);

create sequence public.award_reference_seq;

create table public.awards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid references public.applications(id) on delete restrict,
  program_id uuid references public.programs(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  applicant_org_id uuid references public.applicant_orgs(id) on delete restrict,
  parent_award_id uuid references public.awards(id) on delete restrict,
  kind text not null default 'original' check (kind in ('original', 'amendment', 'supplement')),
  amendment_status text check (amendment_status in ('draft', 'approved', 'rejected')),
  reference text not null unique,
  title text not null,
  purpose text,
  amount_cents bigint not null,
  currency char(3) not null default 'USD',
  start_date date,
  end_date date,
  fiscal_year int,
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'cancelled')),
  agreement_pending boolean not null default true,
  on_hold boolean not null default false,
  hold_reason text,
  report_overdue boolean not null default false,
  disbursed_cents bigint not null default 0 check (disbursed_cents >= 0),
  expenditure_responsibility boolean not null default false,
  grant_to_individual boolean not null default false,
  relationship_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  check ((kind = 'original') = (parent_award_id is null)),
  check (kind = 'original' or amendment_status is not null),
  check (kind <> 'original' or amount_cents >= 0),
  check (start_date is null or end_date is null or start_date <= end_date)
);
create index on public.awards (workspace_id, status);
create index on public.awards (parent_award_id);
create index on public.awards (applicant_org_id);

create table public.award_conditions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  award_id uuid not null references public.awards(id) on delete cascade,
  body text not null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'met', 'waived')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.award_conditions (award_id);

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  award_id uuid not null references public.awards(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'countersigned', 'void')),
  document_path text,
  document_hash text,
  body_md text,
  sent_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.agreements (award_id);

create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  signer_id uuid not null references public.profiles(id),
  signer_role text not null check (signer_role in ('grantee', 'foundation')),
  typed_name text not null check (length(typed_name) between 2 and 200),
  attestation text not null,
  signed_at timestamptz not null default clock_timestamp(),
  ip inet,
  user_agent text,
  document_hash text not null,
  unique (agreement_id, signer_role)
);
create trigger signatures_append_only before update or delete on public.signatures
  for each row execute function gms_private.append_only();

-- Payments ---------------------------------------------------------------------
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('mercury', 'manual')),
  mode text not null default 'token' check (mode in ('token', 'oauth', 'none')),
  environment text not null default 'fake' check (environment in ('fake', 'sandbox', 'production')),
  secret_ref text,
  webhook_id text,
  webhook_secret_ref text,
  webhook_status text not null default 'none' check (webhook_status in ('none', 'active', 'failing')),
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_synced_at timestamptz,
  connected_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.bank_connections (workspace_id);

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  provider_account_id text not null,
  name text not null,
  mask text check (mask is null or mask ~ '^[0-9]{4}$'),
  kind text not null default 'checking',
  available_cents bigint,
  current_cents bigint,
  currency char(3) not null default 'USD',
  balance_updated_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (connection_id, provider_account_id)
);
create index on public.bank_accounts (workspace_id);

create table public.program_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (program_id, bank_account_id)
);
create index on public.program_accounts (workspace_id);

create table public.payees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  applicant_org_id uuid not null references public.applicant_orgs(id) on delete restrict,
  provider text not null default 'mercury' check (provider in ('mercury', 'manual')),
  provider_recipient_id text,
  invite_id text,
  onboarding_url text,
  invite_status text check (invite_status in ('created', 'completed', 'expired')),
  status text not null default 'invite_sent' check (status in ('invite_sent', 'onboarding', 'ready', 'invite_expired')),
  contact_email text not null,
  payment_methods text[] not null default '{ach}',
  invited_at timestamptz,
  ready_at timestamptz,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (workspace_id, applicant_org_id, provider)
);
create index on public.payees (workspace_id, status);

create table public.payment_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  award_id uuid not null unique references public.awards(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  schedule_id uuid not null references public.payment_schedules(id) on delete cascade,
  award_id uuid not null references public.awards(id) on delete cascade,
  position int not null,
  due_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'USD',
  condition text,
  status text not null default 'scheduled' check (status in ('scheduled', 'paid', 'cancelled')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (schedule_id, position)
);
create index on public.installments (workspace_id, due_date);

create table public.payment_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  source_account_id uuid references public.bank_accounts(id) on delete restrict,
  method text not null default 'ach' check (method in ('ach', 'check', 'domestic_wire', 'international_wire', 'manual')),
  status text not null default 'draft' check (status in (
    'draft', 'awaiting_approval', 'approved', 'submitting', 'submitted', 'rejected', 'cancelled')),
  requires_second_approval boolean not null default false,
  total_cents bigint not null default 0,
  created_by uuid not null references public.profiles(id),
  created_by_agent_client_id uuid references public.agent_clients(id) on delete set null,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  second_approved_by uuid references public.profiles(id),
  second_approved_at timestamptz,
  submitted_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  constraint batch_maker_checker check (approved_by is null or approved_by <> created_by),
  constraint batch_second_approver check (
    second_approved_by is null or (second_approved_by <> created_by and second_approved_by <> approved_by))
);
create index on public.payment_batches (workspace_id, status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  award_id uuid not null references public.awards(id) on delete restrict,
  installment_id uuid references public.installments(id) on delete set null,
  batch_id uuid references public.payment_batches(id) on delete set null,
  payee_id uuid references public.payees(id) on delete restrict,
  source_account_id uuid references public.bank_accounts(id) on delete restrict,
  method text not null default 'ach' check (method in ('ach', 'check', 'domestic_wire', 'international_wire', 'manual')),
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'USD',
  fee_cents bigint not null default 0,
  status text not null default 'scheduled' check (status in (
    'scheduled', 'in_batch', 'awaiting_approval', 'awaiting_bank_approval', 'sent', 'failed', 'held',
    'reconciled', 'exception', 'cancelled')),
  rail text not null default 'mercury' check (rail in ('mercury', 'manual')),
  rail_ref text,
  rail_transaction_id text,
  idempotency_key text not null unique default gen_random_uuid()::text,
  hold_reason text,
  failure_reason text,
  memo text,
  external_reference text,
  requested_at timestamptz,
  sent_at timestamptz,
  reconciled_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.payments (workspace_id, status);
create index on public.payments (award_id);
create index on public.payments (batch_id);
create index on public.payments (rail_ref);

create table public.payment_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null references public.payment_batches(id) on delete cascade,
  approver_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('approve', 'reject')),
  aal text not null check (aal in ('aal1', 'aal2')),
  note text,
  created_at timestamptz not null default clock_timestamp(),
  unique (batch_id, approver_id)
);
create index on public.payment_approvals (workspace_id);
create trigger payment_approvals_append_only before update or delete on public.payment_approvals
  for each row execute function gms_private.append_only();

create table public.rail_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);
create index on public.rail_events (workspace_id, received_at desc);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bank_account_id uuid references public.bank_accounts(id) on delete cascade,
  provider_transaction_id text not null,
  amount_cents bigint not null,
  currency char(3) not null default 'USD',
  status text not null,
  kind text,
  counterparty_name text,
  memo text,
  note text,
  posted_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (workspace_id, provider_transaction_id)
);
create index on public.bank_transactions (workspace_id, posted_at desc);

create table public.recon_exceptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('unmatched_transaction', 'unmatched_payment', 'amount_mismatch', 'status_mismatch')),
  bank_transaction_id uuid references public.bank_transactions(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete cascade,
  details text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.recon_exceptions (workspace_id, status);

-- Invariants --------------------------------------------------------------------
-- Ceiling: sum of live payments on an award tree <= original amount + approved amendments/supplements.
create or replace function gms_private.award_root(award uuid) returns uuid
language sql stable as $$
  with recursive up as (
    select id, parent_award_id from public.awards where id = award
    union all
    select a.id, a.parent_award_id from public.awards a join up on a.id = up.parent_award_id
  )
  select id from up where parent_award_id is null limit 1
$$;

create or replace function gms_private.award_ceiling_cents(root uuid) returns bigint
language sql stable as $$
  select coalesce((select amount_cents from public.awards where id = root), 0)
    + coalesce((select sum(amount_cents) from public.awards
                where parent_award_id = root and amendment_status = 'approved'), 0)
$$;

create or replace function gms_private.payments_ceiling() returns trigger
language plpgsql as $$
declare
  root uuid;
  ceiling bigint;
  total bigint;
begin
  root := gms_private.award_root(new.award_id);
  perform 1 from public.awards where id = root for update;
  ceiling := gms_private.award_ceiling_cents(root);
  select coalesce(sum(p.amount_cents), 0) into total
  from public.payments p
  where gms_private.award_root(p.award_id) = root
    and p.status not in ('failed', 'cancelled');
  if total > ceiling then
    raise exception 'payments on award % would total % cents, above the awarded % cents', root, total, ceiling
      using errcode = 'P0001', hint = 'payment_ceiling';
  end if;
  return null;
end
$$;
create constraint trigger payments_ceiling after insert or update of amount_cents, status, award_id on public.payments
  deferrable initially immediate for each row execute function gms_private.payments_ceiling();

-- Payee gate & holds: a payment cannot be batched (or beyond) without a ready payee and no active hold.
create or replace function gms_private.payments_gate() returns trigger
language plpgsql as $$
declare
  payee_status text;
  held boolean;
begin
  if new.status in ('in_batch', 'awaiting_approval', 'awaiting_bank_approval')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) and new.rail = 'mercury' then
    select status into payee_status from public.payees where id = new.payee_id;
    if payee_status is distinct from 'ready' then
      raise exception 'payment % cannot be batched: payee is not ready', new.id using errcode = 'P0001', hint = 'payee_not_ready';
    end if;
  end if;
  if new.status in ('in_batch', 'awaiting_approval', 'awaiting_bank_approval')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select on_hold into held from public.awards where id = gms_private.award_root(new.award_id);
    if coalesce(held, false) then
      raise exception 'payment % cannot be batched: award is on hold', new.id using errcode = 'P0001', hint = 'award_on_hold';
    end if;
  end if;
  return new;
end
$$;
create trigger payments_gate before insert or update on public.payments
  for each row execute function gms_private.payments_gate();

-- Maker-checker on individual approvals.
create or replace function gms_private.payment_approvals_guard() returns trigger
language plpgsql as $$
declare
  creator uuid;
begin
  select created_by into creator from public.payment_batches where id = new.batch_id;
  if creator = new.approver_id then
    raise exception 'the creator of a payment batch cannot approve it' using errcode = 'P0001', hint = 'maker_checker';
  end if;
  return new;
end
$$;
create trigger payment_approvals_guard before insert on public.payment_approvals
  for each row execute function gms_private.payment_approvals_guard();

-- Keep award.disbursed_cents in sync with sent/reconciled payments.
create or replace function gms_private.payments_disbursed() returns trigger
language plpgsql as $$
declare
  root uuid;
begin
  root := gms_private.award_root(coalesce(new.award_id, old.award_id));
  update public.awards a set disbursed_cents = (
    select coalesce(sum(p.amount_cents), 0) from public.payments p
    where gms_private.award_root(p.award_id) = root and p.status in ('sent', 'reconciled')
  ) where a.id = root;
  return null;
end
$$;
create trigger payments_disbursed after insert or update of status, amount_cents on public.payments
  for each row execute function gms_private.payments_disbursed();

-- Policies ----------------------------------------------------------------------
select gms_private.staff_policies('decisions',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'board'], array['owner', 'admin', 'program_officer']);
create policy decisions_applicant on public.decisions for select to gms_authenticated
  using (is_final and gms.is_applicant_for(application_id));

select gms_private.staff_policies('dockets',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy dockets_board on public.dockets for select to gms_authenticated
  using (status <> 'draft' and gms.is_member(workspace_id, array['board']));
select gms_private.staff_policies('docket_items',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy docket_items_board on public.docket_items for select to gms_authenticated using (
  gms.is_member(workspace_id, array['board'])
  and exists (select 1 from public.dockets d where d.id = docket_id and d.status <> 'draft')
);
select gms_private.staff_policies('votes', array['owner', 'admin', 'program_officer', 'auditor'], null);
create policy votes_board_select on public.votes for select to gms_authenticated
  using (gms.is_member(workspace_id, array['board']));
create policy votes_board_insert on public.votes for insert to gms_authenticated with check (
  voter_id = gms.uid() and gms.is_member(workspace_id, array['board'])
  and exists (select 1 from public.docket_items di join public.dockets d on d.id = di.docket_id
    where di.id = docket_item_id and d.status = 'in_session')
);

select gms_private.staff_policies('awards',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor', 'board'], array['owner', 'admin', 'program_officer', 'finance']);
create policy awards_grantee on public.awards for select to gms_authenticated
  using (status <> 'draft' and applicant_org_id is not null and gms.is_org_member(applicant_org_id));

select gms_private.staff_policies('award_conditions',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy award_conditions_grantee on public.award_conditions for select to gms_authenticated using (
  exists (select 1 from public.awards a where a.id = award_id and a.applicant_org_id is not null and gms.is_org_member(a.applicant_org_id))
);

select gms_private.staff_policies('agreements',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy agreements_grantee on public.agreements for select to gms_authenticated using (
  status <> 'draft' and exists (
    select 1 from public.awards a where a.id = award_id and a.applicant_org_id is not null and gms.is_org_member(a.applicant_org_id))
);
create policy agreements_grantee_update on public.agreements for update to gms_authenticated using (
  status = 'sent' and exists (
    select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id, array['org_admin']))
) with check (status in ('sent', 'signed'));

select gms_private.staff_policies('signatures',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], null);
create policy signatures_staff_insert on public.signatures for insert to gms_authenticated with check (
  signer_id = gms.uid() and signer_role = 'foundation' and gms.is_member(workspace_id, array['owner', 'admin'])
);
create policy signatures_grantee on public.signatures for select to gms_authenticated using (
  exists (select 1 from public.agreements g join public.awards a on a.id = g.award_id
    where g.id = agreement_id and gms.is_org_member(a.applicant_org_id))
);
create policy signatures_grantee_insert on public.signatures for insert to gms_authenticated with check (
  signer_id = gms.uid() and signer_role = 'grantee' and exists (
    select 1 from public.agreements g join public.awards a on a.id = g.award_id
    where g.id = agreement_id and g.status = 'sent' and gms.is_org_member(a.applicant_org_id, array['org_admin']))
);

-- Finance-only tables: finance, admin, owner (write) + auditor (read).
select gms_private.staff_policies('bank_connections', array['owner', 'admin', 'finance', 'auditor'], array['owner', 'admin', 'finance']);
select gms_private.staff_policies('bank_accounts', array['owner', 'admin', 'finance', 'auditor'], array['owner', 'admin', 'finance']);
select gms_private.staff_policies('program_accounts', array['owner', 'admin', 'finance', 'auditor'], array['owner', 'admin', 'finance']);
select gms_private.staff_policies('payees', array['owner', 'admin', 'finance', 'auditor'], array['owner', 'admin', 'finance']);
create policy payees_grantee on public.payees for select to gms_authenticated using (gms.is_org_member(applicant_org_id));
select gms_private.staff_policies('payment_schedules',
  array['owner', 'admin', 'finance', 'auditor', 'program_officer'], array['owner', 'admin', 'finance', 'program_officer']);
select gms_private.staff_policies('installments',
  array['owner', 'admin', 'finance', 'auditor', 'program_officer'], array['owner', 'admin', 'finance', 'program_officer']);
create policy installments_grantee on public.installments for select to gms_authenticated using (
  exists (select 1 from public.awards a where a.id = award_id and a.status <> 'draft' and gms.is_org_member(a.applicant_org_id))
);
select gms_private.staff_policies('payment_batches', array['owner', 'admin', 'finance', 'auditor'], array['owner', 'admin', 'finance']);
select gms_private.staff_policies('payments', array['owner', 'admin', 'finance', 'auditor'], array['owner', 'admin', 'finance']);
create policy payments_grantee on public.payments for select to gms_authenticated using (
  status in ('awaiting_bank_approval', 'sent', 'reconciled', 'failed', 'scheduled', 'in_batch', 'awaiting_approval', 'held')
  and exists (select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id))
);
select gms_private.staff_policies('payment_approvals', array['owner', 'admin', 'finance', 'auditor'], null);
create policy payment_approvals_insert on public.payment_approvals for insert to gms_authenticated with check (
  approver_id = gms.uid() and gms.is_member(workspace_id, array['owner', 'admin', 'finance']) and aal = gms.aal() and gms.aal() = 'aal2'
);
select gms_private.staff_policies('rail_events', array['owner', 'admin', 'finance', 'auditor'], null);
select gms_private.staff_policies('bank_transactions', array['owner', 'admin', 'finance', 'auditor'], array['owner', 'admin', 'finance']);
select gms_private.staff_policies('recon_exceptions', array['owner', 'admin', 'finance', 'auditor'], array['owner', 'admin', 'finance']);

-- Grantees can see who their own award payer/programs are.
create policy orgs_awardee_staff on public.applicant_orgs for select to gms_authenticated using (
  exists (select 1 from public.awards a where a.applicant_org_id = applicant_orgs.id and gms.is_staff(a.workspace_id))
);
-- Public transparency listing (A-05): a narrow, column-limited view. Holds, notes and contacts never leave it.
create view public.public_awards as
  select a.id, a.workspace_id, a.reference, a.title, a.purpose, a.currency, a.start_date, a.end_date, a.fiscal_year,
    a.created_at, a.last_modified_at, a.status,
    gms_private.award_ceiling_cents(a.id) as amount_cents,
    o.legal_name as recipient_name, addr.city as recipient_city, addr.state as recipient_state, addr.county as recipient_county,
    p.name as program_name, a.opportunity_id
  from public.awards a
  join public.workspace_settings s on s.workspace_id = a.workspace_id and s.transparency_enabled
  left join public.applicant_orgs o on o.id = a.applicant_org_id
  left join public.org_addresses addr on addr.org_id = o.id and addr.kind = 'mailing'
  left join public.programs p on p.id = a.program_id
  where a.kind = 'original' and a.status in ('active', 'completed') and not a.grant_to_individual;
grant select on public.public_awards to gms_anon, gms_authenticated;

select gms_private.install_touch_triggers();
