-- SPDX-License-Identifier: AGPL-3.0-or-later
-- OAuth consent: let the consenting person see the client they are about to connect.
--
-- `oauth.grant_consent` runs under RLS as the person. agent_clients_select only shows clients the person owns,
-- clients of a workspace where they are staff, or clients they already hold a grant/PAT for — so an applicant
-- could never see a DCR client (workspace = tenant, no owner) or a CIMD client (no workspace) at consent time,
-- which is exactly when they have no grant yet. Rather than widening the table policy (the row carries
-- client_secret_hash and redirect_uris), expose only the non-secret columns a consent screen needs, only for
-- OAuth clients, and only those registered with the tenant being consented on (or workspace-less CIMD clients).

create or replace function gms.oauth_client_public(client uuid, tenant uuid)
returns table (id uuid, name text, logo_url text, homepage_url text, scopes text[], status text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.logo_url, c.homepage_url, c.scopes, c.status
  from public.agent_clients c
  where c.id = client
    and gms.uid() is not null
    and c.kind = 'oauth_client'
    and (c.workspace_id is null or c.workspace_id = tenant)
$$;
revoke all on function gms.oauth_client_public(uuid, uuid) from public;
grant execute on function gms.oauth_client_public(uuid, uuid) to gms_authenticated;
