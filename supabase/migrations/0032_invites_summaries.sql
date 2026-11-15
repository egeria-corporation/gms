-- 0032_invites_summaries.sql
-- Invite a teammate into a draft, and the AI summary on the funder's review screen (v1.7.0).
--
-- An invitation into a draft is an ordinary row of `invitations` (0002): its `scope` names the
-- draft ({ draft: { kind, id, questionId | formId + section }, applicationIds | outsideApplicationIds })
-- and its role is `consultant`, the least privileged applicant role that can edit answers. The API
-- (apps/api/src/services/draft-invitations.ts) writes it; nothing here reads the scope.
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * invitations: an index on (workspace_id, created_at) and a BEFORE INSERT trigger that refuses
--     the 21st invitation a workspace creates within a rolling day (gms.invitations_per_day()).
--     Existing rows are only counted: an insert is refused while the workspace already holds 20
--     invitations created in the last 24 hours. Updates (accepting) are not limited.
--   * workspace_members: adds dismissed_notes (text[], default {}), the one-time notes a member has
--     dismissed ("Writing with others? Invite a teammate"). Every existing row gets the empty array
--     and passes its check.
--   * adds application_summaries, RLS on, service role only: the assistant's summary of an
--     application, one per application and response version, so every reviewer reads the same one
--     and the monthly quota is spent once. A summary is never a score or a decision.

-- ---------------------------------------------------------------------------------------------
-- Invitations: at most 20 per workspace per rolling day, whichever screen sends them
-- ---------------------------------------------------------------------------------------------
create index if not exists invitations_workspace_created_idx on public.invitations (workspace_id, created_at desc);

-- One constant, mirrored by INVITATIONS_PER_DAY in apps/api/src/services/draft-invitations.ts.
create or replace function gms.invitations_per_day()
returns integer
language sql
immutable
set search_path = ''
as $$ select 20 $$;

create or replace function gms.invitation_daily_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  -- One writer at a time per workspace, so two parallel requests cannot both take the last place.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gms.invitations:' || new.workspace_id::text, 0));
  select count(*) into n from public.invitations i
   where i.workspace_id = new.workspace_id and i.created_at > pg_catalog.now() - interval '1 day';
  if n >= gms.invitations_per_day() then
    raise exception 'invitations: the daily invitation limit for this workspace is reached' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.invitation_daily_limit() from public, anon, authenticated;
create trigger invitations_daily_limit before insert on public.invitations
  for each row execute function gms.invitation_daily_limit();

-- ---------------------------------------------------------------------------------------------
-- One-time notes a member has dismissed
-- ---------------------------------------------------------------------------------------------
alter table public.workspace_members add column if not exists dismissed_notes text[] not null default '{}';
alter table public.workspace_members add constraint workspace_members_dismissed_notes_check
  check (cardinality(dismissed_notes) <= 20 and array_position(dismissed_notes, null) is null);
comment on column public.workspace_members.dismissed_notes is 'One-time notes this member dismissed, by key (e.g. invite_teammate). Set by the API only.';

-- ---------------------------------------------------------------------------------------------
-- The AI summary of an application, shared by every reviewer of the same version
-- ---------------------------------------------------------------------------------------------
create table public.application_summaries (
  id                uuid primary key default gms.uuid_v7(),
  -- The funder's workspace: the application's own workspace.
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  application_id    uuid not null references public.applications (id) on delete cascade,
  -- SHA-256 (hex) of what the assistant read: the answers as the caller may see them, the
  -- application's title, stage, ask and eligibility outcomes. New answers, a new version.
  response_version  text not null check (response_version ~ '^[0-9a-f]{64}$'),
  -- The `summarize` draft: summary, strengths, open questions, quotes, cautions. Never a score.
  summary           jsonb not null check (jsonb_typeof(summary) = 'object' and length(summary::text) <= 100000),
  model             text not null check (length(btrim(model)) between 1 and 200),
  generated_by      uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (application_id, response_version)
);
comment on table public.application_summaries is 'The assistant''s summary of an application, one per response version, read by every reviewer who may see that version. Service role only (apps/api/src/services/assist.ts).';
create index application_summaries_workspace_idx on public.application_summaries (workspace_id, created_at desc);

alter table public.application_summaries enable row level security;
revoke all on public.application_summaries from public, anon, authenticated, service_role;
-- A summary is written once and never edited: no UPDATE.
grant select, insert, delete on public.application_summaries to service_role;
create trigger application_summaries_touch_updated_at before update on public.application_summaries
  for each row execute function gms.touch_updated_at();

-- The summary sits in the application's own (funder) workspace, and stays there.
create or replace function gms.application_summary_same_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.applications a where a.id = new.application_id and a.workspace_id = new.workspace_id) then
    raise exception 'application_summaries: the application belongs to another workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.application_summary_same_workspace() from public, anon, authenticated;
create trigger application_summaries_same_workspace before insert or update of application_id, workspace_id on public.application_summaries
  for each row execute function gms.application_summary_same_workspace();
