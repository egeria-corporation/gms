-- 0024_passport_org_only_from_passport.sql
-- A workspace carries a Passport organization only when Passport said so.
--
-- `POST /gms/workspaces` used to store whatever `passportOrgId` the caller typed, with nothing
-- behind it (red team 2026-11). An applicant workspace parked on an organization's id captured that
-- organization when it later arrived; a funder workspace published opportunities under another
-- organization's id. The API no longer accepts the id at creation: applicants get it from a Passport
-- consent or sign-in, funders when a Passport client is verified against the organization.
--
-- This removes the ids that were only ever typed: a workspace that has never had a row in
-- `passport_links` (live or revoked) never proved anything. THIS CHANGES ROWS: `passport_org_id`
-- becomes NULL on those workspaces, and nothing else. A funder whose id is removed enters it again
-- when connecting its Passport client (Settings > Passport), where it is now verified; an applicant
-- links again with "Continue with Passport". Each removal is written to the ledger.

with released as (
  update public.workspaces w
     set passport_org_id = null
   where w.passport_org_id is not null
     and not exists (select 1 from public.passport_links l where l.workspace_id = w.id)
  returning w.id, w.kind
)
insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data)
select r.id, 'system:migration', 'workspace.passport_claim_released', 'workspace', r.id::text,
       jsonb_build_object('reason', 'no_passport_proof', 'migration', '0024', 'kind', r.kind)
  from released r;
