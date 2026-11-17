-- Bilingual forms (0049): a form version's translations are an object, editable on a draft,
-- immutable once published, copied by the next draft, and read under the forms policies; the
-- assistant's translation drafts are a tool the call log accepts.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('49000000-0000-4000-8000-0000000000f1', 'admin@ft-funder.example', 'authenticated', 'authenticated'),
  ('49000000-0000-4000-8000-0000000000e1', 'admin@ft-other.example',  'authenticated', 'authenticated');

insert into public.workspaces (id, kind, handle, display_name) values
  ('49000000-0000-7000-8000-000000000001', 'funder', 'ft-funder', 'FT Funder'),
  ('49000000-0000-7000-8000-000000000002', 'funder', 'ft-other',  'FT Other Funder');

insert into public.workspace_members (workspace_id, user_id, role, scope) values
  ('49000000-0000-7000-8000-000000000001', '49000000-0000-4000-8000-0000000000f1', 'admin', '{}'),
  ('49000000-0000-7000-8000-000000000002', '49000000-0000-4000-8000-0000000000e1', 'admin', '{}');

set local role service_role;
insert into public.forms (id, version, workspace_id, title) values
  ('49000000-0000-7000-8000-0000000000a1', 1, '49000000-0000-7000-8000-000000000001', 'Letter of intent');
select is((select translations from public.forms where id = '49000000-0000-7000-8000-0000000000a1'), '{}'::jsonb, 'a form without translations reads an empty object');

select throws_ok(
  $$ update public.forms set translations = '[]'::jsonb where id = '49000000-0000-7000-8000-0000000000a1' $$,
  '23514', null, 'translations must be an object'
);

update public.forms set translations = '{"es":{"title":{"text":"Carta de intención","source":"Letter of intent"}}}'::jsonb
  where id = '49000000-0000-7000-8000-0000000000a1' and version = 1;
select is((select translations #>> '{es,title,text}' from public.forms where id = '49000000-0000-7000-8000-0000000000a1'), 'Carta de intención', 'a draft''s translations can change');

update public.forms set published_at = now() where id = '49000000-0000-7000-8000-0000000000a1' and version = 1;
select throws_ok(
  $$ update public.forms set translations = '{}'::jsonb where id = '49000000-0000-7000-8000-0000000000a1' and version = 1 $$,
  '23514', null, 'a published version''s translations never change'
);
select lives_ok(
  $$ update public.forms set title = 'Letter of intent' where id = '49000000-0000-7000-8000-0000000000a1' and version = 1 $$,
  'a published version may still be touched where it always could'
);

-- The next draft is a copy, and its translations are its own.
insert into public.forms (id, version, workspace_id, title, translations, supersedes_form_version)
  select id, 2, workspace_id, title, translations, 1 from public.forms where id = '49000000-0000-7000-8000-0000000000a1' and version = 1;
update public.forms set translations = jsonb_set(translations, '{es,title,text}', '"Carta de intención (2028)"') where id = '49000000-0000-7000-8000-0000000000a1' and version = 2;
select is(
  (select string_agg(version || ':' || (translations #>> '{es,title,text}'), ',' order by version) from public.forms where id = '49000000-0000-7000-8000-0000000000a1'),
  '1:Carta de intención,2:Carta de intención (2028)', 'the next draft starts from the published translations and changes only its own'
);

insert into public.assist_calls (workspace_id, tool) values ('49000000-0000-7000-8000-000000000001', 'translate');
select is((select count(*)::int from public.assist_calls where workspace_id = '49000000-0000-7000-8000-000000000001' and tool = 'translate'), 1, 'a translation draft is logged against the monthly quota');
select throws_ok(
  $$ insert into public.assist_calls (workspace_id, tool) values ('49000000-0000-7000-8000-000000000001', 'translate_everything') $$,
  '23514', null, 'the call log still refuses a tool it does not know'
);

-- ---------------------------------------------------------------- who reads them
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"49000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
select is((select count(*)::int from public.forms where id = '49000000-0000-7000-8000-0000000000a1' and version = 2), 0, 'another funder does not read a draft''s translations');
select is((select translations #>> '{es,title,text}' from public.forms where id = '49000000-0000-7000-8000-0000000000a1' and version = 1), 'Carta de intención', 'a published version reads with its translations, like the rest of it');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"49000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from public.forms where id = '49000000-0000-7000-8000-0000000000a1'), 2, 'the funder''s staff read every version');

select * from finish();
rollback;
