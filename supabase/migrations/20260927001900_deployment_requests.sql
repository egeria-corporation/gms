-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Custom deployment requests. The hosted service (gms.opengrants.io) serves every foundation at
-- {slug}.gms.opengrants.io and does not offer custom domains; a foundation that needs its own domain or a
-- dedicated installation asks for one here. Owners and admins file and read their workspace's requests; the
-- platform team works them from the operator console (status changes run as system actions).

create table public.deployment_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('custom_domain', 'dedicated', 'other')),
  desired_domain text check (desired_domain is null or desired_domain ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'),
  details text not null check (char_length(details) between 1 and 4000),
  contact_email text not null check (contact_email ~ '^[^@\s]+@[^@\s]+$'),
  status text not null default 'new' check (status in ('new', 'in_review', 'closed')),
  created_at timestamptz not null default now(),
  last_modified_at timestamptz not null default now()
);
create index on public.deployment_requests (workspace_id, created_at desc);

select gms_private.staff_policies('deployment_requests', array['owner', 'admin'], null);
create policy deployment_requests_insert on public.deployment_requests for insert to gms_authenticated
  with check (requested_by = gms.uid() and status = 'new' and gms.is_member(workspace_id, array['owner', 'admin']));

select gms_private.install_touch_triggers();
select gms_private.install_workspace_consistency_triggers();
