-- Opt-in content digests (0041): every member starts with all three off, the choice belongs to
-- one membership and goes with it, each digest only fits its kind of workspace, a person, digest
-- and ISO week is sent once, and a member reads only their own rows in a workspace they belong to.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('41000000-0000-4000-8000-0000000000a1', 'maria@cd-applicant.example', 'authenticated', 'authenticated'),
  ('41000000-0000-4000-8000-0000000000a2', 'jamal@cd-applicant.example', 'authenticated', 'authenticated'),
  ('41000000-0000-4000-8000-0000000000f1', 'dana@cd-funder.example',     'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('41000000-0000-7000-8000-000000000001', 'applicant', 'cd-applicant', 'CD Applicant'),
  ('41000000-0000-7000-8000-000000000002', 'funder',    'cd-funder',    'CD Funder');

insert into public.workspace_members (id, workspace_id, user_id, role) values
  ('41000000-0000-7000-8000-0000000000b1', '41000000-0000-7000-8000-000000000001', '41000000-0000-4000-8000-0000000000a1', 'admin'),
  ('41000000-0000-7000-8000-0000000000b2', '41000000-0000-7000-8000-000000000001', '41000000-0000-4000-8000-0000000000a2', 'editor'),
  ('41000000-0000-7000-8000-0000000000b3', '41000000-0000-7000-8000-000000000002', '41000000-0000-4000-8000-0000000000f1', 'program_officer');

-- ---------------------------------------------------------------- defaults and shape (service role)
set local role service_role;

insert into public.digest_subscriptions (workspace_id, member_id, user_id) values
  ('41000000-0000-7000-8000-000000000001', '41000000-0000-7000-8000-0000000000b1', '41000000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select new_matches, deadlines, funder_activity, prompt_dismissed_at is null from public.digest_subscriptions where member_id = '41000000-0000-7000-8000-0000000000b1' $$,
  $$ values (false, false, false, true) $$,
  'a new row has every digest off and the prompt not yet dismissed'
);

update public.digest_subscriptions set new_matches = true, deadlines = true where member_id = '41000000-0000-7000-8000-0000000000b1';
select is((select new_matches and deadlines from public.digest_subscriptions where member_id = '41000000-0000-7000-8000-0000000000b1'), true, 'an applicant member turns on new matches and deadlines');

select throws_ok(
  $$ insert into public.digest_subscriptions (workspace_id, member_id, user_id) values
     ('41000000-0000-7000-8000-000000000001', '41000000-0000-7000-8000-0000000000b1', '41000000-0000-4000-8000-0000000000a1') $$,
  '23505', null, 'one row per membership'
);
select throws_ok(
  $$ insert into public.digest_subscriptions (workspace_id, member_id, user_id) values
     ('41000000-0000-7000-8000-000000000002', '41000000-0000-7000-8000-0000000000b2', '41000000-0000-4000-8000-0000000000a2') $$,
  '23514', null, 'a row cannot name a membership of another workspace'
);
select throws_ok(
  $$ insert into public.digest_subscriptions (workspace_id, member_id, user_id) values
     ('41000000-0000-7000-8000-000000000001', '41000000-0000-7000-8000-0000000000b2', '41000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a row cannot name another person''s membership'
);
select throws_ok(
  $$ insert into public.digest_subscriptions (workspace_id, member_id, user_id, funder_activity) values
     ('41000000-0000-7000-8000-000000000001', '41000000-0000-7000-8000-0000000000b2', '41000000-0000-4000-8000-0000000000a2', true) $$,
  '23514', null, 'funder activity is not offered in an applicant workspace'
);
select throws_ok(
  $$ insert into public.digest_subscriptions (workspace_id, member_id, user_id, new_matches) values
     ('41000000-0000-7000-8000-000000000002', '41000000-0000-7000-8000-0000000000b3', '41000000-0000-4000-8000-0000000000f1', true) $$,
  '23514', null, 'new matches are not offered in a funder workspace'
);
insert into public.digest_subscriptions (workspace_id, member_id, user_id, funder_activity) values
  ('41000000-0000-7000-8000-000000000002', '41000000-0000-7000-8000-0000000000b3', '41000000-0000-4000-8000-0000000000f1', true);
select is((select count(*)::int from public.digest_subscriptions where funder_activity), 1, 'funder staff turn on the week''s activity');

-- Sends: once per person, digest and ISO week.
insert into public.digest_sends (workspace_id, user_id, digest, iso_week, item_keys) values
  ('41000000-0000-7000-8000-000000000001', '41000000-0000-4000-8000-0000000000a1', 'new_matches', '2027-W16', array['og:og-1', 'gms:41000000-0000-7000-8000-0000000000c1']);
select throws_ok(
  $$ insert into public.digest_sends (workspace_id, user_id, digest, iso_week) values
     ('41000000-0000-7000-8000-000000000001', '41000000-0000-4000-8000-0000000000a1', 'new_matches', '2027-W16') $$,
  '23505', null, 'the same digest is not sent twice in one ISO week'
);
select lives_ok(
  $$ insert into public.digest_sends (workspace_id, user_id, digest, iso_week) values
     ('41000000-0000-7000-8000-000000000001', '41000000-0000-4000-8000-0000000000a1', 'deadlines', '2027-W16') $$,
  'another digest the same week is its own send'
);
select throws_ok(
  $$ insert into public.digest_sends (workspace_id, user_id, digest, iso_week) values
     ('41000000-0000-7000-8000-000000000001', '41000000-0000-4000-8000-0000000000a1', 'newsletter', '2027-W17') $$,
  '23514', null, 'only the three digests are recorded'
);
select throws_ok(
  $$ insert into public.digest_sends (workspace_id, user_id, digest, iso_week) values
     ('41000000-0000-7000-8000-000000000001', '41000000-0000-4000-8000-0000000000a1', 'deadlines', '2027-16') $$,
  '23514', null, 'the week is an ISO week'
);

-- ---------------------------------------------------------------- what a member reads
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.digest_subscriptions), 1, 'a member reads their own choices only');
select is((select count(*)::int from public.digest_sends), 2, 'and their own sends');
select throws_ok(
  $$ update public.digest_subscriptions set new_matches = false $$,
  '42501', null, 'a member cannot write the table directly'
);
select set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.digest_subscriptions) + (select count(*)::int from public.digest_sends), 0, 'a teammate reads none of them');

-- ---------------------------------------------------------------- removal
reset role;
delete from public.workspace_members where id = '41000000-0000-7000-8000-0000000000b1';
select is((select count(*)::int from public.digest_subscriptions where member_id = '41000000-0000-7000-8000-0000000000b1'), 0, 'removing the member removes their choices');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"41000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.digest_sends), 0, 'a person removed from the workspace no longer reads its sends');

select * from finish();
rollback;
