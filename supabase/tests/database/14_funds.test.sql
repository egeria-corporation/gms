-- Funds (0039): every funder workspace has a default fund, programs always belong to a fund of their
-- own workspace, only funder workspaces hold funds, and through row-level security a fund advisor
-- (a member whose scope names fundIds) reads their funds and those funds' programs only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('14000000-0000-4000-8000-0000000000a1', 'admin@fd-funder.example',   'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000a2', 'advisor@fd-funder.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000a3', 'officer@fd-funder.example', 'authenticated', 'authenticated'),
  ('14000000-0000-4000-8000-0000000000a4', 'scoped-admin@fd-funder.example', 'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('14000000-0000-7000-8000-000000000001', 'funder',    'fd-funder',    'FD Funder'),
  ('14000000-0000-7000-8000-000000000002', 'funder',    'fd-funder-b',  'FD Funder B'),
  ('14000000-0000-7000-8000-000000000003', 'applicant', 'fd-applicant', 'FD Applicant');

select is((select count(*)::int from public.funds where workspace_id in ('14000000-0000-7000-8000-000000000001', '14000000-0000-7000-8000-000000000002') and is_default and name = 'Default fund' and slug = 'default'), 2, 'a new funder workspace starts with its default fund');
select is((select count(*)::int from public.funds where workspace_id = '14000000-0000-7000-8000-000000000003'), 0, 'an applicant workspace has no funds');

insert into public.funds (id, workspace_id, name, slug) values
  ('14000000-0000-7000-8000-0000000000f1', '14000000-0000-7000-8000-000000000001', 'Riverside Arts Fund', 'riverside-arts'),
  ('14000000-0000-7000-8000-0000000000f2', '14000000-0000-7000-8000-000000000001', 'Elder Care Fund', 'elder-care');

insert into public.programs (id, workspace_id, name) values ('14000000-0000-7000-8000-0000000000b0', '14000000-0000-7000-8000-000000000001', 'No fund named');
insert into public.programs (id, workspace_id, fund_id, name) values
  ('14000000-0000-7000-8000-0000000000b1', '14000000-0000-7000-8000-000000000001', '14000000-0000-7000-8000-0000000000f1', 'Murals'),
  ('14000000-0000-7000-8000-0000000000b2', '14000000-0000-7000-8000-000000000001', '14000000-0000-7000-8000-0000000000f2', 'Home visits');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('14000000-0000-7000-8000-000000000001', '14000000-0000-4000-8000-0000000000a1', 'admin', '{}'),
  ('14000000-0000-7000-8000-000000000001', '14000000-0000-4000-8000-0000000000a2', 'program_officer', '{"fundIds": ["14000000-0000-7000-8000-0000000000f1"]}'),
  ('14000000-0000-7000-8000-000000000001', '14000000-0000-4000-8000-0000000000a3', 'program_officer', '{}'),
  ('14000000-0000-7000-8000-000000000001', '14000000-0000-4000-8000-0000000000a4', 'admin', '{"fundIds": ["14000000-0000-7000-8000-0000000000f1"]}');

-- ---------------------------------------------------------------- programs belong to a fund
select is((select f.is_default from public.programs p join public.funds f on f.id = p.fund_id where p.id = '14000000-0000-7000-8000-0000000000b0'), true, 'a program inserted without a fund lands in the default fund');

set local role service_role;
select throws_ok(
  $$ update public.programs set fund_id = null where id = '14000000-0000-7000-8000-0000000000b1' $$,
  '23514', null, 'a program cannot lose its fund, the service role included'
);
select throws_ok(
  $$ update public.programs set fund_id = (select id from public.funds where workspace_id = '14000000-0000-7000-8000-000000000002' and is_default) where id = '14000000-0000-7000-8000-0000000000b1' $$,
  '23514', 'programs.fund_id names a row of another workspace', 'a program cannot name another workspace''s fund'
);
select throws_ok(
  $$ insert into public.funds (workspace_id, name, slug) values ('14000000-0000-7000-8000-000000000003', 'Applicant fund', 'nope') $$,
  '23514', 'funds: only a funder workspace has funds', 'an applicant workspace cannot hold a fund'
);
select throws_ok(
  $$ insert into public.funds (workspace_id, name, slug) values ('14000000-0000-7000-8000-000000000001', 'Second arts', 'riverside-arts') $$,
  '23505', null, 'a fund''s slug is unique within its workspace'
);
select throws_ok(
  $$ insert into public.funds (workspace_id, name, slug, is_default) values ('14000000-0000-7000-8000-000000000001', 'Another default', 'another', true) $$,
  '23505', null, 'a workspace has one default fund'
);
select throws_ok(
  $$ insert into public.funds (workspace_id, name, slug) values ('14000000-0000-7000-8000-000000000001', 'Bad slug', 'Bad Slug!') $$,
  '23514', null, 'a slug is lowercase letters, digits and hyphens'
);
select throws_ok(
  $$ update public.funds set workspace_id = '14000000-0000-7000-8000-000000000002' where id = '14000000-0000-7000-8000-0000000000f1' $$,
  '23514', null, 'a fund never moves to another workspace'
);
select throws_ok(
  $$ delete from public.funds where id = '14000000-0000-7000-8000-0000000000f2' $$,
  '23503', null, 'a fund that holds programs cannot be deleted'
);
select is(gms.default_fund_of('14000000-0000-7000-8000-000000000001'), (select id from public.funds where workspace_id = '14000000-0000-7000-8000-000000000001' and is_default), 'default_fund_of returns the existing default, never a second one');
reset role;

-- ---------------------------------------------------------------- row-level security
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select results_eq($$ select slug from public.funds order by slug $$, array['riverside-arts'], 'a fund advisor reads their own fund only');
select results_eq($$ select name from public.programs order by name $$, array['Murals'], 'a fund advisor reads their fund''s programs only');

select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is((select count(*)::int from public.funds), 3, 'an unscoped program officer reads every fund of the workspace');

select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
select is((select count(*)::int from public.programs), 3, 'an admin reads every program, whatever their scope says');

select set_config('request.jwt.claims', '{"sub":"14000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from public.funds where workspace_id = '14000000-0000-7000-8000-000000000002'), 0, 'nobody reads another workspace''s funds');
reset role;

select * from finish();
rollback;
