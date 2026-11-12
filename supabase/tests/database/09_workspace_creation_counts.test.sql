-- Daily workspace-creation caps counted in the database (0027, review NP-07): the claim checks and
-- counts in one statement per key, all keys or none, and only the service role may run it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(public.gms_claim_workspace_creation(array['addr:198.51.100.1', 'user:7d000000-0000-4000-8000-000000000001'], array[3, 2]), 'a first claim is counted');
select ok(public.gms_claim_workspace_creation(array['addr:198.51.100.1', 'user:7d000000-0000-4000-8000-000000000001'], array[3, 2]), 'a second claim is counted');
select ok(not public.gms_claim_workspace_creation(array['addr:198.51.100.1', 'user:7d000000-0000-4000-8000-000000000001'], array[3, 2]), 'the account is at its limit');
select is((select used from public.workspace_creation_counts where key = 'addr:198.51.100.1' and day = current_date), 2,
  'a refused claim counts against no key, not even the one under its limit');
select ok(public.gms_claim_workspace_creation(array['addr:198.51.100.1', 'user:7d000000-0000-4000-8000-000000000002'], array[3, 2]), 'another account at the same address still has a place');
select ok(not public.gms_claim_workspace_creation(array['addr:198.51.100.1', 'user:7d000000-0000-4000-8000-000000000003'], array[3, 2]), 'the address is at its limit');

select public.gms_release_workspace_creation(array['addr:198.51.100.1', 'user:7d000000-0000-4000-8000-000000000002']);
select is((select used from public.workspace_creation_counts where key = 'addr:198.51.100.1' and day = current_date), 2, 'a released claim is given back');

select ok(not has_function_privilege('authenticated', 'public.gms_claim_workspace_creation(text[], integer[])', 'EXECUTE')
          and not has_function_privilege('anon', 'public.gms_release_workspace_creation(text[])', 'EXECUTE'),
  'only the service role may count');
select ok(not has_table_privilege('authenticated', 'public.workspace_creation_counts', 'SELECT'), 'signed-in users cannot read the counts');

select * from finish();
rollback;
