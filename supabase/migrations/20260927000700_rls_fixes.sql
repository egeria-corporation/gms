-- SPDX-License-Identifier: AGPL-3.0-or-later
-- RLS / integrity fixes found by the RLS matrix audit (packages/db/test/rls-matrix.db.test.ts).
-- Every change here only narrows what the gms_anon / gms_authenticated roles can do; service
-- connections (executor system actor, workers, webhooks) are unaffected unless stated.
--
--  1. application_collaborators: a collaborator could re-point their own row at ANY application
--     (and self-promote viewer -> editor); viewers could add editors.            [critical]
--  2. review_assignments: a reviewer could re-point their own assignment at ANY application
--     (then declare "no conflict" and read it) or un-recuse themselves.         [critical]
--  3. Cross-workspace references: child rows could reference a parent in another workspace
--     (e.g. an admin of B countersigning A's agreement, B's finance paying against A's award
--     and consuming its ceiling, planting rows in A's applications).            [high]
--  4. payment_batches: approved_by / second_approved_by / status could be written directly,
--     bypassing payment_approvals (aal2 + maker-checker); created_by was spoofable. [high]
--  5. application_submissions: applicants (incl. viewers) could append a new snapshot after the
--     deadline, changing what reviewers read (latest snapshot wins).           [high]
--  6. applications: viewer collaborators could update/withdraw; applicants could move an
--     application to another opportunity or apply to draft/unpublished opportunities. [medium]
--  7. agreements: a grantee org admin could rewrite the agreement body/hash/award while signing. [medium]
--  8. signatures: the signed document_hash was not tied to the agreement's hash. [medium]
--  9. attachments / org_documents: uploaders could mark files as virus-scanned "clean", attach
--     files to any report submission, and re-point attachments at other applications; auditors
--     and finance could modify application attachments.                        [medium]
-- 10. status_history: anyone who could view an application (reviewers, finance, auditors) could
--     forge history rows.                                                      [medium]
-- 11. messages / threads: applicants could rewrite staff-authored messages.     [medium]
-- 12. applicant_orgs: org admins could forge EIN verification (ein_verified_at, irs_status). [low]
-- 13. applicant_org_members bootstrap: the "org has no members" check ran under RLS, so an org's
--     creator could re-add themselves as org_admin after being removed.         [low]
-- 14. agent_clients: an owner of a personal client could move it into a workspace / change kind. [low]
-- 15. gms_private.append_audit: callers under RLS could write audit rows naming another person. [medium]
-- 16. public_awards: amount_cents was computed under the caller's RLS (0 for anonymous users) and
--     suspended workspaces were listed; the view also carried write grants.      [bug]
-- 17. Supabase Data API roles (anon/authenticated): revoke again and remove default privileges so
--     tables created by later migrations never become reachable through PostgREST. [latent]

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function gms_private.is_rls_role() returns boolean
language sql stable as $$
  select current_user::text in ('gms_authenticated', 'gms_anon')
$$;

-- Applicant-side editors regardless of application status (viewers excluded).
create or replace function gms.is_applicant_editor_for(app uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    where a.id = app and (
      a.applicant_user_id = gms.uid()
      or (a.applicant_org_id is not null and gms.is_org_member(a.applicant_org_id))
      or exists (
        select 1 from public.application_collaborators c
        where c.application_id = a.id and c.user_id = gms.uid() and c.status = 'active' and c.role = 'editor')
    )
  )
$$;
grant execute on function gms.is_applicant_editor_for(uuid) to gms_anon, gms_authenticated;

-- Grantee org members may attach files to their own draft / returned report submissions.
create or replace function gms_private.can_edit_report_submission(rs uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.report_submissions s
    join public.awards a on a.id = s.award_id
    where s.id = rs and s.status in ('draft', 'revisions_requested')
      and a.applicant_org_id is not null and gms.is_org_member(a.applicant_org_id)
  )
$$;

create or replace function gms_private.org_has_members(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.applicant_org_members m where m.org_id = org)
$$;

-- Workspace of any workspace-owned row (used by the consistency trigger; bypasses RLS on purpose).
create or replace function gms_private.row_workspace(tbl regclass, col text, val text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  ws uuid;
  typ text;
begin
  select format_type(a.atttypid, a.atttypmod) into typ
  from pg_attribute a where a.attrelid = tbl and a.attname = col and not a.attisdropped;
  if typ is null then
    return null;
  end if;
  execute format('select workspace_id from %s where %I = $1::%s', tbl, col, typ) into ws using val;
  return ws;
end
$$;
revoke all on function gms_private.row_workspace(regclass, text, text) from public;
grant execute on function gms_private.row_workspace(regclass, text, text) to gms_anon, gms_authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cross-workspace reference guard (installed on every public table that has workspace_id and
--    a single-column FK to another public table that has workspace_id). Trigger args are
--    (fk column, parent table, parent column) triples.
--    Enforced for request roles only; service code is trusted (and has no such paths).
-- ---------------------------------------------------------------------------
create or replace function gms_private.enforce_workspace_consistency() returns trigger
language plpgsql as $$
declare
  doc jsonb;
  child_ws uuid;
  i int := 0;
  ref text;
  parent_ws uuid;
begin
  if not gms_private.is_rls_role() then
    return new;
  end if;
  doc := to_jsonb(new);
  child_ws := nullif(doc ->> 'workspace_id', '')::uuid;
  if child_ws is null then
    return new;
  end if;
  while i < tg_nargs loop
    ref := doc ->> tg_argv[i];
    if ref is not null then
      parent_ws := gms_private.row_workspace(tg_argv[i + 1]::regclass, tg_argv[i + 2], ref);
      if parent_ws is not null and parent_ws <> child_ws then
        raise exception '%.% references a row in another workspace', tg_table_name, tg_argv[i]
          using errcode = '42501', hint = 'cross_workspace_reference';
      end if;
    end if;
    i := i + 3;
  end loop;
  return new;
end
$$;

create or replace function gms_private.install_workspace_consistency_triggers() returns void
language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as child,
      string_agg(format('%L, %L, %L', ca.attname, format('%I.%I', pn.nspname, pc.relname), pa.attname), ', ' order by ca.attname) as args
    from pg_constraint c
    join pg_class cc on cc.oid = c.conrelid
    join pg_namespace cn on cn.oid = cc.relnamespace and cn.nspname = 'public'
    join pg_class pc on pc.oid = c.confrelid
    join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
    join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1
      and pc.relname <> 'workspaces'
      and exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'workspace_id' and not x.attisdropped)
      and exists (select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'workspace_id' and not x.attisdropped)
    group by c.conrelid
  loop
    execute format('drop trigger if exists workspace_consistency on %s', r.child);
    execute format(
      'create trigger workspace_consistency before insert or update on %s for each row execute function gms_private.enforce_workspace_consistency(%s)',
      r.child, r.args);
  end loop;
end
$$;
select gms_private.install_workspace_consistency_triggers();

-- ---------------------------------------------------------------------------
-- 1. application_collaborators
-- ---------------------------------------------------------------------------
drop policy collaborators_write on public.application_collaborators;
create policy collaborators_write on public.application_collaborators for insert to gms_authenticated
  with check (gms.is_applicant_editor_for(application_id));
drop policy collaborators_update on public.application_collaborators;
create policy collaborators_update on public.application_collaborators for update to gms_authenticated
  using (gms.is_applicant_editor_for(application_id) or user_id = gms.uid())
  with check (gms.is_applicant_editor_for(application_id) or user_id = gms.uid());
drop policy collaborators_delete on public.application_collaborators;
create policy collaborators_delete on public.application_collaborators for delete to gms_authenticated
  using (gms.is_applicant_editor_for(application_id));

create or replace function gms_private.application_collaborators_guard() returns trigger
language plpgsql as $$
begin
  if not gms_private.is_rls_role() then
    return new;
  end if;
  if new.application_id <> old.application_id or new.workspace_id <> old.workspace_id then
    raise exception 'collaborators cannot be moved to another application' using errcode = '42501';
  end if;
  if not gms.is_applicant_editor_for(old.application_id) then
    -- The invitee acting on their own row may only accept or leave.
    if new.user_id is distinct from old.user_id or new.email <> old.email or new.role <> old.role
       or new.token_hash is distinct from old.token_hash or new.invited_by is distinct from old.invited_by
       or not (new.status = old.status
               or (old.status = 'invited' and new.status in ('active', 'removed'))
               or (old.status = 'active' and new.status = 'removed')) then
      raise exception 'collaborators can only accept or leave an invitation' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger application_collaborators_guard before update on public.application_collaborators
  for each row execute function gms_private.application_collaborators_guard();

-- ---------------------------------------------------------------------------
-- 2. review_assignments
-- ---------------------------------------------------------------------------
create or replace function gms_private.review_assignments_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() and not gms.is_member(old.workspace_id, array['owner', 'admin', 'program_officer']) then
    if new.application_id <> old.application_id or new.stage_id <> old.stage_id or new.reviewer_id <> old.reviewer_id
       or new.workspace_id <> old.workspace_id or new.assigned_by is distinct from old.assigned_by
       or new.due_at is distinct from old.due_at then
      raise exception 'reviewers can only change the status of their assignment' using errcode = '42501';
    end if;
    if old.status = 'recused' and new.status <> 'recused' then
      raise exception 'a recusal can only be reversed by staff' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger review_assignments_guard before update on public.review_assignments
  for each row execute function gms_private.review_assignments_guard();

-- ---------------------------------------------------------------------------
-- 4. payment_batches: approvals only through payment_approvals
-- ---------------------------------------------------------------------------
create or replace function gms_private.payment_batches_guard() returns trigger
language plpgsql as $$
begin
  if not gms_private.is_rls_role() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is distinct from gms.uid() then
      raise exception 'payment batches are created by the signed-in user' using errcode = '42501', hint = 'maker_checker';
    end if;
    if new.approved_by is not null or new.second_approved_by is not null or new.approved_at is not null
       or new.second_approved_at is not null or new.status not in ('draft', 'awaiting_approval') then
      raise exception 'new payment batches cannot be pre-approved' using errcode = '42501', hint = 'maker_checker';
    end if;
    return new;
  end if;
  if new.created_by <> old.created_by then
    raise exception 'the creator of a payment batch cannot change' using errcode = '42501', hint = 'maker_checker';
  end if;
  if old.requires_second_approval and not new.requires_second_approval then
    raise exception 'a required second approval cannot be removed' using errcode = '42501', hint = 'maker_checker';
  end if;
  if new.approved_by is distinct from old.approved_by and new.approved_by is not null and not exists (
    select 1 from public.payment_approvals pa
    where pa.batch_id = new.id and pa.approver_id = new.approved_by and pa.decision = 'approve' and pa.aal = 'aal2') then
    raise exception 'approved_by must match a recorded approval' using errcode = '42501', hint = 'maker_checker';
  end if;
  if new.second_approved_by is distinct from old.second_approved_by and new.second_approved_by is not null and not exists (
    select 1 from public.payment_approvals pa
    where pa.batch_id = new.id and pa.approver_id = new.second_approved_by and pa.decision = 'approve' and pa.aal = 'aal2') then
    raise exception 'second_approved_by must match a recorded approval' using errcode = '42501', hint = 'maker_checker';
  end if;
  if new.status in ('approved', 'submitting', 'submitted') and old.status is distinct from new.status
     and (new.approved_by is null or (new.requires_second_approval and new.second_approved_by is null)) then
    raise exception 'payment batch % is missing required approvals', new.id using errcode = '42501', hint = 'maker_checker';
  end if;
  return new;
end
$$;
create trigger payment_batches_guard before insert or update on public.payment_batches
  for each row execute function gms_private.payment_batches_guard();

-- ---------------------------------------------------------------------------
-- 5. application_submissions: snapshots only while the application is editable, by editors
-- ---------------------------------------------------------------------------
drop policy submissions_insert on public.application_submissions;
create policy submissions_insert on public.application_submissions for insert to gms_authenticated
  with check (gms.can_edit_application(application_id) and (submitted_by is null or submitted_by = gms.uid()));

-- ---------------------------------------------------------------------------
-- 6. applications
-- ---------------------------------------------------------------------------
drop policy applications_applicant_update on public.applications;
create policy applications_applicant_update on public.applications for update to gms_authenticated
  using (gms.is_applicant_editor_for(id)) with check (gms.is_applicant_editor_for(id));

drop policy applications_applicant_insert on public.applications;
create policy applications_applicant_insert on public.applications for insert to gms_authenticated with check (
  applicant_user_id = gms.uid() and status = 'in_progress'
  and (applicant_org_id is null or gms.is_org_member(applicant_org_id))
  and gms.opportunity_is_public(opportunity_id)
  and exists (
    select 1 from public.competitions c
    where c.id = competition_id and c.opportunity_id = applications.opportunity_id and c.status <> 'draft')
);

create or replace function gms_private.applications_guard_extra() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() and not gms.is_member(old.workspace_id, array['owner', 'admin', 'program_officer']) then
    if new.opportunity_id <> old.opportunity_id or new.created_via <> old.created_via then
      raise exception 'applicants cannot change application ownership' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger applications_guard_extra before update on public.applications
  for each row execute function gms_private.applications_guard_extra();

-- form_responses: editors only (viewers were already excluded by can_edit_application).

-- ---------------------------------------------------------------------------
-- 7. agreements: a grantee may only sign (sent -> signed); content is staff-owned
-- ---------------------------------------------------------------------------
drop policy agreements_grantee_update on public.agreements;
create policy agreements_grantee_update on public.agreements for update to gms_authenticated using (
  status = 'sent' and exists (
    select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id, array['org_admin']))
) with check (
  status in ('sent', 'signed') and exists (
    select 1 from public.awards a where a.id = award_id and gms.is_org_member(a.applicant_org_id, array['org_admin']))
);

