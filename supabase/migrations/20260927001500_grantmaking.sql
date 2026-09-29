-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Grantmaking console support:
--   * grantee_profiles: the workspace's own CRM data about an applicant organization (tags, relationship
--     owner, summary). Kept per workspace so one foundation's labels never leak to another.
--   * application_duplicate_dismissals: "not a duplicate" decisions so flagged pairs stop showing.
--   * gms.application_duplicates(ws): duplicate detection (same org + same stage, same EIN across orgs,
--     near-identical titles via pg_trgm) for staff.
--   * gms.reviewer_queue(): a reviewer's own assignments with the minimum context needed to declare
--     conflicts before they can open the application (org name withheld on blind stages).
--   * gms.board_docket_items(docket): what a board member needs to vote: item summaries, recommended
--     amounts and review score aggregates (board members cannot read reviews directly).

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.grantee_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  applicant_org_id uuid not null references public.applicant_orgs(id) on delete cascade,
  tags text[] not null default '{}',
  relationship_owner_id uuid references public.profiles(id) on delete set null,
  summary text,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (workspace_id, applicant_org_id),
  constraint grantee_profiles_tags_len check (cardinality(tags) <= 30)
);
create index on public.grantee_profiles (workspace_id);
create index on public.grantee_profiles (applicant_org_id);

create table public.application_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  other_application_id uuid not null references public.applications(id) on delete cascade,
  reason text,
  dismissed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now(),
  unique (application_id, other_application_id),
  constraint duplicate_dismissal_distinct check (application_id <> other_application_id)
);
create index on public.application_duplicate_dismissals (workspace_id);

select gms_private.staff_policies('grantee_profiles',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);
select gms_private.staff_policies('application_duplicate_dismissals',
  array['owner', 'admin', 'program_officer', 'finance', 'auditor'], array['owner', 'admin', 'program_officer']);

select gms_private.install_touch_triggers();
select gms_private.install_workspace_consistency_triggers();

-- ---------------------------------------------------------------------------------------------
-- Duplicate detection (staff only). Pairs are ordered (application_id < other_application_id).
-- ---------------------------------------------------------------------------------------------
create or replace function gms.application_duplicates(ws uuid, min_title_score real default 0.6)
returns table (application_id uuid, other_application_id uuid, reason text, score real)
language sql stable security definer set search_path = public, pg_temp as $$
  with apps as (
    select a.id, a.competition_id, a.applicant_org_id, a.title, o.ein
    from public.applications a
    left join public.applicant_orgs o on o.id = a.applicant_org_id
    where a.workspace_id = ws and a.status not in ('withdrawn')
      and gms.is_member(ws, array['owner', 'admin', 'program_officer', 'finance', 'auditor'])
  ), pairs as (
    select x.id as a_id, y.id as b_id,
      case
        when x.applicant_org_id is not null and x.applicant_org_id = y.applicant_org_id and x.competition_id = y.competition_id
          then 'same_org_same_stage'
        when x.ein is not null and x.ein = y.ein and x.applicant_org_id is distinct from y.applicant_org_id
          then 'same_ein'
        when x.title is not null and y.title is not null and similarity(lower(x.title), lower(y.title)) >= min_title_score
          then 'similar_title'
      end as reason,
      case when x.title is not null and y.title is not null then similarity(lower(x.title), lower(y.title)) else 0 end::real as score
    from apps x join apps y on x.id < y.id
    where (x.applicant_org_id is not null and x.applicant_org_id = y.applicant_org_id and x.competition_id = y.competition_id)
      or (x.ein is not null and x.ein = y.ein and x.applicant_org_id is distinct from y.applicant_org_id)
      or (x.title is not null and y.title is not null and similarity(lower(x.title), lower(y.title)) >= min_title_score)
  )
  select p.a_id, p.b_id, p.reason, p.score from pairs p
  where p.reason is not null
    and not exists (
      select 1 from public.application_duplicate_dismissals d
      where (d.application_id = p.a_id and d.other_application_id = p.b_id)
         or (d.application_id = p.b_id and d.other_application_id = p.a_id)
    )
  order by p.a_id, p.b_id
