-- 0030_write_and_keep.sql
-- Write faster as a team (v1.6.0) and win and keep it (v1.7.0), for applicant workspaces: the
-- answer library learns when it was last checked, the organization keeps a document vault, an
-- outside application gets a checklist of required documents, a go/no-go scorecard, comments per
-- question and a closeout, and an awarded outside application gets its obligations (reports,
-- expected and received payments, conditions).
--
-- Privacy is 0029's: every new row belongs to one applicant workspace and is readable only by that
-- workspace's members (consultants excluded, gms.is_staff). Signed-in users get SELECT through the
-- policies below; every write goes through the API's service role. No money moves: amounts are the
-- applicant's own records, never a destination or bank detail.
--
-- What this changes on a live database (every new column is nullable or has a default; no existing
-- row is changed, removed or re-written):
--   * answers: adds last_verified_at (null: never checked), variants (default {}) and tags
--     (default {}), each with a check that existing rows pass by their defaults.
--   * documents: adds doc_type and expires_on (both null on every existing row) and a check on
--     them. A vault document is subject_type 'vault', owned by and kept in one applicant workspace,
--     of one of the vault types (never a bank letter, a voided check or anything with an SSN: there
--     is no type for those). 'funder_guidelines' and 'award_letter' mark documents of an outside
--     application. Every existing row has doc_type null and no row has subject_type 'vault', so
--     every existing row passes. An index finds vault documents by expiry.
--   * outside_applications: adds required_documents (default []), go_no_go (null), closed_out_at
--     (null), with checks that existing rows pass by those values.
--   * outside_questions: adds obligation_id (null); a question that belongs to a report obligation
--     is phase 'report'. Existing rows have it null and pass.
--   * outside_answers: the provenance check gains 'assist' (accepted text drafted by the assistant).
--     Every existing value is still allowed.
--   * threads: the subject check gains 'outside_application' (comments per question of an outside
--     application, applicant-internal, in the application's own workspace). Existing rows pass. A
--     RESTRICTIVE select policy keeps outside-application threads (and so their messages) from
--     consultants; it changes nothing for any other thread.
--   * assist_calls: the tool check gains 'draft_answer' and 'parse_guidelines'. Existing rows pass.
--   * adds two tables, RLS on, with 0029's triggers (updated_at, applicant-only, same-workspace,
--     workspace-immutable):
--       outside_obligation_series  "every N months from start until grant end" for an obligation;
--       outside_obligations        each report, expected payment, payment received or condition.
--   * replaces gms.same_workspace_rules() with 0029's list plus the new parent links.
--   * Workspace settings live in workspaces.settings (jsonb), so the new ones are JSON keys with no
--     DDL: goNoGoEnabled (default false), goNoGoWeights ({fit, capacity, effort, relationship},
--     default 3, 2, 2, 1) and fiscalYearStartMonth (1-12, default 1). The API validates them.
-- No existing row is changed or removed.

-- ---------------------------------------------------------------------------------------------
-- Helpers (immutable checks on jsonb and arrays)
-- ---------------------------------------------------------------------------------------------

