-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Applications, submissions (immutable), collaborators, attachments, eligibility results,
-- review stages, rubrics, assignments, COI, reviews, panels.

create sequence public.application_reference_seq;

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  competition_id uuid not null references public.competitions(id) on delete restrict,
  applicant_org_id uuid references public.applicant_orgs(id) on delete restrict,
  applicant_user_id uuid not null references public.profiles(id) on delete restrict,
  reference_number text not null unique,
  title text,
  status text not null default 'in_progress' check (status in (
    'in_progress', 'submitted', 'under_review', 'invited_to_next_stage', 'awarded', 'declined', 'withdrawn', 'ineligible')),
  requested_amount_cents bigint check (requested_amount_cents is null or requested_amount_cents >= 0),
  currency char(3) not null default 'USD',
  submitted_at timestamptz,
  deadline_override_at timestamptz,
  ai_disclosure text,
  created_via text not null default 'human' check (created_via in ('human', 'agent', 'api', 'import')),
  submitted_via text check (submitted_via in ('human', 'agent', 'api', 'import')),
  submitted_by_agent_client_id uuid references public.agent_clients(id) on delete set null,
  duplicate_of uuid references public.applications(id) on delete set null,
  previous_application_id uuid references public.applications(id) on delete set null,
  info_requested_at timestamptz,
  info_request_note text,
  tags text[] not null default '{}',
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(reference_number, '')), 'A')
  ) stored
);
create index on public.applications (workspace_id, status);
create index on public.applications (competition_id);
create index on public.applications (applicant_org_id);
create index on public.applications (applicant_user_id);
create index applications_search_idx on public.applications using gin (search);

create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete restrict,
  form_version_id uuid not null references public.form_versions(id) on delete restrict,
  data jsonb not null default '{}'::jsonb,
  field_updated_at jsonb not null default '{}'::jsonb,
  etag text not null default encode(gen_random_bytes(8), 'hex'),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (application_id, form_id)
);
create index on public.form_responses (workspace_id);

create table public.application_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  submitted_by uuid references public.profiles(id),
  submitted_by_agent_client_id uuid references public.agent_clients(id) on delete set null,
  responses jsonb not null,
  org_profile jsonb not null default '{}'::jsonb,
  form_versions jsonb not null default '[]'::jsonb,
  attestation jsonb not null default '{}'::jsonb,
  receipt_number text not null unique,
  content_hash text not null
);
create index on public.application_submissions (application_id);
create index on public.application_submissions (workspace_id);
create trigger application_submissions_append_only before update or delete on public.application_submissions
  for each row execute function gms_private.append_only();

create table public.application_collaborators (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  token_hash text,
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (application_id, email)
);
create index on public.application_collaborators (user_id);
create index on public.application_collaborators (workspace_id);

create table public.application_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  author_id uuid references public.profiles(id),
  field_path text,
  body text not null check (length(body) between 1 and 5000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.application_comments (application_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  report_submission_id uuid,
  field_path text,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  storage_path text not null unique,
  sha256 text,
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'infected', 'not_scanned')),
  status text not null default 'pending_upload' check (status in ('pending_upload', 'uploaded', 'deleted')),
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.attachments (application_id);
create index on public.attachments (workspace_id);

create table public.eligibility_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  rule_id uuid references public.eligibility_rules(id) on delete set null,
  question text not null,
  passed boolean not null,
  answer jsonb,
  source text not null default 'submission' check (source in ('precheck', 'submission', 'staff', 'agent')),
  evaluated_at timestamptz not null default now()
);
create index on public.eligibility_results (application_id);

create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  actor_type text not null default 'human' check (actor_type in ('human', 'agent', 'system')),
  actor_id uuid,
  actor_name text,
  visible_to_applicant boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);
create index on public.status_history (application_id, created_at);
create trigger status_history_append_only before update or delete on public.status_history
  for each row execute function gms_private.append_only();

create table public.applicant_extensions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  new_deadline timestamptz not null,
  reason text,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.applicant_extensions (application_id);

