-- 0054_share_kit_uses.sql
-- Share-kit downloads count as kit uses (docs/measures.md, measure 6; docs/award-sharing.md). The
-- carousel PDF, the press release and the portrait card are taken from the kit without posting, so
-- until now the only use the GMS could see was a social post. Each is now recorded as a count only:
-- the award, which of the three, and the day. No person, no workspace of the person, no address and
-- no file: one row per award, kind and day at most, so the table holds counts and nothing else.
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * adds share_kit_uses (RLS on, no policy or grant for anon/authenticated; the service role
--     writes): award_id, the award's own workspace_id (kept equal to the award's by a trigger, and
--     never moved), kind in (carousel, press_release, portrait), used_on, created_at, updated_at; unique
--     (award_id, kind, used_on). Deleting an award deletes its counts.
--   * replaces public.gms_operator_measures(timestamptz, integer, integer) (0052) with the same
--     signature, security (definer, empty search_path), grants (service role only) and answer
--     shape; only awardsShared changes: an award counts as shared with a social post that did not
--     fail, as before, or with a recorded download. On a database with no download yet every count
--     is the same as before.
-- Run before the API.

create table public.share_kit_uses (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  award_id      uuid not null references public.awards (id) on delete cascade,
  kind          text not null check (kind in ('carousel', 'press_release', 'portrait')),
  used_on       date not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (award_id, kind, used_on)
);
create index share_kit_uses_award on public.share_kit_uses (award_id);
alter table public.share_kit_uses enable row level security;
revoke all on public.share_kit_uses from anon, authenticated;

-- A count belongs to the award's own (funder) workspace, whichever side downloaded.
create or replace function gms.share_kit_use_award_ok()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.awards a where a.id = new.award_id and a.workspace_id = new.workspace_id) then
    raise exception 'share_kit_uses.workspace_id must be the award''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger share_kit_uses_award_ok before insert or update on public.share_kit_uses
  for each row execute function gms.share_kit_use_award_ok();
create trigger share_kit_uses_workspace_immutable before update of workspace_id on public.share_kit_uses
  for each row execute function gms.workspace_id_immutable();
create trigger share_kit_uses_touch_updated_at before update on public.share_kit_uses
  for each row execute function gms.touch_updated_at();

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
       where exists (select 1 from public.social_posts p where p.subject_type = 'award' and p.subject_id = k.id and p.status <> 'failed')
          or exists (select 1 from public.share_kit_uses u where u.award_id = k.id)),
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
comment on function public.gms_operator_measures(timestamptz, integer, integer) is 'The growth measures as counts only (docs/measures.md); measure 6 counts share-kit downloads too (0054). Service role only.';
revoke all on function public.gms_operator_measures(timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.gms_operator_measures(timestamptz, integer, integer) to service_role;
