-- 0050_co_editing.sql
-- Live co-editing with presence (F1, docs/co-editing.md). People writing one draft together see
-- who else is in it, which question each is in, a soft lock while someone types, and each
-- other's saved answers within seconds. The live channel is Supabase Realtime with Realtime
-- Authorization: private channels, checked by RLS policies on realtime.messages.
--
-- Who may join a draft's channel is decided by the API's own authorization check, the one that
-- decides who may open the draft (services/presence.ts): it issues a short-lived presence pass for
-- one signed-in session and one draft, and the policies below admit a channel join, a presence
-- track or a broadcast only for a session holding a live pass for that channel's topic whose
-- membership in the draft's workspace still stands. Reviewers and funders never get a pass: a
-- draft is the applicant's until it is submitted.
--
-- The channel never carries an answer. It carries who is present (name, the section and question
-- they are in), soft locks and "saved" nudges; the text is read again through the API.
--
-- What this changes on a live database (no existing row is changed, removed or re-written; no
-- existing table, column, function or policy is altered):
--   * adds presence_passes: one row per signed-in session and draft channel, renewed by the editor
--     while it is open and deleted once expired. RLS on, no policy and no grant for signed-in
--     people or visitors: only the API (service role) writes it, and the realtime policies read it
--     through gms.presence_pass_ok() (security definer). A pass lives at most 30 minutes past its
--     last write (a check), and its topic must name a draft of its own workspace (a trigger).
--   * adds gms.presence_pass_ok(channel, want_write) and the trigger function
--     gms.presence_pass_draft_ok().
--   * adds three policies on realtime.messages, for the `draft:` topics only: read broadcast and
--     presence (a live pass), track presence (a live pass), send a broadcast (a live pass that may
--     write). RLS on realtime.messages is already on (Supabase), so this migration does not touch
--     it. Where the database has no realtime.messages (a Postgres without Supabase Realtime) the
--     policies are skipped with a notice and the editors work without live updates.
-- Existing public channels are unaffected; turn off "Allow public access" in Realtime settings so
-- only private channels can be joined (docs/co-editing.md, Setup).

-- ---------------------------------------------------------------------------------------------
-- presence_passes
-- ---------------------------------------------------------------------------------------------
create table public.presence_passes (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- The Supabase Auth session the pass was issued to (the access token's `session_id` claim).
  session_id    uuid not null,
  -- `draft:application:<uuid>` (a built-in application) or `draft:outside:<uuid>` (an outside one).
  topic         text not null check (topic ~ '^draft:(application|outside):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- The session may write answers in this draft (applications:write), so it may send soft locks and
  -- "saved" nudges; a reader only receives them and is shown as present.
  can_write     boolean not null default false,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, session_id, topic),
  check (expires_at <= updated_at + interval '30 minutes')
);
-- The policies look a pass up by its topic and person.
create index presence_passes_topic_user_idx on public.presence_passes (topic, user_id);

-- A pass names a draft of the workspace it was issued in.
create or replace function gms.presence_pass_draft_ok()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  kind text;
  draft uuid;
begin
  -- A malformed topic is left to the table's check.
  if new.topic !~ '^draft:(application|outside):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  kind := split_part(new.topic, ':', 2);
  draft := split_part(new.topic, ':', 3)::uuid;
  if kind = 'application' and exists (select 1 from public.applications a where a.id = draft and a.applicant_workspace_id = new.workspace_id) then
    return new;
  end if;
  if kind = 'outside' and exists (select 1 from public.outside_applications o where o.id = draft and o.workspace_id = new.workspace_id) then
    return new;
  end if;
  raise exception 'a presence pass names a draft of its own workspace' using errcode = '23514';
end;
$$;
revoke all on function gms.presence_pass_draft_ok() from public, anon, authenticated;

create trigger presence_passes_draft_ok before insert or update of workspace_id, topic on public.presence_passes
  for each row execute function gms.presence_pass_draft_ok();
create trigger presence_passes_touch_updated_at before update on public.presence_passes
  for each row execute function gms.touch_updated_at();

alter table public.presence_passes enable row level security;
revoke all on public.presence_passes from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.presence_passes to service_role;
-- No grant and no policy for signed-in people: the realtime policies read passes through the
-- function below, and nobody reads them directly.

-- ---------------------------------------------------------------------------------------------
-- The check the realtime policies make
-- ---------------------------------------------------------------------------------------------
-- True when the signed-in session (auth.uid() and the token's session_id) holds a live pass for
-- `channel` (and, with want_write, one that may write), and its membership in the pass's workspace
-- still stands (gms.is_member: not removed, not expired).
create or replace function gms.presence_pass_ok(channel text, want_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(channel, '') like 'draft:%' and exists (
    select 1 from public.presence_passes p
    where p.topic = channel
      and p.user_id = (select auth.uid())
      and p.session_id::text = coalesce((select auth.jwt()) ->> 'session_id', '')
      and p.expires_at > pg_catalog.now()
      and (not want_write or p.can_write)
      and gms.is_member(p.workspace_id)
  );
$$;
revoke all on function gms.presence_pass_ok(text, boolean) from public, anon;
grant execute on function gms.presence_pass_ok(text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Realtime Authorization (https://supabase.com/docs/guides/realtime/authorization)
-- ---------------------------------------------------------------------------------------------
-- Realtime evaluates these when a client joins a private channel and when it sends a new access
-- token; it caches the answer for the connection. The editor renews its pass and its token every
-- few minutes, and a session whose pass is refused leaves the channel.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0050: realtime.messages does not exist here; the draft channels stay closed (docs/co-editing.md)';
    return;
  end if;
  execute $p$
    create policy gms_draft_receive on realtime.messages for select to authenticated
      using (realtime.messages.extension in ('broadcast', 'presence') and gms.presence_pass_ok((select realtime.topic()), false))
  $p$;
  execute $p$
    create policy gms_draft_track_presence on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'presence' and gms.presence_pass_ok((select realtime.topic()), false))
  $p$;
  execute $p$
    create policy gms_draft_send_broadcast on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'broadcast' and gms.presence_pass_ok((select realtime.topic()), true))
  $p$;
end;
$$;
