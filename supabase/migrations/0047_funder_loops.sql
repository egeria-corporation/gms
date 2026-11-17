-- 0047_funder_loops.sql
-- Funder loops (E4): how funders hear of the GMS from the people already on it.
--   1. A funder admin invites a peer funder by email (one email, never a reminder, at most
--      PEER_INVITES_PER_WEEK = 5 per workspace per week; the limit is the API's one constant).
--   2. The send-to-funder package's footer links to "for funders" with the applicant workspace's
--      referral token, so a funder who received one sees where applicants keep theirs.
--   3. A multi-fund workspace (an intermediary) has a co-branded onboarding link for its funds'
--      grantees and affiliated funders, and may ask to be listed in the partner directory, which an
--      operator approves.
-- Who joined from which link is counted by the link's or invitation's id, never with a tracking
-- pixel and never with the address of the person who joined.
--
-- The API (apps/api/src/services/peer-invites.ts, for-funders.ts, partners.ts, referrals.ts) writes
-- every row as the service role. Signed-in staff of the owning workspace read their own rows.
--
-- What this changes on a live database (no existing row is changed, removed or re-written; no
-- existing table, column, function or policy is altered):
--   * adds peer_invitations: one row per invitation email. The address is kept masked (first
--     character and domain) and as a SHA-256 of the workspace and address, so the same address is
--     never invited twice by one workspace; the link's token as a SHA-256 only. No note text.
--     Unique (workspace_id, week_start, slot) holds the weekly limit on every Worker.
--   * adds referral_links: the applicant's package link (kind 'package', applicant workspaces) and
--     the intermediary's onboarding link (kind 'onboarding', funder workspaces), with the logo the
--     intermediary uploaded and its alt text. One live link of each kind per workspace.
--   * adds referral_joins: a workspace that joined from an invitation or a link, counted once.
--     Read by the service role only (no policy for signed-in people): the inviter sees a count.
--   * adds directory_listings: an intermediary's request to be listed at /partners, and the
--     operator's decision. One row per workspace; status pending, approved, rejected or withdrawn.
--   * adds gms.referral_link_kind_ok(), a trigger function: a package link belongs to an applicant
--     workspace, an onboarding link to a funder workspace. Reuses gms.gallery_funder_only() (0036)
--     and gms.workspace_id_immutable() (0020) for the funder-only and never-moves rules.
-- RLS is on for all four tables; nothing is granted to anon.

-- ---------------------------------------------------------------------------------------------
-- peer_invitations
-- ---------------------------------------------------------------------------------------------
create table public.peer_invitations (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  invited_by       uuid not null,
  -- `j…@example.org`: the first character and the domain only.
  email_masked     text not null check (email_masked ~ '^[^@[:space:]]…@[^@[:space:]]{1,253}$'),
  -- SHA-256 of `<workspace id>:<address, lower case>`: one invitation per address per workspace.
  email_hash       text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the token in the link; the token itself is only in the email.
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- The Monday (UTC) of the week the email went out, and its place among that week's emails.
  week_start       date not null check (extract(isodow from week_start) = 1),
  slot             smallint not null check (slot between 1 and 50),
  status           text not null default 'sending' check (status in ('sending', 'sent', 'joined')),
  sent_at          timestamptz,
  -- Funder workspaces made from this invitation's link (referral_joins), and when the first was.
  joined_count     integer not null default 0 check (joined_count >= 0),
  first_joined_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, email_hash),
  unique (workspace_id, week_start, slot),
  check ((status = 'sending') = (sent_at is null)),
  check ((status = 'joined') = (first_joined_at is not null)),
  check (status <> 'joined' or joined_count >= 1)
);
comment on table public.peer_invitations is 'A funder admin''s invitation of a peer funder: one email, no reminders. Masked address, hashed token, how many joined. Private to the inviting workspace''s staff.';
create index peer_invitations_workspace_idx on public.peer_invitations (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- referral_links
-- ---------------------------------------------------------------------------------------------
create table public.referral_links (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  kind          text not null check (kind in ('package', 'onboarding')),
  -- Shown in the package footer or the onboarding link. It opens a public page and grants nothing.
  token         text not null unique check (token ~ '^[a-z0-9]{20}$'),
  -- The intermediary's logo (onboarding links only), in the GMS's file storage, with its alt text.
  logo_storage  text check (logo_storage is null or logo_storage in ('r2', 'supabase')),
  logo_path     text check (logo_path is null or length(logo_path) between 1 and 300),
  logo_mime     text check (logo_mime is null or logo_mime in ('image/png', 'image/jpeg', 'image/webp')),
  logo_sha256   text check (logo_sha256 is null or logo_sha256 ~ '^[0-9a-f]{64}$'),
  logo_alt      text check (logo_alt is null or length(btrim(logo_alt)) between 1 and 200),
  revoked_at    timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kind = 'onboarding' or (logo_path is null and logo_alt is null)),
  check ((logo_path is null) = (logo_mime is null) and (logo_path is null) = (logo_storage is null) and (logo_path is null) = (logo_sha256 is null)),
  check (logo_path is null or logo_alt is not null)
);
comment on table public.referral_links is 'Links that bring people to the GMS: an applicant''s package footer link and an intermediary''s co-branded onboarding link. Private to the workspace''s staff; the public pages are the API''s.';
create unique index referral_links_one_live_idx on public.referral_links (workspace_id, kind) where revoked_at is null;

