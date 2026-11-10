-- 0009_rls: row level security, grants and updated_at triggers for every table.
--
-- The Workers use the service role (which bypasses RLS) and still filter every query by
-- workspace_id. These policies are written as if a user-scoped key were in use, so the schema
-- stays safe if one ever is:
--   * anon:          no table access at all (public pages are served by the Worker from published fields).
--   * authenticated: SELECT only, limited by the policies below. Every write goes through the
--                    service layer (one authorization check, packages/workflow for status changes).
--   * service_role:  everything, except UPDATE/DELETE/TRUNCATE on the ledger tables.
-- Tables that hold secrets or OAuth state get RLS with no policy and no grant: invisible to users.
--
-- RLS is row-level. Column-level rules (funder-internal columns on applications, PII masking for
-- external reviewers, reviewerVisible form fields) are enforced by the service layer; reviewers
-- therefore get no direct policy on form_responses.
--
-- A migration that adds a table must repeat the three steps at the bottom for it: enable RLS,
-- set grants, add the updated_at trigger (supabase/tests/database/00_schema.test.sql checks).

-- ---------------------------------------------------------------------------------------------
-- Helpers. Security definer so policies on workspace_members itself do not recurse.
-- ---------------------------------------------------------------------------------------------
create or replace function gms.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and (m.expires_at is null or m.expires_at > pg_catalog.now())
  );
$$;

create or replace function gms.has_role(ws uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = any (roles)
      and (m.expires_at is null or m.expires_at > pg_catalog.now())
  );
$$;

-- Staff = members whose access is not restricted to assigned or scoped records.
create or replace function gms.is_staff(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and m.role not in ('reviewer', 'external_reviewer', 'consultant')
      and (m.expires_at is null or m.expires_at > pg_catalog.now())
  );
$$;

-- Scoped members (consultants, external reviewers): scope ->> key is a JSON array of ids.
create or replace function gms.scope_has(ws uuid, scope_key text, record_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and (m.expires_at is null or m.expires_at > pg_catalog.now())
      and pg_catalog.jsonb_typeof(m.scope -> scope_key) = 'array'
      and (m.scope -> scope_key) ? record_id::text
  );
$$;

-- A funder's staff may read an applicant's cached profile while a consent stands.
create or replace function gms.has_consent(applicant_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.consents c
    where c.applicant_workspace_id = applicant_ws and c.revoked_at is null
      and gms.is_staff(c.funder_workspace_id)
  );
$$;

-- An applicant's members may see the funders they have a relationship with.
create or replace function gms.is_my_funder(funder_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.consents c
    where c.funder_workspace_id = funder_ws and gms.is_member(c.applicant_workspace_id)
  );
$$;

create or replace function gms.can_see_application(app uuid, funder_ws uuid, applicant_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select gms.is_staff(funder_ws)
      or gms.is_staff(applicant_ws)
      or gms.scope_has(applicant_ws, 'applicationIds', app)
      or exists (
        select 1 from public.review_assignments ra
        where ra.application_id = app and ra.reviewer_user_id = (select auth.uid()) and ra.status <> 'recused'
      );
$$;

-- Both sides of an application, but not reviewers (they read masked content through the API).
create or replace function gms.is_application_party(app uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    where a.id = app
      and (gms.is_staff(a.workspace_id) or gms.is_staff(a.applicant_workspace_id)
           or gms.scope_has(a.applicant_workspace_id, 'applicationIds', a.id))
  );
$$;

create or replace function gms.can_see_award(awd uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.awards a
    where a.id = awd
      and (gms.is_staff(a.workspace_id)
           or (a.recipient_workspace_id is not null
               and (gms.is_staff(a.recipient_workspace_id) or gms.scope_has(a.recipient_workspace_id, 'awardIds', a.id))))
  );
$$;

create or replace function gms.can_see_thread(funder_ws uuid, applicant_ws uuid, visibility text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case visibility
    when 'shared' then gms.is_staff(funder_ws) or gms.is_member(applicant_ws)
    when 'funder_internal' then gms.is_staff(funder_ws)
    when 'applicant_internal' then gms.is_member(applicant_ws)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Enable RLS, reset grants and add updated_at triggers on every public table.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select c.relname as name,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped) as has_updated_at
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t.name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t.name);
    execute format('grant select, insert, update, delete on public.%I to service_role', t.name);
    if t.has_updated_at and t.name not in ('ledger_events', 'ledger_archives') then
      execute format('create trigger %I before update on public.%I for each row execute function gms.touch_updated_at()',
                     t.name || '_touch_updated_at', t.name);
    end if;
  end loop;
