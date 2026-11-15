-- 0042_importer_adapters.sql
-- Importer adapters (v1.8.0): a funder moving from another grants system drops in that system's
-- export (Good Grants, SurveyMonkey Apply, Submittable, Foundant GLM, SmartSimple, OpenWater) and
-- gets a mapping already filled in, or has the GMS read its records from Fluxx or Zengine through
-- their APIs with the funder's own credentials, read-only. Every run still goes through the import
-- framework of 0031: sensitive columns dropped first, a dry run, then the commit.
--
-- Privacy: nothing here widens who reads what. Import runs stay readable by the workspace's staff
-- only (0031's policies). The Fluxx client secret and the Zengine access token are AES-GCM
-- ciphertext under CREDENTIALS_ENCRYPTION_KEY in connector_accounts.secret_enc, a column no
-- signed-in user may select (0009); the API deletes them when the import is finished or the person
-- disconnects. Files from a system's zip are documents of the funder's own workspace (subject
-- 'imported_award_file'), readable by its staff under documents' existing policy, never by the
-- grantee. No bank or identity data is stored.
--
-- What this changes on a live database:
--   * import_mappings.source and import_runs.source: the checks gain 'json' (an OpenWater JSON
--     export), 'fluxx' and 'zengine'. Every existing value is still allowed; no row is touched.
--   * import_runs gains two nullable columns, null on every existing row:
--       adapter           which system's export the run read, or null for a plain spreadsheet
--                         (grant history only);
--       source_next_page  where the next pull from Fluxx or Zengine starts, or null when the
--                         source was read to its end (always null for a file).
--   * connector_accounts: the provider check gains 'fluxx' and 'zengine'. Every existing value is
--     still allowed; existing rows are not touched.
-- No existing row is changed or removed. No backfill. If a migration after 0031 other than this
-- one changes connector_accounts_provider_check or the two source checks, keep both lists.

-- ---------------------------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------------------------

alter table public.import_mappings drop constraint import_mappings_source_check;
alter table public.import_mappings add constraint import_mappings_source_check
  check (source in ('csv', 'xlsx', 'google_sheets', 'airtable', 'json', 'fluxx', 'zengine'));

alter table public.import_runs drop constraint import_runs_source_check;
alter table public.import_runs add constraint import_runs_source_check
  check (source in ('csv', 'xlsx', 'google_sheets', 'airtable', 'json', 'fluxx', 'zengine'));

-- ---------------------------------------------------------------------------------------------
-- Which system a run read, and where an API pull continues
-- ---------------------------------------------------------------------------------------------

alter table public.import_runs
  add column adapter text
    check (adapter is null or adapter in ('good_grants', 'sm_apply', 'submittable', 'foundant_glm', 'smartsimple', 'openwater', 'fluxx', 'zengine')),
  add column source_next_page integer
    check (source_next_page is null or source_next_page between 2 and 1000000);
alter table public.import_runs
  -- Adapters map to a funder's grant history only.
  add constraint import_runs_adapter_target_check check (adapter is null or target = 'award_history'),
  -- Only an API source is read in parts.
  add constraint import_runs_next_page_source_check check (source_next_page is null or source in ('fluxx', 'zengine')),
  -- An API source is read through its own adapter.
  add constraint import_runs_api_adapter_check check (source not in ('fluxx', 'zengine') or coalesce(adapter = source, false));
comment on column public.import_runs.adapter is 'Which grants system''s export the run read (its preset mapping and the rows it set aside as never awarded); null for a plain spreadsheet.';
comment on column public.import_runs.source_next_page is 'Fluxx and Zengine: the page the next pull starts at, null when the source was read to its end. A row imported before is skipped by its key.';

-- ---------------------------------------------------------------------------------------------
-- Connector accounts: Fluxx and Zengine, with the funder's own credentials
-- ---------------------------------------------------------------------------------------------

alter table public.connector_accounts drop constraint connector_accounts_provider_check;
alter table public.connector_accounts add constraint connector_accounts_provider_check
  check (provider in ('google_workspace', 'mercury', 'google_sheets', 'airtable', 'fluxx', 'zengine'));
comment on column public.connector_accounts.secret_enc is 'Ciphertext under CREDENTIALS_ENCRYPTION_KEY: the Mercury read-only token; the Fluxx OAuth client id and secret and the Zengine access token for an import (deleted when it is finished or the person disconnects). Composio holds Google, Google Sheets and Airtable credentials; nothing is stored for them here.';
comment on column public.connector_accounts.external_id is 'Google Workspace and the Composio import sources: the workspace id (the Composio entity). Fluxx: the instance address. Null otherwise.';
