-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Narrow security-definer entry points for fields that request roles may not write directly
-- (scan results, EIN verification), plus guards for gaps found in the RLS audit.

-- 1. Record a scan result for an upload the caller made.
create or replace function gms_private.record_scan(
  p_kind text, p_id uuid, p_status text, p_sha256 text, p_size bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('clean', 'infected', 'not_scanned') then
    raise exception 'invalid scan status' using errcode = '22023';
  end if;
  if p_kind = 'attachment' then
    update public.attachments
      set scan_status = p_status, sha256 = coalesce(p_sha256, sha256), size_bytes = coalesce(p_size, size_bytes),
          status = case when p_status = 'infected' then 'deleted' else 'uploaded' end
      where id = p_id and uploaded_by = gms.uid() and scan_status = 'pending';
  elsif p_kind = 'org_document' then
    update public.org_documents
      set scan_status = p_status, sha256 = coalesce(p_sha256, sha256), size_bytes = coalesce(p_size, size_bytes)
      where id = p_id and uploaded_by = gms.uid() and scan_status = 'pending';
  else
    raise exception 'unknown upload kind' using errcode = '22023';
  end if;
  if not found then
    raise exception 'upload not found or already scanned' using errcode = '42501';
  end if;
end
$$;
revoke all on function gms_private.record_scan(text, uuid, text, text, bigint) from public;
grant execute on function gms_private.record_scan(text, uuid, text, text, bigint) to gms_authenticated;

-- 2. Set (optionally change) an organization's EIN and recompute IRS verification from imported IRS data.
create or replace function gms_private.verify_org_ein(p_org uuid, p_new_ein text default null)
returns table (verified boolean, irs_status text)
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  rec record;
  target_ein text;
begin
  if not gms.is_org_member(p_org, array['org_admin']) and not exists (
       select 1 from public.applicant_orgs x where x.id = p_org and x.created_by = gms.uid()) then
    raise exception 'only an organization admin can change its EIN' using errcode = '42501';
  end if;
  select * into o from public.applicant_orgs where id = p_org for update;
  target_ein := coalesce(p_new_ein, o.ein);
  select i.ein, i.name, i.status, i.pub78, i.subsection into rec from public.irs_exempt_orgs i where i.ein = target_ein;
  update public.applicant_orgs set
    ein = target_ein,
    ein_verified_at = case when rec.status = 'active' then now() else null end,
    irs_status = case when rec.ein is null then null
                      else jsonb_build_object('name', rec.name, 'status', rec.status, 'pub78', rec.pub78, 'subsection', rec.subsection) end
  where id = p_org;
  verified := rec.status = 'active';
  irs_status := rec.status;
  return next;
end
$$;
revoke all on function gms_private.verify_org_ein(uuid, text) from public;
grant execute on function gms_private.verify_org_ein(uuid, text) to gms_authenticated;

-- 3. Only owners grant or remove the owner role (defense in depth; the action layer checks too).
create or replace function gms_private.workspace_members_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() and not gms.is_member(coalesce(new.workspace_id, old.workspace_id), array['owner']) then
    if (tg_op in ('INSERT', 'UPDATE') and new.role = 'owner') or (tg_op in ('UPDATE', 'DELETE') and old.role = 'owner') then
      raise exception 'only an owner can change owner roles' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end
$$;
create trigger workspace_members_owner_guard before insert or update or delete on public.workspace_members
  for each row execute function gms_private.workspace_members_guard();

-- 4. Reviewers cannot reopen a submitted review or change its scores (staff reopen reviews).
create or replace function gms_private.reviews_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() and old.status = 'submitted'
     and not gms.is_member(old.workspace_id, array['owner', 'admin', 'program_officer']) then
    raise exception 'this review was submitted; ask the program officer to reopen it' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger reviews_submitted_guard before update on public.reviews
  for each row execute function gms_private.reviews_guard();

create or replace function gms_private.review_scores_guard() returns trigger
language plpgsql as $$
declare
  st text;
begin
  select r.status into st from public.reviews r where r.id = coalesce(new.review_id, old.review_id);
  if gms_private.is_rls_role() and st = 'submitted'
     and not gms.is_member(coalesce(new.workspace_id, old.workspace_id), array['owner', 'admin', 'program_officer']) then
    raise exception 'scores on a submitted review are locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;
create trigger review_scores_submitted_guard before insert or update or delete on public.review_scores
  for each row execute function gms_private.review_scores_guard();

-- 5. Report forms are visible to signed-in grantees only (not anonymous visitors).
drop policy if exists forms_public on public.forms;
create policy forms_public on public.forms for select to gms_anon, gms_authenticated using (
  exists (
    select 1 from public.competition_forms cf join public.competitions c on c.id = cf.competition_id
    where cf.form_id = forms.id and gms.opportunity_is_public(c.opportunity_id)
  )
);
create policy forms_report_authenticated on public.forms for select to gms_authenticated using (kind = 'report');

-- 6. Approval requests are decided through the service path only.
drop policy if exists approvals_update on public.approval_requests;

-- 7. The model-provider key reference is never readable by request roles.
revoke select on public.agent_policies from gms_authenticated;
grant select (workspace_id, ai_use, disclosure_prompt, reviewer_assist, agent_submissions_enabled, mcp_enabled, a2a_enabled,
  llm_provider, created_at, last_modified_at) on public.agent_policies to gms_authenticated;

-- 8. Applicants may only record precheck/submission eligibility results.
drop policy if exists eligibility_results_insert on public.eligibility_results;
create policy eligibility_results_insert on public.eligibility_results for insert to gms_authenticated with check (
  (source in ('precheck', 'submission') and gms.is_applicant_editor_for(application_id))
  or gms.is_member(workspace_id, array['owner', 'admin', 'program_officer'])
);

-- 9. Team comments: only the author edits the text; any applicant editor may resolve.
create or replace function gms_private.application_comments_guard() returns trigger
language plpgsql as $$
begin
  if gms_private.is_rls_role() and old.author_id is distinct from gms.uid()
     and (new.body is distinct from old.body or new.field_path is distinct from old.field_path or new.author_id is distinct from old.author_id) then
    raise exception 'only the author can edit a comment' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger application_comments_guard before update on public.application_comments
  for each row execute function gms_private.application_comments_guard();