end;
$$;

revoke update, delete on public.ledger_events, public.ledger_archives from service_role;

grant usage on schema gms to authenticated, service_role;
revoke execute on all functions in schema gms from public, anon;
grant execute on all functions in schema gms to authenticated, service_role;

-- Tables a signed-in user may read (subject to the policies below). Deliberately absent:
-- passport_links, invitations, api_clients, oauth_*, custom_mcp_servers, webhook_subscriptions,
-- webhook_deliveries, inbound_events, ledger_archives, reminder_sends.
grant select on
  public.workspaces, public.workspace_members, public.consents,
  public.programs, public.forms, public.rubrics, public.templates, public.opportunities, public.competitions,
  public.applications, public.form_responses, public.application_events,
  public.review_assignments, public.reviews, public.decisions,
  public.awards, public.agreements, public.payment_schedules, public.tranches,
  public.requirements, public.submissions, public.budgets, public.amendments, public.bank_transactions,
  public.threads, public.messages, public.tasks, public.documents, public.answers,
  public.grantee_records, public.org_change_inbox, public.discover_saved,
  public.mcp_connections, public.approvals, public.connector_accounts, public.assist_calls,
  public.ledger_events
to authenticated;

-- connector_accounts.secret_enc is ciphertext, and still not for users.
revoke select on public.connector_accounts from authenticated;
grant select (id, workspace_id, provider, external_id, scopes, status, last_sync_at, created_at, updated_at)
  on public.connector_accounts to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Policies (SELECT for authenticated).
-- ---------------------------------------------------------------------------------------------
-- Tenancy
create policy workspaces_select on public.workspaces for select to authenticated
  using (gms.is_member(id) or gms.has_consent(id) or gms.is_my_funder(id));
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()) or gms.is_staff(workspace_id));
create policy consents_select on public.consents for select to authenticated
  using (gms.is_staff(applicant_workspace_id) or gms.is_staff(funder_workspace_id));

-- Design-time objects
create policy programs_select on public.programs for select to authenticated
  using (gms.is_staff(workspace_id));
create policy forms_select on public.forms for select to authenticated
  using (workspace_id is null or published_at is not null or gms.is_staff(workspace_id));
create policy rubrics_select on public.rubrics for select to authenticated
  using (workspace_id is null or gms.is_member(workspace_id));
create policy templates_select on public.templates for select to authenticated
  using (workspace_id is null or gms.is_staff(workspace_id));
create policy opportunities_select on public.opportunities for select to authenticated
  using (published_at is not null or gms.is_staff(workspace_id));
create policy competitions_select on public.competitions for select to authenticated
  using (gms.is_staff(workspace_id)
         or (status in ('open', 'closed')
             and exists (select 1 from public.opportunities o where o.id = opportunity_id and o.published_at is not null)));

-- Applications and review
create policy applications_select on public.applications for select to authenticated
  using (gms.can_see_application(id, workspace_id, applicant_workspace_id));
create policy form_responses_select on public.form_responses for select to authenticated
  using ((application_id is not null and gms.is_application_party(application_id))
         or (submission_id is not null and exists (
               select 1 from public.submissions s
               where s.id = submission_id
                 and (gms.is_staff(s.workspace_id) or (s.award_id is not null and gms.can_see_award(s.award_id))))));
