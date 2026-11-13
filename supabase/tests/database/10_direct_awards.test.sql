-- Direct awards (0028): the invitation table is the service role's alone, a claim attaches the award
-- only for the invited, confirmed address and an admin of an applicant workspace, all in one
-- transaction, and the rolling daily limit counts every send. Run as the service role, the role the
-- API uses, so a missing grant fails here and not in production.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('7da00000-0000-4000-8000-000000000001', 'Jo.Grant@Alder.example', 'authenticated', 'authenticated', now()),  -- the invited person
  ('7da00000-0000-4000-8000-000000000002', 'someone@alder.example', 'authenticated', 'authenticated', now()),   -- another admin
  ('7da00000-0000-4000-8000-000000000003', 'pending@alder.example', 'authenticated', 'authenticated', null);    -- never confirmed
insert into public.workspaces (id, kind, handle, display_name) values
  ('7d000000-0000-4000-8000-0000000000f1', 'funder', 'da-funder', 'Direct Funder'),
  ('7d000000-0000-4000-8000-0000000000f2', 'funder', 'da-funder-2', 'Other Funder'),
  ('7d000000-0000-4000-8000-0000000000a1', 'applicant', 'da-applicant', 'Alder'),
  ('7d000000-0000-4000-8000-0000000000a2', 'applicant', 'da-applicant-2', 'Alder (editor only)');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000001', 'admin'),
  ('7d000000-0000-4000-8000-0000000000a2', '7da00000-0000-4000-8000-000000000001', 'editor'),
  ('7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000002', 'admin'),
  ('7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000003', 'admin'),
  ('7d000000-0000-4000-8000-0000000000f1', '7da00000-0000-4000-8000-000000000001', 'admin');
insert into public.awards (id, workspace_id, recipient_individual, title, status) values
  ('7d500000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-0000000000f1', '{"name": "Alder Creek"}', 'Direct award', 'offered'),
  ('7d500000-0000-4000-8000-000000000002', '7d000000-0000-4000-8000-0000000000f1', '{"name": "Alder Creek"}', 'Expired one', 'offered'),
  ('7d500000-0000-4000-8000-000000000003', '7d000000-0000-4000-8000-0000000000f2', '{"name": "Elsewhere"}', 'Other funder award', 'offered'),
  ('7d500000-0000-4000-8000-000000000006', '7d000000-0000-4000-8000-0000000000f1', '{"name": "Alder Creek"}', 'For an unconfirmed address', 'offered');

set local role service_role;

insert into public.award_invitations (workspace_id, award_id, email, organization_name, token_hash, expires_at, created_by) values
  ('7d000000-0000-4000-8000-0000000000f1', '7d500000-0000-4000-8000-000000000001', 'jo.grant@alder.example', 'Alder Creek', repeat('a', 43), now() + interval '14 days', '7da00000-0000-4000-8000-000000000002'),
  ('7d000000-0000-4000-8000-0000000000f1', '7d500000-0000-4000-8000-000000000002', 'jo.grant@alder.example', 'Alder Creek', repeat('b', 43), now() - interval '1 second', '7da00000-0000-4000-8000-000000000002'),
  ('7d000000-0000-4000-8000-0000000000f1', '7d500000-0000-4000-8000-000000000006', 'pending@alder.example', 'Alder Creek', repeat('f', 43), now() + interval '14 days', '7da00000-0000-4000-8000-000000000002');
select pass('the service role can write invitations');

select throws_ok($$ insert into public.award_invitations (workspace_id, award_id, email, organization_name, token_hash, expires_at, created_by) values ('7d000000-0000-4000-8000-0000000000f1', '7d500000-0000-4000-8000-000000000003', 'x@y.example', 'X', repeat('c', 43), now(), '7da00000-0000-4000-8000-000000000002') $$,
  '23514', null, 'an invitation cannot name another workspace''s award');
select throws_ok($$ insert into public.award_invitations (workspace_id, award_id, email, organization_name, token_hash, expires_at, created_by) values ('7d000000-0000-4000-8000-0000000000f2', '7d500000-0000-4000-8000-000000000003', 'X@Y.example', 'X', repeat('c', 43), now(), '7da00000-0000-4000-8000-000000000002') $$,
  '23514', null, 'the invited address is stored trimmed and in lower case');
select throws_ok($$ insert into public.award_invitations (workspace_id, award_id, email, organization_name, token_hash, expires_at, created_by) values ('7d000000-0000-4000-8000-0000000000f2', '7d500000-0000-4000-8000-000000000003', 'x@y.example', 'X', 'not-a-hash', now(), '7da00000-0000-4000-8000-000000000002') $$,
  '23514', null, 'only a SHA-256 is stored, never a token');
