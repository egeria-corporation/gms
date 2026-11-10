-- 0004_applications_reviews: applications, their form responses, reviews and decisions.
-- Status columns are written only by packages/workflow (guard -> write -> ledger -> webhook).

create table public.applications (
  id                            uuid primary key default gms.uuid_v7(),
  workspace_id                  uuid not null references public.workspaces (id) on delete cascade,
  applicant_workspace_id        uuid not null references public.workspaces (id) on delete restrict,
  competition_id                uuid not null references public.competitions (id) on delete restrict,
  opportunity_id                uuid not null references public.opportunities (id) on delete restrict,
  title                         text not null default '',
  stage                         text not null,
  status                        text not null default 'draft' check (status = any (gms.application_statuses())),
  cg_status                     text not null default 'inProgress'
                                  check (cg_status in ('inProgress', 'submitted', 'accepted', 'rejected', 'custom')),
  cg_custom_value               text,
  submitted_at                  timestamptz,
  verification_level_at_submit  text check (verification_level_at_submit = any (gms.verification_levels())),
  attestation_url               text,
  eligibility                   jsonb,
  requested_amount_minor        bigint check (requested_amount_minor >= 0),
  currency                      text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  tags                          text[] not null default '{}',
  assigned_to_user_id           uuid,
  withdrawn_at                  timestamptz,
  decision_id                   uuid,
  cg                            jsonb,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  check ((cg_status = 'custom') = (cg_custom_value is not null))
);
comment on table public.applications is 'CG ApplicationBase plus GMS stage/status. workspace_id is the funder; applicant_workspace_id the applicant.';
create index applications_workspace_id_idx on public.applications (workspace_id, status);
create index applications_applicant_workspace_id_idx on public.applications (applicant_workspace_id);
create index applications_competition_id_idx on public.applications (competition_id, stage);
create index applications_opportunity_id_idx on public.applications (opportunity_id);
create index applications_assigned_to_idx on public.applications (assigned_to_user_id) where assigned_to_user_id is not null;

-- CG AppFormResponse; also holds requirement submissions (submission_id, FK added in 0005).
create table public.form_responses (
  id                   uuid primary key default gms.uuid_v7(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  application_id       uuid references public.applications (id) on delete cascade,
  submission_id        uuid,
  form_id              uuid not null,
  form_version         integer not null,
  stage                text,
  response             jsonb not null default '{}'::jsonb,
  status               text not null default 'notStarted' check (status in ('notStarted', 'inProgress', 'complete')),
  validation_errors    jsonb not null default '[]'::jsonb,
  provenance           jsonb not null default '{}'::jsonb,
  section_assignments  jsonb not null default '{}'::jsonb,
  locked_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (form_id, form_version) references public.forms (id, version) on delete restrict,
  check ((application_id is null) <> (submission_id is null))
);
comment on column public.form_responses.provenance is 'Field path -> passport | library | prior_submission | qbo | user | agent:<client>.';
comment on column public.form_responses.workspace_id is 'The funder workspace that owns the application or award.';
create index form_responses_workspace_id_idx on public.form_responses (workspace_id);
create index form_responses_form_idx on public.form_responses (form_id, form_version);
create unique index form_responses_application_form_idx on public.form_responses (application_id, form_id) where application_id is not null;
create unique index form_responses_submission_form_idx on public.form_responses (submission_id, form_id) where submission_id is not null;

create table public.application_events (
  id              uuid primary key default gms.uuid_v7(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  application_id  uuid not null references public.applications (id) on delete cascade,
  type            text not null check (type ~ '^[a-z][a-z0-9_.]*$'),
  from_stage      text,
  to_stage        text,
  from_status     text,
  to_status       text,
  payload         jsonb not null default '{}'::jsonb,
  actor           text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.application_events is 'Stage transitions, status changes, revision requests (payload: revision diff, interview slot).';
create index application_events_workspace_id_idx on public.application_events (workspace_id);
create index application_events_application_id_idx on public.application_events (application_id, created_at);

create table public.review_assignments (
  id                uuid primary key default gms.uuid_v7(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  application_id    uuid not null references public.applications (id) on delete cascade,
  stage             text not null,
  reviewer_user_id  uuid not null references auth.users (id) on delete cascade,
  rubric_id         uuid not null,
  rubric_version    integer not null,
  due_at            timestamptz,
  status            text not null default 'assigned'
                      check (status in ('assigned', 'coi_declared', 'in_progress', 'submitted', 'recused')),
  coi               jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (rubric_id, rubric_version) references public.rubrics (id, version) on delete restrict,
  unique (application_id, stage, reviewer_user_id)
);
create index review_assignments_workspace_id_idx on public.review_assignments (workspace_id);
create index review_assignments_reviewer_idx on public.review_assignments (reviewer_user_id, status);
create index review_assignments_rubric_idx on public.review_assignments (rubric_id, rubric_version);

create table public.reviews (
  id              uuid primary key default gms.uuid_v7(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  assignment_id   uuid not null unique references public.review_assignments (id) on delete cascade,
  scores          jsonb not null default '{}'::jsonb,
  narrative       text,
  recommendation  text,
  submitted_at    timestamptz,
  visibility      text not null default 'panel' check (visibility in ('panel', 'funder_only')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on column public.reviews.scores is 'Criterion key -> { value, comment }.';
create index reviews_workspace_id_idx on public.reviews (workspace_id);

create table public.decisions (
  id                  uuid primary key default gms.uuid_v7(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  competition_id      uuid not null references public.competitions (id) on delete cascade,
  application_id      uuid not null references public.applications (id) on delete cascade,
  stage               text,
  outcome             text not null check (outcome in ('approve', 'decline', 'waitlist', 'defer')),
  amount_minor        bigint check (amount_minor >= 0),
  currency            text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  conditions          text[] not null default '{}',
  rationale           text,
  letter_template_id  uuid references public.templates (id) on delete set null,
  proposed_by         text,
  decided_by          uuid,
  committed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (outcome <> 'approve' or amount_minor is not null)
);
comment on table public.decisions is 'Cohort decisions. A row with committed_at null is a proposal (possibly from an agent, see proposed_by).';
create index decisions_workspace_id_idx on public.decisions (workspace_id);
create index decisions_competition_id_idx on public.decisions (competition_id);
create index decisions_application_id_idx on public.decisions (application_id);
create index decisions_letter_template_id_idx on public.decisions (letter_template_id);

alter table public.applications
  add constraint applications_decision_id_fkey foreign key (decision_id) references public.decisions (id) on delete set null;
create index applications_decision_id_idx on public.applications (decision_id);

-- A committed decision never changes.
create or replace function gms.decisions_committed_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.committed_at is not null then
    raise exception 'decision % is committed and immutable', old.id using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger decisions_committed_immutable before update on public.decisions
  for each row execute function gms.decisions_committed_immutable();
