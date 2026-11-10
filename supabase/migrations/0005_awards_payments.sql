-- 0005_awards_payments: awards, agreements, payment schedules, requirements, budgets.
--
-- Money rules (CLAUDE.md): no table here holds a payout destination and nothing here is the
-- source of truth for amounts disbursed. tranches.passport_disbursement_id points at the Passport
-- disbursement; awards.funding.disbursed is a cache of Passport's value. The only bank-related
-- display fields anywhere are a bank name and last4 inside jsonb (tranches.external).

create table public.awards (
  id                      uuid primary key default gms.uuid_v7(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  recipient_workspace_id  uuid references public.workspaces (id) on delete restrict,
  recipient_individual    jsonb,
  application_id          uuid references public.applications (id) on delete set null,
  opportunity_id          uuid references public.opportunities (id) on delete set null,
  program_id              uuid references public.programs (id) on delete set null,
  title                   text not null check (length(btrim(title)) between 1 and 300),
  description             text,
  status                  text not null default 'offered' check (status = any (gms.award_statuses())),
  cg_status               text not null default 'awarded' check (cg_status in ('awarded', 'completed', 'cancelled', 'custom')),
  funding                 jsonb not null default '{}'::jsonb,
  disbursed_at            timestamptz,
  key_dates               jsonb not null default '{}'::jsonb,
  parent_award_id         uuid references public.awards (id) on delete set null,
  passport_award_id       text,
  passport_synced_at      timestamptz,
  conditions              text[] not null default '{}',
  cg                      jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check ((recipient_workspace_id is null) <> (recipient_individual is null))
);
comment on column public.awards.funding is 'requested/awarded (minor units + currency). disbursed is read from Passport and cached; disbursed_at is when.';
comment on column public.awards.recipient_individual is 'Individual recipients (name, contact). Tranches for individuals are resolve-mode only.';
create index awards_workspace_id_idx on public.awards (workspace_id, status);
create index awards_recipient_workspace_id_idx on public.awards (recipient_workspace_id);
create index awards_application_id_idx on public.awards (application_id);
create index awards_opportunity_id_idx on public.awards (opportunity_id);
create index awards_program_id_idx on public.awards (program_id);
create index awards_parent_award_id_idx on public.awards (parent_award_id);
create unique index awards_passport_award_id_idx on public.awards (passport_award_id) where passport_award_id is not null;

create table public.agreements (
  id                 uuid primary key default gms.uuid_v7(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  award_id           uuid not null references public.awards (id) on delete cascade,
  template_id        uuid references public.templates (id) on delete set null,
  version            integer not null default 1 check (version >= 1),
  status             text not null default 'draft' check (status = any (gms.agreement_statuses())),
  rendered_pdf_path  text,
  document_sha256    text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  grantee_signature  jsonb,
  funder_signature   jsonb,
  executed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (award_id, version),
  check (status <> 'executed' or (executed_at is not null and document_sha256 is not null
                                  and grantee_signature is not null and funder_signature is not null))
);
comment on column public.agreements.grantee_signature is 'Click-to-sign audit record: name, user_id, ip, at, hash (the document SHA-256 that was signed).';
create index agreements_workspace_id_idx on public.agreements (workspace_id);
create index agreements_template_id_idx on public.agreements (template_id);

-- An executed agreement is final: issue an amendment instead of voiding or editing it.
create or replace function gms.agreements_executed_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'executed' then
    raise exception 'agreement % is executed; issue an amendment instead', old.id using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger agreements_executed_immutable before update or delete on public.agreements
  for each row execute function gms.agreements_executed_immutable();

create table public.payment_schedules (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  award_id      uuid not null unique references public.awards (id) on delete cascade,
  currency      text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index payment_schedules_workspace_id_idx on public.payment_schedules (workspace_id);

create table public.tranches (
  id                        uuid primary key default gms.uuid_v7(),
  workspace_id              uuid not null references public.workspaces (id) on delete cascade,
  schedule_id               uuid not null references public.payment_schedules (id) on delete cascade,
  award_id                  uuid not null references public.awards (id) on delete cascade,
  seq                       integer not null check (seq >= 1),
  amount_minor              bigint not null check (amount_minor > 0),
  currency                  text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  condition                 jsonb not null default '{"type":"manual"}'::jsonb
                              check (condition ->> 'type' in ('onExecution', 'onReportAccepted', 'onDate', 'manual')),
  status                    text not null default 'scheduled' check (status = any (gms.tranche_statuses())),
  due_at                    timestamptz,
  released_by               uuid,
  released_at               timestamptz,
  mode                      text check (mode in ('facilitated', 'resolve')),
  passport_disbursement_id  text,
  passport_status           text,
  external                  jsonb,
  hold_reason               text,
  idempotency_key           text unique,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (award_id, seq),
  check (status <> 'held' or hold_reason is not null)
);
comment on table public.tranches is 'Scheduled payments. Releases happen at Passport (POST /passport/disbursements); this row tracks the instruction and its status.';
comment on column public.tranches.external is 'Resolve mode: reference, paidAt, last4 of what the funder paid elsewhere. Display only.';
create index tranches_workspace_id_idx on public.tranches (workspace_id, status);
create index tranches_schedule_id_idx on public.tranches (schedule_id);
create index tranches_due_idx on public.tranches (due_at) where status in ('scheduled', 'due', 'ready');
create unique index tranches_passport_disbursement_id_idx on public.tranches (passport_disbursement_id) where passport_disbursement_id is not null;

create table public.requirements (
  id                   uuid primary key default gms.uuid_v7(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  award_id             uuid not null references public.awards (id) on delete cascade,
  type                 text not null check (type in ('report', 'document', 'milestone', 'site_visit', 'acknowledgment')),
  title                text not null check (length(btrim(title)) between 1 and 300),
  form_id              uuid,
  form_version         integer,
  due_at               timestamptz,
  recurrence           jsonb,
  grace_days           integer not null default 0 check (grace_days >= 0),
  reminder_plan        jsonb not null default '[-30, -14, -7, 0, 3, 14]'::jsonb,
  status               text not null default 'scheduled' check (status = any (gms.requirement_statuses())),
  waived_by            uuid,
  releases_tranche_id  uuid references public.tranches (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (form_id, form_version) references public.forms (id, version) on delete restrict,
  check ((form_id is null) = (form_version is null)),
  check (status <> 'waived' or waived_by is not null)
);
create index requirements_workspace_id_idx on public.requirements (workspace_id, status);
create index requirements_award_id_idx on public.requirements (award_id);
create index requirements_due_idx on public.requirements (due_at) where status in ('scheduled', 'due', 'overdue');
create index requirements_form_idx on public.requirements (form_id, form_version);
create index requirements_releases_tranche_id_idx on public.requirements (releases_tranche_id);

create table public.submissions (
  id                         uuid primary key default gms.uuid_v7(),
  workspace_id               uuid not null references public.workspaces (id) on delete cascade,
  requirement_id             uuid references public.requirements (id) on delete cascade,
  award_id                   uuid references public.awards (id) on delete cascade,
  status                     text not null default 'draft' check (status = any (gms.submission_statuses())),
  submitted_at               timestamptz,
  submitted_by               uuid,
  reviewed_by                uuid,
  review_note                text,
  shared_from_submission_id  uuid references public.submissions (id) on delete set null,
  shared_fields              jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  -- A grantee-shared copy (shared_from_submission_id) may arrive without a requirement or award
  -- in the receiving funder's workspace.
  check (shared_from_submission_id is not null or (requirement_id is not null and award_id is not null))
);
comment on column public.submissions.shared_from_submission_id is 'Consented copy of another funder''s accepted report (consents.basis = shared_submission).';
create index submissions_workspace_id_idx on public.submissions (workspace_id, status);
create index submissions_requirement_id_idx on public.submissions (requirement_id);
create index submissions_award_id_idx on public.submissions (award_id);
create index submissions_shared_from_idx on public.submissions (shared_from_submission_id);

alter table public.form_responses
  add constraint form_responses_submission_id_fkey foreign key (submission_id) references public.submissions (id) on delete cascade;

create table public.budgets (
  id              uuid primary key default gms.uuid_v7(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  application_id  uuid references public.applications (id) on delete cascade,
  award_id        uuid references public.awards (id) on delete cascade,
  kind            text not null check (kind in ('proposed', 'approved', 'actual')),
  categories      jsonb not null default '[]'::jsonb,
  lines           jsonb not null default '[]'::jsonb,
  currency        text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  source          text not null default 'user' check (source ~ '^(user|qbo|agent:.+)$'),
  period_start    date,
  period_end      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (application_id is not null or award_id is not null),
  check (period_end is null or period_start is null or period_end >= period_start)
);
comment on column public.budgets.lines is 'category, label, amount_minor, notes.';
create index budgets_workspace_id_idx on public.budgets (workspace_id);
create index budgets_application_id_idx on public.budgets (application_id);
create index budgets_award_id_idx on public.budgets (award_id);

create table public.amendments (
  id              uuid primary key default gms.uuid_v7(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  award_id        uuid not null references public.awards (id) on delete cascade,
  type            text not null check (type in ('extension', 'reallocation', 'scope', 'supplemental')),
  request         jsonb not null default '{}'::jsonb,
  status          text not null default 'requested' check (status in ('requested', 'approved', 'declined')),
  requested_by    uuid,
  decided_by      uuid,
  decided_at      timestamptz,
  child_award_id  uuid references public.awards (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index amendments_workspace_id_idx on public.amendments (workspace_id);
create index amendments_award_id_idx on public.amendments (award_id);
create index amendments_child_award_id_idx on public.amendments (child_award_id);

-- Mercury reconciliation: outbound transactions only, read-only connector. No bank identifiers of any kind.
create table public.bank_transactions (
  id                  uuid primary key default gms.uuid_v7(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  provider            text not null check (provider in ('mercury')),
  external_txn_id     text not null unique,
  amount_minor        bigint not null,
  currency            text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  posted_at           timestamptz not null,
  counterparty_name   text,
  memo                text,
  matched_tranche_id  uuid references public.tranches (id) on delete set null,
  matched_by          uuid,
  matched_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.bank_transactions is 'Outbound bank transactions pulled read-only for resolve-mode matching. Counterparty name and memo only.';
create index bank_transactions_workspace_id_idx on public.bank_transactions (workspace_id, posted_at desc);
create index bank_transactions_matched_tranche_id_idx on public.bank_transactions (matched_tranche_id);

-- Reminder sends are idempotent per (requirement, offset) across job retries (§10.8).
create table public.reminder_sends (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  requirement_id   uuid not null references public.requirements (id) on delete cascade,
  due_at           timestamptz not null,
  offset_days      integer not null,
  email_message_id text,
  sent_at          timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (requirement_id, due_at, offset_days)
);
create index reminder_sends_workspace_id_idx on public.reminder_sends (workspace_id);
