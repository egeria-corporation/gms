-- Syndication (0045): syndication_sends is private to the funder workspace that owns the call.
-- Writes run as the service role (the API's role); reads are checked as signed-in staff of the
-- owning workspace, a reviewer of it, another funder and an applicant. One submission per call and
-- listing service.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('45000000-0000-4000-8000-0000000000a1', 'admin@syn-funder-x.example',    'authenticated', 'authenticated'),
  ('45000000-0000-4000-8000-0000000000a2', 'officer@syn-funder-x.example',  'authenticated', 'authenticated'),
  ('45000000-0000-4000-8000-0000000000a3', 'reviewer@syn-funder-x.example', 'authenticated', 'authenticated'),
  ('45000000-0000-4000-8000-0000000000b1', 'admin@syn-funder-y.example',    'authenticated', 'authenticated'),
  ('45000000-0000-4000-8000-0000000000c1', 'admin@syn-applicant.example',   'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('45000000-0000-7000-8000-000000000001', 'funder',    'syn-funder-x',  'Syndication Funder X'),
  ('45000000-0000-7000-8000-000000000002', 'funder',    'syn-funder-y',  'Syndication Funder Y'),
  ('45000000-0000-7000-8000-000000000003', 'applicant', 'syn-applicant', 'Syndication Applicant');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('45000000-0000-7000-8000-000000000001', '45000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('45000000-0000-7000-8000-000000000001', '45000000-0000-4000-8000-0000000000a2', 'program_officer', '{}'),
  ('45000000-0000-7000-8000-000000000001', '45000000-0000-4000-8000-0000000000a3', 'reviewer', '{}'),
  ('45000000-0000-7000-8000-000000000002', '45000000-0000-4000-8000-0000000000b1', 'admin', '{}'),
  ('45000000-0000-7000-8000-000000000003', '45000000-0000-4000-8000-0000000000c1', 'admin', '{}');

insert into public.opportunities (id, workspace_id, slug, title, description, status) values
  ('45000000-0000-7000-8000-0000000000a1', '45000000-0000-7000-8000-000000000001', 'x-call', 'X call', 'Grants for X.', 'open'),
  ('45000000-0000-7000-8000-0000000000a2', '45000000-0000-7000-8000-000000000001', 'x-call-2', 'X second call', 'More grants for X.', 'open'),
  ('45000000-0000-7000-8000-0000000000b1', '45000000-0000-7000-8000-000000000002', 'y-call', 'Y call', 'Grants for Y.', 'open');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

insert into public.syndication_sends (workspace_id, opportunity_id, target, sent_by, to_address, reply_to_masked, digest, sent_at) values
  ('45000000-0000-7000-8000-000000000001', '45000000-0000-7000-8000-0000000000a1', 'pnd', '45000000-0000-4000-8000-0000000000a2', 'pndrfp@candid.org', 'g…@syn-funder-x.example', repeat('a', 64), now()),
  ('45000000-0000-7000-8000-000000000002', '45000000-0000-7000-8000-0000000000b1', 'pnd', '45000000-0000-4000-8000-0000000000b1', 'pndrfp@candid.org', 'g…@syn-funder-y.example', repeat('b', 64), now());
select pass('the service role records a submission');

select throws_ok(
  $$ insert into public.syndication_sends (workspace_id, opportunity_id, target, sent_by, to_address, reply_to_masked, digest)
     values ('45000000-0000-7000-8000-000000000001', '45000000-0000-7000-8000-0000000000a1', 'pnd', '45000000-0000-4000-8000-0000000000a1', 'pndrfp@candid.org', 'g…@syn-funder-x.example', repeat('c', 64)) $$,
  '23505', null, 'a call is sent to the same service once'
);
select lives_ok(
  $$ insert into public.syndication_sends (workspace_id, opportunity_id, target, sent_by, to_address, reply_to_masked, digest)
     values ('45000000-0000-7000-8000-000000000001', '45000000-0000-7000-8000-0000000000a2', 'pnd', '45000000-0000-4000-8000-0000000000a1', 'pndrfp@candid.org', 'g…@syn-funder-x.example', repeat('c', 64)) $$,
  'another call of the same funder has its own submission'
);
select throws_ok(
  $$ insert into public.syndication_sends (workspace_id, opportunity_id, target, sent_by, to_address, reply_to_masked, digest)
     values ('45000000-0000-7000-8000-000000000001', '45000000-0000-7000-8000-0000000000b1', 'pnd', '45000000-0000-4000-8000-0000000000a1', 'pndrfp@candid.org', 'g…@syn-funder-x.example', repeat('d', 64)) $$,
  '23514', null, 'a submission cannot name another workspace''s call'
);
select throws_ok(
  $$ insert into public.syndication_sends (workspace_id, opportunity_id, target, sent_by, to_address, reply_to_masked, digest)
     values ('45000000-0000-7000-8000-000000000001', '45000000-0000-7000-8000-0000000000a2', 'newsletter', '45000000-0000-4000-8000-0000000000a1', 'pndrfp@candid.org', 'g…@syn-funder-x.example', repeat('d', 64)) $$,
  '23514', null, 'only a known listing service is a target'
);
select throws_ok(
  $$ insert into public.syndication_sends (workspace_id, opportunity_id, target, sent_by, to_address, reply_to_masked, digest)
     values ('45000000-0000-7000-8000-000000000002', '45000000-0000-7000-8000-0000000000b1', 'pnd', '45000000-0000-4000-8000-0000000000b1', 'pndrfp@candid.org', 'grants@syn-funder-y.example', repeat('d', 64)) $$,
  '23514', null, 'the reply-to address is stored masked, never in full'
);
select throws_ok(
  $$ insert into public.syndication_sends (workspace_id, opportunity_id, target, sent_by, to_address, reply_to_masked, digest)
     values ('45000000-0000-7000-8000-000000000002', '45000000-0000-7000-8000-0000000000b1', 'pnd', '45000000-0000-4000-8000-0000000000b1', 'pndrfp@candid.org', 'g…@syn-funder-y.example', 'not-a-digest') $$,
  '23514', null, 'the digest is a SHA-256'
);
select throws_ok(
  $$ update public.syndication_sends set workspace_id = '45000000-0000-7000-8000-000000000002' where opportunity_id = '45000000-0000-7000-8000-0000000000a1' $$,
  null, null, 'a submission cannot move to another workspace'
);

-- ---------------------------------------------------------------- who reads
reset role;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"45000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.syndication_sends), 2, 'the funder''s admin reads its workspace''s submissions');

select set_config('request.jwt.claims', '{"sub":"45000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.syndication_sends), 2, 'its program officer reads them too');

select set_config('request.jwt.claims', '{"sub":"45000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is((select count(*)::int from public.syndication_sends), 0, 'a reviewer of the workspace reads none');

select set_config('request.jwt.claims', '{"sub":"45000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from public.syndication_sends where workspace_id = '45000000-0000-7000-8000-000000000001'), 0, 'another funder reads none of them');

select set_config('request.jwt.claims', '{"sub":"45000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from public.syndication_sends), 0, 'an applicant reads none');

select throws_ok(
  $$ insert into public.syndication_sends (workspace_id, opportunity_id, target, sent_by, to_address, reply_to_masked, digest)
     values ('45000000-0000-7000-8000-000000000003', '45000000-0000-7000-8000-0000000000a2', 'pnd', '45000000-0000-4000-8000-0000000000c1', 'pndrfp@candid.org', 'g…@syn.example', repeat('e', 64)) $$,
  '42501', null, 'a signed-in person cannot write a submission'
);

select * from finish();
rollback;
