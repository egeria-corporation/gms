-- 0040_send_package.sql
-- Send to the funder (C4): an applicant emails an outside application's package (a PDF of the
-- cover, questions and answers, budget summary and attachment list, plus the files the person
-- attached to that application) to a funder contact who is not on the GMS.
--
-- The API (apps/api/src/services/send-package.ts) writes one row per email, as the service role.
-- At most PACKAGE_EMAILS_PER_DAY (5) per application per UTC day: the service takes the first free
-- `slot` from 1 to that limit, and the unique (outside_application_id, day, slot) makes two
-- parallel sends unable to take the same place, so the count holds on every Worker. The limit
-- itself is the service's one constant; the check on `slot` here is only a brake.
--
-- The recipient is kept masked (first character and the domain); no answer text, file or address
-- in full is stored. Downloads write nothing.
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * adds package_sends, RLS on. The service role writes; signed-in members of the applicant
--     workspace that owns the outside application read their workspace's rows (consultants
--     excluded, as for outside applications: gms.is_staff). Nothing else is granted.
--   * adds gms.package_sends_same_workspace(), a trigger function: a row names an outside
--     application of its own workspace.

create table public.package_sends (
  id                      uuid primary key default gms.uuid_v7(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  outside_application_id  uuid not null references public.outside_applications (id) on delete cascade,
  -- The UTC day the email was sent, and its place among that day's sends for this application.
  day                     date not null,
  slot                    smallint not null check (slot between 1 and 50),
  sent_by                 uuid not null,
  -- `j…@example.org`: the first character and the domain only.
  to_masked               text not null check (to_masked ~ '^[^@[:space:]]…@[^@[:space:]]{1,253}$'),
  -- SHA-256 of the package PDF that was attached.
  package_sha256          text not null check (package_sha256 ~ '^[0-9a-f]{64}$'),
  attachment_count        integer not null check (attachment_count between 0 and 200),
  sent_at                 timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (outside_application_id, day, slot)
);
comment on table public.package_sends is 'Each send-to-funder package email from an outside application: masked recipient, the PDF''s SHA-256 and the number of files. For the daily limit and the record. Private to the applicant workspace.';
create index package_sends_workspace_idx on public.package_sends (workspace_id, created_at);

alter table public.package_sends enable row level security;
revoke all on public.package_sends from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.package_sends to service_role;
grant select on public.package_sends to authenticated;
create policy package_sends_select on public.package_sends for select to authenticated
  using (gms.is_staff(workspace_id));

create trigger package_sends_touch_updated_at before update on public.package_sends
  for each row execute function gms.touch_updated_at();
create trigger package_sends_applicant_only before insert or update of workspace_id on public.package_sends
  for each row execute function gms.applicant_workspace_only();
create trigger package_sends_workspace_immutable before update of workspace_id on public.package_sends
  for each row execute function gms.workspace_id_immutable();

-- A send names an outside application of its own workspace. Its own function rather than a line
-- in gms.same_workspace_rules(), which other migrations redefine.
create or replace function gms.package_sends_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.outside_applications a where a.id = new.outside_application_id and a.workspace_id = new.workspace_id) then
    raise exception 'package_sends: the outside application is not in this workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.package_sends_same_workspace() from public, anon, authenticated;
create trigger package_sends_same_workspace before insert or update of outside_application_id, workspace_id on public.package_sends
  for each row execute function gms.package_sends_same_workspace();