-- Voluntary demographics live apart from the application and are never readable by staff row-by-row.
create table public.demographic_responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  applicant_org_id uuid references public.applicant_orgs(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.demographic_responses (workspace_id);

-- Review ---------------------------------------------------------------------
create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.rubrics (workspace_id);

create table public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rubric_id uuid not null references public.rubrics(id) on delete cascade,
  position int not null default 1,
  label text not null,
  guidance text,
  weight_pct numeric(5, 2) not null check (weight_pct > 0 and weight_pct <= 100),
  scale_min int not null default 1,
  scale_max int not null default 5,
  scale_labels jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  check (scale_min < scale_max)
);
create index on public.rubric_criteria (rubric_id);

create table public.review_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  rubric_id uuid references public.rubrics(id) on delete set null,
  name text not null,
  position int not null default 1,
  blind boolean not null default false,
  reviewers_per_application int not null default 2 check (reviewers_per_application between 1 and 20),
  due_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.review_stages (workspace_id);

create table public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stage_id uuid not null references public.review_stages(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'submitted', 'recused')),
  assigned_by uuid references public.profiles(id),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (stage_id, application_id, reviewer_id)
);
create index on public.review_assignments (reviewer_id, status);
create index on public.review_assignments (application_id);
create index on public.review_assignments (workspace_id);

create table public.coi_declarations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  assignment_id uuid not null unique references public.review_assignments(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  has_conflict boolean not null,
  explanation text,
  declared_at timestamptz not null default now()
);
create index on public.coi_declarations (workspace_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  assignment_id uuid not null unique references public.review_assignments(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  overall_comment text,
  private_note text,
  recommendation text check (recommendation in ('fund', 'maybe', 'decline')),
  weighted_score numeric(6, 2),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.reviews (workspace_id);

create table public.review_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  criterion_id uuid not null references public.rubric_criteria(id) on delete cascade,
  score numeric(5, 2) not null,
  comment text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (review_id, criterion_id)
);
create index on public.review_scores (workspace_id);

create table public.panels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stage_id uuid not null references public.review_stages(id) on delete cascade,
  name text not null,
  meets_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'closed')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.panels (workspace_id);

