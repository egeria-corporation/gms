-- 0028_direct_awards.sql
-- Give an award directly: a funder offers an award to an organization that has not applied, by
-- its name and a contact email. The contact signs in with that same address and accepts for an
-- applicant workspace where they are an admin; only then is the award attached to that workspace
-- and the organization's consent recorded. Nothing is ever matched by name or EIN (review F-01).
--
-- What this changes on a live database:
--   * adds `award_invitations` (one row per directly given award: the invited address, the name
--     the funder typed, the SHA-256 of the current link token, and when it was sent, accepted,
--     declined or revoked) and `award_invitation_sends` (one row per email sent, for the send
--     limits: per funder workspace, per sender, per network address, per recipient and for the
--     whole instance; the recipient is kept as a digest). Both are service role only: RLS on, no policy, nothing for anon or signed-in users.
--   * widens `consents.basis` to allow 'award' (accepting a direct award is the consent). Every
--     existing row already satisfies the wider check.
--   * adds `award_invitations.award_id` to the same-workspace rules of 0020
--     (`gms.same_workspace_rules()` is replaced with the same list plus that one row) and its two
--     triggers on the new table.
--   * adds four functions only the service role may run: counting a send against the limits,
--     giving a count back, creating a direct award in one transaction and claiming one in one
--     transaction, and `gms.append_ledger`, which only they call.
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

