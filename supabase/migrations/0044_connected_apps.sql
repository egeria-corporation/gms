-- 0044_connected_apps.sql
-- Connected apps through Composio (v1.12.0): Slack alerts for a workspace's team, deadlines
-- written to a person's Google Calendar, an applicant's Google Drive (attach a picked file, save
-- the as-submitted packet), and Salesforce as a read-only import source.
--
-- Privacy: Composio holds every provider token; nothing here stores one. A Slack alert's text is
-- not kept (only which event was alerted, and Slack's message timestamp), and the alert names the
-- event, the record title and a link, never an applicant's answers, emails or amounts. A calendar
-- link keeps the person's Composio account id, the calendar they chose, and for each deadline the
-- Google event id, date and a digest of what was written. Signed-in users only read: workspace
-- admins their workspace's Slack settings and alert log, each person their own calendar link.
-- Every write goes through the API's service role. No bank or identity data is stored.
--
-- What this changes on a live database:
--   * connector_accounts: the provider check gains 'slack', 'google_drive' and 'salesforce'. Every
--     existing value is still allowed; existing rows are not touched.
--   * import_mappings.source and import_runs.source: the checks gain 'salesforce'. Every existing
--     value is still allowed; no row is touched.
--   * adds three tables, each with RLS on, `updated_at` kept by gms.touch_updated_at() and the
--     workspace-immutable trigger:
--       alert_subscriptions  one Slack channel per workspace: channel id and name, the events
--                            alerted, on or off, and the moment alerts start from;
--       alert_deliveries     one row per alerted event and subscription (unique), so the jobs
--                            Worker posts each event once; tied to its subscription's workspace
--                            by a composite foreign key;
--       calendar_links       one per person per workspace: Composio account id, chosen calendar,
--                            the event map (deadline key -> Google event id, date, digest).
-- No existing row is changed or removed. No backfill. If a later migration changes
-- connector_accounts_provider_check or the two import source checks, keep these values.

-- ---------------------------------------------------------------------------------------------
-- Providers and import sources
-- ---------------------------------------------------------------------------------------------

alter table public.connector_accounts drop constraint connector_accounts_provider_check;
alter table public.connector_accounts add constraint connector_accounts_provider_check
  check (provider in ('google_workspace', 'mercury', 'google_sheets', 'airtable', 'fluxx', 'zengine', 'slack', 'google_drive', 'salesforce'));
comment on column public.connector_accounts.secret_enc is 'Ciphertext under CREDENTIALS_ENCRYPTION_KEY: the Mercury read-only token; the Fluxx OAuth client id and secret and the Zengine access token for an import (deleted when it is finished or the person disconnects). Composio holds Google, Google Sheets, Airtable, Slack, Google Drive and Salesforce credentials; nothing is stored for them here.';
comment on column public.connector_accounts.external_id is 'Google Workspace, Slack, Google Drive, Salesforce and the Composio import sources: the workspace id (the Composio entity). Fluxx: the instance address. Null otherwise.';

alter table public.import_mappings drop constraint import_mappings_source_check;
alter table public.import_mappings add constraint import_mappings_source_check
  check (source in ('csv', 'xlsx', 'google_sheets', 'airtable', 'json', 'fluxx', 'zengine', 'salesforce'));

alter table public.import_runs drop constraint import_runs_source_check;
alter table public.import_runs add constraint import_runs_source_check
  check (source in ('csv', 'xlsx', 'google_sheets', 'airtable', 'json', 'fluxx', 'zengine', 'salesforce'));

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The events a Slack channel can be told about.
create or replace function gms.alert_events_ok(e text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select e is not null
     and pg_catalog.cardinality(e) <= 5
     and e <@ array['new_application', 'review_assigned', 'deadline_soon', 'report_due', 'payment_due']::text[];
$$;

-- A calendar link's event map: { "<deadline key>": { "eventId", "date", "hash" } }, at most 2,000.
create or replace function gms.calendar_event_map_ok(m jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(m) = 'object'
     and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(m)) <= 2000
     and not exists (
       select 1 from pg_catalog.jsonb_each(m) f
        where pg_catalog.length(f.key) > 200
           or f.key !~ '^[a-z]+:[A-Za-z0-9:._-]+$'
           or pg_catalog.jsonb_typeof(f.value) <> 'object'
           or (f.value ->> 'eventId') is null
           or pg_catalog.length(f.value ->> 'eventId') not between 5 and 1024
           or (f.value ->> 'eventId') !~ '^[a-v0-9_]+$'
           or (f.value ->> 'date') is null
           or (f.value ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
           or (f.value ? 'hash' and coalesce(f.value ->> 'hash', '') !~ '^[0-9a-f]{16,64}$')
           or exists (select 1 from pg_catalog.jsonb_object_keys(f.value) k where k not in ('eventId', 'date', 'hash'))
     );
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.alert_subscriptions (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  provider      text not null default 'slack' check (provider in ('slack')),
  -- A public Slack channel's id and its name when it was chosen.
  channel_id    text not null check (channel_id ~ '^[CG][A-Z0-9]{2,30}$'),
  channel_name  text not null check (pg_catalog.length(channel_name) between 1 and 80),
  events        text[] not null default '{}' check (gms.alert_events_ok(events)),
  enabled       boolean not null default true,
  -- Nothing that happened before this moment is alerted (set each time alerts are turned on).
  alerts_from   timestamptz not null default now(),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, provider),
  unique (id, workspace_id)
);
comment on table public.alert_subscriptions is 'One Slack channel per workspace for alerts: channel id and name, events, on or off. No token and no message text.';

create table public.alert_deliveries (
  id               uuid primary key default gms.uuid_v7(),
  subscription_id  uuid not null,
  workspace_id     uuid not null,
  -- The event and its record, e.g. new_application:<application id>; the claim that keeps it to one post.
  event_key        text not null check (pg_catalog.length(event_key) <= 200 and event_key ~ '^[a-z_]+:[A-Za-z0-9:._-]+$'),
  event            text not null check (event in ('new_application', 'review_assigned', 'deadline_soon', 'report_due', 'payment_due')),
  status           text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts         integer not null default 1 check (attempts between 1 and 20),
  slack_ts         text check (slack_ts is null or slack_ts ~ '^\d{1,12}\.\d{1,8}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (subscription_id, event_key),
  foreign key (subscription_id, workspace_id) references public.alert_subscriptions (id, workspace_id) on delete cascade
);
comment on table public.alert_deliveries is 'Which events were alerted to a Slack channel, once each. Not the text of the message.';
create index alert_deliveries_workspace_idx on public.alert_deliveries (workspace_id, created_at desc);

create table public.calendar_links (
  id                   uuid primary key default gms.uuid_v7(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  -- The person's own Composio connected account on the workspace's entity.
  composio_account_id  text not null check (composio_account_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  status               text not null default 'pending' check (status in ('pending', 'active', 'error')),
  calendar_id          text check (calendar_id is null or (pg_catalog.length(calendar_id) between 1 and 255 and calendar_id !~ '[[:space:]/\\]')),
  calendar_name        text check (calendar_name is null or pg_catalog.length(calendar_name) between 1 and 120),
  event_map            jsonb not null default '{}'::jsonb check (gms.calendar_event_map_ok(event_map)),
  last_sync_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, user_id),
  check ((calendar_id is null) = (calendar_name is null))
);
comment on table public.calendar_links is 'A person''s Google Calendar for deadlines: Composio account id, chosen calendar, and the Google event id written for each deadline. No token.';

-- ---------------------------------------------------------------------------------------------
-- RLS, grants, triggers
-- ---------------------------------------------------------------------------------------------

alter table public.alert_subscriptions enable row level security;
alter table public.alert_deliveries enable row level security;
alter table public.calendar_links enable row level security;

revoke all on public.alert_subscriptions, public.alert_deliveries, public.calendar_links from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.alert_subscriptions, public.alert_deliveries, public.calendar_links to service_role;
grant select on public.alert_subscriptions, public.alert_deliveries, public.calendar_links to authenticated;

create policy alert_subscriptions_select on public.alert_subscriptions for select to authenticated
  using (gms.has_role(workspace_id, array['admin']));
create policy alert_deliveries_select on public.alert_deliveries for select to authenticated
  using (gms.has_role(workspace_id, array['admin']));
create policy calendar_links_select on public.calendar_links for select to authenticated
  using (user_id = (select auth.uid()) and gms.is_member(workspace_id));

do $$
declare
  t text;
begin
  foreach t in array array['alert_subscriptions', 'alert_deliveries', 'calendar_links'] loop
    execute pg_catalog.format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()', t || '_touch_updated_at', t);
    execute pg_catalog.format('create trigger %I before update of workspace_id on public.%I for each row execute function gms.workspace_id_immutable()', t || '_workspace_immutable', t);
  end loop;
end;
$$;