-- A package link belongs to an applicant workspace, an onboarding link to a funder workspace.
create or replace function gms.referral_link_kind_ok()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_kind text := (select w.kind from public.workspaces w where w.id = new.workspace_id);
begin
  if new.kind = 'package' and ws_kind is distinct from 'applicant' then
    raise exception 'referral_links: a package link belongs to an applicant workspace' using errcode = '23514';
  end if;
  if new.kind = 'onboarding' and ws_kind is distinct from 'funder' then
    raise exception 'referral_links: an onboarding link belongs to a funder workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.referral_link_kind_ok() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- referral_joins
-- ---------------------------------------------------------------------------------------------
create table public.referral_joins (
  id                   uuid primary key default gms.uuid_v7(),
  -- The workspace that was made, counted once whatever link it came from.
  joined_workspace_id  uuid not null unique references public.workspaces (id) on delete cascade,
  joined_kind          text not null check (joined_kind in ('funder', 'applicant')),
  joined_by            uuid not null,
  source               text not null check (source in ('peer_invitation', 'package', 'onboarding')),
  -- The inviting funder, the applicant whose package it was, or the intermediary.
  source_workspace_id  uuid references public.workspaces (id) on delete set null,
  peer_invitation_id   uuid references public.peer_invitations (id) on delete set null,
  referral_link_id     uuid references public.referral_links (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (source = 'peer_invitation' or peer_invitation_id is null),
  check (source <> 'peer_invitation' or referral_link_id is null),
  check (source = 'onboarding' or joined_kind = 'funder'),
  check (source_workspace_id is distinct from joined_workspace_id)
);
comment on table public.referral_joins is 'A workspace made from a peer invitation, a package link or an onboarding link, counted once. Read by the API only; the source workspace sees counts.';
create index referral_joins_invitation_idx on public.referral_joins (peer_invitation_id) where peer_invitation_id is not null;
create index referral_joins_link_idx on public.referral_joins (referral_link_id) where referral_link_id is not null;
create index referral_joins_source_idx on public.referral_joins (source, created_at);

-- ---------------------------------------------------------------------------------------------
-- directory_listings
-- ---------------------------------------------------------------------------------------------
create table public.directory_listings (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null unique references public.workspaces (id) on delete cascade,
  -- Where the intermediary works, as it wrote it (e.g. "Oregon", "Pacific Northwest").
  region           text not null check (length(btrim(region)) between 2 and 100),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  submitted_by     uuid not null,
  submitted_at     timestamptz not null default now(),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text check (decision_reason is null or length(decision_reason) <= 2000),
  withdrawn_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'pending' or (decided_at is null and decided_by is null)),
  check (status not in ('approved', 'rejected') or (decided_at is not null and decided_by is not null)),
  check (status <> 'rejected' or length(btrim(coalesce(decision_reason, ''))) >= 3),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);
comment on table public.directory_listings is 'An intermediary''s request to be listed in the partner directory (/partners), and the operator''s decision. Public only through the API, and only while approved.';
create index directory_listings_queue_idx on public.directory_listings (submitted_at) where status = 'pending';
create index directory_listings_listed_idx on public.directory_listings (status) where status = 'approved';

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers
-- ---------------------------------------------------------------------------------------------
alter table public.peer_invitations enable row level security;
alter table public.referral_links enable row level security;
alter table public.referral_joins enable row level security;
alter table public.directory_listings enable row level security;
revoke all on public.peer_invitations, public.referral_links, public.referral_joins, public.directory_listings from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.peer_invitations, public.referral_links, public.referral_joins, public.directory_listings to service_role;
grant select on public.peer_invitations, public.referral_links, public.directory_listings to authenticated;
-- No anonymous table access at all: the public pages are the API's. referral_joins has no policy
-- for signed-in people (and no grant): only the API reads it.
create policy peer_invitations_select on public.peer_invitations for select to authenticated
  using (gms.is_staff(workspace_id));
create policy referral_links_select on public.referral_links for select to authenticated
  using (gms.is_staff(workspace_id));
create policy directory_listings_select on public.directory_listings for select to authenticated
  using (gms.is_staff(workspace_id));

create trigger peer_invitations_touch_updated_at before update on public.peer_invitations
  for each row execute function gms.touch_updated_at();
create trigger referral_links_touch_updated_at before update on public.referral_links
  for each row execute function gms.touch_updated_at();
create trigger referral_joins_touch_updated_at before update on public.referral_joins
  for each row execute function gms.touch_updated_at();
create trigger directory_listings_touch_updated_at before update on public.directory_listings
  for each row execute function gms.touch_updated_at();

create trigger peer_invitations_funder_only before insert or update of workspace_id on public.peer_invitations
  for each row execute function gms.gallery_funder_only('workspace_id');
create trigger directory_listings_funder_only before insert or update of workspace_id on public.directory_listings
  for each row execute function gms.gallery_funder_only('workspace_id');
create trigger referral_links_kind_ok before insert or update of workspace_id, kind on public.referral_links
  for each row execute function gms.referral_link_kind_ok();

create trigger peer_invitations_workspace_immutable before update of workspace_id on public.peer_invitations
  for each row execute function gms.workspace_id_immutable();
create trigger referral_links_workspace_immutable before update of workspace_id on public.referral_links
  for each row execute function gms.workspace_id_immutable();
create trigger directory_listings_workspace_immutable before update of workspace_id on public.directory_listings
  for each row execute function gms.workspace_id_immutable();
