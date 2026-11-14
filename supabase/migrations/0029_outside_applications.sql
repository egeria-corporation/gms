-- 0029_outside_applications.sql
-- Apply anywhere (v1.5.0): an applicant organization keeps its applications to ANY funder here,
-- not only to funders on this GMS. These are outside applications: the applicant's own records.
-- The GMS never submits anything; it records a submission the person made elsewhere. Built-in
-- applications are unchanged.
--
-- Privacy: every row below belongs to one applicant workspace and is readable only by that
-- workspace's members (consultants excluded: their access is scoped to named applications). No
-- funder workspace, no CommonGrants route and no Passport mirror reads these tables. Signed-in
-- users get SELECT through the policies below; every write goes through the API's service role.
--
-- What this changes on a live database:
--   * adds six tables, each with RLS on, `updated_at` kept by gms.touch_updated_at(), and the
--     applicant-only trigger (a row in a funder workspace is refused):
--       funder_records       a light record per funder (contacts, notes, portal login holder);
--       outside_applications the application itself (stage, deadlines, ask, submission, decision);
--       outside_questions    the funder's questions, with word or character limits;
--       outside_answers      every saved version of an answer (the latest is current);
--       calendar_feeds       the SHA-256 of one private calendar link per workspace (service role only);
--       consulting_requests  each "Get help writing this" email sent (masked address, field names only).
--   * replaces gms.same_workspace_rules() with the same list plus the new parent links, and adds
--     the same-workspace and workspace-immutable triggers on the new tables. `documents` and
--     `answers` become parents (an outside application names its receipt and snapshot documents,
--     an answer version names a library answer), so they also get the workspace-immutable trigger:
--     no existing row changes, and nothing in the GMS moves a document or an answer between workspaces.
--   * adds a trigger on `documents` and `tasks`: a row whose subject is an outside application must
--     sit in that application's workspace (documents: uploaded by it too). Those tables have no
--     subject-type check today and none is added; existing rows are not touched or re-checked.
--   * adds two functions only the service role may run: counting a consulting request against its
--     limits (3 per application and 10 per workspace per rolling 24 hours, under one lock), and
--     copying saved OpenGrants listings into prospects (below).
--   * THIS ADDS ROWS: every `discover_saved` row with source 'opengrants' in an applicant workspace
--     is copied into `outside_applications` as a prospect (stage 'prospect', source 'opengrants',
--     its title, link and listing), with one `outside_application.created` ledger row each
--     (actor system:migration). The saved rows stay as they are; 'gms' and 'alert' rows, and
--     OpenGrants rows that hold a funding alert (`alert:` ids), are not copied. Running the copy again adds nothing (a unique index on the listing id per workspace).
-- No existing row is changed or removed.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Outside applications and everything around them belong to applicant workspaces.
create or replace function gms.applicant_workspace_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select w.kind from public.workspaces w where w.id = new.workspace_id) is distinct from 'applicant' then
    raise exception '%: rows belong to applicant workspaces', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A funder record's contacts: at most 20 objects, each with a name and optional role, email, phone.
