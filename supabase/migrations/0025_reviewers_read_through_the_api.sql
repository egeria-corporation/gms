-- 0025_reviewers_read_through_the_api: reviewers no longer read application rows through the
-- Supabase data API (red team re-review, 2026-11-12).
--
-- `applications_select` let an assigned reviewer select the raw `applications` row with their own
-- session: the applicant's workspace id and the eligibility results, including the values the
-- funder's rules read from the applicant's Passport record. An external reviewer could do it even
-- for an assignment outside their competitions. The API already masks what reviewers see and
-- applies the competition scope; the data API did neither.
--
-- Reviewers now read applications only through the API (which uses the service role and masks), as
-- they already did for form responses, threads and documents. Staff on either side and consultants
-- scoped to the application keep their direct read.
--
-- Applying this to a live database: it replaces one function, same signature, owner and grants, so
-- the policy that calls it is unchanged. No row is changed. The web app and the API never read
-- `applications` with a reviewer's session, so nothing they do changes.

create or replace function gms.can_see_application(app uuid, funder_ws uuid, applicant_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select gms.is_staff(funder_ws)
      or gms.is_staff(applicant_ws)
      or gms.scope_has(applicant_ws, 'applicationIds', app);
$$;
