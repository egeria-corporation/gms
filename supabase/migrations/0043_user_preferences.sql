-- 0043_user_preferences.sql
-- A person's own preferences, starting with the language the GMS speaks to them in (v1.10.0,
-- docs/i18n.md): the web app's language once they sign in, and the language of the emails sent to
-- them (apps/api/src/services/preferences.ts). One row per person, not per workspace.
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * adds user_preferences: one row per person who has chosen a language. A person without a row
--     has no preference: the web app follows `?lang=`, the cookie and the browser, and emails go
--     in English, exactly as before this migration. The row goes with the account.
--   * `locale` is 'en' or 'es', or null (no preference); a language the GMS does not speak cannot
--     be stored. No existing data can violate this: the table is new.
--   * RLS on, written by the service role only (the API); a person reads their own row.

create table public.user_preferences (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  locale      text check (locale in ('en', 'es')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.user_preferences is 'A person''s own preferences (the language of the interface and of their emails). Written by the API only (apps/api/src/services/preferences.ts).';
comment on column public.user_preferences.locale is 'en or es; null means no preference (the browser''s language for the interface, English for emails).';

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers (0009's three steps for every new table)
-- ---------------------------------------------------------------------------------------------
alter table public.user_preferences enable row level security;

revoke all on public.user_preferences from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.user_preferences to service_role;
-- A person reads their own preferences; nobody else's.
grant select on public.user_preferences to authenticated;

create policy user_preferences_select on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create trigger user_preferences_touch_updated_at before update on public.user_preferences
  for each row execute function gms.touch_updated_at();
