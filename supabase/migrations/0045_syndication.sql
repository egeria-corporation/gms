-- 0045_syndication.sql
-- Syndication (E2, docs/syndication.md): a funder sends an open call to a listing service that
-- takes submissions by email, today Philanthropy News Digest (Candid), on the funder's own click,
-- after a preview. One submission per call and service: the unique (opportunity_id, target) makes
-- a second send, or two clicks at once, unable to record a second row, on every Worker.
--
-- The API (apps/api/src/services/syndication.ts) writes the row as the service role: it claims the
-- place first (sent_at null), sends, then stamps sent_at and Resend's message id. A send that fails
-- removes its claim. The address it went to is the service's own published submission address;
-- the reply-to (the funder's) is kept masked. No email body is stored, only the SHA-256 of the
-- email the person previewed and confirmed.
--
-- The open-call feeds and the OpenGrants index feed need no table: `publish.feeds` sits in the
-- opportunity's existing `publish` options (absent = on), like `openGrantsIndex`.
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * adds syndication_sends, RLS on. The service role writes; signed-in staff of the funder
--     workspace that owns the call read their workspace's rows (gms.is_staff: reviewers,
--     consultants and fund advisors excluded). Nothing else is granted.
--   * adds gms.syndication_sends_same_workspace(), a trigger function: a row names an opportunity
--     of its own workspace (opportunities belong to funder workspaces, so the row does too).

create table public.syndication_sends (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  opportunity_id   uuid not null references public.opportunities (id) on delete cascade,
  -- The listing service. One value today; a new service is a new value here and in the service.
  target           text not null check (target in ('pnd')),
  sent_by          uuid not null,
  -- The service's own published submission address (never a person's).
  to_address       text not null check (length(to_address) <= 320 and to_address ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- `j…@example.org`: the first character and the domain of the funder's reply-to address.
  reply_to_masked  text not null check (reply_to_masked ~ '^[^@[:space:]]…@[^@[:space:]]{1,253}$'),
  -- SHA-256 of the email exactly as previewed and sent.
  digest           text not null check (digest ~ '^[0-9a-f]{64}$'),
  message_id       text check (message_id is null or length(message_id) <= 200),
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (opportunity_id, target)
);
comment on table public.syndication_sends is 'Each submission of an open call to a listing service by email (Philanthropy News Digest): who sent it, when, the masked reply-to and the SHA-256 of the email. One per call and service.';
create index syndication_sends_workspace_idx on public.syndication_sends (workspace_id, created_at);

alter table public.syndication_sends enable row level security;
revoke all on public.syndication_sends from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.syndication_sends to service_role;
grant select on public.syndication_sends to authenticated;
create policy syndication_sends_select on public.syndication_sends for select to authenticated
  using (gms.is_staff(workspace_id));

create trigger syndication_sends_touch_updated_at before update on public.syndication_sends
  for each row execute function gms.touch_updated_at();
create trigger syndication_sends_workspace_immutable before update of workspace_id on public.syndication_sends
  for each row execute function gms.workspace_id_immutable();

-- A submission names an opportunity of its own workspace. Its own function rather than a line in
-- gms.same_workspace_rules(), which other migrations redefine.
create or replace function gms.syndication_sends_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.opportunities o where o.id = new.opportunity_id and o.workspace_id = new.workspace_id) then
    raise exception 'syndication_sends: the opportunity is not in this workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.syndication_sends_same_workspace() from public, anon, authenticated;
create trigger syndication_sends_same_workspace before insert or update of opportunity_id, workspace_id on public.syndication_sends
  for each row execute function gms.syndication_sends_same_workspace();