create or replace function gms.funder_contacts_ok(c jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(c) = 'array'
     and pg_catalog.jsonb_array_length(c) <= 20
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(c) e(v)
        where pg_catalog.jsonb_typeof(e.v) <> 'object'
           or pg_catalog.jsonb_typeof(e.v -> 'name') is distinct from 'string'
           or pg_catalog.length(pg_catalog.btrim(e.v ->> 'name')) not between 1 and 200
           or exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k where k not in ('name', 'role', 'email', 'phone'))
           or exists (select 1 from pg_catalog.jsonb_each(e.v) f where pg_catalog.jsonb_typeof(f.value) <> 'string' or pg_catalog.length(f.value #>> '{}') > 320)
     );
$$;

-- Custom fields: an object of at most 30 string keys with scalar values (string, number, boolean or null).
create or replace function gms.custom_fields_ok(c jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(c) = 'object'
     and (select count(*) from pg_catalog.jsonb_object_keys(c)) <= 30
     and not exists (
       select 1 from pg_catalog.jsonb_each(c) f
        where pg_catalog.length(f.key) not between 1 and 100
           or pg_catalog.jsonb_typeof(f.value) in ('object', 'array')
           or (pg_catalog.jsonb_typeof(f.value) = 'string' and pg_catalog.length(f.value #>> '{}') > 2000)
     );
$$;

-- Amounts by year: [{ year, amountMinor }], at most 20 entries, whole non-negative amounts.
create or replace function gms.amounts_by_year_ok(c jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(c) = 'array'
     and pg_catalog.jsonb_array_length(c) <= 20
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(c) e(v)
        where pg_catalog.jsonb_typeof(e.v) <> 'object'
           or pg_catalog.jsonb_typeof(e.v -> 'year') is distinct from 'number'
           or pg_catalog.jsonb_typeof(e.v -> 'amountMinor') is distinct from 'number'
           or (e.v ->> 'year') !~ '^[12][0-9]{3}$'
           or (e.v ->> 'amountMinor') !~ '^[0-9]{1,15}$'
           or exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k where k not in ('year', 'amountMinor'))
     );
$$;

-- A date from free text, or null (never an error): for listing deadlines copied below.
create or replace function gms.try_date(t text)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return pg_catalog.substr(t, 1, 10)::date;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.funder_records (
  id                   uuid primary key default gms.uuid_v7(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 1 and 200),
  website              text check (website is null or length(website) <= 500),
  notes                text check (notes is null or length(notes) <= 20000),
  contacts             jsonb not null default '[]'::jsonb check (gms.funder_contacts_ok(contacts)),
  portal_url           text check (portal_url is null or length(portal_url) <= 2000),
  -- A person's name: who holds the login to the funder's portal. Never a password or a username.
  portal_login_holder  text check (portal_login_holder is null or length(btrim(portal_login_holder)) between 1 and 200),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.funder_records is 'An applicant''s light record of a funder (contacts, notes, portal login holder). Private to the applicant workspace.';
create unique index funder_records_name_idx on public.funder_records (workspace_id, lower(btrim(name)));

create table public.outside_applications (
  id                    uuid primary key default gms.uuid_v7(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  -- identity
  title                 text not null check (length(btrim(title)) between 1 and 300),
  program_name          text check (program_name is null or length(program_name) <= 300),
  funder_record_id      uuid references public.funder_records (id) on delete set null,
  funder_name           text check (funder_name is null or length(btrim(funder_name)) between 1 and 200),
  -- source
  source                text not null default 'manual' check (source in ('opengrants', 'manual', 'import', 'link')),
  source_ref            text check (source_ref is null or length(source_ref) between 1 and 300),
  listing               jsonb not null default '{}'::jsonb check (jsonb_typeof(listing) = 'object'),
  listing_url           text check (listing_url is null or length(listing_url) <= 2000),
  portal_url            text check (portal_url is null or length(portal_url) <= 2000),
  -- stage
  stage                 text not null default 'drafting' check (stage in ('prospect', 'deciding', 'loi', 'invited', 'drafting', 'submitted', 'awarded', 'declined', 'withdrawn', 'not_pursuing')),
  previous_stage        text check (previous_stage is null or previous_stage in ('prospect', 'deciding', 'loi', 'invited', 'drafting', 'submitted', 'awarded', 'declined', 'withdrawn', 'not_pursuing')),
  -- money and dates (the applicant's own records; no money moves here)
  currency              text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  ask_amount_minor      bigint check (ask_amount_minor is null or ask_amount_minor >= 0),
  ask_by_year           jsonb not null default '[]'::jsonb check (gms.amounts_by_year_ok(ask_by_year)),
  loi_due               date,
  full_due              date,
  internal_due          date,
  rolling               boolean not null default false,
  -- submission (made elsewhere; recorded here)
  submitted_at          timestamptz,
  submission_method     text check (submission_method is null or submission_method in ('portal', 'email', 'mail', 'grants_gov', 'other')),
  confirmation_ref      text check (confirmation_ref is null or length(confirmation_ref) <= 200),
  receipt_document_id   uuid references public.documents (id) on delete set null,
  snapshot_document_id  uuid references public.documents (id) on delete set null,
  snapshot_sha256       text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  -- decision
  decided_at            timestamptz,
  awarded_amount_minor  bigint check (awarded_amount_minor is null or awarded_amount_minor >= 0),
  award_by_year         jsonb not null default '[]'::jsonb check (gms.amounts_by_year_ok(award_by_year)),
  grant_start           date,
  grant_end             date,
  decision_notes        text check (decision_notes is null or length(decision_notes) <= 5000),
  next_cycle_on         date,
  -- other
  owner_user_id         uuid,
  custom_fields         jsonb not null default '{}'::jsonb check (gms.custom_fields_ok(custom_fields)),
  archived_at           timestamptz,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (grant_start is null or grant_end is null or grant_end >= grant_start),
  -- What the outside_application machine (packages/workflow/src/outside.ts) guards, held here too.
  check (stage <> 'submitted' or (submitted_at is not null and submission_method is not null)),
  check (stage <> 'awarded' or awarded_amount_minor is not null),
  check (snapshot_document_id is null or snapshot_sha256 is not null)
);
comment on table public.outside_applications is 'Apply anywhere: an applicant''s own record of an application to any funder. Private to the applicant workspace; never in CommonGrants output, Passport or funder analytics.';
create index outside_applications_stage_idx on public.outside_applications (workspace_id, stage);
create index outside_applications_loi_due_idx on public.outside_applications (loi_due) where loi_due is not null;
create index outside_applications_full_due_idx on public.outside_applications (full_due) where full_due is not null;
create index outside_applications_internal_due_idx on public.outside_applications (internal_due) where internal_due is not null;
create index outside_applications_funder_record_idx on public.outside_applications (funder_record_id) where funder_record_id is not null;
-- One prospect per OpenGrants listing per workspace: creating it again returns the existing one.
create unique index outside_applications_opengrants_ref_idx on public.outside_applications (workspace_id, source_ref) where source = 'opengrants';

create table public.outside_questions (
  id                      uuid primary key default gms.uuid_v7(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  outside_application_id  uuid not null references public.outside_applications (id) on delete cascade,
  phase                   text not null default 'full' check (phase in ('loi', 'full', 'report')),
  section                 text check (section is null or length(section) <= 200),
  position                integer not null default 0 check (position between 0 and 100000),
  prompt                  text not null check (length(btrim(prompt)) between 1 and 5000),
  guidance                text check (guidance is null or length(guidance) <= 10000),
  limit_kind              text check (limit_kind is null or limit_kind in ('words', 'chars', 'chars_no_spaces')),
  limit_value             integer check (limit_value is null or limit_value between 1 and 1000000),
  required                boolean not null default false,
  assignee_user_id        uuid,
  status                  text not null default 'empty' check (status in ('empty', 'draft', 'ready', 'approved')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check ((limit_kind is null) = (limit_value is null))
);
comment on table public.outside_questions is 'A funder''s question on an outside application, with its limit. Private to the applicant workspace.';
create index outside_questions_application_idx on public.outside_questions (outside_application_id, phase, position);
create index outside_questions_assignee_idx on public.outside_questions (assignee_user_id) where assignee_user_id is not null;

create table public.outside_answers (
  id                 uuid primary key default gms.uuid_v7(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  question_id        uuid not null references public.outside_questions (id) on delete cascade,
  version            integer not null check (version >= 1),
  body               text not null default '' check (length(body) <= 100000),
  -- The vocabulary of packages/forms/src/types.ts (ProvenanceSource).
  provenance         text not null check (provenance in ('passport', 'self_declared', 'library', 'prior_submission', 'qbo', 'user') or provenance ~ '^agent:[A-Za-z0-9_.:-]{1,200}$'),
  library_answer_id  uuid references public.answers (id) on delete set null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (question_id, version)
);
comment on table public.outside_answers is 'Every saved version of an answer to an outside question; the highest version is current. Private to the applicant workspace.';

create table public.calendar_feeds (
  id             uuid primary key default gms.uuid_v7(),
  workspace_id   uuid not null unique references public.workspaces (id) on delete cascade,
  -- Hex SHA-256 of the feed link's token. The token itself is shown once and never stored.
  token_sha256   text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_by     uuid,
  rotated_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.calendar_feeds is 'One private calendar link per applicant workspace, by token hash only. Service role only.';

create table public.consulting_requests (
  id                      uuid primary key default gms.uuid_v7(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  outside_application_id  uuid not null references public.outside_applications (id) on delete cascade,
  requested_by            uuid not null,
  contact_name            text not null check (length(btrim(contact_name)) between 1 and 200),
  -- `j…@example.org`: the first character and the domain only.
  contact_email_masked    text not null check (contact_email_masked ~ '^[^@[:space:]]…@[^@[:space:]]{1,253}$'),
  sent_at                 timestamptz,
  -- Names of the fields that were sent, never their values.
  fields_sent             text[] not null default '{}' check (fields_sent <@ array['organization', 'requester', 'title', 'funder', 'deadlines', 'ask', 'links', 'stage', 'questionCount', 'message', 'answers']::text[]),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.consulting_requests is 'Each consulting request email sent from an outside application, for the send limits and the record. Private to the applicant workspace.';
create index consulting_requests_workspace_idx on public.consulting_requests (workspace_id, created_at);
create index consulting_requests_application_idx on public.consulting_requests (outside_application_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers (0009's three steps for every new table)
-- ---------------------------------------------------------------------------------------------

alter table public.funder_records enable row level security;
alter table public.outside_applications enable row level security;
alter table public.outside_questions enable row level security;
alter table public.outside_answers enable row level security;
alter table public.calendar_feeds enable row level security;
alter table public.consulting_requests enable row level security;

revoke all on public.funder_records, public.outside_applications, public.outside_questions, public.outside_answers, public.calendar_feeds, public.consulting_requests
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.funder_records, public.outside_applications, public.outside_questions, public.outside_answers, public.calendar_feeds, public.consulting_requests
  to service_role;
-- Members read their own workspace's records (consultants excluded: gms.is_staff). The calendar
-- feed's token hash is not granted at all.
grant select on public.funder_records, public.outside_applications, public.outside_questions, public.outside_answers, public.consulting_requests
  to authenticated;

create policy funder_records_select on public.funder_records for select to authenticated
  using (gms.is_staff(workspace_id));
create policy outside_applications_select on public.outside_applications for select to authenticated
  using (gms.is_staff(workspace_id));
create policy outside_questions_select on public.outside_questions for select to authenticated
  using (gms.is_staff(workspace_id));
create policy outside_answers_select on public.outside_answers for select to authenticated
  using (gms.is_staff(workspace_id));
create policy consulting_requests_select on public.consulting_requests for select to authenticated
  using (gms.is_staff(workspace_id));

do $$
declare
  t text;
begin
  foreach t in array array['funder_records', 'outside_applications', 'outside_questions', 'outside_answers', 'calendar_feeds', 'consulting_requests'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before insert or update of workspace_id on public.%I for each row execute function gms.applicant_workspace_only()', t || '_applicant_only', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Same workspace as the parent (0020): the same list as 0028, plus the new parent links.
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
    ('outside_answers', 'question_id', 'outside_questions'),
    ('outside_answers', 'library_answer_id', 'answers'),
    ('consulting_requests', 'outside_application_id', 'outside_applications')
$$;
revoke all on function gms.same_workspace_rules() from public, anon, authenticated;
grant execute on function gms.same_workspace_rules() to service_role;

create trigger outside_applications_same_workspace before insert or update of funder_record_id, receipt_document_id, snapshot_document_id, workspace_id on public.outside_applications
  for each row execute function gms.same_workspace_as_parent();
create trigger outside_questions_same_workspace before insert or update of outside_application_id, workspace_id on public.outside_questions
  for each row execute function gms.same_workspace_as_parent();
create trigger outside_answers_same_workspace before insert or update of question_id, library_answer_id, workspace_id on public.outside_answers
  for each row execute function gms.same_workspace_as_parent();
create trigger consulting_requests_same_workspace before insert or update of outside_application_id, workspace_id on public.consulting_requests
  for each row execute function gms.same_workspace_as_parent();

do $$
declare
  t text;
begin
  foreach t in array array['funder_records', 'outside_applications', 'outside_questions', 'outside_answers', 'calendar_feeds', 'consulting_requests', 'documents', 'answers'] loop
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
  end loop;
end;
$$;

-- A document or task about an outside application sits in that application's workspace (and a
-- document is uploaded by it): another workspace can neither attach to nor see it.
create or replace function gms.outside_subject_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_json jsonb := pg_catalog.to_jsonb(new);
begin
  if new.subject_type is distinct from 'outside_application' then
    return new;
  end if;
  if new.subject_id is null or not exists (
       select 1 from public.outside_applications a where a.id = new.subject_id and a.workspace_id = new.workspace_id) then
    raise exception '%: the outside application is not in this workspace', tg_table_name using errcode = '23514';
  end if;
  if row_json ? 'owner_workspace_id' and (row_json ->> 'owner_workspace_id')::uuid is distinct from new.workspace_id then
    raise exception '%: a document about an outside application is the applicant''s own', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger documents_outside_subject before insert or update of subject_type, subject_id, workspace_id, owner_workspace_id on public.documents
  for each row execute function gms.outside_subject_same_workspace();
create trigger tasks_outside_subject before insert or update of subject_type, subject_id, workspace_id on public.tasks
  for each row execute function gms.outside_subject_same_workspace();

revoke all on function gms.applicant_workspace_only() from public, anon, authenticated;
revoke all on function gms.outside_subject_same_workspace() from public, anon, authenticated;
revoke all on function gms.try_date(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Consulting requests: counted and recorded in one step
-- ---------------------------------------------------------------------------------------------
-- Count one consulting request against its limits (the caller's: apps/api/src/services/
-- consulting.ts) and record it, or (at a limit) record nothing. One transaction-scoped advisory
-- lock per workspace makes the two counts and the insert one step, so parallel requests cannot
-- both take the last place. Returns { outcome, requestId }: outcome is 'ok', 'not_found' (no such
-- outside application in the workspace), 'application' or 'workspace' (the limit reached).
create or replace function public.gms_claim_consulting_request(
  p_workspace uuid, p_application uuid, p_requested_by uuid, p_contact_name text, p_contact_email_masked text,
  p_fields_sent text[], p_application_limit integer, p_workspace_limit integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  day_ago timestamptz := now() - interval '24 hours';
  made uuid;
begin
  if p_workspace is null or p_application is null or p_requested_by is null or p_application_limit is null or p_workspace_limit is null then
    raise exception 'the workspace, application, requester and both limits are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gms.consulting_requests:' || p_workspace::text, 0));
  if not exists (select 1 from public.outside_applications a where a.id = p_application and a.workspace_id = p_workspace) then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if (select count(*) from public.consulting_requests r where r.outside_application_id = p_application and r.created_at > day_ago) >= p_application_limit then
    return jsonb_build_object('outcome', 'application');
  end if;
  if (select count(*) from public.consulting_requests r where r.workspace_id = p_workspace and r.created_at > day_ago) >= p_workspace_limit then
    return jsonb_build_object('outcome', 'workspace');
  end if;
  insert into public.consulting_requests (workspace_id, outside_application_id, requested_by, contact_name, contact_email_masked, fields_sent)
  values (p_workspace, p_application, p_requested_by, p_contact_name, p_contact_email_masked, coalesce(p_fields_sent, '{}'))
  returning id into made;
  return jsonb_build_object('outcome', 'ok', 'requestId', made);
end;
$$;

-- Give back a count whose email was not sent (the send failed): only a request never marked sent.
create or replace function public.gms_release_consulting_request(p_request uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.consulting_requests r where r.id = p_request and r.sent_at is null;
$$;

revoke all on function public.gms_claim_consulting_request(uuid, uuid, uuid, text, text, text[], integer, integer) from public, anon, authenticated;
revoke all on function public.gms_release_consulting_request(uuid) from public, anon, authenticated;
grant execute on function public.gms_claim_consulting_request(uuid, uuid, uuid, text, text, text[], integer, integer) to service_role;
grant execute on function public.gms_release_consulting_request(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Saved OpenGrants listings become prospects
-- ---------------------------------------------------------------------------------------------
-- Copy every saved OpenGrants listing of an applicant workspace into a prospect, once: a listing
-- that already has one (by listing id) is skipped, so this can run any number of times. Saved
-- rows stay in place; 'gms' and 'alert' rows are not copied. Each prospect made is ledgered as
-- created by the migration. Returns how many were made.
create or replace function gms.copy_saved_listings_to_prospects()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  with made as (
    insert into public.outside_applications (workspace_id, title, funder_name, source, source_ref, listing, listing_url, full_due, stage, created_by, created_at)
    select s.workspace_id,
           coalesce(nullif(pg_catalog.left(pg_catalog.btrim(s.title), 300), ''), 'Saved listing'),
           nullif(pg_catalog.left(pg_catalog.btrim(coalesce(s.listing ->> 'funder', '')), 200), ''),
           'opengrants',
           s.external_id,
           pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
             'funder', pg_catalog.left(s.listing ->> 'funder', 200),
             'amount', pg_catalog.left(s.listing ->> 'amount', 200),
             'deadline', pg_catalog.left(s.listing ->> 'deadline', 100),
             'summary', pg_catalog.left(s.listing ->> 'summary', 2000),
             'url', pg_catalog.left(coalesce(s.url, s.listing ->> 'url'), 2000))),
           pg_catalog.left(coalesce(s.url, s.listing ->> 'url'), 2000),
           gms.try_date(s.listing ->> 'deadline'),
           'prospect',
           s.saved_by,
           s.created_at
      from public.discover_saved s
      join public.workspaces w on w.id = s.workspace_id and w.kind = 'applicant'
     where s.source = 'opengrants'
       -- A funding alert some clients kept as a saved OpenGrants row (`alert:<query>`) is not a listing.
       and s.external_id not like 'alert:%'
       and pg_catalog.length(s.external_id) between 1 and 300
    on conflict (workspace_id, source_ref) where source = 'opengrants' do nothing
    returning id, workspace_id
  ), logged as (
    insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data)
    select m.workspace_id, 'system:migration', 'outside_application.created', 'outside_application', m.id::text,
           pg_catalog.jsonb_build_object('source', 'opengrants', 'stage', 'prospect', 'migration', '0029')
      from made m
    returning 1
  )
  select count(*) into n from logged;
  return n;
end;
$$;
revoke all on function gms.copy_saved_listings_to_prospects() from public, anon, authenticated;
grant execute on function gms.copy_saved_listings_to_prospects() to service_role;

do $$
begin
  raise notice '0029: % saved OpenGrants listing(s) copied into prospects', gms.copy_saved_listings_to_prospects();
end;
$$;
