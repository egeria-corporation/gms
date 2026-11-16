-- A person's preferences (0043): one row per person, only a language the GMS speaks, written by the
-- service role only, read by the person alone, and gone with the account.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, aud, role) values
  ('43000000-0000-4000-8000-0000000000a1', 'lucia@up-test.example', 'authenticated', 'authenticated'),
  ('43000000-0000-4000-8000-0000000000a2', 'omar@up-test.example',  'authenticated', 'authenticated');

set local role service_role;
insert into public.user_preferences (user_id, locale) values ('43000000-0000-4000-8000-0000000000a1', 'es');
insert into public.user_preferences (user_id) values ('43000000-0000-4000-8000-0000000000a2');
select is((select locale from public.user_preferences where user_id = '43000000-0000-4000-8000-0000000000a2'), null, 'no language is a preference of none');

select throws_ok(
  $$ insert into public.user_preferences (user_id, locale) values ('43000000-0000-4000-8000-0000000000a1', 'en') $$,
  '23505', null, 'one row per person'
);
select throws_ok(
  $$ update public.user_preferences set locale = 'fr' where user_id = '43000000-0000-4000-8000-0000000000a2' $$,
  '23514', null, 'a language the GMS does not speak cannot be stored'
);

update public.user_preferences set locale = 'en', updated_at = '2000-01-01' where user_id = '43000000-0000-4000-8000-0000000000a2';
select ok((select updated_at > '2001-01-01' from public.user_preferences where user_id = '43000000-0000-4000-8000-0000000000a2'), 'a change touches updated_at');

-- ---------------------------------------------------------------- what a signed-in person sees
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"43000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select results_eq($$ select user_id::text, locale from public.user_preferences $$, $$ values ('43000000-0000-4000-8000-0000000000a1', 'es') $$, 'a person reads their own row and nobody else''s');
select throws_ok(
  $$ update public.user_preferences set locale = 'en' where user_id = '43000000-0000-4000-8000-0000000000a1' $$,
  '42501', null, 'a person cannot write it directly: the API does'
);
select throws_ok(
  $$ insert into public.user_preferences (user_id, locale) values ('43000000-0000-4000-8000-0000000000a1', 'en') $$,
  '42501', null, 'nor add a row'
);

reset role;
set local role anon;
select throws_ok($$ select * from public.user_preferences $$, '42501', null, 'a visitor reads nothing');

reset role;
delete from auth.users where id = '43000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.user_preferences where user_id = '43000000-0000-4000-8000-0000000000a1'), 0, 'the row goes with the account');

select * from finish();
rollback;
