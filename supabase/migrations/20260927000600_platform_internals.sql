-- SPDX-License-Identifier: AGPL-3.0-only
-- Service-only internals: encrypted secrets (AES fallback for Supabase Vault), fake payment rail state,
-- test-auth tables (tier 3 only), idempotency helper, outbox claiming, and email capture helpers.
-- No gms_* role has table privileges in gms_private; RLS is enabled anyway.

create table gms_private.secrets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  ciphertext text not null,
  created_at timestamptz not null default now()
);
alter table gms_private.secrets enable row level security;

create table gms_private.fake_rail_objects (
  kind text not null check (kind in ('account', 'invite', 'recipient', 'request', 'transaction', 'event', 'webhook')),
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
alter table gms_private.fake_rail_objects enable row level security;

create table gms_private.test_auth_tokens (
  token_hash text primary key,
  email text not null,
  redirect_to text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table gms_private.test_auth_tokens enable row level security;

create table gms_private.test_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  aal text not null default 'aal1' check (aal in ('aal1', 'aal2')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table gms_private.test_auth_sessions enable row level security;

create table gms_private.test_auth_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  secret_ciphertext text not null,
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  created_at timestamptz not null default now()
);
alter table gms_private.test_auth_factors enable row level security;

-- Idempotency: stored inside the action's transaction so the response commits atomically with the change.
create or replace function gms_private.store_idempotency(
  p_key text, p_action text, p_ws uuid, p_actor uuid, p_hash text, p_response jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.idempotency_keys (key, action_id, workspace_id, actor_id, request_hash, response)
  values (p_key, p_action, p_ws, p_actor, p_hash, p_response)
  on conflict (action_id, key) do nothing
$$;
revoke all on function gms_private.store_idempotency(text, text, uuid, uuid, text, jsonb) from public;
grant execute on function gms_private.store_idempotency(text, text, uuid, uuid, text, jsonb) to gms_authenticated, gms_anon;

-- Outbox claiming for the worker (skip locked so several workers can drain concurrently).
create or replace function gms_private.claim_outbox(batch int default 50)
returns setof public.outbox
language sql as $$
  update public.outbox o set attempts = o.attempts + 1
  where o.id in (
    select id from public.outbox where processed_at is null and attempts < 10
    order by id for update skip locked limit batch
  )
  returning o.*
$$;

-- Sequential reference numbers per workspace/year.
create table gms_private.reference_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  year int not null,
  value int not null default 0,
  primary key (workspace_id, kind, year)
);
alter table gms_private.reference_counters enable row level security;

create or replace function gms_private.next_reference(p_ws uuid, p_kind text, p_year int) returns int
language sql security definer set search_path = '' as $$
  insert into gms_private.reference_counters (workspace_id, kind, year, value) values (p_ws, p_kind, p_year, 1)
  on conflict (workspace_id, kind, year) do update set value = gms_private.reference_counters.value + 1
  returning value
$$;
revoke all on function gms_private.next_reference(uuid, text, int) from public;
grant execute on function gms_private.next_reference(uuid, text, int) to gms_authenticated;

-- Workspace settings/brand/policies rows are created with the workspace.
create or replace function gms_private.workspace_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_settings (workspace_id) values (new.id) on conflict do nothing;
  insert into public.workspace_brand (workspace_id, display_name) values (new.id, new.name) on conflict do nothing;
  insert into public.agent_policies (workspace_id) values (new.id) on conflict do nothing;
  return new;
end
$$;
create trigger workspaces_defaults after insert on public.workspaces
  for each row execute function gms_private.workspace_defaults();

-- Profiles follow auth.users (Supabase Auth or the test adapter).
create or replace function gms_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function gms_private.handle_new_user();
