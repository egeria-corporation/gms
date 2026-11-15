-- The template gallery (0036): the starter library, what the tables refuse, and who reads what.
-- Writes run as the service role (the API's role); reads are checked as an anonymous visitor, the
-- author's staff, another funder's staff, the author's external reviewer and an applicant.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('13000000-0000-4000-8000-0000000000f1', 'admin@tg-funder.example',     'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000f2', 'reviewer@tg-funder.example',  'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000e1', 'admin@tg-other.example',      'authenticated', 'authenticated'),
  ('13000000-0000-4000-8000-0000000000a1', 'admin@tg-applicant.example',  'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('13000000-0000-7000-8000-000000000001', 'funder',    'tg-funder',    'TG Funder'),
  ('13000000-0000-7000-8000-000000000002', 'funder',    'tg-other',     'TG Other Funder'),
  ('13000000-0000-7000-8000-000000000003', 'applicant', 'tg-applicant', 'TG Applicant');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f2', 'external_reviewer', '{}'),
  ('13000000-0000-7000-8000-000000000002', '13000000-0000-4000-8000-0000000000e1', 'admin', '{}'),
  ('13000000-0000-7000-8000-000000000003', '13000000-0000-4000-8000-0000000000a1', 'admin', '{}');

-- ---------------------------------------------------------------- the starter library
select is((select count(*)::int from public.gallery_items where author_workspace_id is null and status = 'approved'), 9, 'the migration ships nine approved starter items');
select is(
  (select string_agg(kind || ':' || n, ',' order by kind) from (select kind, count(*) n from public.gallery_items where author_workspace_id is null group by kind) k),
  'application_form:3,email_template:2,program_kit:1,report_form:2,rubric:1',
  'three application forms, two report forms, a rubric, two emails and a program kit'
);
select is((select count(*)::int from public.gallery_items where licence <> 'CC-BY-4.0'), 0, 'every starter is CC BY 4.0');
select is(
  (select jsonb_array_length(snapshot -> 'forms') || '/' || jsonb_array_length(snapshot -> 'rubrics') || '/' || jsonb_array_length(snapshot -> 'emails') from public.gallery_items where slug = 'small-grants-program-kit'),
  '2/1/2', 'the program kit holds two forms, a rubric and two emails'
);

set local role service_role;

-- ---------------------------------------------------------------- what the tables refuse

insert into public.gallery_submissions (id, workspace_id, submitted_by, kind, title, summary, source_type, source_id, source_version, snapshot) values
  ('13000000-0000-7000-8000-0000000000b1', '13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f1', 'application_form', 'Shared form', 'A form we use.', 'form', '13000000-0000-7000-8000-0000000000c1', 2, '{"forms":[{"title":"Shared form","purpose":"application","jsonSchema":{"type":"object","properties":{}},"uiSchema":{"type":"VerticalLayout","elements":[]}}],"rubrics":[],"emails":[]}');
select pass('the service role files a pending submission for a funder workspace');

select throws_ok(
  $$ insert into public.gallery_submissions (workspace_id, submitted_by, kind, title, summary, source_type, source_id, source_version, snapshot) values
     ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f1', 'application_form', 'Again', 'Again.', 'form', '13000000-0000-7000-8000-0000000000c1', 2,
      '{"forms":[{"title":"x","purpose":"application","jsonSchema":{"type":"object"},"uiSchema":{"type":"VerticalLayout"}}]}') $$,
  '23505', null, 'one submission of the same record waits at a time'
);
select throws_ok(
  $$ insert into public.gallery_submissions (workspace_id, submitted_by, kind, title, summary, source_type, source_id, source_version, snapshot) values
     ('13000000-0000-7000-8000-000000000003', '13000000-0000-4000-8000-0000000000a1', 'application_form', 'Applicant', 'From an applicant.', 'form', gen_random_uuid(), 1,
      '{"forms":[{"title":"x","purpose":"application","jsonSchema":{"type":"object"},"uiSchema":{"type":"VerticalLayout"}}]}') $$,
  '23514', null, 'only funder workspaces share to the gallery'
);
select throws_ok(
  $$ insert into public.gallery_submissions (workspace_id, submitted_by, kind, title, summary, source_type, source_id, source_version, snapshot) values
     ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f1', 'rubric', 'Wrong', 'Wrong kind.', 'rubric', gen_random_uuid(), 1,
      '{"forms":[{"title":"x","purpose":"application","jsonSchema":{"type":"object"},"uiSchema":{"type":"VerticalLayout"}}]}') $$,
  '23514', null, 'a snapshot holds what its kind says'
);
select throws_ok(
  $$ insert into public.gallery_submissions (workspace_id, submitted_by, kind, title, summary, source_type, source_id, source_version, snapshot) values
     ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f1', 'program_kit', 'Kit', 'A kit.', 'form', gen_random_uuid(), 1,
      '{"forms":[],"rubrics":[],"emails":[]}') $$,
  '23514', null, 'a workspace cannot submit a program kit'
);
select throws_ok(
  $$ insert into public.gallery_submissions (workspace_id, submitted_by, kind, title, summary, source_type, source_id, source_version, snapshot) values
     ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f1', 'email_template', 'Mail', 'A mail.', 'form', gen_random_uuid(), 1,
      '{"emails":[{"name":"x","subject":"y","body":"z"}]}') $$,
  '23514', null, 'an email template comes from a template'
);
select throws_ok(
  $$ insert into public.gallery_submissions (workspace_id, submitted_by, kind, title, summary, tags, source_type, source_id, source_version, snapshot) values
     ('13000000-0000-7000-8000-000000000001', '13000000-0000-4000-8000-0000000000f1', 'email_template', 'Mail', 'A mail.', '{"colour":["blue"]}', 'template', gen_random_uuid(), 1,
      '{"emails":[{"name":"x","subject":"y","body":"z"}]}') $$,
  '23514', null, 'tags are field of work, grant size and audience only'
);
select throws_ok(
  $$ update public.gallery_submissions set status = 'rejected', decided_at = now(), decided_by = gen_random_uuid() where id = '13000000-0000-7000-8000-0000000000b1' $$,
  '23514', null, 'a declined submission says why'
);
select throws_ok(
  $$ update public.gallery_submissions set status = 'approved' where id = '13000000-0000-7000-8000-0000000000b1' $$,
  '23514', null, 'an approval records who decided and when'
);
select throws_ok(
  $$ update public.gallery_submissions set decided_at = now() where id = '13000000-0000-7000-8000-0000000000b1' $$,
  '23514', null, 'a pending submission has no decision'
);
select throws_ok(
  $$ update public.gallery_submissions set workspace_id = '13000000-0000-7000-8000-000000000002' where id = '13000000-0000-7000-8000-0000000000b1' $$,
  '23514', null, 'a submission stays in its workspace'
);

