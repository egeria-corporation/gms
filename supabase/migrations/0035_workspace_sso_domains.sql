-- 0035_workspace_sso_domains.sql
-- Single sign-on (SAML 2.0) for funder workspaces. A funder workspace lists the email domains its
-- staff sign in with through the organization's identity provider, proves each one with a DNS TXT
-- record, and may require single sign-on for people whose address is on an active domain. The
-- identity provider itself is registered in Supabase Auth by the operator
-- (scripts/sso/register-provider.mjs); `provider_id` is the id Supabase gives it, the same value a
-- session carries in its `amr` claim after an SSO sign-in. docs/sso.md has the whole flow.
--
-- What this changes on a live database:
--   * adds the table workspace_sso_domains (new and empty), with RLS on: members of the workspace
--     read its rows; signed-in users write nothing directly (0009's rule). The API's service role
--     writes after its own checks: admin role, DNS proof, the SSO rule for turning the requirement
--     on, and the ledger.
--   * a domain is active for at most one workspace (partial unique index); any number of
--     workspaces may hold it as pending, so nobody can block a domain by claiming it first.
--   * adds gms.sso_domain_funder_only() (trigger: rows belong to funder workspaces) and three
--     operator functions, executable by the service role only: gms.activate_sso_domain,
--     gms.deactivate_sso_domain and gms.lift_sso_requirement (the lockout recovery). Each checks,
--     writes and appends its ledger row in one transaction.
-- No existing row is changed or removed, and no workspace requires single sign-on until one of its
-- admins turns it on.

create table public.workspace_sso_domains (
  id                  uuid primary key default gms.uuid_v7(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  -- Lowercase ASCII (punycode), no trailing dot; the API normalizes before writing.
  domain              text not null check (length(domain) <= 253 and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  -- pending: added, DNS proof outstanding or the identity provider not yet registered.
  -- active: the operator registered the identity provider for this domain (provider_id).
  status              text not null default 'pending' check (status in ('pending', 'active')),
  -- People whose email address is on this domain must sign in through single sign-on.
  require_sso         boolean not null default false,
  -- The Supabase Auth SSO provider's id (the `provider` of an `sso/saml` entry in `amr`).
  provider_id         uuid,
  -- The DNS TXT challenge: `gms-verify=<token>` at `_gms-verify.<domain>` (or at the domain).
  verification_token  text not null check (verification_token ~ '^[A-Za-z0-9_-]{43}$'),
  verified_at         timestamptz,
  last_checked_at     timestamptz,
  last_check_result   text check (last_check_result is null or last_check_result in ('matched', 'not_found', 'mismatch', 'error')),
  activated_at        timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, domain),
  -- Active exactly when a provider is registered, and only after the DNS proof.
  check ((status = 'active') = (provider_id is not null and activated_at is not null)),
  check (status = 'pending' or verified_at is not null),
  -- Requiring single sign-on for a domain nobody can sign in through would lock its people out.
  check (not require_sso or status = 'active')
);
comment on table public.workspace_sso_domains is 'Email domains a funder workspace signs in with through SAML single sign-on, their DNS proof, and whether SSO is required for them. Members read; the API writes; the operator activates.';
comment on column public.workspace_sso_domains.provider_id is 'Supabase Auth SSO provider id, as carried in a session''s amr claim (method sso/saml).';

-- A domain is active for one workspace at most.
create unique index workspace_sso_domains_active_domain on public.workspace_sso_domains (domain) where status = 'active';

-- Rows belong to funder workspaces.
create or replace function gms.sso_domain_funder_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select w.kind from public.workspaces w where w.id = new.workspace_id) is distinct from 'funder' then
    raise exception '%: single sign-on domains belong to funder workspaces', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger workspace_sso_domains_touch_updated_at before update on public.workspace_sso_domains
  for each row execute function gms.touch_updated_at();
create trigger workspace_sso_domains_funder_only before insert or update of workspace_id on public.workspace_sso_domains
  for each row execute function gms.sso_domain_funder_only();
create trigger workspace_sso_domains_workspace_immutable before update of workspace_id on public.workspace_sso_domains
  for each row execute function gms.workspace_id_immutable();

alter table public.workspace_sso_domains enable row level security;
revoke all on public.workspace_sso_domains from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.workspace_sso_domains to service_role;
grant select on public.workspace_sso_domains to authenticated;
create policy workspace_sso_domains_select on public.workspace_sso_domains for select to authenticated
  using (gms.is_member(workspace_id));

-- ---------------------------------------------------------------------------------------------
-- Operator functions. The operator runs these (SQL editor, or the service role) after registering
-- or removing an identity provider; nothing in the API calls them. Each refuses what it should not
-- do, writes, and appends its ledger row as `system:operator`, in one transaction.
-- ---------------------------------------------------------------------------------------------

-- Mark a proved domain active with the identity provider registered for it.
create or replace function gms.activate_sso_domain(p_workspace uuid, p_domain text, p_provider_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.workspace_sso_domains%rowtype;
begin
  if p_provider_id is null then
    raise exception 'name the identity provider''s id (from the register-provider script)' using errcode = '22023';
  end if;
  select * into r from public.workspace_sso_domains d
   where d.workspace_id = p_workspace and d.domain = pg_catalog.lower(pg_catalog.btrim(p_domain))
   for update;
  if not found then
    raise exception 'this workspace has not added % as a single sign-on domain', p_domain using errcode = 'P0002';
  end if;
  if r.status = 'active' then
    raise exception '% is already active for this workspace', r.domain using errcode = '55000';
  end if;
  if r.verified_at is null then
    raise exception '% has no DNS proof yet: the workspace admin checks the TXT record first', r.domain using errcode = '55000';
  end if;
  if exists (select 1 from public.workspace_sso_domains o where o.domain = r.domain and o.status = 'active' and o.id <> r.id) then
    raise exception '% is already active for another workspace', r.domain using errcode = '23505';
  end if;
  update public.workspace_sso_domains
     set status = 'active', provider_id = p_provider_id, activated_at = pg_catalog.now()
   where id = r.id;
  insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data)
  values (r.workspace_id, 'system:operator', 'sso_domain.activated', 'sso_domain', r.id::text,
          pg_catalog.jsonb_build_object('domain', r.domain, 'providerId', p_provider_id, 'from', 'pending', 'to', 'active'));
  return r.id;
end;
$$;

-- Back to pending (the identity provider was removed or replaced). Also lifts the requirement.
create or replace function gms.deactivate_sso_domain(p_workspace uuid, p_domain text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.workspace_sso_domains%rowtype;
begin
  select * into r from public.workspace_sso_domains d
   where d.workspace_id = p_workspace and d.domain = pg_catalog.lower(pg_catalog.btrim(p_domain))
   for update;
  if not found then
    raise exception 'this workspace has not added % as a single sign-on domain', p_domain using errcode = 'P0002';
  end if;
  if r.status <> 'active' then
    raise exception '% is not active', r.domain using errcode = '55000';
  end if;
  update public.workspace_sso_domains
     set status = 'pending', provider_id = null, activated_at = null, require_sso = false
   where id = r.id;
  insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data)
  values (r.workspace_id, 'system:operator', 'sso_domain.deactivated', 'sso_domain', r.id::text,
          pg_catalog.jsonb_build_object('domain', r.domain, 'providerId', r.provider_id, 'from', 'active', 'to', 'pending', 'requirementLifted', r.require_sso));
  return r.id;
end;
$$;

-- Lockout recovery: stop requiring single sign-on in a workspace (every domain), e.g. when its
-- identity provider is down and no admin can sign in. Returns how many domains it changed.
create or replace function gms.lift_sso_requirement(p_workspace uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 1 and 500 then
    raise exception 'say why the requirement is lifted (1 to 500 characters)' using errcode = '22023';
  end if;
  update public.workspace_sso_domains set require_sso = false where workspace_id = p_workspace and require_sso;
  get diagnostics n = row_count;
  insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data)
  values (p_workspace, 'system:operator', 'sso.requirement_lifted', 'workspace', p_workspace::text,
          pg_catalog.jsonb_build_object('domains', n, 'reason', pg_catalog.btrim(p_reason)));
  return n;
end;
$$;

revoke all on function gms.activate_sso_domain(uuid, text, uuid) from public, anon, authenticated;
revoke all on function gms.deactivate_sso_domain(uuid, text) from public, anon, authenticated;
revoke all on function gms.lift_sso_requirement(uuid, text) from public, anon, authenticated;
revoke all on function gms.sso_domain_funder_only() from public, anon, authenticated;
grant execute on function gms.activate_sso_domain(uuid, text, uuid) to service_role;
grant execute on function gms.deactivate_sso_domain(uuid, text) to service_role;
grant execute on function gms.lift_sso_requirement(uuid, text) to service_role;