create or replace function gms_private.agreements_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() and not gms.is_member(old.workspace_id, array['owner', 'admin', 'program_officer']) then
    if (to_jsonb(new) - 'status' - 'last_modified_at') <> (to_jsonb(old) - 'status' - 'last_modified_at')
       or not (new.status = old.status or (old.status = 'sent' and new.status = 'signed')) then
      raise exception 'grantees can only sign an agreement' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger agreements_guard before update on public.agreements
  for each row execute function gms_private.agreements_guard();

-- ---------------------------------------------------------------------------
-- 8. signatures bind to the agreement's document hash
-- ---------------------------------------------------------------------------
drop policy signatures_staff_insert on public.signatures;
create policy signatures_staff_insert on public.signatures for insert to gms_authenticated with check (
  signer_id = gms.uid() and signer_role = 'foundation' and gms.is_member(workspace_id, array['owner', 'admin'])
  and exists (
    select 1 from public.agreements g
    where g.id = agreement_id and g.workspace_id = signatures.workspace_id
      and signatures.document_hash = coalesce(g.document_hash, signatures.document_hash))
);
drop policy signatures_grantee_insert on public.signatures;
create policy signatures_grantee_insert on public.signatures for insert to gms_authenticated with check (
  signer_id = gms.uid() and signer_role = 'grantee' and exists (
    select 1 from public.agreements g join public.awards a on a.id = g.award_id
    where g.id = agreement_id and g.status = 'sent' and g.workspace_id = signatures.workspace_id
      and signatures.document_hash = coalesce(g.document_hash, signatures.document_hash)
      and gms.is_org_member(a.applicant_org_id, array['org_admin']))
);

