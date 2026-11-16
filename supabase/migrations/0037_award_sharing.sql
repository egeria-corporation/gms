-- 0037_award_sharing.sql
-- Award sharing (v1.9.0): a confidential flag on awards with a program default, the grantee's
-- choice to stay off the funder's public page, and the slug that names an award's public page and
-- its "Funded by" badge. The rules that decide what is public live in one function,
-- `isPubliclyListable` in apps/api/src/services/award-sharing.ts; this migration adds the facts it
-- reads and makes nothing public on its own.
--
-- What this changes on a live database:
--   * adds `awards.confidential boolean not null default false`. Every existing award stays not
--     confidential, and still not public: an award is listed only once the funder turns on "List
--     awards on my public page" (`workspaces.settings.awardSharing.listAwards`, absent and so off
--     for every workspace today) and the award is accepted, active or completed.
--   * copies the open-data "exclude from open data" choices (`workspaces.settings.openData
--     .excludedAwardIds`, a list of award UUIDs, from the open-data track) into
--     `awards.confidential = true`, for awards of that same workspace only. A workspace without the
--     key, a value that is not a list, and entries that are not one of its award ids change nothing.
--     The copy is `gms.confidential_from_open_data()`, which the service role can run again.
--   * adds `awards.recipient_unlisted boolean not null default false`: the grantee's "Don't list us
--     publicly". Every existing award stays false (no choice made yet).
--   * adds `awards.public_slug text not null unique`: a random 12-character token per award. Adding
--     the column rewrites `awards` once, giving each existing row its own token; new rows get one
--     from the default. The token names the public page and badge and is shown only while public.
--   * adds `programs.awards_confidential boolean not null default false` (existing programs stay
--     false) and a trigger that marks a new award confidential when its program says so.
-- No table is added. The new columns are read by signed-in users only through the existing member
-- policies (0009: `awards_select` for the funder's staff and the recipient's staff,
-- `programs_select` for the funder's staff); only the API (service role) writes them.

-- ------------------------------------------------------------------------------- awards
create or replace function gms.new_public_slug() returns text
language sql volatile parallel safe set search_path = '' as $$
  -- 48 random bits as 12 lowercase hex digits (the first 12 of a version 4 UUID are all random).
  select substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12);
$$;
comment on function gms.new_public_slug() is 'A random token for an award''s public page and badge address (awards.public_slug).';

alter table public.awards
  add column confidential boolean not null default false,
  add column recipient_unlisted boolean not null default false,
  add column public_slug text not null default gms.new_public_slug()
    check (public_slug ~ '^[a-z0-9]{8,32}$');
alter table public.awards add constraint awards_public_slug_key unique (public_slug);

comment on column public.awards.confidential is 'Set by the funder (or from the program''s default). A confidential award is never on a public page, feed, badge, open-data export or share card.';
comment on column public.awards.recipient_unlisted is 'The grantee''s "Don''t list us publicly": the award stays off the funder''s public pages and badge.';
comment on column public.awards.public_slug is 'Random token in the award''s public page (/f/{handle}/awards/{name}-{token}) and badge (/badge/{name}-{token}.svg) addresses.';

-- ------------------------------------------------------------------------------- programs
alter table public.programs
  add column awards_confidential boolean not null default false;
comment on column public.programs.awards_confidential is 'New awards in this program start confidential. Changing it does not change awards already made.';

-- A new award takes its program's default. Only the program of the award's own workspace counts
-- (0020 already refuses a program from another workspace).
create or replace function gms.award_confidential_default() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.program_id is not null and not new.confidential
     and exists (select 1 from public.programs p where p.id = new.program_id and p.workspace_id = new.workspace_id and p.awards_confidential) then
    new.confidential := true;
  end if;
  return new;
end;
$$;
create trigger awards_confidential_default before insert on public.awards
  for each row execute function gms.award_confidential_default();

-- ------------------------------------------------------------------------------- open-data choices
-- Copies `settings.openData.excludedAwardIds` into `awards.confidential`. Returns how many awards
-- it marked. Entries may be bare UUIDs or `awd_`-prefixed; anything else is ignored.
create or replace function gms.confidential_from_open_data() returns integer
language plpgsql set search_path = '' as $$
declare
  marked integer;
begin
  with wanted as (
    select w.id as workspace_id, regexp_replace(lower(x.v #>> '{}'), '^awd_', '') as award_id
    from public.workspaces w
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(w.settings -> 'openData' -> 'excludedAwardIds') = 'array'
           then w.settings -> 'openData' -> 'excludedAwardIds' else '[]'::jsonb end) as x(v)
    where jsonb_typeof(x.v) = 'string'
  )
  update public.awards a
     set confidential = true
    from wanted
   where a.workspace_id = wanted.workspace_id
     and a.id::text = wanted.award_id
     and not a.confidential;
  get diagnostics marked = row_count;
  return marked;
end;
$$;
comment on function gms.confidential_from_open_data() is 'Marks confidential the awards a funder excluded from open data (settings.openData.excludedAwardIds). Service role only.';

revoke all on function gms.new_public_slug() from public, anon, authenticated;
revoke all on function gms.award_confidential_default() from public, anon, authenticated;
revoke all on function gms.confidential_from_open_data() from public, anon, authenticated;
grant execute on function gms.new_public_slug() to service_role;
grant execute on function gms.confidential_from_open_data() to service_role;

select gms.confidential_from_open_data();