-- One row per invitation email (new or resent), for the send limits of apps/api/src/services/
-- direct-awards.ts over rolling windows. Rows older than eight days are deleted as new ones are
-- counted (the longest window is seven days).
create table public.award_invitation_sends (
  id                uuid primary key default gms.uuid_v7(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  sender_user_id    uuid not null,
  -- `addressKey` in apps/api/src/lib/rate-limit.ts: an IPv4 address or an IPv6 /64. Null when unknown.
  address_key       text check (address_key is null or address_key ~ '^[0-9A-Za-z:./-]{1,80}$'),
  -- base64url SHA-256 of the invited address, trimmed and in lower case. Never the address itself.
  recipient_digest  text not null check (recipient_digest ~ '^[A-Za-z0-9_-]{43}$'),
  sent_at           timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.award_invitation_sends is 'Direct-award invitation emails, for the rolling send limits. The recipient is a digest. Service role only.';
create index award_invitation_sends_sent_idx on public.award_invitation_sends (sent_at);
create index award_invitation_sends_workspace_idx on public.award_invitation_sends (workspace_id, sent_at);
create index award_invitation_sends_sender_idx on public.award_invitation_sends (sender_user_id, sent_at);
create index award_invitation_sends_address_idx on public.award_invitation_sends (address_key, sent_at) where address_key is not null;
create index award_invitation_sends_recipient_idx on public.award_invitation_sends (recipient_digest, sent_at);

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

-- Append ledger rows built by the API (`ledgerRow`, @gms/ledger) in the caller's transaction, so a
-- change and its record commit together. Only into the workspaces the caller names.
create or replace function gms.append_ledger(p_events jsonb, p_workspaces uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from jsonb_populate_recordset(null::public.ledger_events, p_events) e
              where e.workspace_id is null or not (e.workspace_id = any (p_workspaces))) then
    raise exception 'a ledger row names a workspace this change does not touch' using errcode = '23514';
  end if;
  insert into public.ledger_events (id, workspace_id, actor, event_type, subject_type, subject_id, data, occurred_at)
    select e.id, e.workspace_id, e.actor, e.event_type, e.subject_type, e.subject_id, coalesce(e.data, '{}'), coalesce(e.occurred_at, now())
      from jsonb_populate_recordset(null::public.ledger_events, p_events) e;
end;
$$;

-- Count one invitation email against every send limit, or against none. The limits are the
-- callers' (apps/api/src/services/direct-awards.ts); the windows are 24 hours, and seven days for
-- the recipient. One transaction-scoped advisory lock for all sends makes the counts and the
-- insert one step (the instance-wide count needs a single lock anyway), so parallel requests
-- cannot both take the last place. Returns { outcome, sendId }: outcome is 'ok' or the first limit
-- reached ('workspace', 'sender', 'address', 'recipient', 'instance'), and nothing is counted then.
create or replace function public.gms_claim_award_invitation_send(
  p_workspace uuid, p_sender uuid, p_address text, p_recipient text,
  p_workspace_limit integer, p_sender_limit integer, p_address_limit integer, p_recipient_limit integer, p_instance_limit integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  day_ago timestamptz := now() - interval '24 hours';
  sent uuid;
begin
  if p_workspace is null or p_sender is null or p_recipient is null
     or p_workspace_limit is null or p_sender_limit is null or p_address_limit is null or p_recipient_limit is null or p_instance_limit is null then
    raise exception 'every key and limit is required (the address may be null)';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gms.award_invitation_sends', 0));
  delete from public.award_invitation_sends s where s.sent_at < now() - interval '8 days';
  if (select count(*) from public.award_invitation_sends s where s.workspace_id = p_workspace and s.sent_at > day_ago) >= p_workspace_limit then
    return jsonb_build_object('outcome', 'workspace');
  end if;
  if (select count(*) from public.award_invitation_sends s where s.sender_user_id = p_sender and s.sent_at > day_ago) >= p_sender_limit then
    return jsonb_build_object('outcome', 'sender');
  end if;
  if p_address is not null and (select count(*) from public.award_invitation_sends s where s.address_key = p_address and s.sent_at > day_ago) >= p_address_limit then
    return jsonb_build_object('outcome', 'address');
  end if;
  if (select count(*) from public.award_invitation_sends s where s.recipient_digest = p_recipient and s.sent_at > now() - interval '7 days') >= p_recipient_limit then
    return jsonb_build_object('outcome', 'recipient');
  end if;
  if (select count(*) from public.award_invitation_sends s where s.sent_at > day_ago) >= p_instance_limit then
    return jsonb_build_object('outcome', 'instance');
  end if;
  insert into public.award_invitation_sends (workspace_id, sender_user_id, address_key, recipient_digest)
  values (p_workspace, p_sender, p_address, p_recipient)
  returning id into sent;
  return jsonb_build_object('outcome', 'ok', 'sendId', sent);
end;
$$;

-- Give back a count whose invitation was not sent (the resend lost a race).
create or replace function public.gms_release_award_invitation_send(p_send uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.award_invitation_sends s where s.id = p_send;
$$;

-- Create a direct award, all in one transaction (review DA-04): count the send against every limit
-- (as above; nothing is written when one is reached), then write the award with its payment
-- schedule, tranches and requirements, the invitation and their ledger entries, all from the plan
-- the API built (apps/api/src/services/direct-awards.ts). Every row is put in the sending workspace
-- and the award is always `offered` to its named recipient, whatever the plan says. Returns what
-- gms_claim_award_invitation_send returned.
create or replace function public.gms_create_direct_award(p_plan jsonb, p_send jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ws uuid := (p_send ->> 'p_workspace')::uuid;
  award uuid := (p_plan -> 'award' ->> 'id')::uuid;
  counted jsonb;
begin
  if ws is null or award is null then
    raise exception 'a workspace and an award id are required';
  end if;
  counted := public.gms_claim_award_invitation_send(
    ws, (p_send ->> 'p_sender')::uuid, p_send ->> 'p_address', p_send ->> 'p_recipient',
    (p_send ->> 'p_workspace_limit')::integer, (p_send ->> 'p_sender_limit')::integer, (p_send ->> 'p_address_limit')::integer,
    (p_send ->> 'p_recipient_limit')::integer, (p_send ->> 'p_instance_limit')::integer
  );
  if counted ->> 'outcome' <> 'ok' then
    return counted;
  end if;
  insert into public.awards (id, workspace_id, recipient_workspace_id, recipient_individual, program_id, title, description, status, cg_status, conditions, funding, key_dates)
    select award, ws, null, a.recipient_individual, a.program_id, a.title, a.description, 'offered', a.cg_status, coalesce(a.conditions, '{}'), coalesce(a.funding, '{}'), coalesce(a.key_dates, '{}')
      from jsonb_populate_record(null::public.awards, p_plan -> 'award') a;
  insert into public.payment_schedules (id, workspace_id, award_id, currency)
    select s.id, ws, award, s.currency from jsonb_populate_record(null::public.payment_schedules, p_plan -> 'schedule') s;
  insert into public.tranches (id, workspace_id, award_id, schedule_id, seq, amount_minor, currency, condition, status, due_at, idempotency_key)
    select t.id, ws, award, t.schedule_id, t.seq, t.amount_minor, t.currency, t.condition, 'scheduled', t.due_at, t.idempotency_key
      from jsonb_populate_recordset(null::public.tranches, coalesce(p_plan -> 'tranches', '[]')) t;
  insert into public.requirements (id, workspace_id, award_id, type, title, form_id, form_version, due_at, grace_days, reminder_plan, status, releases_tranche_id)
    select r.id, ws, award, r.type, r.title, r.form_id, r.form_version, r.due_at, coalesce(r.grace_days, 0), coalesce(r.reminder_plan, '[-30, -14, -7, 0, 3, 14]'), 'scheduled', r.releases_tranche_id
      from jsonb_populate_recordset(null::public.requirements, coalesce(p_plan -> 'requirements', '[]')) r;
  insert into public.award_invitations (id, workspace_id, award_id, email, organization_name, message, token_hash, expires_at, sent_count, last_sent_at, created_by)
    select i.id, ws, award, i.email, i.organization_name, i.message, i.token_hash, i.expires_at, 1, coalesce(i.last_sent_at, now()), i.created_by
      from jsonb_populate_record(null::public.award_invitations, p_plan -> 'invitation') i;
  perform gms.append_ledger(coalesce(p_plan -> 'ledger', '[]'), array[ws]);
  return counted;
end;
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

revoke all on function public.gms_claim_award_invitation_send(uuid, uuid, text, text, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.gms_release_award_invitation_send(uuid) from public, anon, authenticated;
revoke all on function public.gms_claim_direct_award(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.gms_create_direct_award(jsonb, jsonb) from public, anon, authenticated;
revoke all on function gms.append_ledger(jsonb, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.gms_claim_award_invitation_send(uuid, uuid, text, text, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.gms_release_award_invitation_send(uuid) to service_role;
grant execute on function public.gms_claim_direct_award(text, uuid, uuid, text, text) to service_role;
grant execute on function public.gms_create_direct_award(jsonb, jsonb) to service_role;
