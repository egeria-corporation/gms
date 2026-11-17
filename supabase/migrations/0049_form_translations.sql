-- 0049_form_translations.sql
-- Bilingual funder forms (docs/forms.md, "Languages"): a form version can carry the funder's text in
-- a second language (title, section titles, field labels, help text, option labels), drafted by a
-- person or by the assistant and reviewed before publishing. An opportunity's translated title,
-- summary and eligibility labels live in its existing `custom_fields` (as the CommonGrants custom
-- field `translations`), so opportunities need no change here.
--
-- What this changes on a live database (no existing row is changed, removed or re-written):
--   * forms gains `translations` (jsonb object, default '{}'). Every existing version reads '{}':
--     no translations, shown exactly as before. The check (an object) holds for every existing row
--     because they all take the default.
--   * a published form version stays immutable: its translations join the columns the
--     forms_published_immutable trigger protects. Existing published rows all hold '{}' and are not
--     touched; the next draft (a copy) is where translations change.
--   * assist_calls: the tool check gains 'translate' (the assistant's translation drafts count
--     against the same monthly quota). Existing rows hold the six earlier tools and pass.
--   * RLS: unchanged. The column is covered by the forms table's policies and grants (a draft is
--     read by the workspace's staff; a published version by any signed-in person, as before).

alter table public.forms
  add column translations jsonb not null default '{}'::jsonb
  constraint forms_translations_object check (jsonb_typeof(translations) = 'object');
comment on column public.forms.translations is 'The funder''s text in other languages: { source?: "en"|"es", es?: { title, sections, fields } }. Each text keeps the source it translates (packages/forms translations.ts). Part of the version: immutable once published.';

create or replace function gms.forms_published_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null and (
       new.json_schema is distinct from old.json_schema
    or new.ui_schema is distinct from old.ui_schema
    or new.mapping_from_cg is distinct from old.mapping_from_cg
    or new.mapping_to_cg is distinct from old.mapping_to_cg
    or new.field_meta is distinct from old.field_meta
    or new.translations is distinct from old.translations
    or new.published_at is distinct from old.published_at
    or new.purpose is distinct from old.purpose) then
    raise exception 'form % version % is published and immutable; create the next version', old.id, old.version
      using errcode = '23514';
  end if;
  return new;
end;
$$;

alter table public.assist_calls drop constraint assist_calls_tool_check;
alter table public.assist_calls add constraint assist_calls_tool_check
  check (tool in ('summarize', 'compare_rubric', 'draft_letter', 'adapt_answer', 'draft_answer', 'parse_guidelines', 'translate'));
