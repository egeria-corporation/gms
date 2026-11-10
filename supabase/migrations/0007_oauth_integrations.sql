-- 0007_oauth_integrations: the GMS OAuth 2.1 server (API clients, MCP clients), human-gate
-- approvals, connectors, webhooks, inbound events and assistant usage.
-- Every secret here is a hash or AES-GCM ciphertext; none of these tables is readable with a
-- user-scoped key except where 0009 says so.

create table public.api_clients (
  id                  uuid primary key default gms.uuid_v7(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 200),
  client_secret_hash  text not null,
  allowed_scopes      text[] not null default '{}' check (allowed_scopes <@ gms.scopes()),
  gated_tools         text[],
  created_by          uuid,
  last_used_at        timestamptz,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.api_clients is 'Workspace API clients (client credentials). The secret is shown once and stored as a hash.';
comment on column public.api_clients.gated_tools is 'Override of the default human-gated tool list for this client; null = workspace default.';
create index api_clients_workspace_id_idx on public.api_clients (workspace_id);

create table public.oauth_clients_dynamic (
  id                          uuid primary key default gms.uuid_v7(),
  client_name                 text not null check (length(btrim(client_name)) between 1 and 200),
  redirect_uris               text[] not null check (cardinality(redirect_uris) > 0),
  grant_types                 text[] not null default '{authorization_code,refresh_token}'
                                check (grant_types <@ array['authorization_code', 'refresh_token']),
  token_endpoint_auth_method  text not null default 'none' check (token_endpoint_auth_method in ('none')),
  client_uri                  text,
  logo_uri                    text,
  software_id                 text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
comment on table public.oauth_clients_dynamic is 'RFC 7591 dynamic registrations (MCP clients). Public clients only; PKCE S256 is required.';

create table public.oauth_grants (
  id                  uuid primary key default gms.uuid_v7(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  client_id           uuid not null references public.oauth_clients_dynamic (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  scopes              text[] not null check (scopes <@ gms.scopes()),
  gated_tools         text[],
  refresh_token_hash  text unique,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.oauth_grants is 'Consents from the auth-code flow: tokens are bound to user + workspace + scopes.';
create index oauth_grants_workspace_id_idx on public.oauth_grants (workspace_id);
create index oauth_grants_client_id_idx on public.oauth_grants (client_id);
create index oauth_grants_user_id_idx on public.oauth_grants (user_id);
create unique index oauth_grants_one_active_idx on public.oauth_grants (client_id, user_id, workspace_id) where revoked_at is null;

create table public.oauth_codes (
  id              uuid primary key default gms.uuid_v7(),
  code_hash       text not null unique,
  client_id       uuid not null references public.oauth_clients_dynamic (id) on delete cascade,
  grant_id        uuid not null references public.oauth_grants (id) on delete cascade,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  scopes          text[] not null check (scopes <@ gms.scopes()),
  code_challenge  text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  redirect_uri    text not null,
  resource        text,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on column public.oauth_codes.code_challenge is 'PKCE S256 challenge (base64url). Plain challenges are not accepted.';
create index oauth_codes_client_id_idx on public.oauth_codes (client_id);
create index oauth_codes_grant_id_idx on public.oauth_codes (grant_id);
create index oauth_codes_workspace_id_idx on public.oauth_codes (workspace_id);
create index oauth_codes_user_id_idx on public.oauth_codes (user_id);
create index oauth_codes_expires_at_idx on public.oauth_codes (expires_at);

create table public.oauth_refresh_tokens (
  token_hash  text primary key,
  grant_id    uuid not null references public.oauth_grants (id) on delete cascade,
  issued_at   timestamptz not null default now(),
  rotated_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.oauth_refresh_tokens is 'Refresh-token rotation history; reuse of a rotated token revokes the grant.';
create index oauth_refresh_tokens_grant_id_idx on public.oauth_refresh_tokens (grant_id);

create table public.mcp_connections (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  client_id     uuid not null references public.oauth_clients_dynamic (id) on delete cascade,
  grant_id      uuid references public.oauth_grants (id) on delete set null,
  user_id       uuid not null references auth.users (id) on delete cascade,
  scopes        text[] not null default '{}' check (scopes <@ gms.scopes()),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.mcp_connections is 'Agents connected to a workspace on a user''s behalf.';
create index mcp_connections_workspace_id_idx on public.mcp_connections (workspace_id);
create index mcp_connections_client_id_idx on public.mcp_connections (client_id);
create index mcp_connections_grant_id_idx on public.mcp_connections (grant_id);
create index mcp_connections_user_id_idx on public.mcp_connections (user_id);

-- Human gates (§10.9): a gated tool call from a client without approvals:bypass parks here until
-- a person approves or rejects it in the UI.
create table public.approvals (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  tool          text not null check (tool ~ '^[a-z][a-z0-9_]*$'),
  input         jsonb not null default '{}'::jsonb,
  summary       text,
  impact        text,
  subject_type  text,
  subject_id    uuid,
  requested_by  text not null check (requested_by ~ '^(user:[^/]+/client:.+|client:.+)$'),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  result        jsonb,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((status in ('approved', 'rejected')) = (decided_by is not null and decided_at is not null))
);
comment on table public.approvals is 'Pending and resolved human-gate requests from agents. requested_by is the ledger actor of the agent call.';
create index approvals_workspace_id_idx on public.approvals (workspace_id, status);
create index approvals_subject_idx on public.approvals (subject_type, subject_id);

-- A resolved approval keeps who decided and when; it never reopens.
create or replace function gms.approvals_resolved_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' and (new.status is distinct from old.status
       or new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
       or new.tool is distinct from old.tool or new.input is distinct from old.input) then
    raise exception 'approval % is already %', old.id, old.status using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger approvals_resolved_immutable before update on public.approvals
  for each row execute function gms.approvals_resolved_immutable();

create table public.custom_mcp_servers (
  id             uuid primary key default gms.uuid_v7(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 200),
  url            text not null check (url ~ '^https://[^[:space:]]+$'),
  auth           jsonb,
  allowed_tools  text[] not null default '{}',
  read_only      boolean not null default true check (read_only),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, name)
);
comment on table public.custom_mcp_servers is 'Funder-registered MCP servers the assistant may read from. auth is ciphertext. Write tools are not allowed in v1 (read_only is always true).';

create table public.connector_accounts (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  provider      text not null check (provider in ('google_workspace', 'mercury')),
  external_id   text,
  scopes        text[] not null default '{}',
  status        text not null default 'active' check (status in ('pending', 'active', 'error', 'revoked')),
  secret_enc    text,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, provider)
);
comment on column public.connector_accounts.secret_enc is 'Mercury read-only token as ciphertext. Composio holds Google credentials; nothing is stored for it here.';

create table public.webhook_subscriptions (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  url           text not null check (url ~ '^https://[^[:space:]]+$'),
  secret_enc    text not null,
  events        text[] not null check (cardinality(events) > 0 and events <@ gms.webhook_events()),
  active        boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.webhook_subscriptions.secret_enc is 'HMAC signing secret, encrypted with WEBHOOK_SECRET_KEY.';
create index webhook_subscriptions_workspace_id_idx on public.webhook_subscriptions (workspace_id);

create table public.webhook_deliveries (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  subscription_id  uuid not null references public.webhook_subscriptions (id) on delete cascade,
  event_id         uuid not null default gms.uuid_v7(),
  event            text not null check (event = any (gms.webhook_events())),
  payload          jsonb not null,
  attempt          integer not null default 1 check (attempt >= 1),
  status_code      integer check (status_code between 100 and 599),
  next_attempt_at  timestamptz,
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index webhook_deliveries_workspace_id_idx on public.webhook_deliveries (workspace_id);
create index webhook_deliveries_subscription_id_idx on public.webhook_deliveries (subscription_id, created_at desc);
create index webhook_deliveries_undelivered_idx on public.webhook_deliveries (next_attempt_at) where delivered_at is null;

create table public.inbound_events (
  id            uuid primary key default gms.uuid_v7(),
  provider      text not null check (provider in ('passport', 'resend', 'mercury')),
  external_id   text not null,
  type          text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (provider, external_id)
);
comment on table public.inbound_events is 'Inbound webhooks, raw and deduped on (provider, external_id).';
create index inbound_events_unprocessed_idx on public.inbound_events (received_at) where processed_at is null;

create table public.assist_calls (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid,
  tool          text not null check (tool in ('summarize', 'compare_rubric', 'draft_letter', 'adapt_answer')),
  tokens_in     integer not null default 0 check (tokens_in >= 0),
  tokens_out    integer not null default 0 check (tokens_out >= 0),
  subject       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.assist_calls is 'Assistant usage log; the monthly quota per workspace is counted from here.';
create index assist_calls_workspace_id_idx on public.assist_calls (workspace_id, created_at desc);
