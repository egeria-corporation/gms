-- 0048_award_kit_plus.sql
-- The award kit, plus (v1.12.0, docs/award-sharing.md and docs/social.md): the federal share
-- statement, the social page each side may be tagged with, the funder's press-release wording,
-- "Meet our grantees" posts about a program, and the "Two weeks left" reminder prompt.
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * awards gains four columns for the federal share statement (the Stevens Amendment, HHS):
--       federally_funded  boolean not null default false: every existing award reads "not marked";
--       federal_amount    numeric(14,2), null: the federal dollars, more than zero;
--       federal_percent   numeric(5,2), null: the federal share of the total costs, above 0, at most 100;
--       federal_source    text, null: the federal agency, as the funder names it (at most 200).
--     The numbers are kept only while the award is marked federally funded (a check). Existing rows
--     hold false and nulls, so they pass every new check. Adding a column with a constant default is
--     a catalog change in Postgres 16: the table is not rewritten.
--   * adds share_kit_profiles: one row per workspace that filled in its share-kit settings. Its
--     social page link (https, at most 300), whether it consents to being tagged there (with who and
--     when; consent needs a link), and, for a funder, the press release's credit wording ("funded
--     by" or "supported by"; "sponsored" is not a value) and standard description (at most 1,500).
--     A workspace without a row has no link, no consent, "funded by" and no description.
--   * adds social_reminder_prompts: at most one per call (unique opportunity_id). The jobs Worker
--     writes it fourteen days before the call's deadline; a funder admin may dismiss it. It records
--     the deadline it was made for, and who dismissed it and when. It never posts anything.
--   * social_posts.subject_type gains 'program' ("Meet our grantees": one post about several awards
--     of a program). The ownership trigger checks that the program is the workspace's own. Every
--     existing value is still allowed; existing rows are not touched.
-- RLS: both new tables are read by the workspace's staff (gms.is_staff) and written only by the API's
-- service role. The award columns are read through the existing member policies on awards.

-- ---------------------------------------------------------------------------------------------
-- Awards: the federal share
-- ---------------------------------------------------------------------------------------------

alter table public.awards
  add column federally_funded boolean not null default false,
  add column federal_amount numeric(14, 2),
  add column federal_percent numeric(5, 2),
  add column federal_source text;

alter table public.awards
  add constraint awards_federal_amount_check check (federal_amount is null or federal_amount > 0),
  add constraint awards_federal_percent_check check (federal_percent is null or (federal_percent > 0 and federal_percent <= 100)),
  add constraint awards_federal_source_check check (federal_source is null or pg_catalog.length(federal_source) between 1 and 200),
  add constraint awards_federal_only_when_marked check (federally_funded or (federal_amount is null and federal_percent is null and federal_source is null));

comment on column public.awards.federally_funded is 'The funder marked this award as paid in whole or in part with federal money (the Stevens Amendment statement).';
comment on column public.awards.federal_amount is 'Federal dollars in the project, as the funder entered them. The statement appears only with both numbers.';
comment on column public.awards.federal_percent is 'Federal share of the project''s total costs, in percent, as entered. Never computed.';

-- ---------------------------------------------------------------------------------------------
-- Share-kit settings
-- ---------------------------------------------------------------------------------------------

create table public.share_kit_profiles (
  workspace_id          uuid primary key references public.workspaces (id) on delete cascade,
  page_url              text check (page_url is null or (page_url ~ '^https://[^[:space:]]+$' and pg_catalog.length(page_url) <= 300)),
  tag_consent           boolean not null default false,
  consented_at          timestamptz,
  consented_by          uuid,
  credit_wording        text not null default 'funded_by' check (credit_wording in ('funded_by', 'supported_by')),
  standard_description  text check (standard_description is null or pg_catalog.length(standard_description) between 1 and 1500),
  updated_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (tag_consent = (consented_at is not null)),
  check (not tag_consent or page_url is not null)
);
comment on table public.share_kit_profiles is 'A workspace''s share-kit settings: its social page and consent to be tagged there, and a funder''s press-release credit wording and description. Written by the API only.';

-- ---------------------------------------------------------------------------------------------
-- "Two weeks left": the reminder prompt
-- ---------------------------------------------------------------------------------------------

create table public.social_reminder_prompts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  opportunity_id  uuid not null unique references public.opportunities (id) on delete cascade,
  deadline        date not null,
  prompted_at     timestamptz not null default now(),
  dismissed_at    timestamptz,
  dismissed_by    uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((dismissed_at is null) = (dismissed_by is null))
);
comment on table public.social_reminder_prompts is 'One "Post a reminder?" prompt per call, made fourteen days before its deadline. It never posts: a person opens the composer.';
create index social_reminder_prompts_workspace_idx on public.social_reminder_prompts (workspace_id, prompted_at desc);

-- A prompt's call belongs to its workspace.
create or replace function gms.social_reminder_owned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.opportunities o where o.id = new.opportunity_id and o.workspace_id = new.workspace_id) then
    raise exception 'social_reminder_prompts: the call belongs to another workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- "Meet our grantees": a post about a program
-- ---------------------------------------------------------------------------------------------

alter table public.social_posts drop constraint social_posts_subject_type_check;
alter table public.social_posts add constraint social_posts_subject_type_check
  check (subject_type in ('opportunity', 'award', 'program'));

-- As in 0038, plus: a program is the funder's own.
create or replace function gms.social_post_owned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subject_type = 'opportunity' then
    if not exists (select 1 from public.opportunities o where o.id = new.subject_id and o.workspace_id = new.workspace_id) then
      raise exception 'social_posts: the opportunity belongs to another workspace' using errcode = '23514';
    end if;
  elsif new.subject_type = 'award' then
    if not exists (select 1 from public.awards a where a.id = new.subject_id and (a.workspace_id = new.workspace_id or a.recipient_workspace_id = new.workspace_id)) then
      raise exception 'social_posts: the award is not this workspace''s' using errcode = '23514';
    end if;
  elsif new.subject_type = 'program' then
    if not exists (select 1 from public.programs p where p.id = new.subject_id and p.workspace_id = new.workspace_id) then
      raise exception 'social_posts: the program belongs to another workspace' using errcode = '23514';
    end if;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(new.targets) e(v)
     where not exists (select 1 from public.social_accounts s where s.id = (e.v ->> 'accountId')::uuid and s.workspace_id = new.workspace_id)
  ) then
    raise exception 'social_posts: every account must be one of this workspace''s' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gms.social_post_owned() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers
-- ---------------------------------------------------------------------------------------------

alter table public.share_kit_profiles enable row level security;
alter table public.social_reminder_prompts enable row level security;

revoke all on public.share_kit_profiles, public.social_reminder_prompts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.share_kit_profiles, public.social_reminder_prompts to service_role;
grant select on public.share_kit_profiles, public.social_reminder_prompts to authenticated;

create policy share_kit_profiles_select on public.share_kit_profiles for select to authenticated
  using (gms.is_staff(workspace_id));
create policy social_reminder_prompts_select on public.social_reminder_prompts for select to authenticated
  using (gms.is_staff(workspace_id));

do $$
declare
  t text;
begin
  foreach t in array array['share_kit_profiles', 'social_reminder_prompts'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
  end loop;
end;
$$;

create trigger social_reminder_prompts_owned before insert or update of workspace_id, opportunity_id on public.social_reminder_prompts
  for each row execute function gms.social_reminder_owned();

revoke all on function gms.social_reminder_owned() from public, anon, authenticated;