-- ---------------------------------------------------------------------------
-- 9. attachments / org_documents
-- ---------------------------------------------------------------------------
drop policy attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to gms_authenticated with check (
  uploaded_by = gms.uid() and (
    (application_id is not null and gms.can_edit_application(application_id))
    or (application_id is null and report_submission_id is null)
    or (application_id is null and report_submission_id is not null and gms_private.can_edit_report_submission(report_submission_id))
  )
);
drop policy attachments_update on public.attachments;
create policy attachments_update on public.attachments for update to gms_authenticated
  using (uploaded_by = gms.uid() or gms.is_member(workspace_id, array['owner', 'admin', 'program_officer']))
  with check (
    gms.is_member(workspace_id, array['owner', 'admin', 'program_officer'])
    or (uploaded_by = gms.uid() and (
      (application_id is not null and gms.can_edit_application(application_id))
      or (application_id is null and report_submission_id is null)
      or (application_id is null and report_submission_id is not null and gms_private.can_edit_report_submission(report_submission_id))
    ))
  );

-- Scan results are written by the worker (service) only.
create or replace function gms_private.scan_status_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() then
    if tg_op = 'INSERT' and new.scan_status <> 'pending' then
      raise exception 'uploads start unscanned' using errcode = '42501', hint = 'scan_status';
    end if;
    if tg_op = 'UPDATE' and new.scan_status <> old.scan_status then
      raise exception 'scan results are recorded by the scanner' using errcode = '42501', hint = 'scan_status';
    end if;
  end if;
  return new;
