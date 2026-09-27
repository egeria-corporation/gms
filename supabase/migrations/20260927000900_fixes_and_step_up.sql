-- SPDX-License-Identifier: AGPL-3.0-only
-- 1. award_ceiling_cents must see all child awards regardless of the caller's RLS (used by public_awards
--    and by the payment ceiling trigger). It only returns a number, never row data.
-- 2. Board members may change their vote while a docket is in session.
-- 3. Test-auth sessions record when the authenticator was last verified (step-up freshness).
-- 4. Public program names for published opportunities (the public site and CommonGrants customFields).

create or replace function gms_private.award_ceiling_cents(root uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select amount_cents from public.awards where id = root), 0)
    + coalesce((select sum(amount_cents) from public.awards
                where parent_award_id = root and amendment_status = 'approved'), 0)
$$;
revoke all on function gms_private.award_ceiling_cents(uuid) from public;
grant execute on function gms_private.award_ceiling_cents(uuid) to gms_anon, gms_authenticated;

create or replace function gms_private.award_root(award uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select id, parent_award_id from public.awards where id = award
    union all
    select a.id, a.parent_award_id from public.awards a join up on a.id = up.parent_award_id
  )
  select id from up where parent_award_id is null limit 1
$$;

create policy votes_board_update on public.votes for update to gms_authenticated
  using (
    voter_id = gms.uid() and gms.is_member(workspace_id, array['board'])
    and exists (select 1 from public.docket_items di join public.dockets d on d.id = di.docket_id
                where di.id = docket_item_id and d.status = 'in_session')
  )
  with check (voter_id = gms.uid());

alter table gms_private.test_auth_sessions add column if not exists mfa_at timestamptz;

create or replace view public.public_programs as
  select p.id, p.workspace_id, p.name, p.slug, p.description, p.cause_area
  from public.programs p
  where p.status = 'active'
    and exists (select 1 from public.opportunities o
                where o.program_id = p.id and o.status in ('forecasted', 'open', 'closed'));
grant select on public.public_programs to gms_anon, gms_authenticated;