$$;
grant execute on function gms.application_duplicates(uuid, real) to gms_authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reviewer queue: the signed-in reviewer's own assignments in a workspace. Application content is
-- never returned here (that is gms.reviewer_submission); only what a reviewer needs to declare a
-- conflict. The organization name is withheld on blind stages.
-- ---------------------------------------------------------------------------------------------
create or replace function gms.reviewer_queue(ws uuid)
returns table (
  assignment_id uuid, application_id uuid, stage_id uuid, stage_name text, blind boolean, stage_status text,
  opportunity_title text, competition_name text, reference_number text, application_title text,
  organization_name text, status text, due_at timestamptz, coi_declared boolean, has_conflict boolean,
  review_status text, weighted_score numeric, rubric_id uuid, assigned_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select ra.id, ra.application_id, rs.id, rs.name, rs.blind, rs.status,
    o.title, c.name, a.reference_number, a.title,
    case when rs.blind then null else g.legal_name end,
    ra.status, coalesce(ra.due_at, rs.due_at),
    (d.id is not null), coalesce(d.has_conflict, false),
    r.status, r.weighted_score::numeric, rs.rubric_id, ra.created_at
  from public.review_assignments ra
  join public.review_stages rs on rs.id = ra.stage_id
  join public.applications a on a.id = ra.application_id
  join public.opportunities o on o.id = a.opportunity_id
  join public.competitions c on c.id = a.competition_id
  left join public.applicant_orgs g on g.id = a.applicant_org_id
  left join lateral (
    select x.id, x.has_conflict from public.coi_declarations x
    where x.assignment_id = ra.id order by x.declared_at desc limit 1
  ) d on true
  left join public.reviews r on r.assignment_id = ra.id
  where ra.reviewer_id = gms.uid() and ra.workspace_id = ws
  order by coalesce(ra.due_at, rs.due_at) nulls last, a.reference_number
$$;
grant execute on function gms.reviewer_queue(uuid) to gms_authenticated;

-- ---------------------------------------------------------------------------------------------
-- Board docket items with review aggregates. Board members see non-draft dockets of their workspace;
-- staff see every docket. Individual reviews, reviewer identities and private notes are never exposed.
-- ---------------------------------------------------------------------------------------------
create or replace function gms.board_docket_items(docket uuid)
returns table (
  item_id uuid, application_id uuid, item_position int, reference_number text, application_title text,
  organization_name text, opportunity_title text, requested_amount_cents bigint, recommended_amount_cents bigint,
  recommendation text, outcome text, review_count int, average_score numeric, min_score numeric, max_score numeric,
  application_status text
)
language sql stable security definer set search_path = '' as $$
  select di.id, di.application_id, di.position, a.reference_number, a.title,
    g.legal_name, o.title, a.requested_amount_cents, di.recommended_amount_cents,
    di.recommendation, di.outcome,
    coalesce(s.n, 0)::int, s.avg_score, s.min_score, s.max_score, a.status
  from public.docket_items di
  join public.dockets d on d.id = di.docket_id
  join public.applications a on a.id = di.application_id
  join public.opportunities o on o.id = a.opportunity_id
  left join public.applicant_orgs g on g.id = a.applicant_org_id
  left join lateral (
    select count(*) as n, round(avg(r.weighted_score)::numeric, 1) as avg_score,
      round(min(r.weighted_score)::numeric, 1) as min_score, round(max(r.weighted_score)::numeric, 1) as max_score
    from public.reviews r join public.review_assignments ra on ra.id = r.assignment_id
    where ra.application_id = di.application_id and r.status = 'submitted'
  ) s on true
  where di.docket_id = docket
    and (
      gms.is_staff(d.workspace_id)
      or (d.status <> 'draft' and gms.is_member(d.workspace_id, array['board']))
    )
  order by di.position, a.reference_number
$$;
grant execute on function gms.board_docket_items(uuid) to gms_authenticated;

-- ---------------------------------------------------------------------------------------------
-- The exact form versions of the latest submission, for a cleared reviewer (gms.reviewer_submission
-- returns the answers; this says which form version each answer set was written against).
-- ---------------------------------------------------------------------------------------------
create or replace function gms.reviewer_form_versions(app uuid)
returns table (form_id uuid, form_version_id uuid)
language sql stable security definer set search_path = '' as $$
  with s as (
    select sub.form_versions from public.application_submissions sub
    where sub.application_id = app
    order by sub.submitted_at desc limit 1
  )
  select (fv ->> 'formId')::uuid, (fv ->> 'formVersionId')::uuid
  from s, jsonb_array_elements(s.form_versions) fv
  where (gms.is_cleared_reviewer_for(app) or gms.can_view_application_content(app))
    and fv ? 'formId' and fv ? 'formVersionId'
$$;
grant execute on function gms.reviewer_form_versions(uuid) to gms_authenticated;
