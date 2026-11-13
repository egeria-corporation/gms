-- 0028_direct_awards.sql
-- Give an award directly: a funder offers an award to an organization that has not applied, by
-- its name and a contact email. The contact signs in with that same address and accepts for an
-- applicant workspace where they are an admin; only then is the award attached to that workspace
-- and the organization's consent recorded. Nothing is ever matched by name or EIN (review F-01).
--
-- What this changes on a live database:
--   * adds `award_invitations` (one row per directly given award: the invited address, the name
--     the funder typed, the SHA-256 of the current link token, and when it was sent, accepted,
--     declined or revoked) and `award_invitation_sends` (one row per email sent, for the daily
--     limit). Both are service role only: RLS on, no policy, nothing for anon or signed-in users.
--   * widens `consents.basis` to allow 'award' (accepting a direct award is the consent). Every
--     existing row already satisfies the wider check.
--   * adds `award_invitations.award_id` to the same-workspace rules of 0020
--     (`gms.same_workspace_rules()` is replaced with the same list plus that one row) and its two
--     triggers on the new table.
--   * adds three functions only the service role may run: counting a send against the limit,
--     giving a count back, and claiming an invitation in one transaction.
-- No existing row changes.

create table public.award_invitations (
  id                     uuid primary key default gms.uuid_v7(),
  -- The funder's workspace: the award's own workspace.
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  award_id               uuid not null unique references public.awards (id) on delete cascade,
  -- The address the invitation was sent to, trimmed and in lower case. Never copied to the ledger.
  email                  text not null check (email = lower(btrim(email)) and length(email) between 3 and 320 and email ~ '^[^@\s]+@[^@\s]+$'),
  -- The organization's name as the funder typed it. Not a match key: nothing is looked up by it.
  organization_name      text not null check (length(btrim(organization_name)) between 1 and 200),
  -- The funder's note, plain text.
  message                text check (message is null or length(message) <= 2000),
  -- base64url SHA-256 of the current link token. The token itself is never stored; resending replaces it.
  token_hash             text not null unique check (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at             timestamptz not null,
  sent_count             integer not null default 1 check (sent_count >= 1),
  last_sent_at           timestamptz not null default now(),
  accepted_at            timestamptz,
  accepted_by            uuid,
  accepted_workspace_id  uuid references public.workspaces (id) on delete set null,
  declined_at            timestamptz,
  decline_reason         text check (decline_reason is null or length(decline_reason) <= 2000),
  revoked_at             timestamptz,
  created_by             uuid not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- An invitation ends once: accepted, declined or revoked.
  check (num_nonnulls(accepted_at, declined_at, revoked_at) <= 1),
  check ((accepted_at is null) = (accepted_by is null)),
  check (accepted_workspace_id is null or accepted_at is not null)
);
comment on table public.award_invitations is 'Awards given directly: who was invited, by token hash only. Service role only (apps/api/src/services/direct-awards.ts).';
create index award_invitations_workspace_idx on public.award_invitations (workspace_id, created_at desc);

alter table public.award_invitations enable row level security;
revoke all on public.award_invitations from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.award_invitations to service_role;
create trigger award_invitations_touch_updated_at before update on public.award_invitations
  for each row execute function gms.touch_updated_at();

-- One row per invitation email (new or resent), for DIRECT_AWARD_INVITES_PER_DAY over a rolling
-- 24 hours. Rows older than two days are deleted as new ones are counted.
create table public.award_invitation_sends (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  sent_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.award_invitation_sends is 'Direct-award invitation emails per funder workspace, for the rolling daily limit. Service role only.';
create index award_invitation_sends_workspace_idx on public.award_invitation_sends (workspace_id, sent_at);

alter table public.award_invitation_sends enable row level security;
revoke all on public.award_invitation_sends from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.award_invitation_sends to service_role;
create trigger award_invitation_sends_touch_updated_at before update on public.award_invitation_sends
  for each row execute function gms.touch_updated_at();

-- Accepting a direct award is the organization's consent to share its record with that funder.
alter table public.consents drop constraint if exists consents_basis_check;
alter table public.consents add constraint consents_basis_check
  check (basis in ('application', 'passport_grant', 'shared_submission', 'award'));

-- The invitation belongs to the award's workspace (0020). Same list as before, plus one row.
create or replace function gms.same_workspace_rules()
returns table (child text, col text, parent text)
language sql
immutable
set search_path = ''
as $$
  values
    ('opportunities', 'program_id', 'programs'),
    ('competitions', 'opportunity_id', 'opportunities'),
    ('applications', 'competition_id', 'competitions'),
    ('applications', 'opportunity_id', 'opportunities'),
    ('form_responses', 'application_id', 'applications'),
    ('form_responses', 'submission_id', 'submissions'),
    ('application_events', 'application_id', 'applications'),
    ('review_assignments', 'application_id', 'applications'),
    ('reviews', 'assignment_id', 'review_assignments'),
    ('decisions', 'application_id', 'applications'),
    ('decisions', 'competition_id', 'competitions'),
    ('awards', 'application_id', 'applications'),
    ('awards', 'opportunity_id', 'opportunities'),
    ('awards', 'program_id', 'programs'),
    ('awards', 'parent_award_id', 'awards'),
    ('agreements', 'award_id', 'awards'),
    ('payment_schedules', 'award_id', 'awards'),
    ('tranches', 'award_id', 'awards'),
    ('tranches', 'schedule_id', 'payment_schedules'),
    ('requirements', 'award_id', 'awards'),
    ('requirements', 'releases_tranche_id', 'tranches'),
    ('submissions', 'requirement_id', 'requirements'),
    ('submissions', 'award_id', 'awards'),
    ('budgets', 'award_id', 'awards'),
    ('budgets', 'application_id', 'applications'),
    ('amendments', 'award_id', 'awards'),
    ('amendments', 'child_award_id', 'awards'),
    ('bank_transactions', 'matched_tranche_id', 'tranches'),
    ('award_invitations', 'award_id', 'awards')
$$;
revoke all on function gms.same_workspace_rules() from public, anon, authenticated;
grant execute on function gms.same_workspace_rules() to service_role;

create trigger award_invitations_same_workspace before insert or update of award_id, workspace_id on public.award_invitations
  for each row execute function gms.same_workspace_as_parent();
create trigger award_invitations_workspace_immutable before update of workspace_id on public.award_invitations
  for each row execute function gms.workspace_id_immutable();

-- Count one invitation email against the funder's limit over the last 24 hours; false (and nothing
-- counted) when the limit is reached. A transaction-scoped advisory lock per workspace makes the
-- count and the insert one step, so parallel requests cannot both take the last place.
create or replace function public.gms_claim_award_invitation_send(p_workspace uuid, p_limit integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  used integer;
begin
  if p_workspace is null or p_limit is null or p_limit < 0 then
    raise exception 'a workspace and a limit are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gms.award_invitation_sends:' || p_workspace::text, 0));
  delete from public.award_invitation_sends s where s.workspace_id = p_workspace and s.sent_at < now() - interval '2 days';
  select count(*)::integer into used from public.award_invitation_sends s where s.workspace_id = p_workspace and s.sent_at > now() - interval '24 hours';
  if used >= p_limit then
    return false;
  end if;
  insert into public.award_invitation_sends (workspace_id) values (p_workspace);
  return true;
