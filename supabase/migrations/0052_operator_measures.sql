-- 0052_operator_measures.sql
-- The growth measures (F3, docs/measures.md): nine numbers OpenGrants' operators read on one
-- screen, each over the last 30 days with its 90-day target. Counted from the GMS's own database,
-- with no third-party tracker. Aggregate counts only: nothing here returns a person, an
-- organization, an address, a name or an id to anyone.
--
-- The API (apps/api/src/services/measures.ts) calls public.gms_operator_measures() and writes the
-- two new tables as the service role, for the operators in the OPERATORS secret only. Signed-in
-- people and anonymous visitors get nothing: no grant, no policy.
--
-- What this changes on a live database (no existing row is changed, removed or re-written; no
-- existing table, column, function or policy is altered):
--   * adds lost_deals: one row per deal an operator says was lost, with the stated reason from a
--     fixed list (the parity gaps of the growth plan and a few common reasons), the date and the
--     operator's user id. No free text, no organization and no person, so the record cannot name
--     anyone; the screen shows counts by reason only.
--   * adds operator_settings: one row at most (id is always true), holding the Google Search
--     Console property the operators chose for the GMS's own host (`sc-domain:<domain>` or
--     `https://<host>/`). No token: Composio holds the Google connection.
--   * adds public.gms_operator_measures(p_now, p_window_days, p_switch_days), a read-only function
--     that returns one JSON object of counts. Executable by the service role only.
-- RLS is on for both tables; anon and authenticated hold no privilege on them.

