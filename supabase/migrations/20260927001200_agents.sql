-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Agents (packages/agents): let a status change made by an agent acting for an applicant be recorded.
--
-- recordStatus() writes status_history rows for agent actors as actor_type = 'agent' and actor_id = the agent
-- client (agent_clients.id), so the timeline reads "<agent>, acting for <person>". The applicant branch of
-- status_history_insert only accepted actor_id = gms.uid(), so an application an agent prepared could never be
-- submitted — not even after the person confirmed the approval request (decideApproval runs the action as the
-- agent, with the person's claims). The person (gms.uid()) is still the RLS subject and must still be an
-- editor of the application; the agent client must be one the person has actually connected (their own PAT
-- client, an active consent grant, or an agent account they own).

create or replace function gms.agent_acts_for(client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select client is not null and gms.uid() is not null and exists (
    select 1 from public.agent_clients c
    where c.id = client
      and c.status = 'active'
      and (
        (c.owner_user_id = gms.uid() and c.kind in ('pat_client', 'agent_account'))
        or exists (
          select 1 from public.personal_access_tokens p
          where p.agent_client_id = c.id and p.user_id = gms.uid() and p.revoked_at is null)
        or exists (
          select 1 from public.agent_grants g
          where g.client_id = c.id and g.user_id = gms.uid() and g.status = 'active'
            and (g.expires_at is null or g.expires_at > now()))
      )
  )
$$;
revoke all on function gms.agent_acts_for(uuid) from public;
grant execute on function gms.agent_acts_for(uuid) to gms_authenticated;

drop policy status_history_insert on public.status_history;
create policy status_history_insert on public.status_history for insert to gms_authenticated with check (
  gms.is_member(workspace_id, array['owner', 'admin', 'program_officer'])
  or (
    gms.is_applicant_editor_for(application_id)
    and to_status in ('submitted', 'withdrawn')
    and (
      actor_id = gms.uid()
      or (actor_type = 'agent' and gms.agent_acts_for(actor_id))
    )
  )
);
