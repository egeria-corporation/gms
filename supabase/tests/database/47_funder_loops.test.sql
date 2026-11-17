-- Funder loops (0047): peer invitations, referral links and joins, directory listings. Writes run
-- as the service role (the API's role); reads are checked as signed-in staff of the owning
-- workspace, another workspace, a reviewer of the same workspace and an anonymous visitor.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('47000000-0000-4000-8000-0000000000a1', 'admin@loops-funder-a.example',  'authenticated', 'authenticated'),
  ('47000000-0000-4000-8000-0000000000a2', 'reviewer@loops-funder-a.example', 'authenticated', 'authenticated'),
  ('47000000-0000-4000-8000-0000000000b1', 'admin@loops-funder-b.example',  'authenticated', 'authenticated'),
  ('47000000-0000-4000-8000-0000000000c1', 'admin@loops-applicant.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('47000000-0000-7000-8000-000000000001', 'funder',    'loops-funder-a',  'Loops Funder A'),
  ('47000000-0000-7000-8000-000000000002', 'funder',    'loops-funder-b',  'Loops Funder B'),
  ('47000000-0000-7000-8000-000000000003', 'applicant', 'loops-applicant', 'Loops Applicant'),
  ('47000000-0000-7000-8000-000000000004', 'funder',    'loops-joined',    'Loops Joined Funder');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('47000000-0000-7000-8000-000000000001', '47000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('47000000-0000-7000-8000-000000000001', '47000000-0000-4000-8000-0000000000a2', 'reviewer', '{}'),
  ('47000000-0000-7000-8000-000000000002', '47000000-0000-4000-8000-0000000000b1', 'admin', '{}'),
  ('47000000-0000-7000-8000-000000000003', '47000000-0000-4000-8000-0000000000c1', 'admin', '{}');

-- ---------------------------------------------------------------- the service role writes
set local role service_role;

insert into public.peer_invitations (id, workspace_id, invited_by, email_masked, email_hash, token_hash, week_start, slot, status, sent_at) values
  ('47000000-0000-7000-8000-0000000000e1', '47000000-0000-7000-8000-000000000001', '47000000-0000-4000-8000-0000000000a1', 'p…@peer.example', repeat('a', 64), repeat('1', 64), '2027-04-12', 1, 'sent', now()),
  ('47000000-0000-7000-8000-0000000000e2', '47000000-0000-7000-8000-000000000002', '47000000-0000-4000-8000-0000000000b1', 'p…@peer.example', repeat('a', 64), repeat('2', 64), '2027-04-12', 1, 'sent', now());
select pass('the service role records an invitation');

select throws_ok(
  $$ insert into public.peer_invitations (workspace_id, invited_by, email_masked, email_hash, token_hash, week_start, slot) values
     ('47000000-0000-7000-8000-000000000001', '47000000-0000-4000-8000-0000000000a1', 'p…@peer.example', repeat('a', 64), repeat('3', 64), '2027-04-19', 1) $$,
  '23505', null, 'one workspace never invites the same address twice'
);
select throws_ok(
  $$ insert into public.peer_invitations (workspace_id, invited_by, email_masked, email_hash, token_hash, week_start, slot) values
     ('47000000-0000-7000-8000-000000000001', '47000000-0000-4000-8000-0000000000a1', 'q…@peer.example', repeat('b', 64), repeat('4', 64), '2027-04-12', 1) $$,
  '23505', null, 'one week''s place is taken once'
);
select throws_ok(
  $$ insert into public.peer_invitations (workspace_id, invited_by, email_masked, email_hash, token_hash, week_start, slot) values
     ('47000000-0000-7000-8000-000000000001', '47000000-0000-4000-8000-0000000000a1', 'quinn@peer.example', repeat('c', 64), repeat('5', 64), '2027-04-12', 2) $$,
  '23514', null, 'the address is stored masked only'
);
select throws_ok(
  $$ insert into public.peer_invitations (workspace_id, invited_by, email_masked, email_hash, token_hash, week_start, slot) values
     ('47000000-0000-7000-8000-000000000001', '47000000-0000-4000-8000-0000000000a1', 'q…@peer.example', repeat('c', 64), repeat('5', 64), '2027-04-14', 2) $$,
  '23514', null, 'a week starts on a Monday'
);
select throws_ok(
  $$ insert into public.peer_invitations (workspace_id, invited_by, email_masked, email_hash, token_hash, week_start, slot) values
     ('47000000-0000-7000-8000-000000000003', '47000000-0000-4000-8000-0000000000c1', 'q…@peer.example', repeat('c', 64), repeat('5', 64), '2027-04-12', 2) $$,
  '23514', null, 'invitations belong to funder workspaces'
);
select throws_ok(
  $$ update public.peer_invitations set status = 'joined' where id = '47000000-0000-7000-8000-0000000000e1' $$,
  '23514', null, 'joined needs a first join and a count'
);
select lives_ok(
  $$ update public.peer_invitations set status = 'joined', joined_count = 1, first_joined_at = now() where id = '47000000-0000-7000-8000-0000000000e1' $$,
  'an invitation is marked joined with its count'
);
select throws_ok(
  $$ update public.peer_invitations set workspace_id = '47000000-0000-7000-8000-000000000002' where id = '47000000-0000-7000-8000-0000000000e1' $$,
  null, null, 'an invitation never moves to another workspace'
);

insert into public.referral_links (id, workspace_id, kind, token) values
  ('47000000-0000-7000-8000-0000000000f1', '47000000-0000-7000-8000-000000000003', 'package', 'pkgtoken0000000000aa'),
  ('47000000-0000-7000-8000-0000000000f2', '47000000-0000-7000-8000-000000000001', 'onboarding', 'jointoken000000000aa');
select pass('the service role records a package link and an onboarding link');
select throws_ok(
  $$ insert into public.referral_links (workspace_id, kind, token) values ('47000000-0000-7000-8000-000000000001', 'package', 'pkgtoken0000000000bb') $$,
  '23514', null, 'a package link belongs to an applicant workspace'
);
select throws_ok(
  $$ insert into public.referral_links (workspace_id, kind, token) values ('47000000-0000-7000-8000-000000000003', 'onboarding', 'jointoken000000000bb') $$,
  '23514', null, 'an onboarding link belongs to a funder workspace'
);
select throws_ok(
  $$ insert into public.referral_links (workspace_id, kind, token) values ('47000000-0000-7000-8000-000000000001', 'onboarding', 'jointoken000000000cc') $$,
  '23505', null, 'one live onboarding link per workspace'
);
select lives_ok(
  $$ update public.referral_links set revoked_at = now() where id = '47000000-0000-7000-8000-0000000000f2';
     insert into public.referral_links (workspace_id, kind, token) values ('47000000-0000-7000-8000-000000000001', 'onboarding', 'jointoken000000000dd') $$,
  'a new link replaces a revoked one'
);
select throws_ok(
  $$ update public.referral_links set logo_storage = 'r2', logo_path = 'onboarding-logos/x/y', logo_mime = 'image/png', logo_sha256 = repeat('e', 64) where token = 'jointoken000000000dd' $$,
  '23514', null, 'a logo needs its alt text'
);
select throws_ok(
  $$ update public.referral_links set logo_storage = 'r2', logo_path = 'onboarding-logos/x/y', logo_mime = 'image/svg+xml', logo_sha256 = repeat('e', 64), logo_alt = 'Logo' where token = 'jointoken000000000dd' $$,
  '23514', null, 'only png, jpeg and webp logos'
);
select lives_ok(
  $$ update public.referral_links set logo_storage = 'r2', logo_path = 'onboarding-logos/x/y', logo_mime = 'image/png', logo_sha256 = repeat('e', 64), logo_alt = 'Loops Funder A logo' where token = 'jointoken000000000dd' $$,
  'a logo with its alt text'
);
select throws_ok(
  $$ update public.referral_links set logo_storage = 'r2', logo_path = 'p', logo_mime = 'image/png', logo_sha256 = repeat('e', 64), logo_alt = 'x' where token = 'pkgtoken0000000000aa' $$,
  '23514', null, 'a package link carries no logo'
);

insert into public.referral_joins (joined_workspace_id, joined_kind, joined_by, source, source_workspace_id, peer_invitation_id) values
  ('47000000-0000-7000-8000-000000000004', 'funder', '47000000-0000-4000-8000-0000000000b1', 'peer_invitation', '47000000-0000-7000-8000-000000000001', '47000000-0000-7000-8000-0000000000e1');
select pass('the service role records a join');
select throws_ok(
  $$ insert into public.referral_joins (joined_workspace_id, joined_kind, joined_by, source, source_workspace_id, referral_link_id) values
     ('47000000-0000-7000-8000-000000000004', 'funder', '47000000-0000-4000-8000-0000000000b1', 'package', '47000000-0000-7000-8000-000000000003', '47000000-0000-7000-8000-0000000000f1') $$,
  '23505', null, 'a workspace is counted once'
);
select throws_ok(
  $$ insert into public.referral_joins (joined_workspace_id, joined_kind, joined_by, source, source_workspace_id, referral_link_id) values
     ('47000000-0000-7000-8000-000000000003', 'applicant', '47000000-0000-4000-8000-0000000000c1', 'package', '47000000-0000-7000-8000-000000000003', '47000000-0000-7000-8000-0000000000f1') $$,
  '23514', null, 'a package link brings funders only, and never counts its own workspace'
);

insert into public.directory_listings (workspace_id, region, submitted_by) values
  ('47000000-0000-7000-8000-000000000001', 'Pacific Northwest', '47000000-0000-4000-8000-0000000000a1');
select pass('the service role records a listing request');
select throws_ok(
  $$ insert into public.directory_listings (workspace_id, region, submitted_by) values ('47000000-0000-7000-8000-000000000003', 'Oregon', '47000000-0000-4000-8000-0000000000c1') $$,
  '23514', null, 'listings belong to funder workspaces'
);
select throws_ok(
  $$ update public.directory_listings set status = 'rejected', decided_at = now(), decided_by = '47000000-0000-4000-8000-0000000000b1' where workspace_id = '47000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'a decline needs a reason'
);
select throws_ok(
  $$ update public.directory_listings set status = 'withdrawn' where workspace_id = '47000000-0000-7000-8000-000000000001' $$,
  '23514', null, 'a withdrawal records when'
);

-- ---------------------------------------------------------------- signed-in people read
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.peer_invitations), 1, 'an admin reads their workspace''s invitations only');
select is((select count(*)::int from public.referral_links), 2, 'and its links');
select throws_ok($$ select count(*) from public.referral_joins $$, '42501', null, 'joins are the API''s alone');

select set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.peer_invitations) + (select count(*)::int from public.directory_listings), 0, 'a reviewer of the workspace reads none');

select set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.directory_listings (workspace_id, region, submitted_by) values ('47000000-0000-7000-8000-000000000002', 'Oregon', '47000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'a signed-in admin cannot write a listing directly (only the API does)'
);

set local role anon;
select throws_ok($$ select count(*) from public.directory_listings $$, '42501', null, 'anonymous visitors read nothing');

select * from finish();
rollback;