-- ---------------------------------------------------------------------------------------------
-- lost_deals
-- ---------------------------------------------------------------------------------------------
create table public.lost_deals (
  id           uuid primary key default gms.uuid_v7(),
  -- LOST_DEAL_REASONS in apps/api/src/services/measures.ts (a test keeps the two lists equal).
  reason       text not null check (reason in (
                 'forms', 'reviews', 'reporting', 'payments', 'procurement', 'languages',
                 'integrations', 'data_migration', 'support', 'went_elsewhere', 'timing',
                 'no_decision', 'other')),
  -- The day the deal was lost, as the operator says (the API refuses a future day or one over a year ago).
  lost_on      date not null check (lost_on >= date '2026-01-01'),
  -- The operator who recorded it; never shown, kept for the record (the ledger names them too).
  recorded_by  uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.lost_deals is 'Deals lost, by stated reason, recorded by an operator. Counted by reason only; never names an organization or a person.';
create index lost_deals_lost_on_idx on public.lost_deals (lost_on);

-- ---------------------------------------------------------------------------------------------
-- operator_settings
-- ---------------------------------------------------------------------------------------------
create table public.operator_settings (
  id                   boolean primary key default true check (id),
  -- The Search Console property for the GMS's own host; null until an operator picks one.
  search_console_site  text check (search_console_site is null or search_console_site ~ '^(sc-domain:[a-z0-9.-]{1,253}|https://[a-z0-9.-]{1,253}/)$'),
  updated_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.operator_settings is 'One row: what the GMS''s operators chose for the measures (the Search Console property). No credential.';

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers
-- ---------------------------------------------------------------------------------------------
alter table public.lost_deals enable row level security;
alter table public.operator_settings enable row level security;
revoke all on public.lost_deals, public.operator_settings from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.lost_deals, public.operator_settings to service_role;
-- No policy: only the API (service role) reads or writes them.

create trigger lost_deals_touch_updated_at before update on public.lost_deals
  for each row execute function gms.touch_updated_at();
create trigger operator_settings_touch_updated_at before update on public.operator_settings
  for each row execute function gms.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- public.gms_operator_measures: the counts, in one read
-- ---------------------------------------------------------------------------------------------
-- The window is (p_now - p_window_days, p_now]. A workspace counts while it is active or still
-- onboarding (never suspended or closed). Every value is a count or a sum; nothing else leaves.
--   fundersWithOpenCall        funder workspaces with a published call that was open in the window:
--                              open now, or closed (ledger opportunity.closed) inside the window
--   activeApplicantWorkspaces  applicant workspaces whose members were last active in the window
--   newApplicantWorkspaces     applicant workspaces made in the window
--   callsPublished             calls first published in the window (funder workspaces)
--   fundersJoinedFromApplicantLinks  funder workspaces made from an applicant's package link (0047)
--   switchedFundersWithCall    funder workspaces that published a call in the window within
--                              p_switch_days after committing a history import (0042, 0046)
--   awardsEligibleForKit       awards made in the window, accepted or later, to an organization,
--                              not confidential
--   awardsShared               those with a social post about the award (any side, not failed)
--   awardPosts / awardPostClicks / awardPostsWithClicks  award posts sent in the window, the clicks
--                              their platforms reported (0038 metrics), and how many reported any
--   invitationsSent / invitationsAccepted  teammate invitations made in the window, and how many of
--                              them were accepted
--   lostDeals                  deals lost in the window, counted by reason
create or replace function public.gms_operator_measures(p_now timestamptz, p_window_days integer, p_switch_days integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select p_now as t1,
           p_now - pg_catalog.make_interval(days => least(greatest(coalesce(p_window_days, 30), 1), 366)) as t0,
           pg_catalog.make_interval(days => least(greatest(coalesce(p_switch_days, 14), 1), 90)) as switch_within
  ),
  live as (
    select w.id, w.kind, w.created_at from public.workspaces w where w.status in ('active', 'onboarding')
  ),
  kit_awards as (
    select a.id from public.awards a join live w on w.id = a.workspace_id and w.kind = 'funder', b
     where a.created_at > b.t0 and a.created_at <= b.t1
       and not a.confidential and a.recipient_individual is null
       and a.status in ('accepted', 'active', 'completed')
  ),
  award_posts as (
    select p.metrics from public.social_posts p join live w on w.id = p.workspace_id, b
     where p.subject_type = 'award' and p.status in ('published', 'partial')
       and p.sent_at > b.t0 and p.sent_at <= b.t1
  ),
  invited as (
    select i.accepted_at from public.invitations i join live w on w.id = i.workspace_id, b
     where i.created_at > b.t0 and i.created_at <= b.t1
  ),
  lost as (
    select d.reason, count(*)::int as n from public.lost_deals d, b
     where d.lost_on > (b.t0 at time zone 'UTC')::date and d.lost_on <= (b.t1 at time zone 'UTC')::date
     group by d.reason
  )
  select jsonb_build_object(
    'from', (select t0 from b),
    'to', (select t1 from b),
    'fundersWithOpenCall', (
      select count(distinct o.workspace_id)::int
        from public.opportunities o join live w on w.id = o.workspace_id and w.kind = 'funder', b
       where o.published_at is not null and o.published_at <= b.t1
         and (o.status = 'open'
              or exists (select 1 from public.ledger_events e
                          where e.event_type = 'opportunity.closed' and e.subject_type = 'opportunity'
                            and e.subject_id = o.id::text and e.occurred_at > b.t0 and e.occurred_at <= b.t1))),
    'activeApplicantWorkspaces', (
      select count(*)::int from live w, b
       where w.kind = 'applicant'
         and exists (select 1 from public.workspace_members m
                      where m.workspace_id = w.id and m.last_active_at > b.t0 and m.last_active_at <= b.t1)),
    'newApplicantWorkspaces', (
      select count(*)::int from live w, b where w.kind = 'applicant' and w.created_at > b.t0 and w.created_at <= b.t1),
    'callsPublished', (
      select count(*)::int from public.opportunities o join live w on w.id = o.workspace_id and w.kind = 'funder', b
       where o.published_at > b.t0 and o.published_at <= b.t1),
    'fundersJoinedFromApplicantLinks', (
      select count(*)::int from public.referral_joins j join live w on w.id = j.joined_workspace_id, b
       where j.source = 'package' and j.joined_kind = 'funder' and j.created_at > b.t0 and j.created_at <= b.t1),
    'switchedFundersWithCall', (
      select count(distinct w.id)::int from live w, b
       where w.kind = 'funder'
         and exists (select 1 from public.import_runs r join public.opportunities o on o.workspace_id = r.workspace_id
                      where r.workspace_id = w.id and r.committed_at is not null
                        and r.target in ('award_history', 'history_applications', 'history_reviews', 'history_reports')
                        and o.published_at >= r.committed_at and o.published_at <= r.committed_at + b.switch_within
                        and o.published_at > b.t0 and o.published_at <= b.t1)),
    'awardsEligibleForKit', (select count(*)::int from kit_awards),
    'awardsShared', (
      select count(*)::int from kit_awards k
       where exists (select 1 from public.social_posts p where p.subject_type = 'award' and p.subject_id = k.id and p.status <> 'failed')),
    'awardPosts', (select count(*)::int from award_posts),
    'awardPostClicks', (
      select coalesce(sum((p.metrics ->> 'clicks')::bigint), 0)::bigint from award_posts p where jsonb_typeof(p.metrics -> 'clicks') = 'number'),
    'awardPostsWithClicks', (
      select count(*)::int from award_posts p where jsonb_typeof(p.metrics -> 'clicks') = 'number'),
    'invitationsSent', (select count(*)::int from invited),
    'invitationsAccepted', (select count(*)::int from invited where accepted_at is not null),
    'lostDeals', coalesce((select jsonb_object_agg(reason, n) from lost), '{}'::jsonb)
  );
$$;
comment on function public.gms_operator_measures(timestamptz, integer, integer) is 'The growth measures as counts only (docs/measures.md). Service role only.';
revoke all on function public.gms_operator_measures(timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.gms_operator_measures(timestamptz, integer, integer) to service_role;
