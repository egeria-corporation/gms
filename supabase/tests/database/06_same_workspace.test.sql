-- A child row belongs to the workspace of the row it hangs off (0020). No writer, the service role
-- included, can make a tranche, agreement, requirement, amendment, budget, competition, application
-- or decision that sits in one workspace and names a parent of another; and no row changes workspace.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into public.workspaces (id, kind, handle, display_name) values
  ('6a000000-0000-4000-8000-0000000000f1', 'funder', 'sw-funder-f', 'Funder F'),
  ('6a000000-0000-4000-8000-0000000000e1', 'funder', 'sw-funder-e', 'Funder E (self-made)'),
  ('6a000000-0000-4000-8000-0000000000a1', 'applicant', 'sw-applicant', 'Applicant');

-- Funder F: an opportunity, a competition, an application, an award with a schedule and a tranche.
insert into public.programs (id, workspace_id, name) values ('6a100000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000f1', 'F program');
insert into public.opportunities (id, workspace_id, slug, title) values ('6a200000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000f1', 'f-opp', 'F opportunity');
insert into public.competitions (id, workspace_id, opportunity_id, title) values ('6a300000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000f1', '6a200000-0000-4000-8000-0000000000f1', 'F competition');
insert into public.applications (id, workspace_id, applicant_workspace_id, competition_id, opportunity_id, stage) values
  ('6a400000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000a1', '6a300000-0000-4000-8000-0000000000f1', '6a200000-0000-4000-8000-0000000000f1', 'loi');
insert into public.awards (id, workspace_id, recipient_workspace_id, title) values
  ('6a500000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000a1', 'F award'),
  ('6a500000-0000-4000-8000-0000000000e1', '6a000000-0000-4000-8000-0000000000e1', '6a000000-0000-4000-8000-0000000000a1', 'E award');
insert into public.payment_schedules (id, workspace_id, award_id) values
  ('6a600000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000f1', '6a500000-0000-4000-8000-0000000000f1'),
  ('6a600000-0000-4000-8000-0000000000e1', '6a000000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000e1');
insert into public.tranches (id, workspace_id, schedule_id, award_id, seq, amount_minor) values
  ('6a700000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000f1', '6a600000-0000-4000-8000-0000000000f1', '6a500000-0000-4000-8000-0000000000f1', 1, 7500000),
  ('6a700000-0000-4000-8000-0000000000e1', '6a000000-0000-4000-8000-0000000000e1', '6a600000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000e1', 1, 100);

select is((select count(*)::int from gms.cross_workspace_children()), 0, 'rows written the ordinary way never break the rule');

-- The service role writes for the API. It is refused like anyone else.
set local role service_role;

select throws_ok($$ insert into public.tranches (workspace_id, schedule_id, award_id, seq, amount_minor, status) values ('6a000000-0000-4000-8000-0000000000e1', '6a600000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000f1', 99, 7500000, 'due') $$,
  '23514', null, 'a tranche in workspace E cannot name an award of workspace F');
select throws_ok($$ insert into public.tranches (workspace_id, schedule_id, award_id, seq, amount_minor) values ('6a000000-0000-4000-8000-0000000000e1', '6a600000-0000-4000-8000-0000000000f1', '6a500000-0000-4000-8000-0000000000e1', 98, 100) $$,
  '23514', null, 'nor a schedule of workspace F');