-- Library answer variants: { short?, medium?, long? }, each a string of at most 20,000 characters.
create or replace function gms.answer_variants_ok(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(v) = 'object'
     and not exists (
       select 1 from pg_catalog.jsonb_each(v) f
        where f.key not in ('short', 'medium', 'long')
           or pg_catalog.jsonb_typeof(f.value) <> 'string'
           or pg_catalog.length(f.value #>> '{}') > 20000
     );
$$;

-- Library answer tags: at most 20, each 1-50 characters with no outer spaces.
create or replace function gms.answer_tags_ok(t text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.cardinality(t) <= 20
     and pg_catalog.array_position(t, null) is null
     and not exists (select 1 from pg_catalog.unnest(t) x(tag) where pg_catalog.length(x.tag) not between 1 and 50 or x.tag <> pg_catalog.btrim(x.tag));
$$;

-- Required documents of an outside application: at most 50 of
-- { label, docType?, documentId?, status: needed | attached | not_needed }.
create or replace function gms.required_documents_ok(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(r) = 'array'
     and pg_catalog.jsonb_array_length(r) <= 50
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(r) e(v)
        where pg_catalog.jsonb_typeof(e.v) <> 'object'
           or exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k where k not in ('label', 'docType', 'documentId', 'status'))
           or pg_catalog.jsonb_typeof(e.v -> 'label') is distinct from 'string'
           or pg_catalog.length(pg_catalog.btrim(e.v ->> 'label')) not between 1 and 200
           or (e.v ->> 'status') is null
           or (e.v ->> 'status') not in ('needed', 'attached', 'not_needed')
           or (e.v ? 'docType' and (e.v ->> 'docType') is not null and (e.v ->> 'docType') not in ('irs_letter', 'audit', 'financials', 'board_list', 'budget', 'annual_report', 'logo', 'other'))
           or (e.v ? 'documentId' and (e.v ->> 'documentId') is not null and (e.v ->> 'documentId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
           or ((e.v ->> 'status') = 'attached') <> ((e.v ->> 'documentId') is not null)
     );
$$;

-- A go/no-go scorecard: { scores, weights, total, decision: go | no_go, decidedBy, decidedAt, reason }.
-- The API computes it; the database holds its shape and the decision vocabulary.
create or replace function gms.go_no_go_ok(g jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
       pg_catalog.jsonb_typeof(g) = 'object'
       and not exists (select 1 from pg_catalog.jsonb_object_keys(g) k where k not in ('scores', 'weights', 'total', 'decision', 'decidedBy', 'decidedAt', 'reason', 'to'))
       and (g ->> 'decision') in ('go', 'no_go')
       and pg_catalog.jsonb_typeof(g -> 'scores') = 'object'
       and pg_catalog.jsonb_typeof(g -> 'total') = 'number'
       and (g ->> 'reason' is null or pg_catalog.length(g ->> 'reason') <= 2000),
     false);
$$;

-- Like 0029's check helpers these stay executable by every role: a check constraint runs them as
-- whoever writes the row, and they read nothing but their argument.

-- ---------------------------------------------------------------------------------------------
-- Answer library: last verified, variants, tags
-- ---------------------------------------------------------------------------------------------
alter table public.answers
  add column last_verified_at timestamptz,
  add column variants jsonb not null default '{}'::jsonb,
  add column tags text[] not null default '{}';
alter table public.answers
  add constraint answers_variants_check check (gms.answer_variants_ok(variants)),
  add constraint answers_tags_check check (gms.answer_tags_ok(tags));
comment on column public.answers.last_verified_at is 'When a person last confirmed this answer''s facts; null if never. Older than 12 months is shown as stale.';
comment on column public.answers.variants is 'Shorter and longer versions: { short?, medium?, long? } of about 50, 150 and 500 words.';

-- ---------------------------------------------------------------------------------------------
-- Document vault and document types
-- ---------------------------------------------------------------------------------------------
alter table public.documents
  add column doc_type text,
  add column expires_on date;
alter table public.documents
  add constraint documents_doc_type_check check (
    doc_type is null or doc_type in ('irs_letter', 'audit', 'financials', 'board_list', 'budget', 'annual_report', 'logo', 'other', 'funder_guidelines', 'award_letter')),
  -- A vault document has a vault type and is the workspace's own; an outside application's
  -- document may be the funder's guidelines or the award letter; any other document has no type.
  add constraint documents_doc_type_subject_check check (
    case
      when subject_type = 'vault' then doc_type is not null and doc_type in ('irs_letter', 'audit', 'financials', 'board_list', 'budget', 'annual_report', 'logo', 'other') and workspace_id = owner_workspace_id
      when subject_type = 'outside_application' then doc_type is null or doc_type in ('funder_guidelines', 'award_letter')
      else doc_type is null
    end),
  add constraint documents_expires_on_check check (expires_on is null or subject_type = 'vault');
comment on column public.documents.doc_type is 'Vault documents (subject_type ''vault''): irs_letter, audit, financials, board_list, budget, annual_report, logo, other. Outside application documents: funder_guidelines, award_letter. Null otherwise.';
comment on column public.documents.expires_on is 'Vault documents only: when the document stops being current (a warning goes 30 days before).';
create index documents_vault_expiry_idx on public.documents (expires_on) where subject_type = 'vault' and expires_on is not null;
create index documents_vault_idx on public.documents (workspace_id, doc_type) where subject_type = 'vault';

-- Vault documents belong to applicant workspaces.
create or replace function gms.vault_document_applicant_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subject_type is not distinct from 'vault'
     and (select w.kind from public.workspaces w where w.id = new.workspace_id) is distinct from 'applicant' then
    raise exception 'documents: the vault belongs to applicant workspaces' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.vault_document_applicant_only() from public, anon, authenticated;
create trigger documents_vault_applicant_only before insert or update of subject_type, workspace_id on public.documents
  for each row execute function gms.vault_document_applicant_only();

-- ---------------------------------------------------------------------------------------------
-- Outside applications: required documents, go/no-go, closeout
-- ---------------------------------------------------------------------------------------------
alter table public.outside_applications
  add column required_documents jsonb not null default '[]'::jsonb,
  add column go_no_go jsonb,
  add column closed_out_at timestamptz;
alter table public.outside_applications
  add constraint outside_applications_required_documents_check check (gms.required_documents_ok(required_documents)),
  add constraint outside_applications_go_no_go_check check (go_no_go is null or gms.go_no_go_ok(go_no_go)),
  -- Only an awarded application is closed out; reopening it clears the closeout.
  add constraint outside_applications_closed_out_check check (closed_out_at is null or stage = 'awarded');
comment on column public.outside_applications.required_documents is 'The funder''s required documents: [{ label, docType?, documentId?, status }]; documentId names a vault document of the same workspace.';
comment on column public.outside_applications.go_no_go is 'The go/no-go scorecard and decision: { scores, weights, total, decision, decidedBy, decidedAt, reason }.';
comment on column public.outside_applications.closed_out_at is 'When an awarded application was closed out (every obligation done or received). The stage stays awarded.';

-- ---------------------------------------------------------------------------------------------
-- Obligations of an outside award
-- ---------------------------------------------------------------------------------------------
create table public.outside_obligation_series (
  id                      uuid primary key default gms.uuid_v7(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  outside_application_id  uuid not null references public.outside_applications (id) on delete cascade,
  kind                    text not null check (kind in ('report', 'payment_expected', 'condition')),
  title                   text not null check (length(btrim(title)) between 1 and 300),
  every_months            integer not null check (every_months between 1 and 24),
  start_on                date not null,
  end_on                  date not null,
  amount_minor            bigint check (amount_minor is null or amount_minor >= 0),
  notes                   text check (notes is null or length(notes) <= 5000),
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (end_on >= start_on),
  check (amount_minor is null or kind = 'payment_expected')
);
comment on table public.outside_obligation_series is 'A repeating obligation of an outside award ("every N months from start until grant end"). Its instances are outside_obligations rows. Private to the applicant workspace.';
create index outside_obligation_series_application_idx on public.outside_obligation_series (outside_application_id);

create table public.outside_obligations (
  id                      uuid primary key default gms.uuid_v7(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  outside_application_id  uuid not null references public.outside_applications (id) on delete cascade,
  kind                    text not null check (kind in ('report', 'payment_expected', 'payment_received', 'condition')),
  title                   text not null check (length(btrim(title)) between 1 and 300),
  -- The date it is due (a payment received: the date it arrived).
  due_on                  date,
  -- Payments only, in the application's currency. The applicant's own record; no money moves.
  amount_minor            bigint check (amount_minor is null or amount_minor >= 0),
  status                  text not null default 'upcoming' check (status in ('upcoming', 'due', 'submitted', 'received', 'done', 'missed')),
  series_id               uuid references public.outside_obligation_series (id) on delete set null,
  -- Edited on its own: regenerating the series leaves it as it is.
  customized              boolean not null default false,
  notes                   text check (notes is null or length(notes) <= 5000),
  -- A report: when it was submitted to the funder, its confirmation and the "as submitted" PDF.
  submitted_at            timestamptz,
  confirmation_ref        text check (confirmation_ref is null or length(confirmation_ref) <= 200),
  document_id             uuid references public.documents (id) on delete set null,
  snapshot_sha256         text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  -- When it was done or the payment received.
  completed_on            date,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (amount_minor is null or kind in ('payment_expected', 'payment_received')),
  check (kind <> 'payment_received' or (amount_minor is not null and due_on is not null)),
  check (kind <> 'report' or due_on is not null),
  check (series_id is null or kind <> 'payment_received'),
  -- The statuses each kind can be in.
  check (case kind
           when 'report' then status in ('upcoming', 'due', 'submitted', 'done', 'missed')
           when 'payment_expected' then status in ('upcoming', 'due', 'received', 'missed')
           when 'payment_received' then status = 'received'
           when 'condition' then status in ('upcoming', 'due', 'done', 'missed')
         end),
  check (status <> 'submitted' or submitted_at is not null),
  check (snapshot_sha256 is null or document_id is not null)
);
comment on table public.outside_obligations is 'What an outside award asks of the applicant (reports, conditions) and the payments it expects or received. Amounts are records only. Private to the applicant workspace.';
create index outside_obligations_application_idx on public.outside_obligations (outside_application_id, due_on);
create index outside_obligations_series_idx on public.outside_obligations (series_id) where series_id is not null;
create index outside_obligations_due_idx on public.outside_obligations (due_on) where status in ('upcoming', 'due');

-- A report's own questions, written in the same editor as the application's.
alter table public.outside_questions
  add column obligation_id uuid references public.outside_obligations (id) on delete cascade;
alter table public.outside_questions
  add constraint outside_questions_obligation_check check (obligation_id is null or phase = 'report');
create index outside_questions_obligation_idx on public.outside_questions (obligation_id) where obligation_id is not null;

alter table public.outside_obligation_series enable row level security;
alter table public.outside_obligations enable row level security;
revoke all on public.outside_obligation_series, public.outside_obligations from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.outside_obligation_series, public.outside_obligations to service_role;
grant select on public.outside_obligation_series, public.outside_obligations to authenticated;
create policy outside_obligation_series_select on public.outside_obligation_series for select to authenticated
  using (gms.is_staff(workspace_id));
create policy outside_obligations_select on public.outside_obligations for select to authenticated
  using (gms.is_staff(workspace_id));

do $$
declare
  t text;
begin
  foreach t in array array['outside_obligation_series', 'outside_obligations'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before insert or update of workspace_id on public.%I for each row execute function gms.applicant_workspace_only()', t || '_applicant_only', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
  end loop;
end;
$$;

-- An obligation, its series and a report's questions all hang off the same outside application.
create or replace function gms.outside_obligation_same_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nested, so each table's own column is only read on that table.
  if tg_table_name = 'outside_obligations' then
    if new.series_id is not null
       and not exists (select 1 from public.outside_obligation_series s where s.id = new.series_id and s.outside_application_id = new.outside_application_id) then
      raise exception 'outside_obligations: the series belongs to another application' using errcode = '23514';
    end if;
  elsif tg_table_name = 'outside_questions' then
    if new.obligation_id is not null
       and not exists (select 1 from public.outside_obligations o where o.id = new.obligation_id and o.outside_application_id = new.outside_application_id and o.kind = 'report') then
      raise exception 'outside_questions: the obligation is not a report of this application' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gms.outside_obligation_same_application() from public, anon, authenticated;
create trigger outside_obligations_same_application before insert or update of series_id, outside_application_id on public.outside_obligations
  for each row execute function gms.outside_obligation_same_application();
create trigger outside_questions_same_obligation before insert or update of obligation_id, outside_application_id on public.outside_questions
  for each row execute function gms.outside_obligation_same_application();

-- ---------------------------------------------------------------------------------------------
-- Same workspace as the parent (0020): 0029's list plus the new parent links.
-- ---------------------------------------------------------------------------------------------
create or replace function gms.same_workspace_rules()
returns table (child text, col text, parent text)
language sql
immutable
set search_path = ''
as $$
  values
    ('opportunities', 'program_id', 'programs'),
    ('competitions', 'opportunity_id', 'opportunities'),
    ('applications', 'competition_id', 'competitions'),
    ('applications', 'opportunity_id', 'opportunities'),
    ('form_responses', 'application_id', 'applications'),
    ('form_responses', 'submission_id', 'submissions'),
    ('application_events', 'application_id', 'applications'),
    ('review_assignments', 'application_id', 'applications'),
    ('reviews', 'assignment_id', 'review_assignments'),
    ('decisions', 'application_id', 'applications'),
    ('decisions', 'competition_id', 'competitions'),
    ('awards', 'application_id', 'applications'),
    ('awards', 'opportunity_id', 'opportunities'),
    ('awards', 'program_id', 'programs'),
    ('awards', 'parent_award_id', 'awards'),
    ('agreements', 'award_id', 'awards'),
    ('payment_schedules', 'award_id', 'awards'),
    ('tranches', 'award_id', 'awards'),
    ('tranches', 'schedule_id', 'payment_schedules'),
    ('requirements', 'award_id', 'awards'),
    ('requirements', 'releases_tranche_id', 'tranches'),
    ('submissions', 'requirement_id', 'requirements'),
    ('submissions', 'award_id', 'awards'),
    ('budgets', 'award_id', 'awards'),
    ('budgets', 'application_id', 'applications'),
    ('amendments', 'award_id', 'awards'),
    ('amendments', 'child_award_id', 'awards'),
    ('bank_transactions', 'matched_tranche_id', 'tranches'),
    ('award_invitations', 'award_id', 'awards'),
    ('outside_applications', 'funder_record_id', 'funder_records'),
    ('outside_applications', 'receipt_document_id', 'documents'),
    ('outside_applications', 'snapshot_document_id', 'documents'),
    ('outside_questions', 'outside_application_id', 'outside_applications'),
    ('outside_questions', 'obligation_id', 'outside_obligations'),
    ('outside_answers', 'question_id', 'outside_questions'),
    ('outside_answers', 'library_answer_id', 'answers'),
    ('consulting_requests', 'outside_application_id', 'outside_applications'),
    ('outside_obligation_series', 'outside_application_id', 'outside_applications'),
    ('outside_obligations', 'outside_application_id', 'outside_applications'),
    ('outside_obligations', 'series_id', 'outside_obligation_series'),
    ('outside_obligations', 'document_id', 'documents')
$$;
revoke all on function gms.same_workspace_rules() from public, anon, authenticated;
grant execute on function gms.same_workspace_rules() to service_role;

-- outside_questions already has a same-workspace trigger (0029); it now also watches obligation_id.
drop trigger outside_questions_same_workspace on public.outside_questions;
create trigger outside_questions_same_workspace before insert or update of outside_application_id, obligation_id, workspace_id on public.outside_questions
  for each row execute function gms.same_workspace_as_parent();
create trigger outside_obligation_series_same_workspace before insert or update of outside_application_id, workspace_id on public.outside_obligation_series
  for each row execute function gms.same_workspace_as_parent();
create trigger outside_obligations_same_workspace before insert or update of outside_application_id, series_id, document_id, workspace_id on public.outside_obligations
  for each row execute function gms.same_workspace_as_parent();

-- ---------------------------------------------------------------------------------------------
-- Provenance 'assist'; assistant tools; comment threads on outside applications
-- ---------------------------------------------------------------------------------------------
alter table public.outside_answers drop constraint outside_answers_provenance_check;
alter table public.outside_answers add constraint outside_answers_provenance_check
  check (provenance in ('passport', 'self_declared', 'library', 'prior_submission', 'qbo', 'user', 'assist') or provenance ~ '^agent:[A-Za-z0-9_.:-]{1,200}$');
comment on column public.form_responses.provenance is 'Field path -> passport | self_declared | library | prior_submission | qbo | user | assist | agent:<client>.';

alter table public.assist_calls drop constraint assist_calls_tool_check;
alter table public.assist_calls add constraint assist_calls_tool_check
  check (tool in ('summarize', 'compare_rubric', 'draft_letter', 'adapt_answer', 'draft_answer', 'parse_guidelines'));

alter table public.threads drop constraint if exists threads_subject_type_check;
alter table public.threads add constraint threads_subject_type_check check (subject_type in ('application', 'award', 'requirement', 'competition', 'outside_application'));
-- Comments on an outside application are the applicant team's own: internal, in its workspace.
alter table public.threads add constraint threads_outside_application_check check (
  subject_type <> 'outside_application'
  or (visibility = 'applicant_internal' and funder_workspace_id is null and applicant_workspace_id = workspace_id));
create trigger threads_outside_subject before insert or update of subject_type, subject_id, workspace_id on public.threads
  for each row execute function gms.outside_subject_same_workspace();
comment on column public.messages.field_ref is 'For a field comment: { formId, path } of the form field it is about, or { questionId } of an outside application''s question; null for plain messages.';

-- Applicant-internal threads are visible to every member (0009, consultants included). Outside
-- applications are not: this RESTRICTIVE policy narrows those threads to staff (gms.is_staff), and
-- messages follow, since their policy reads the thread through this one. Other threads are as before.
create policy threads_outside_private on public.threads as restrictive for select to authenticated
  using (subject_type <> 'outside_application' or gms.is_staff(workspace_id));