end
$$;
create trigger attachments_scan_guard before insert or update on public.attachments
  for each row execute function gms_private.scan_status_guard();
create trigger org_documents_scan_guard before insert or update on public.org_documents
  for each row execute function gms_private.scan_status_guard();

-- ---------------------------------------------------------------------------
-- 10. status_history: staff writers, or applicant editors recording their own applicant transition
-- ---------------------------------------------------------------------------
drop policy status_history_insert on public.status_history;
create policy status_history_insert on public.status_history for insert to gms_authenticated with check (
  gms.is_member(workspace_id, array['owner', 'admin', 'program_officer'])
  or (gms.is_applicant_editor_for(application_id) and actor_id = gms.uid() and to_status in ('submitted', 'withdrawn'))
);

-- ---------------------------------------------------------------------------
-- 11. messages / threads: applicants may only mark read / bump activity
-- ---------------------------------------------------------------------------
create or replace function gms_private.messages_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() and not gms.is_member(old.workspace_id, array['owner', 'admin', 'program_officer', 'finance']) then
    if (to_jsonb(new) - 'read_by_applicant_at') <> (to_jsonb(old) - 'read_by_applicant_at') then
      raise exception 'applicants can only mark messages as read' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger messages_guard before update on public.messages
  for each row execute function gms_private.messages_guard();

