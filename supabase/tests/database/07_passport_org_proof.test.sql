-- A workspace carries a Passport organization only when a Passport link stands behind it (0024).
-- This pins the cleanup rule on rows made here. (The development seed is loaded after the
-- migrations and gives its fixture workspaces an id without a link, so the whole table is not asserted.)
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.workspaces (id, kind, handle, display_name, passport_org_id) values
  ('7a000000-0000-4000-8000-000000000001', 'applicant', 'pp-typed', 'Typed at sign-up', '7a900000-0000-4000-8000-000000000001'),
  ('7a000000-0000-4000-8000-000000000002', 'funder', 'pp-proven', 'Proven by a client', '7a900000-0000-4000-8000-000000000002'),
  ('7a000000-0000-4000-8000-000000000003', 'applicant', 'pp-once', 'Consent since withdrawn', '7a900000-0000-4000-8000-000000000003');
insert into public.passport_links (workspace_id, mode, client_id, client_secret_enc, linked_at) values
  ('7a000000-0000-4000-8000-000000000002', 'funder_client', 'pc_x', 'ciphertext', now());
insert into public.passport_links (workspace_id, mode, client_id, refresh_token_enc, linked_at, revoked_at) values
  ('7a000000-0000-4000-8000-000000000003', 'applicant_consent', 'gms', 'ciphertext', now(), now());

-- The statement of migration 0024, run again on these rows.
with released as (
  update public.workspaces w set passport_org_id = null
   where w.passport_org_id is not null and not exists (select 1 from public.passport_links l where l.workspace_id = w.id)
  returning w.id, w.kind
)
insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data)
select r.id, 'system:migration', 'workspace.passport_claim_released', 'workspace', r.id::text, jsonb_build_object('reason', 'no_passport_proof', 'migration', '0024', 'kind', r.kind) from released r;

select is((select passport_org_id from public.workspaces where id = '7a000000-0000-4000-8000-000000000001'), null, 'an id that was only typed is removed');
select is((select passport_org_id::text from public.workspaces where id = '7a000000-0000-4000-8000-000000000002'), '7a900000-0000-4000-8000-000000000002', 'a funder whose client was verified keeps its organization');
select is((select passport_org_id::text from public.workspaces where id = '7a000000-0000-4000-8000-000000000003'), '7a900000-0000-4000-8000-000000000003', 'and so does a workspace whose consent was given once, even if withdrawn since');
select is((select count(*)::int from public.ledger_events where event_type = 'workspace.passport_claim_released' and workspace_id = '7a000000-0000-4000-8000-000000000001'), 1, 'the removal is on the ledger');

select * from finish();
rollback;