insert into public.gallery_items (id, slug, kind, title, summary, author_workspace_id, snapshot) values
  ('13000000-0000-7000-8000-0000000000d1', 'tg-shared-form', 'application_form', 'Shared form', 'A form we use.', '13000000-0000-7000-8000-000000000001', '{"forms":[{"title":"Shared form","purpose":"application","jsonSchema":{"type":"object","properties":{}},"uiSchema":{"type":"VerticalLayout","elements":[]}}],"rubrics":[],"emails":[]}');
update public.gallery_submissions set status = 'approved', decided_at = now(), decided_by = '13000000-0000-4000-8000-0000000000e9', item_id = '13000000-0000-7000-8000-0000000000d1'
 where id = '13000000-0000-7000-8000-0000000000b1';
select pass('approving publishes an item and records the decision');

select throws_ok(
  $$ insert into public.gallery_items (slug, kind, title, summary, licence, snapshot) values ('tg-licence', 'rubric', 'R', 'R.', 'CC-BY-SA-4.0', '{"rubrics":[{"name":"R","criteria":[{"key":"a"}]}]}') $$,
  '23514', null, 'every item is CC BY 4.0'
);
select throws_ok(
  $$ insert into public.gallery_items (slug, kind, title, summary, snapshot) values ('moderation', 'rubric', 'R', 'R.', '{"rubrics":[{"name":"R","criteria":[{"key":"a"}]}]}') $$,
  '23514', null, 'the moderation path is never a slug'
);
select throws_ok(
  $$ insert into public.gallery_items (slug, kind, title, summary, snapshot) values ('tg-shared-form', 'rubric', 'R', 'R.', '{"rubrics":[{"name":"R","criteria":[{"key":"a"}]}]}') $$,
  '23505', null, 'slugs are unique'
);
select throws_ok(
  $$ insert into public.gallery_items (slug, kind, title, summary, author_workspace_id, snapshot) values ('tg-applicant', 'rubric', 'R', 'R.', '13000000-0000-7000-8000-000000000003', '{"rubrics":[{"name":"R","criteria":[{"key":"a"}]}]}') $$,
  '23514', null, 'an item is authored by a funder workspace or by OpenGrants'
);
select throws_ok(
  $$ insert into public.gallery_items (slug, kind, title, summary, snapshot) values ('tg-empty-rubric', 'rubric', 'R', 'R.', '{"rubrics":[{"name":"R","criteria":[]}]}') $$,
  '23514', null, 'a rubric has criteria'
);
select throws_ok(
  $$ update public.gallery_items set status = 'withdrawn' where id = '13000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'a withdrawn item records when'
);
select throws_ok(
  $$ update public.gallery_items set uses_count = -1 where id = '13000000-0000-7000-8000-0000000000d1' $$,
  '23514', null, 'the uses count never goes below zero'
);

reset role;

-- ---------------------------------------------------------------- who reads what
set local role anon;
select throws_ok($$ select count(*) from public.gallery_items $$, '42501', null, 'an anonymous visitor cannot read the items table');
select throws_ok($$ select count(*) from public.gallery_submissions $$, '42501', null, 'an anonymous visitor cannot read submissions');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"13000000-0000-4000-8000-0000000000f1"}';
select is((select count(*)::int from public.gallery_submissions), 1, 'the author''s admin reads its submission');
select is((select string_agg(slug, ',') from public.gallery_items), 'tg-shared-form', 'the author''s admin reads its own item, not the whole gallery');
select throws_ok($$ update public.gallery_items set uses_count = 99 $$, '42501', null, 'a member never writes an item');

set local request.jwt.claims = '{"sub":"13000000-0000-4000-8000-0000000000f2"}';
select is((select count(*)::int from public.gallery_submissions), 0, 'an external reviewer of the author does not read submissions');

set local request.jwt.claims = '{"sub":"13000000-0000-4000-8000-0000000000e1"}';
select is((select count(*)::int from public.gallery_submissions) + (select count(*)::int from public.gallery_items), 0, 'another funder reads neither');

set local request.jwt.claims = '{"sub":"13000000-0000-4000-8000-0000000000a1"}';
select is((select count(*)::int from public.gallery_submissions) + (select count(*)::int from public.gallery_items), 0, 'an applicant reads neither');
reset role;

select * from finish();
rollback;
