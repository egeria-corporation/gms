-- SPDX-License-Identifier: AGPL-3.0-only
-- Analytics data layer (M8). Each metric is defined ONCE here, as a materialized view in the `analytics`
-- schema, and reused by the dashboards (AN-01), the report builder (AN-02) and BI tools (Metabase via the
-- read-only gms_analytics role; see docs/analytics.md).
--
-- Security model:
--   * analytics.* matviews span every workspace and cannot carry RLS, so request roles
--     (gms_anon / gms_authenticated) get NO select on them.
--   * The app reads them through public.analytics_* views. These run with the view owner's privileges
--     (like public.public_awards) and filter rows with gms.is_staff(workspace_id), which reads the caller's
--     verified JWT claims: a request only ever sees its own workspace's rows, and only as staff.
--   * Demographics are aggregated with small-group suppression (n < 5 hidden, plus a complementary cell
--     so a hidden value can't be recovered by subtraction). Never row-level.
--   * Every matview has a unique index so it can be refreshed CONCURRENTLY. The worker refreshes all
--     analytics matviews hourly and nightly (apps/worker/src/tasks.ts); analytics.refresh_all() does the same.

-- ---------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------
-- Fiscal year named by the calendar year in which it ends (July 2026 with a July start → FY 2027).
create or replace function analytics.fiscal_year(d date, start_month int) returns int
language sql immutable parallel safe as $$
  select case when coalesce(start_month, 1) <= 1 then extract(year from d)::int
              else extract(year from d)::int + (extract(month from d)::int >= start_month)::int end
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Pipeline funnel: how many applications reached each stage, per opportunity.
-- ---------------------------------------------------------------------------------------------------------
create materialized view analytics.pipeline_funnel as
  with reached as (
    select a.id, a.workspace_id, a.opportunity_id, a.status, a.submitted_at,
      array(select distinct h.to_status from public.status_history h where h.application_id = a.id) as seen
    from public.applications a
  )
  select r.workspace_id, r.opportunity_id, o.title as opportunity_title, o.status as opportunity_status,
    count(*)::int as started,
    count(*) filter (where r.submitted_at is not null or r.status <> 'in_progress' or 'submitted' = any (r.seen))::int as submitted,
    count(*) filter (where r.status in ('under_review', 'invited_to_next_stage', 'awarded') or r.seen && array['under_review', 'invited_to_next_stage', 'awarded'])::int as reviewed,
    count(*) filter (where r.status = 'awarded' or 'awarded' = any (r.seen))::int as awarded,
    count(*) filter (where r.status = 'declined')::int as declined,
    count(*) filter (where r.status in ('withdrawn', 'ineligible'))::int as withdrawn_or_ineligible,
    now() as refreshed_at
  from reached r
  join public.opportunities o on o.id = r.opportunity_id
  group by r.workspace_id, r.opportunity_id, o.title, o.status;
create unique index on analytics.pipeline_funnel (opportunity_id);
create index on analytics.pipeline_funnel (workspace_id);

-- ---------------------------------------------------------------------------------------------------------
-- 2. Time in stage: days applications spend in each status (from the append-only status history).
--    Completed intervals end at the next transition; current intervals are measured up to the refresh.
-- ---------------------------------------------------------------------------------------------------------
create materialized view analytics.time_in_stage as
  with intervals as (
    select h.workspace_id, h.to_status as status, h.created_at as entered_at,
      lead(h.created_at) over (partition by h.application_id order by h.created_at, h.id) as left_at
    from public.status_history h
  )
  select i.workspace_id, i.status,
    count(*) filter (where i.left_at is not null)::int as completed,
    round((avg(extract(epoch from i.left_at - i.entered_at)) filter (where i.left_at is not null) / 86400)::numeric, 1) as avg_days,
    round((percentile_cont(0.5) within group (order by extract(epoch from i.left_at - i.entered_at)) filter (where i.left_at is not null) / 86400)::numeric, 1) as median_days,
    round((percentile_cont(0.9) within group (order by extract(epoch from i.left_at - i.entered_at)) filter (where i.left_at is not null) / 86400)::numeric, 1) as p90_days,
    count(*) filter (where i.left_at is null)::int as current,
    round((avg(extract(epoch from now() - i.entered_at)) filter (where i.left_at is null) / 86400)::numeric, 1) as current_avg_days,
    now() as refreshed_at
  from intervals i
  group by i.workspace_id, i.status;
create unique index on analytics.time_in_stage (workspace_id, status);

-- ---------------------------------------------------------------------------------------------------------
-- 3. Committed vs paid vs remaining, by program and fiscal year.
--    committed = original awards (active/completed) + approved amendments, in the award's fiscal year;
--    paid = payments sent or reconciled, in the fiscal year they were sent; budget = program_budgets.
-- ---------------------------------------------------------------------------------------------------------
create materialized view analytics.budget_by_program as
  with ws as (select id, fiscal_year_start_month as fy_start from public.workspaces),
  committed as (
    select a.workspace_id, a.program_id, a.currency,
      coalesce(a.fiscal_year, analytics.fiscal_year(coalesce(a.start_date, a.created_at::date), ws.fy_start)) as fiscal_year,
      sum(a.amount_cents + coalesce((select sum(c.amount_cents) from public.awards c
                                     where c.parent_award_id = a.id and c.amendment_status = 'approved'), 0))::bigint as cents,
      count(*)::int as awards
    from public.awards a join ws on ws.id = a.workspace_id
    where a.kind = 'original' and a.status in ('active', 'completed')
    group by 1, 2, 3, 4
  ),
  paid as (
    select p.workspace_id, a.program_id, p.currency, analytics.fiscal_year(p.sent_at::date, ws.fy_start) as fiscal_year,
      sum(p.amount_cents)::bigint as cents
    from public.payments p
    join public.awards a on a.id = p.award_id
    join ws on ws.id = p.workspace_id
    where p.status in ('sent', 'reconciled') and p.sent_at is not null
    group by 1, 2, 3, 4
  ),
  budget as (
    select b.workspace_id, b.program_id, b.currency, b.fiscal_year, sum(b.amount_cents)::bigint as cents
    from public.program_budgets b group by 1, 2, 3, 4
  ),
  keys as (
    select workspace_id, program_id, currency, fiscal_year from committed
    union select workspace_id, program_id, currency, fiscal_year from paid
    union select workspace_id, program_id, currency, fiscal_year from budget
  )
  select k.workspace_id, k.program_id, coalesce(pr.name, 'No program') as program_name, k.fiscal_year, k.currency,
    coalesce(k.program_id::text, 'none') || ':' || k.fiscal_year || ':' || k.currency as row_key,
    b.cents as budget_cents,
    coalesce(c.cents, 0)::bigint as committed_cents,
    coalesce(p.cents, 0)::bigint as paid_cents,
    (coalesce(c.cents, 0) - coalesce(p.cents, 0))::bigint as unpaid_commitments_cents,
    case when b.cents is null then null else (b.cents - coalesce(c.cents, 0))::bigint end as remaining_cents,
    coalesce(c.awards, 0) as awards,
    now() as refreshed_at
  from keys k
  left join committed c on c.workspace_id = k.workspace_id and c.program_id is not distinct from k.program_id and c.currency = k.currency and c.fiscal_year = k.fiscal_year
  left join paid p on p.workspace_id = k.workspace_id and p.program_id is not distinct from k.program_id and p.currency = k.currency and p.fiscal_year = k.fiscal_year
  left join budget b on b.workspace_id = k.workspace_id and b.program_id is not distinct from k.program_id and b.currency = k.currency and b.fiscal_year = k.fiscal_year
  left join public.programs pr on pr.id = k.program_id;
create unique index on analytics.budget_by_program (workspace_id, row_key);

-- ---------------------------------------------------------------------------------------------------------
-- 4. Cash-flow forecast: scheduled installments by month, next to what was actually paid that month.
-- ---------------------------------------------------------------------------------------------------------
create materialized view analytics.cashflow_forecast as
  with sched as (
    select i.workspace_id, i.currency, date_trunc('month', i.due_date)::date as month,
      sum(i.amount_cents)::bigint as cents, count(*)::int as n
    from public.installments i where i.status = 'scheduled' group by 1, 2, 3
  ),
  paid as (
    select p.workspace_id, p.currency, date_trunc('month', p.sent_at)::date as month, sum(p.amount_cents)::bigint as cents
    from public.payments p where p.status in ('sent', 'reconciled') and p.sent_at is not null group by 1, 2, 3
  ),
  keys as (select workspace_id, currency, month from sched union select workspace_id, currency, month from paid)
  select k.workspace_id, k.month, k.currency,
    coalesce(s.cents, 0)::bigint as scheduled_cents, coalesce(s.n, 0) as installments,
    coalesce(p.cents, 0)::bigint as paid_cents,
    now() as refreshed_at
  from keys k
  left join sched s on s.workspace_id = k.workspace_id and s.currency = k.currency and s.month = k.month
  left join paid p on p.workspace_id = k.workspace_id and p.currency = k.currency and p.month = k.month;
create unique index on analytics.cashflow_forecast (workspace_id, month, currency);

-- ---------------------------------------------------------------------------------------------------------
-- 5. Portfolio by cause area (opportunity cause terms, else the program's cause area) and by county
--    (the grantee's mailing-address county, else the first county it serves). Committed amounts.
-- ---------------------------------------------------------------------------------------------------------
create materialized view analytics.portfolio_by_cause as
  with base as (
    select a.id, a.workspace_id, a.currency,
      a.amount_cents + coalesce((select sum(c.amount_cents) from public.awards c
                                 where c.parent_award_id = a.id and c.amendment_status = 'approved'), 0) as cents,
      coalesce(nullif(o.cause_terms, '{}'), case when pr.cause_area is not null then array[pr.cause_area] end, array['Unspecified']) as causes
    from public.awards a
    left join public.opportunities o on o.id = a.opportunity_id
    left join public.programs pr on pr.id = a.program_id
    where a.kind = 'original' and a.status in ('active', 'completed')
  ),
  exploded as (
    -- An award tagged with several causes is split evenly so totals still add up.
    select b.workspace_id, b.currency, c.cause, (b.cents / cardinality(b.causes))::bigint as cents, b.id
    from base b cross join lateral unnest(b.causes) as c(cause)
  )
  select e.workspace_id, e.cause, coalesce(t.label, initcap(replace(e.cause, '_', ' '))) as cause_label, e.currency,
    sum(e.cents)::bigint as committed_cents, count(distinct e.id)::int as awards, now() as refreshed_at
  from exploded e
  left join public.taxonomy_terms t on t.workspace_id = e.workspace_id and t.kind = 'cause' and t.code = e.cause
  group by e.workspace_id, e.cause, t.label, e.currency;
create unique index on analytics.portfolio_by_cause (workspace_id, cause, currency);

create materialized view analytics.portfolio_by_county as
  with base as (
    select a.id, a.workspace_id, a.currency, a.applicant_org_id,
      a.amount_cents + coalesce((select sum(c.amount_cents) from public.awards c
                                 where c.parent_award_id = a.id and c.amendment_status = 'approved'), 0) as cents,
      coalesce(
        (select nullif(trim(ad.county), '') from public.org_addresses ad where ad.org_id = a.applicant_org_id
          order by (ad.kind = 'mailing') desc, ad.created_at limit 1),
        (select nullif(trim(g.counties[1]), '') from public.applicant_orgs g where g.id = a.applicant_org_id),
        'Unknown') as county
    from public.awards a
    where a.kind = 'original' and a.status in ('active', 'completed')
  )
  select b.workspace_id, b.county, b.currency, sum(b.cents)::bigint as committed_cents, count(*)::int as awards,
    count(distinct b.applicant_org_id)::int as grantees, now() as refreshed_at
  from base b group by b.workspace_id, b.county, b.currency;
create unique index on analytics.portfolio_by_county (workspace_id, county, currency);

-- ---------------------------------------------------------------------------------------------------------
-- 6. Outcomes: reported indicator values (from grant reports), per indicator.
-- ---------------------------------------------------------------------------------------------------------
create materialized view analytics.outcomes as
  select i.workspace_id, i.id as indicator_id, i.name as indicator, i.unit, i.program_id, pr.name as program_name,
    coalesce(sum(v.value), 0)::numeric as total_value, count(distinct v.award_id)::int as awards_reporting,
    max(v.period_end) as latest_period_end, now() as refreshed_at
  from public.indicators i
  left join public.indicator_values v on v.indicator_id = i.id
  left join public.programs pr on pr.id = i.program_id
  group by i.workspace_id, i.id, i.name, i.unit, i.program_id, pr.name;
create unique index on analytics.outcomes (indicator_id);
create index on analytics.outcomes (workspace_id);

-- ---------------------------------------------------------------------------------------------------------
-- 7. Voluntary demographics: counts of responses per question and answer, never row-level.
--    Primary suppression: cells with n < 5 are hidden. Complementary suppression: if a question has exactly
--    one hidden cell, its smallest visible sibling is hidden too, so totals can't reveal it.
-- ---------------------------------------------------------------------------------------------------------
create materialized view analytics.demographics as
  with answers as (
    select d.workspace_id, d.id as response_id, kv.key as question,
      case when jsonb_typeof(kv.value) = 'array' then elem.value #>> '{}' else kv.value #>> '{}' end as answer
    from public.demographic_responses d
    cross join lateral jsonb_each(d.data) kv
    left join lateral jsonb_array_elements(case when jsonb_typeof(kv.value) = 'array' then kv.value else '[]'::jsonb end) elem(value) on true
    where jsonb_typeof(kv.value) <> 'array' or elem.value is not null
  ),
  cells as (
    select workspace_id, question, coalesce(nullif(answer, ''), '(no answer)') as answer, count(distinct response_id)::int as n
    from answers group by 1, 2, 3
  ),
  primary_s as (
    select c.*, (c.n < 5) as small,
      count(*) filter (where c.n < 5) over (partition by c.workspace_id, c.question) as small_in_question,
      row_number() over (partition by c.workspace_id, c.question order by (c.n < 5), c.n, c.answer) as rank_visible
    from cells c
  ),
  totals as (
    select workspace_id, question, count(distinct response_id)::int as respondents from answers group by 1, 2
  )
  select p.workspace_id, p.question, p.answer,
    case when p.small or (p.small_in_question = 1 and not p.small and p.rank_visible = 1) then null else p.n end as responses,
    (p.small or (p.small_in_question = 1 and not p.small and p.rank_visible = 1)) as suppressed,
    case when t.respondents < 5 then null else t.respondents end as question_respondents,
    now() as refreshed_at
  from primary_s p join totals t on t.workspace_id = p.workspace_id and t.question = p.question;
create unique index on analytics.demographics (workspace_id, question, answer);

-- ---------------------------------------------------------------------------------------------------------
-- Refresh helper (the worker refreshes each matview itself; this is for scripts and tests).
-- ---------------------------------------------------------------------------------------------------------
create or replace function analytics.refresh_all() returns void
language plpgsql as $$
declare
  mv record;
begin
  for mv in select matviewname from pg_matviews where schemaname = 'analytics' order by matviewname loop
    execute format('refresh materialized view analytics.%I', mv.matviewname);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Request-facing views: staff of the workspace only.
-- ---------------------------------------------------------------------------------------------------------
create view public.analytics_pipeline_funnel with (security_barrier = true) as
  select * from analytics.pipeline_funnel where gms.is_staff(workspace_id);
create view public.analytics_time_in_stage with (security_barrier = true) as
  select * from analytics.time_in_stage where gms.is_staff(workspace_id);
create view public.analytics_budget_by_program with (security_barrier = true) as
  select * from analytics.budget_by_program where gms.is_staff(workspace_id);
create view public.analytics_cashflow_forecast with (security_barrier = true) as
  select * from analytics.cashflow_forecast where gms.is_staff(workspace_id);
create view public.analytics_portfolio_by_cause with (security_barrier = true) as
  select * from analytics.portfolio_by_cause where gms.is_staff(workspace_id);
create view public.analytics_portfolio_by_county with (security_barrier = true) as
  select * from analytics.portfolio_by_county where gms.is_staff(workspace_id);
create view public.analytics_outcomes with (security_barrier = true) as
  select * from analytics.outcomes where gms.is_staff(workspace_id);
create view public.analytics_demographics with (security_barrier = true) as
  select * from analytics.demographics where gms.is_staff(workspace_id);

do $$
declare
  v text;
begin
  foreach v in array array['analytics_pipeline_funnel', 'analytics_time_in_stage', 'analytics_budget_by_program',
    'analytics_cashflow_forecast', 'analytics_portfolio_by_cause', 'analytics_portfolio_by_county',
    'analytics_outcomes', 'analytics_demographics'] loop
    -- Default privileges grant writes on new public relations; these views are read-only and staff-only.
    execute format('revoke all on public.%I from public, gms_anon, gms_authenticated', v);
    execute format('grant select on public.%I to gms_authenticated', v);
  end loop;
end
$$;

-- Matviews: no request-role access. BI tools use the read-only gms_analytics role (docs/analytics.md).
revoke all on all tables in schema analytics from public, gms_anon, gms_authenticated;
grant select on all tables in schema analytics to gms_analytics;
alter default privileges in schema analytics grant select on tables to gms_analytics;
revoke all on function analytics.refresh_all() from public;

-- ---------------------------------------------------------------------------------------------------------
-- Fix (S-02 invite acceptance): in gms.accept_invitation the OUT parameter "workspace_id" made the
-- ON CONFLICT (workspace_id, user_id) target ambiguous, so every acceptance failed. Same function, with
-- column references preferred over the OUT parameters.
-- ---------------------------------------------------------------------------------------------------------
create or replace function gms.accept_invitation(p_token_hash text)
returns table (workspace_id uuid, role text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  inv record;
  me uuid := gms.uid();
begin
  if me is null then
    return;
  end if;
  select i.* into inv from public.invitations i
  where i.token_hash = p_token_hash and i.status = 'pending' and i.expires_at > now()
    and lower(i.email) = gms.email()
  for update;
  if not found then
    return;
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (inv.workspace_id, me, inv.role, inv.invited_by)
  on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active';
  update public.invitations set status = 'accepted', accepted_at = now() where id = inv.id;
  workspace_id := inv.workspace_id;
  role := inv.role;
  return next;
end
$$;
revoke all on function gms.accept_invitation(text) from public;
grant execute on function gms.accept_invitation(text) to gms_authenticated;