create policy application_events_select on public.application_events for select to authenticated
  using (gms.is_application_party(application_id));
create policy review_assignments_select on public.review_assignments for select to authenticated
  using (reviewer_user_id = (select auth.uid()) or gms.is_staff(workspace_id));
create policy reviews_select on public.reviews for select to authenticated
  using (gms.is_staff(workspace_id)
         or exists (select 1 from public.review_assignments ra
                    where ra.id = assignment_id and ra.reviewer_user_id = (select auth.uid())));
create policy decisions_select on public.decisions for select to authenticated
  using (gms.is_staff(workspace_id));

-- Awards, payments, reporting
create policy awards_select on public.awards for select to authenticated
  using (gms.is_staff(workspace_id)
         or (recipient_workspace_id is not null
             and (gms.is_staff(recipient_workspace_id) or gms.scope_has(recipient_workspace_id, 'awardIds', id))));
create policy agreements_select on public.agreements for select to authenticated
  using (gms.can_see_award(award_id) and (status <> 'draft' or gms.is_staff(workspace_id)));
create policy payment_schedules_select on public.payment_schedules for select to authenticated
  using (gms.can_see_award(award_id));
create policy tranches_select on public.tranches for select to authenticated
  using (gms.can_see_award(award_id));
create policy requirements_select on public.requirements for select to authenticated
  using (gms.can_see_award(award_id));
create policy submissions_select on public.submissions for select to authenticated
  using (gms.is_staff(workspace_id) or (award_id is not null and gms.can_see_award(award_id)));
create policy budgets_select on public.budgets for select to authenticated
  using ((application_id is not null and gms.is_application_party(application_id))
         or (award_id is not null and gms.can_see_award(award_id)));
create policy amendments_select on public.amendments for select to authenticated
  using (gms.can_see_award(award_id));
create policy bank_transactions_select on public.bank_transactions for select to authenticated
  using (gms.has_role(workspace_id, array['admin', 'finance', 'auditor']));

-- Collaboration
create policy threads_select on public.threads for select to authenticated
  using (gms.can_see_thread(funder_workspace_id, applicant_workspace_id, visibility));
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.threads t
                 where t.id = thread_id
                   and gms.can_see_thread(t.funder_workspace_id, t.applicant_workspace_id, t.visibility)));
create policy tasks_select on public.tasks for select to authenticated
  using (gms.is_staff(workspace_id) or assignee_user_id = (select auth.uid()));
create policy documents_select on public.documents for select to authenticated
  using (gms.is_staff(workspace_id) or gms.is_staff(owner_workspace_id));
create policy answers_select on public.answers for select to authenticated
  using (gms.is_member(workspace_id));
create policy grantee_records_select on public.grantee_records for select to authenticated
  using (gms.is_staff(workspace_id));
create policy org_change_inbox_select on public.org_change_inbox for select to authenticated
  using (gms.is_staff(workspace_id));
create policy discover_saved_select on public.discover_saved for select to authenticated
  using (gms.is_member(workspace_id));

-- Integrations and audit
create policy mcp_connections_select on public.mcp_connections for select to authenticated
  using (user_id = (select auth.uid()) or gms.has_role(workspace_id, array['admin']));
create policy approvals_select on public.approvals for select to authenticated
  using (gms.is_staff(workspace_id));
create policy connector_accounts_select on public.connector_accounts for select to authenticated
  using (gms.has_role(workspace_id, array['admin', 'finance']));
create policy assist_calls_select on public.assist_calls for select to authenticated
  using (user_id = (select auth.uid()) or gms.has_role(workspace_id, array['admin']));
create policy ledger_events_select on public.ledger_events for select to authenticated
  using (workspace_id is not null and gms.has_role(workspace_id, array['admin', 'auditor']));