select throws_ok($$ update public.award_invitations set accepted_at = now(), accepted_by = '7da00000-0000-4000-8000-000000000001', declined_at = now() where award_id = '7d500000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an invitation ends once');

-- Claims that fail change nothing.
select is(public.gms_claim_direct_award(repeat('z', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000001', 'jo.grant@alder.example', 'awarded') ->> 'outcome', 'not_found', 'an unknown token is not found');
select is(public.gms_claim_direct_award(repeat('b', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000001', 'jo.grant@alder.example', 'awarded') ->> 'outcome', 'expired', 'an expired invitation cannot be claimed');
select is(public.gms_claim_direct_award(repeat('a', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000002', 'someone@alder.example', 'awarded') ->> 'outcome', 'email_mismatch', 'another admin of the workspace cannot claim it');
select is(public.gms_claim_direct_award(repeat('a', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000002', 'jo.grant@alder.example', 'awarded') ->> 'outcome', 'email_mismatch', 'a session address that is not the account''s own is not enough');
select is(public.gms_claim_direct_award(repeat('f', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000003', 'pending@alder.example', 'awarded') ->> 'outcome', 'email_mismatch', 'nor an account whose address was never confirmed');
select is(public.gms_claim_direct_award(repeat('a', 43), '7d000000-0000-4000-8000-0000000000a2', '7da00000-0000-4000-8000-000000000001', 'jo.grant@alder.example', 'awarded') ->> 'outcome', 'not_workspace_admin', 'an editor cannot claim for the workspace');
select is(public.gms_claim_direct_award(repeat('a', 43), '7d000000-0000-4000-8000-0000000000f1', '7da00000-0000-4000-8000-000000000001', 'jo.grant@alder.example', 'awarded') ->> 'outcome', 'not_workspace_admin', 'a funder workspace cannot be the recipient');
select is((select status || ':' || coalesce(recipient_workspace_id::text, 'none') from public.awards where id = '7d500000-0000-4000-8000-000000000001'), 'offered:none', 'refused claims leave the award offered to the named recipient');
select is((select count(*)::int from public.consents where funder_workspace_id = '7d000000-0000-4000-8000-0000000000f1'), 0, 'and record no consent');

-- The invited person, signed in with that address in another case, claims for their workspace.
select is(public.gms_claim_direct_award(repeat('a', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000001', '  JO.GRANT@alder.example ', 'awarded') ->> 'outcome', 'claimed', 'the invited person claims it');
select is((select recipient_workspace_id from public.awards where id = '7d500000-0000-4000-8000-000000000001'), '7d000000-0000-4000-8000-0000000000a1'::uuid, 'the award now names the workspace');
select is((select recipient_individual from public.awards where id = '7d500000-0000-4000-8000-000000000001'), null::jsonb, 'and no longer the named recipient');
select is((select status || ':' || cg_status from public.awards where id = '7d500000-0000-4000-8000-000000000001'), 'accepted:awarded', 'the award is accepted');
select is((select basis || ':' || array_to_string(scopes, ',') from public.consents where funder_workspace_id = '7d000000-0000-4000-8000-0000000000f1' and applicant_workspace_id = '7d000000-0000-4000-8000-0000000000a1' and revoked_at is null), 'award:org:read', 'accepting records the consent, basis award');
select ok((select accepted_at is not null and accepted_by = '7da00000-0000-4000-8000-000000000001' and accepted_workspace_id = '7d000000-0000-4000-8000-0000000000a1' from public.award_invitations where award_id = '7d500000-0000-4000-8000-000000000001'), 'the invitation is marked accepted');
select is(public.gms_claim_direct_award(repeat('a', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000001', 'jo.grant@alder.example', 'awarded') ->> 'outcome', 'used', 'a token is single use');

-- A second claim from the same organization does not add a second consent.
reset role;
insert into public.awards (id, workspace_id, recipient_individual, title, status) values
  ('7d500000-0000-4000-8000-000000000004', '7d000000-0000-4000-8000-0000000000f1', '{"name": "Alder Creek"}', 'Second direct award', 'offered'),
  ('7d500000-0000-4000-8000-000000000005', '7d000000-0000-4000-8000-0000000000f1', '{"name": "Alder Creek"}', 'Revoked one', 'offered');
set local role service_role;
insert into public.award_invitations (workspace_id, award_id, email, organization_name, token_hash, expires_at, created_by, revoked_at) values
  ('7d000000-0000-4000-8000-0000000000f1', '7d500000-0000-4000-8000-000000000004', 'jo.grant@alder.example', 'Alder Creek', repeat('d', 43), now() + interval '1 day', '7da00000-0000-4000-8000-000000000002', null),
  ('7d000000-0000-4000-8000-0000000000f1', '7d500000-0000-4000-8000-000000000005', 'jo.grant@alder.example', 'Alder Creek', repeat('e', 43), now() + interval '1 day', '7da00000-0000-4000-8000-000000000002', now());
select is(public.gms_claim_direct_award(repeat('e', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000001', 'jo.grant@alder.example', 'awarded') ->> 'outcome', 'revoked', 'a revoked invitation cannot be claimed');
select is(public.gms_claim_direct_award(repeat('d', 43), '7d000000-0000-4000-8000-0000000000a1', '7da00000-0000-4000-8000-000000000001', 'jo.grant@alder.example', 'awarded'), '{"outcome": "claimed", "consentId": null}'::jsonb, 'a live consent is not recorded twice');
select is((select count(*)::int from public.consents where funder_workspace_id = '7d000000-0000-4000-8000-0000000000f1'), 1, 'one consent per organization and funder');

-- The send limits: each counts in its own window, a refused send counts nothing, a release gives one back.
-- Arguments: workspace, sender, address, recipient digest; limits workspace, sender, address, recipient, instance.
select is(public.gms_claim_award_invitation_send('7d000000-0000-4000-8000-0000000000f1', '7da00000-0000-4000-8000-000000000002', '198.51.100.7', repeat('r', 43), 2, 9, 9, 9, 99) ->> 'outcome', 'ok', 'a first send is counted');
select is(public.gms_claim_award_invitation_send('7d000000-0000-4000-8000-0000000000f1', '7da00000-0000-4000-8000-000000000002', '198.51.100.7', repeat('s', 43), 2, 9, 9, 9, 99) ->> 'outcome', 'ok', 'a second send is counted');
select is(public.gms_claim_award_invitation_send('7d000000-0000-4000-8000-0000000000f1', '7da00000-0000-4000-8000-000000000002', '198.51.100.7', repeat('t', 43), 2, 9, 9, 9, 99) ->> 'outcome', 'workspace', 'the third is refused at a workspace limit of two');
select is(public.gms_claim_award_invitation_send('7d000000-0000-4000-8000-0000000000f2', '7da00000-0000-4000-8000-000000000002', null, repeat('t', 43), 9, 2, 9, 9, 99) ->> 'outcome', 'sender', 'one person is counted across workspaces');
select is(public.gms_claim_award_invitation_send('7d000000-0000-4000-8000-0000000000f2', '7da00000-0000-4000-8000-000000000001', '198.51.100.7', repeat('t', 43), 9, 9, 2, 9, 99) ->> 'outcome', 'address', 'one network address is counted across people');
select is(public.gms_claim_award_invitation_send('7d000000-0000-4000-8000-0000000000f2', '7da00000-0000-4000-8000-000000000001', null, repeat('r', 43), 9, 9, 9, 1, 99) ->> 'outcome', 'recipient', 'one recipient is counted across funders');
select is(public.gms_claim_award_invitation_send('7d000000-0000-4000-8000-0000000000f2', '7da00000-0000-4000-8000-000000000001', null, repeat('u', 43), 9, 9, 9, 9, 2) ->> 'outcome', 'instance', 'and the whole instance has a ceiling');
select is((select count(*)::int from public.award_invitation_sends), 2, 'refused sends counted nothing');
select ok(public.gms_claim_award_invitation_send('7d000000-0000-4000-8000-0000000000f2', '7da00000-0000-4000-8000-000000000001', null, repeat('u', 43), 9, 9, 9, 9, 99) ->> 'outcome' = 'ok', 'another funder, person and recipient still has a place');
select public.gms_release_award_invitation_send((select id from public.award_invitation_sends where recipient_digest = repeat('u', 43)));
select is((select count(*)::int from public.award_invitation_sends), 2, 'a released send is given back');
select ok((select bool_and(recipient_digest ~ '^[A-Za-z0-9_-]{43}$') from public.award_invitation_sends), 'only a digest of the recipient is kept');

reset role;
select ok(not has_table_privilege('authenticated', 'public.award_invitations', 'SELECT') and not has_table_privilege('anon', 'public.award_invitations', 'SELECT')
          and not has_table_privilege('authenticated', 'public.award_invitation_sends', 'SELECT'),
  'signed-in users and anon cannot read invitations or counts');
select ok(not has_function_privilege('authenticated', 'public.gms_claim_direct_award(text, uuid, uuid, text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.gms_claim_award_invitation_send(uuid, uuid, text, text, integer, integer, integer, integer, integer)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.gms_release_award_invitation_send(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.gms_claim_direct_award(text, uuid, uuid, text, text)', 'EXECUTE'),
  'only the service role may claim or count');

select * from finish();
rollback;