select throws_ok($$ update public.tranches set award_id = '6a500000-0000-4000-8000-0000000000f1' where id = '6a700000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'an existing tranche cannot be pointed at another workspace''s award');
select throws_ok($$ update public.tranches set workspace_id = '6a000000-0000-4000-8000-0000000000e1' where id = '6a700000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'and a tranche cannot be moved into another workspace');
select throws_ok($$ insert into public.agreements (workspace_id, award_id, version) values ('6a000000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000f1', 99) $$,
  '23514', null, 'an agreement cannot name another workspace''s award');
select throws_ok($$ insert into public.payment_schedules (workspace_id, award_id) values ('6a000000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'nor a payment schedule');
select throws_ok($$ insert into public.requirements (workspace_id, award_id, type, title) values ('6a000000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000f1', 'report', 'x') $$,
  '23514', null, 'nor a requirement');
select throws_ok($$ insert into public.requirements (workspace_id, award_id, type, title, releases_tranche_id) values ('6a000000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000e1', 'report', 'x', '6a700000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'a requirement cannot release another workspace''s tranche');
select throws_ok($$ insert into public.amendments (workspace_id, award_id, type) values ('6a000000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000f1', 'supplemental') $$,
  '23514', null, 'nor an amendment');
select throws_ok($$ insert into public.budgets (workspace_id, award_id, kind) values ('6a000000-0000-4000-8000-0000000000e1', '6a500000-0000-4000-8000-0000000000f1', 'approved') $$,
  '23514', null, 'nor a budget');
select throws_ok($$ insert into public.submissions (workspace_id, requirement_id, award_id) select '6a000000-0000-4000-8000-0000000000e1', null, '6a500000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'nor a report submission');
select throws_ok($$ insert into public.competitions (workspace_id, opportunity_id, title, status) values ('6a000000-0000-4000-8000-0000000000e1', '6a200000-0000-4000-8000-0000000000f1', 'Planted', 'open') $$,
  '23514', null, 'a competition cannot be planted on another workspace''s opportunity');
select throws_ok($$ insert into public.decisions (workspace_id, competition_id, application_id, outcome) values ('6a000000-0000-4000-8000-0000000000e1', '6a300000-0000-4000-8000-0000000000f1', '6a400000-0000-4000-8000-0000000000f1', 'decline') $$,
  '23514', null, 'nor a decision on another workspace''s application');
select throws_ok($$ insert into public.application_events (workspace_id, application_id, type, actor) values ('6a000000-0000-4000-8000-0000000000e1', '6a400000-0000-4000-8000-0000000000f1', 'note', 'x') $$,
  '23514', null, 'nor an application event');
select throws_ok($$ insert into public.awards (workspace_id, recipient_workspace_id, title, application_id) values ('6a000000-0000-4000-8000-0000000000e1', '6a000000-0000-4000-8000-0000000000a1', 'x', '6a400000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'an award cannot claim another workspace''s application');
select throws_ok($$ insert into public.awards (workspace_id, recipient_workspace_id, title, parent_award_id) values ('6a000000-0000-4000-8000-0000000000e1', '6a000000-0000-4000-8000-0000000000a1', 'x', '6a500000-0000-4000-8000-0000000000f1') $$,
  '23514', null, 'nor be a supplement to another workspace''s award');
select throws_ok($$ update public.awards set workspace_id = '6a000000-0000-4000-8000-0000000000e1' where id = '6a500000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'and an award cannot be moved to another workspace');

-- The ordinary writes still work.
select lives_ok($$ insert into public.tranches (workspace_id, schedule_id, award_id, seq, amount_minor) values ('6a000000-0000-4000-8000-0000000000f1', '6a600000-0000-4000-8000-0000000000f1', '6a500000-0000-4000-8000-0000000000f1', 2, 100) $$, 'a tranche on the workspace''s own award is written');
select lives_ok($$ update public.tranches set status = 'due' where id = '6a700000-0000-4000-8000-0000000000f1' $$, 'and status changes are untouched by the rule');
select lives_ok($$ insert into public.requirements (workspace_id, award_id, type, title, releases_tranche_id) values ('6a000000-0000-4000-8000-0000000000f1', '6a500000-0000-4000-8000-0000000000f1', 'report', 'Interim', '6a700000-0000-4000-8000-0000000000f1') $$, 'a requirement that releases its own award''s tranche is written');
reset role;

-- A signed-in person cannot ask for the operator's listing.
set local role authenticated;
select throws_ok($$ select count(*) from gms.cross_workspace_children() $$, '42501', null, 'the listing of rule-breaking rows is not for tenants');
reset role;

select * from finish();
rollback;
