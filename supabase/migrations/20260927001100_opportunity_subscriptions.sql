-- SPDX-License-Identifier: AGPL-3.0-or-later
-- "Notify me" on forecasted opportunities: signed-in people subscribe; the worker emails them when it opens.
create table public.opportunity_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (opportunity_id, user_id)
);
create index on public.opportunity_subscriptions (workspace_id);
alter table public.opportunity_subscriptions enable row level security;
create policy opp_subs_self on public.opportunity_subscriptions for select to gms_authenticated
  using (user_id = gms.uid() or gms.is_member(workspace_id, array['owner', 'admin', 'program_officer', 'auditor']));
create policy opp_subs_insert on public.opportunity_subscriptions for insert to gms_authenticated
  with check (user_id = gms.uid() and gms.opportunity_is_public(opportunity_id));
create policy opp_subs_delete on public.opportunity_subscriptions for delete to gms_authenticated
  using (user_id = gms.uid());
select gms_private.install_workspace_consistency_triggers();