create table public.panel_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  panel_id uuid references public.panels(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.panel_notes (application_id);

-- Access helpers ---------------------------------------------------------------
-- Applicant side: org members (any role), the creating user, and active collaborators.
create or replace function gms.is_applicant_for(app uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    where a.id = app and (
      a.applicant_user_id = gms.uid()
      or (a.applicant_org_id is not null and gms.is_org_member(a.applicant_org_id))
      or exists (
        select 1 from public.application_collaborators c
        where c.application_id = a.id and c.user_id = gms.uid() and c.status = 'active')
    )
  )
$$;

-- Applicant editors (viewers excluded).
create or replace function gms.can_edit_application(app uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    where a.id = app and a.status = 'in_progress' and (
      a.applicant_user_id = gms.uid()
      or (a.applicant_org_id is not null and gms.is_org_member(a.applicant_org_id))
      or exists (
        select 1 from public.application_collaborators c
        where c.application_id = a.id and c.user_id = gms.uid() and c.status = 'active' and c.role = 'editor')
    )
  )
$$;

-- Reviewer: assigned, not recused, and has declared no conflict.
create or replace function gms.is_cleared_reviewer_for(app uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.review_assignments ra
    join public.coi_declarations d on d.assignment_id = ra.id
    where ra.application_id = app and ra.reviewer_id = gms.uid()
      and ra.status <> 'recused' and d.has_conflict = false
  )
$$;

create or replace function gms.can_view_application(app uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    where a.id = app and (
      gms.is_staff(a.workspace_id)
      or gms.is_applicant_for(a.id)
      or gms.is_cleared_reviewer_for(a.id)
    )
  )
$$;

-- Content (responses, submissions) is visible to staff and applicants only.
-- Reviewers read content through gms.reviewer_submission(), which masks blind-flagged fields.
create or replace function gms.can_view_application_content(app uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    where a.id = app and (gms.is_staff(a.workspace_id) or gms.is_applicant_for(a.id))
  )
$$;

-- Removes blind-flagged top-level answers (and nested pointers) from a response document.
create or replace function gms_private.mask_blind(doc jsonb, blind_paths text[]) returns jsonb
language plpgsql immutable as $$
declare
  p text;
  result jsonb := doc;
begin
  if blind_paths is null then
    return doc;
  end if;
  foreach p in array blind_paths loop
    result := result #- string_to_array(trim(both '/' from p), '/');
  end loop;
  return result;
end
$$;

-- The reviewer view of a submission: latest snapshot, blind fields masked when the stage is blind.
create or replace function gms.reviewer_submission(app uuid)
returns table (application_id uuid, submitted_at timestamptz, responses jsonb, org_profile jsonb, blind boolean)
language sql stable security definer set search_path = '' as $$
  with a as (
    select ra.application_id, bool_or(rs.blind) as blind
    from public.review_assignments ra
    join public.review_stages rs on rs.id = ra.stage_id
    join public.coi_declarations d on d.assignment_id = ra.id
    where ra.application_id = app and ra.reviewer_id = gms.uid() and ra.status <> 'recused' and d.has_conflict = false
    group by ra.application_id
  ), s as (
    select sub.* from public.application_submissions sub
    where sub.application_id = app
    order by sub.submitted_at desc limit 1
  ), blind_paths as (
    select array_agg(distinct key) as paths
    from s, jsonb_array_elements(s.form_versions) fv,
      public.form_versions v,
      jsonb_each(v.field_meta) fm(key, meta)
    where v.id = (fv ->> 'formVersionId')::uuid and coalesce((fm.meta ->> 'blind')::boolean, false)
  )
  select s.application_id, s.submitted_at,
    case when a.blind then (
      select jsonb_object_agg(r.key, gms_private.mask_blind(r.value, (select paths from blind_paths)))
      from jsonb_each(s.responses) r
    ) else s.responses end,
    case when a.blind then '{}'::jsonb else s.org_profile end,
    a.blind
  from a join s on s.application_id = a.application_id
$$;
grant execute on function gms.reviewer_submission(uuid) to gms_authenticated;
grant execute on all functions in schema gms to gms_anon, gms_authenticated;

-- Policies -------------------------------------------------------------------
alter table public.applications enable row level security;
create policy applications_select on public.applications for select to gms_authenticated
  using (gms.can_view_application(id) or (gms.is_member(workspace_id, array['board']) and status <> 'in_progress'));
create policy applications_applicant_insert on public.applications for insert to gms_authenticated with check (
  applicant_user_id = gms.uid() and status = 'in_progress'
  and (applicant_org_id is null or gms.is_org_member(applicant_org_id))
);
create policy applications_applicant_update on public.applications for update to gms_authenticated
  using (gms.is_applicant_for(id)) with check (gms.is_applicant_for(id));
create policy applications_staff_update on public.applications for update to gms_authenticated
  using (gms.is_member(workspace_id, array['owner', 'admin', 'program_officer']))
  with check (gms.is_member(workspace_id, array['owner', 'admin', 'program_officer']));

alter table public.form_responses enable row level security;
create policy form_responses_select on public.form_responses for select to gms_authenticated
  using (gms.can_view_application_content(application_id));
create policy form_responses_insert on public.form_responses for insert to gms_authenticated
  with check (gms.can_edit_application(application_id));
create policy form_responses_update on public.form_responses for update to gms_authenticated
  using (gms.can_edit_application(application_id)) with check (gms.can_edit_application(application_id));

alter table public.application_submissions enable row level security;
create policy submissions_select on public.application_submissions for select to gms_authenticated
  using (gms.can_view_application_content(application_id));
create policy submissions_insert on public.application_submissions for insert to gms_authenticated
  with check (gms.is_applicant_for(application_id));

alter table public.application_collaborators enable row level security;
create policy collaborators_select on public.application_collaborators for select to gms_authenticated
  using (user_id = gms.uid() or gms.can_view_application_content(application_id));
create policy collaborators_write on public.application_collaborators for insert to gms_authenticated
  with check (gms.is_applicant_for(application_id));
create policy collaborators_update on public.application_collaborators for update to gms_authenticated
  using (gms.is_applicant_for(application_id) or (user_id = gms.uid()))
  with check (gms.is_applicant_for(application_id) or (user_id = gms.uid()));
create policy collaborators_delete on public.application_collaborators for delete to gms_authenticated
  using (gms.is_applicant_for(application_id));

alter table public.application_comments enable row level security;
create policy app_comments_select on public.application_comments for select to gms_authenticated
  using (gms.is_applicant_for(application_id));
create policy app_comments_insert on public.application_comments for insert to gms_authenticated
  with check (author_id = gms.uid() and gms.is_applicant_for(application_id));
create policy app_comments_update on public.application_comments for update to gms_authenticated
  using (gms.is_applicant_for(application_id)) with check (gms.is_applicant_for(application_id));

alter table public.attachments enable row level security;
create policy attachments_select on public.attachments for select to gms_authenticated using (
  (application_id is not null and gms.can_view_application(application_id))
  or (report_submission_id is not null and gms.is_staff(workspace_id))
  or uploaded_by = gms.uid()
);
create policy attachments_insert on public.attachments for insert to gms_authenticated with check (
  uploaded_by = gms.uid() and (
    (application_id is not null and gms.can_edit_application(application_id))
    or (application_id is null and report_submission_id is null)
    or report_submission_id is not null
  )
);
create policy attachments_update on public.attachments for update to gms_authenticated
  using (uploaded_by = gms.uid() or gms.is_staff(workspace_id))
  with check (uploaded_by = gms.uid() or gms.is_staff(workspace_id));

alter table public.eligibility_results enable row level security;
create policy eligibility_results_select on public.eligibility_results for select to gms_authenticated
  using (gms.can_view_application_content(application_id));
create policy eligibility_results_insert on public.eligibility_results for insert to gms_authenticated
  with check (gms.is_applicant_for(application_id) or gms.is_member(workspace_id, array['owner', 'admin', 'program_officer']));

alter table public.status_history enable row level security;
create policy status_history_select on public.status_history for select to gms_authenticated using (
  gms.is_staff(workspace_id) or (visible_to_applicant and gms.is_applicant_for(application_id))
);
create policy status_history_insert on public.status_history for insert to gms_authenticated
  with check (gms.can_view_application(application_id));

select gms_private.staff_policies('applicant_extensions',
  array['owner', 'admin', 'program_officer', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy extensions_applicant on public.applicant_extensions for select to gms_authenticated
  using (gms.is_applicant_for(application_id));

alter table public.demographic_responses enable row level security;
create policy demographics_applicant_select on public.demographic_responses for select to gms_authenticated
  using ((applicant_org_id is not null and gms.is_org_member(applicant_org_id))
    or (application_id is not null and gms.is_applicant_for(application_id)));
create policy demographics_applicant_write on public.demographic_responses for insert to gms_authenticated
  with check ((applicant_org_id is not null and gms.is_org_member(applicant_org_id))
    or (application_id is not null and gms.is_applicant_for(application_id)));
create policy demographics_applicant_update on public.demographic_responses for update to gms_authenticated
  using ((applicant_org_id is not null and gms.is_org_member(applicant_org_id))
    or (application_id is not null and gms.is_applicant_for(application_id)))
  with check ((applicant_org_id is not null and gms.is_org_member(applicant_org_id))
    or (application_id is not null and gms.is_applicant_for(application_id)));

-- Staff can see applicant orgs and profiles connected to their workspace.
create policy orgs_staff_select on public.applicant_orgs for select to gms_authenticated using (
  exists (select 1 from public.applications a where a.applicant_org_id = applicant_orgs.id and gms.is_staff(a.workspace_id))
);
create policy org_addresses_staff_select on public.org_addresses for select to gms_authenticated using (
  exists (select 1 from public.applications a where a.applicant_org_id = org_addresses.org_id and gms.is_staff(a.workspace_id))
);
create policy org_documents_staff_select on public.org_documents for select to gms_authenticated using (
  exists (select 1 from public.applications a
    where a.applicant_org_id = org_documents.org_id and a.status <> 'in_progress' and gms.is_staff(a.workspace_id))
);
create policy org_members_staff_select on public.applicant_org_members for select to gms_authenticated using (
  exists (select 1 from public.applications a where a.applicant_org_id = applicant_org_members.org_id and gms.is_staff(a.workspace_id))
);
create policy profiles_staff_applicants on public.profiles for select to gms_authenticated using (
  exists (
    select 1 from public.applications a
    where gms.is_staff(a.workspace_id) and (
      a.applicant_user_id = profiles.id
      or exists (select 1 from public.applicant_org_members m where m.org_id = a.applicant_org_id and m.user_id = profiles.id)
    )
  )
);

-- Review policies
select gms_private.staff_policies('rubrics',
  array['owner', 'admin', 'program_officer', 'auditor', 'reviewer'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('rubric_criteria',
  array['owner', 'admin', 'program_officer', 'auditor', 'reviewer'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('review_stages',
  array['owner', 'admin', 'program_officer', 'auditor', 'reviewer'], array['owner', 'admin', 'program_officer']);

select gms_private.staff_policies('review_assignments',
  array['owner', 'admin', 'program_officer', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy assignments_reviewer_select on public.review_assignments for select to gms_authenticated
  using (reviewer_id = gms.uid());
create policy assignments_reviewer_update on public.review_assignments for update to gms_authenticated
  using (reviewer_id = gms.uid()) with check (reviewer_id = gms.uid());

select gms_private.staff_policies('coi_declarations', array['owner', 'admin', 'program_officer', 'auditor'], null);
create policy coi_reviewer_select on public.coi_declarations for select to gms_authenticated using (reviewer_id = gms.uid());
create policy coi_reviewer_insert on public.coi_declarations for insert to gms_authenticated with check (
  reviewer_id = gms.uid()
  and exists (select 1 from public.review_assignments ra where ra.id = assignment_id and ra.reviewer_id = gms.uid())
);

select gms_private.staff_policies('reviews', array['owner', 'admin', 'program_officer', 'auditor'], null);
create policy reviews_reviewer_select on public.reviews for select to gms_authenticated using (
  exists (select 1 from public.review_assignments ra where ra.id = assignment_id and ra.reviewer_id = gms.uid())
);
create policy reviews_reviewer_insert on public.reviews for insert to gms_authenticated with check (
  exists (select 1 from public.review_assignments ra
    where ra.id = assignment_id and ra.reviewer_id = gms.uid() and gms.is_cleared_reviewer_for(ra.application_id))
);
create policy reviews_reviewer_update on public.reviews for update to gms_authenticated using (
  exists (select 1 from public.review_assignments ra where ra.id = assignment_id and ra.reviewer_id = gms.uid())
) with check (
  exists (select 1 from public.review_assignments ra
    where ra.id = assignment_id and ra.reviewer_id = gms.uid() and gms.is_cleared_reviewer_for(ra.application_id))
);

select gms_private.staff_policies('review_scores', array['owner', 'admin', 'program_officer', 'auditor'], null);
create policy scores_reviewer_all on public.review_scores for all to gms_authenticated using (
  exists (select 1 from public.reviews r join public.review_assignments ra on ra.id = r.assignment_id
    where r.id = review_id and ra.reviewer_id = gms.uid())
) with check (
  exists (select 1 from public.reviews r join public.review_assignments ra on ra.id = r.assignment_id
    where r.id = review_id and ra.reviewer_id = gms.uid() and r.status = 'in_progress')
);

select gms_private.staff_policies('panels',
  array['owner', 'admin', 'program_officer', 'auditor', 'reviewer'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('panel_notes',
  array['owner', 'admin', 'program_officer', 'auditor'], array['owner', 'admin', 'program_officer']);
create policy panel_notes_reviewer on public.panel_notes for select to gms_authenticated
  using (gms.is_cleared_reviewer_for(application_id));
create policy panel_notes_reviewer_insert on public.panel_notes for insert to gms_authenticated
  with check (author_id = gms.uid() and gms.is_cleared_reviewer_for(application_id));

select gms_private.install_touch_triggers();

-- Defense in depth: applicants can only move their own application through applicant transitions.
create or replace function gms_private.applications_guard() returns trigger
language plpgsql as $$
begin
  if current_user = 'gms_authenticated' and not gms.is_member(old.workspace_id, array['owner', 'admin', 'program_officer']) then
    if new.workspace_id <> old.workspace_id or new.competition_id <> old.competition_id
       or new.reference_number <> old.reference_number or new.applicant_user_id <> old.applicant_user_id
       or new.applicant_org_id is distinct from old.applicant_org_id then
      raise exception 'applicants cannot change application ownership' using errcode = '42501';
    end if;
    if new.status <> old.status and not (
      (old.status = 'in_progress' and new.status in ('submitted', 'withdrawn'))
      or (old.status in ('submitted', 'under_review', 'invited_to_next_stage') and new.status = 'withdrawn')
    ) then
      raise exception 'applicants cannot move an application from % to %', old.status, new.status using errcode = '42501';
    end if;
    if new.tags <> old.tags or new.duplicate_of is distinct from old.duplicate_of
       or new.deadline_override_at is distinct from old.deadline_override_at then
      raise exception 'applicants cannot change staff-managed fields' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger applications_guard before update on public.applications
  for each row execute function gms_private.applications_guard();