create or replace function gms_private.threads_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() and not gms.is_member(old.workspace_id, array['owner', 'admin', 'program_officer', 'finance']) then
    if (to_jsonb(new) - 'last_message_at' - 'last_modified_at') <> (to_jsonb(old) - 'last_message_at' - 'last_modified_at') then
      raise exception 'applicants cannot change a thread' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger threads_guard before update on public.threads
  for each row execute function gms_private.threads_guard();

-- ---------------------------------------------------------------------------
-- 12. applicant_orgs verification fields are set by the IRS check (service)
-- ---------------------------------------------------------------------------
create or replace function gms_private.applicant_orgs_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() then
    if tg_op = 'INSERT' and (new.ein_verified_at is not null or new.irs_status is not null) then
      raise exception 'EIN verification is recorded by GMS' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.ein_verified_at is distinct from old.ein_verified_at
                             or new.irs_status is distinct from old.irs_status
                             or (new.ein is distinct from old.ein and new.ein_verified_at is not null)) then
      raise exception 'EIN verification is recorded by GMS' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger applicant_orgs_guard before insert or update on public.applicant_orgs
  for each row execute function gms_private.applicant_orgs_guard();

-- ---------------------------------------------------------------------------
-- 13. applicant_org_members bootstrap check must not run under RLS
-- ---------------------------------------------------------------------------
drop policy org_members_insert on public.applicant_org_members;
create policy org_members_insert on public.applicant_org_members for insert to gms_authenticated
  with check (
    gms.is_org_member(org_id, array['org_admin'])
    or (
      user_id = gms.uid() and role = 'org_admin'
      and exists (select 1 from public.applicant_orgs o where o.id = org_id and o.created_by = gms.uid())
      and not gms_private.org_has_members(org_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 14. agent_clients: owners manage only their personal (workspace-less) PAT clients
-- ---------------------------------------------------------------------------
drop policy agent_clients_update on public.agent_clients;
create policy agent_clients_update on public.agent_clients for update to gms_authenticated
  using ((workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin'])) or owner_user_id = gms.uid())
  with check (
    (workspace_id is not null and gms.is_member(workspace_id, array['owner', 'admin']))
    or (owner_user_id = gms.uid() and workspace_id is null and kind = 'pat_client')
  );

-- ---------------------------------------------------------------------------
-- 15. append_audit: request roles may only write entries about themselves
-- ---------------------------------------------------------------------------
create or replace function gms_private.append_audit(entry jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  req_role text := current_setting('role', true);
begin
  if req_role in ('gms_authenticated', 'gms_anon') then
    if entry ->> 'actor_type' = 'system' then
      raise exception 'system audit entries are written by the service' using errcode = '42501';
    end if;
    if entry ->> 'actor_type' = 'human'
       and nullif(entry ->> 'actor_id', '')::uuid is distinct from gms.uid() then
      raise exception 'audit entries must name the signed-in person' using errcode = '42501';
    end if;
    if entry ->> 'actor_type' = 'agent'
       and nullif(entry ->> 'on_behalf_of', '')::uuid is distinct from gms.uid() then
      raise exception 'agent audit entries must name the person the agent acts for' using errcode = '42501';
    end if;
  end if;
  insert into public.audit_log (
    workspace_id, actor_type, actor_id, actor_name, agent_client_id, on_behalf_of, on_behalf_of_name,
    action, entity_type, entity_id, before, after, risk_tier, approval_request_id, ip, user_agent, request_id)
  values (
    nullif(entry ->> 'workspace_id', '')::uuid,
    entry ->> 'actor_type',
    nullif(entry ->> 'actor_id', '')::uuid,
    entry ->> 'actor_name',
    nullif(entry ->> 'agent_client_id', '')::uuid,
    nullif(entry ->> 'on_behalf_of', '')::uuid,
    entry ->> 'on_behalf_of_name',
    entry ->> 'action',
    entry ->> 'entity_type',
    nullif(entry ->> 'entity_id', '')::uuid,
    entry -> 'before',
    entry -> 'after',
    entry ->> 'risk_tier',
    nullif(entry ->> 'approval_request_id', '')::uuid,
    nullif(entry ->> 'ip', '')::inet,
    entry ->> 'user_agent',
    entry ->> 'request_id')
  returning id into new_id;
  return new_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 16. public_awards: compute the ceiling as the view owner; active workspaces only; read-only
-- ---------------------------------------------------------------------------
create or replace view public.public_awards as
  select a.id, a.workspace_id, a.reference, a.title, a.purpose, a.currency, a.start_date, a.end_date, a.fiscal_year,
    a.created_at, a.last_modified_at, a.status,
    (a.amount_cents + coalesce((
      select sum(c.amount_cents) from public.awards c
      where c.parent_award_id = a.id and c.amendment_status = 'approved'), 0))::bigint as amount_cents,
    o.legal_name as recipient_name, addr.city as recipient_city, addr.state as recipient_state, addr.county as recipient_county,
    p.name as program_name, a.opportunity_id
  from public.awards a
  join public.workspaces w on w.id = a.workspace_id and w.status = 'active'
  join public.workspace_settings s on s.workspace_id = a.workspace_id and s.transparency_enabled
  left join public.applicant_orgs o on o.id = a.applicant_org_id
  left join public.org_addresses addr on addr.org_id = o.id and addr.kind = 'mailing'
  left join public.programs p on p.id = a.program_id
  where a.kind = 'original' and a.status in ('active', 'completed') and not a.grant_to_individual;
revoke all on public.public_awards from gms_anon, gms_authenticated;
grant select on public.public_awards to gms_anon, gms_authenticated;

-- ---------------------------------------------------------------------------
-- 17. Supabase Data API roles never reach GMS objects, now or in later migrations
-- ---------------------------------------------------------------------------
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
    end if;
  end loop;
end
$$;