end;
$$;

-- Give back a count whose invitation was not made (the award could not be created).
create or replace function public.gms_release_award_invitation_send(p_workspace uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.award_invitation_sends s
   where s.id = (select x.id from public.award_invitation_sends x
                  where x.workspace_id = p_workspace and x.sent_at > now() - interval '24 hours'
                  order by x.sent_at desc, x.id desc limit 1);
$$;

-- Claim a direct award, all in one transaction (contract: direct awards). The API has already
-- checked each of these for a clear answer; this re-checks them under row locks and writes:
--   the invitation: found by token hash, not accepted, declined or revoked, not expired;
--   the person: their confirmed sign-in address (auth.users) and the address the API read from
--     their session both equal the invited address, trimmed and case-insensitive;
--   the workspace: an applicant workspace where the person is a current admin;
--   the award: still offered to the named recipient, in the invitation's workspace.
-- Then the award's recipient becomes the workspace (the named recipient is cleared, keeping the
-- one-recipient check) and its status `accepted` (offered → accepted, the transition
-- packages/workflow decided; `p_cg_status` is its CommonGrants status), a consent with basis
-- 'award' is recorded unless a live one exists, and the invitation is marked accepted.
-- Returns { outcome, consentId }: outcome is 'claimed' or the first check that failed.
create or replace function public.gms_claim_direct_award(p_token_hash text, p_workspace uuid, p_user uuid, p_email text, p_cg_status text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.award_invitations%rowtype;
  claimed uuid;
  consent uuid;
begin
  select * into inv from public.award_invitations i where i.token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if inv.accepted_at is not null or inv.declined_at is not null then
    return jsonb_build_object('outcome', 'used');
  end if;
  if inv.revoked_at is not null then
    return jsonb_build_object('outcome', 'revoked');
  end if;
  if inv.expires_at <= now() then
    return jsonb_build_object('outcome', 'expired');
  end if;
  if lower(btrim(coalesce(p_email, ''))) <> inv.email
     or not exists (select 1 from auth.users u
                     where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null
                       and lower(btrim(u.email)) = inv.email) then
    return jsonb_build_object('outcome', 'email_mismatch');
  end if;
  if not exists (select 1 from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
                  where m.workspace_id = p_workspace and m.user_id = p_user and m.role = 'admin'
                    and w.kind = 'applicant' and w.id <> inv.workspace_id
                    and (m.expires_at is null or m.expires_at > now())) then
    return jsonb_build_object('outcome', 'not_workspace_admin');
  end if;
  update public.awards a
     set recipient_workspace_id = p_workspace, recipient_individual = null, status = 'accepted', cg_status = p_cg_status
   where a.id = inv.award_id and a.workspace_id = inv.workspace_id and a.status = 'offered' and a.recipient_workspace_id is null
  returning a.id into claimed;
  if claimed is null then
    return jsonb_build_object('outcome', 'award_changed');
  end if;
  if not exists (select 1 from public.consents c
                  where c.applicant_workspace_id = p_workspace and c.funder_workspace_id = inv.workspace_id and c.revoked_at is null) then
    insert into public.consents (applicant_workspace_id, funder_workspace_id, basis, scopes, granted_by, granted_at)
    values (p_workspace, inv.workspace_id, 'award', array['org:read'], p_user, now())
    returning id into consent;
  end if;
  update public.award_invitations i
     set accepted_at = now(), accepted_by = p_user, accepted_workspace_id = p_workspace
   where i.id = inv.id;
  return jsonb_build_object('outcome', 'claimed', 'consentId', consent);
end;
$$;

revoke all on function public.gms_claim_award_invitation_send(uuid, integer) from public, anon, authenticated;
revoke all on function public.gms_release_award_invitation_send(uuid) from public, anon, authenticated;
revoke all on function public.gms_claim_direct_award(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.gms_claim_award_invitation_send(uuid, integer) to service_role;
grant execute on function public.gms_release_award_invitation_send(uuid) to service_role;
grant execute on function public.gms_claim_direct_award(text, uuid, uuid, text, text) to service_role;
