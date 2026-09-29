-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Security-definer functions for flows where the caller is not yet a member:
-- accepting a workspace invitation and accepting an application collaborator invitation.
-- Each validates that the signed-in email matches the invitation before granting anything.

create or replace function gms.accept_invitation(p_token_hash text)
returns table (workspace_id uuid, role text)
language plpgsql security definer set search_path = '' as $$
declare
  inv record;
  me uuid := gms.uid();
begin
  if me is null then
    return;
  end if;
  select i.* into inv from public.invitations i
  where i.token_hash = p_token_hash and i.status = 'pending' and i.expires_at > now()
    and lower(i.email) = gms.email()
  for update;
  if not found then
    return;
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (inv.workspace_id, me, inv.role, inv.invited_by)
  on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active';
  update public.invitations set status = 'accepted', accepted_at = now() where id = inv.id;
  workspace_id := inv.workspace_id;
  role := inv.role;
  return next;
end
$$;

create or replace function gms.accept_collaborator_invite(p_token_hash text)
returns table (application_id uuid, workspace_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  me uuid := gms.uid();
begin
  if me is null then
    return;
  end if;
  select x.* into c from public.application_collaborators x
  where x.token_hash = p_token_hash and x.status = 'invited' and lower(x.email) = gms.email()
  for update;
  if not found then
    return;
  end if;
  update public.application_collaborators set user_id = me, status = 'active', token_hash = null where id = c.id;
  application_id := c.application_id;
  workspace_id := c.workspace_id;
  return next;
end
$$;

revoke all on function gms.accept_invitation(text) from public;
revoke all on function gms.accept_collaborator_invite(text) from public;
grant execute on function gms.accept_invitation(text) to gms_authenticated;
grant execute on function gms.accept_collaborator_invite(text) to gms_authenticated;
