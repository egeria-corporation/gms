-- SPDX-License-Identifier: AGPL-3.0-only
-- Grantees submit reports under their own RLS, but report_requirements is staff-writable only.
-- This narrow security-definer function lets an org member (or a person whose agent's request they
-- confirmed) move their own requirement to "submitted" once a submitted report_submissions row exists.
create or replace function gms_private.mark_report_submitted(p_requirement uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  select rr.id, rr.status, a.applicant_org_id into r
  from public.report_requirements rr join public.awards a on a.id = rr.award_id
  where rr.id = p_requirement
  for update of rr;
  if not found or not gms.is_org_member(r.applicant_org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.report_submissions s where s.requirement_id = p_requirement and s.status = 'submitted') then
    raise exception 'no submitted report' using errcode = '42501';
  end if;
  if r.status in ('upcoming', 'due', 'overdue', 'revisions_requested') then
    update public.report_requirements set status = 'submitted' where id = p_requirement;
  end if;
end
$$;
revoke all on function gms_private.mark_report_submitted(uuid) from public;
grant execute on function gms_private.mark_report_submitted(uuid) to gms_authenticated;
