-- 0011_approvals_and_comments: columns the Phase 2 API needs (approval outcomes, field comments,
-- the cached Passport profile). No new tables.
--
-- approvals: the MCP dispatcher records the outcome of running an approved call (executed / failed)
-- and which side of the product the gated tool belongs to, so the approvals screen can show why an
-- approved call did not go through.
--
-- messages: applicant teams comment on a field of an application ("can we cite the county
-- assessment here?"). A comment is a message in the application's applicant-internal thread that
-- points at a form field and can be resolved.

alter table public.approvals drop constraint approvals_status_check;
alter table public.approvals drop constraint approvals_check;
alter table public.approvals
  add constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  add constraint approvals_decided_check
    check ((status in ('approved', 'rejected', 'executed', 'failed')) = (decided_by is not null and decided_at is not null)),
  add column side text not null default 'funder' check (side in ('funder', 'applicant')),
  add column error text check (error is null or length(error) <= 500);

comment on column public.approvals.status is 'pending | approved (claimed, running) | executed | failed | rejected | expired.';
comment on column public.approvals.side is 'Which tool set the gated tool belongs to: funder or applicant.';
comment on column public.approvals.error is 'Why an approved call failed: a short reason, never internals.';

alter table public.messages
  add column field_ref jsonb,
  add column resolved_at timestamptz,
  add column resolved_by uuid;

comment on column public.messages.field_ref is 'For a field comment: { formId, path } of the form field it is about; null for plain messages.';
comment on column public.messages.resolved_at is 'When a field comment was resolved; null while open or for plain messages.';

-- workspaces: the Common App profile beyond OrganizationBase (budget, fiscal year end, staff
-- count, 990 figures), as Passport serves it to a consented client. Cached next to the
-- organization projection; never edited here.
alter table public.workspaces
  add column profile_projection jsonb,
  add column profile_projection_at timestamptz;

comment on column public.workspaces.profile_projection is 'Cached Passport Common App profile: { level, fields[{ path, value, source, ... }] }. Confirmed fields only.';

-- A resolved approval still never reopens and never changes who decided, when, or what was asked.
-- The one move allowed after `approved` is recording how the approved call ended.
create or replace function gms.approvals_resolved_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' and (
       new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
       or new.tool is distinct from old.tool or new.input is distinct from old.input
       or (new.status is distinct from old.status
           and not (old.status = 'approved' and new.status in ('executed', 'failed')))) then
    raise exception 'approval % is already %', old.id, old.status using errcode = '23514';
  end if;
  return new;
end;
$$;
