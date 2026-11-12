-- 0026_self_declared_profile.sql
-- A workspace can be used without Passport (owner decision, 2026-11-12).
--
-- Passport stays the source of verified identity. A workspace that has not linked a Passport
-- organization may keep a self-declared profile instead: what the organization told us about
-- itself, always shown as not verified, never presented as a verified CommonGrants organization,
-- and replaced by the Passport record when the workspace links. The profile is not identity data:
-- it holds an organization's name, website, mission, mailing address, contact address, type and
-- EIN (an organization number), never a person's identity numbers.
--
-- What this changes on a live database:
--   * THIS CHANGES ROWS. A workspace with no Passport organization id loses any Passport data left
--     on it (`verification_level`, `org_projection`, `profile_projection` and their timestamps):
--     0024 released ids that were only typed but kept what the sync job had cached under them, and a
--     level with no organization behind it must not reach anyone (review NP-08). Each cleared row is
--     written to the ledger. Only rows that hold such data are touched.
--   * adds `workspaces.profile_source` (not null, default 'none') and backfills it: 'passport' on
--     every workspace that carries a Passport organization id (this bumps their `updated_at`),
--     'none' on the rest. Every row satisfies the new checks after these two updates (no row has a
--     self-declared profile yet; 'passport' is set exactly where the id is present; no level is left
--     without an id). Adding the columns and checks locks `workspaces` for the length of the
--     migration (one statement scan of a small table).
--   * adds `workspaces.self_declared_profile` (jsonb, null on every existing row).
--   * no new grants and no policy changes: `authenticated` keeps its table-level SELECT on
--     workspaces under the existing policy; only the API (service role) writes these columns.
-- Opportunity options `requirePassport` and `acceptSelfReported` need no column: they live in
-- `opportunities.publish`, the opportunity's existing options object (absent = false).

alter table public.workspaces
  add column profile_source text not null default 'none',
  add column self_declared_profile jsonb;

with cleared as (
  update public.workspaces w
     set verification_level = null, org_projection = null, org_projection_at = null,
         profile_projection = null, profile_projection_at = null
   where w.passport_org_id is null
     and (w.verification_level is not null or w.org_projection is not null or w.profile_projection is not null)
  returning w.id
)
insert into public.ledger_events (workspace_id, actor, event_type, subject_type, subject_id, data)
select c.id, 'system:migration', 'workspace.passport_data_cleared', 'workspace', c.id::text,
       jsonb_build_object('reason', 'no_passport_organization', 'migration', '0026')
  from cleared c;

update public.workspaces set profile_source = 'passport' where passport_org_id is not null;

alter table public.workspaces
  add constraint workspaces_profile_source_check
    check (profile_source in ('none', 'self_declared', 'passport')),
  -- 'passport' means the Passport record is the profile, and a Passport organization means the
  -- profile is Passport's: the two go together (review NP-13).
  add constraint workspaces_profile_source_passport_check
    check ((profile_source = 'passport') = (passport_org_id is not null)),
  -- A Passport level exists only with a Passport organization (review NP-08).
  add constraint workspaces_verification_level_passport_check
    check (passport_org_id is not null or verification_level is null),
  -- A self-declared profile exists exactly when the source says so, and always names the organization.
  add constraint workspaces_self_declared_profile_present_check
    check ((profile_source = 'self_declared') = (self_declared_profile is not null)),
  -- The shape is validated in the API; the database bounds it so nothing else can be parked here.
  add constraint workspaces_self_declared_profile_shape_check
    check (
      self_declared_profile is null or (
        jsonb_typeof(self_declared_profile) = 'object'
        and pg_column_size(self_declared_profile) <= 16384
        and (self_declared_profile - array['legalName', 'displayName', 'website', 'mission', 'address', 'contactEmail', 'orgType', 'ein']) = '{}'::jsonb
        and jsonb_typeof(self_declared_profile -> 'legalName') = 'string'
        and length(btrim(self_declared_profile ->> 'legalName')) between 1 and 200
        -- An organization's EIN: nine digits with an IRS-assigned prefix, never for an individual,
        -- whose nine digits would be a Social Security number (review NP-11).
        and (self_declared_profile -> 'ein' is null or (
              (self_declared_profile ->> 'ein') ~ '^[0-9]{9}$'
              and left(self_declared_profile ->> 'ein', 2) <> all (array['00','07','08','09','17','18','19','28','29','49','69','70','78','79','89','96','97'])
              and coalesce(self_declared_profile ->> 'orgType', '') <> 'individual'))
        and (self_declared_profile -> 'address' is null or jsonb_typeof(self_declared_profile -> 'address') = 'object')
        and (self_declared_profile -> 'contactEmail' is null or jsonb_typeof(self_declared_profile -> 'contactEmail') = 'string')
        and (self_declared_profile -> 'mission' is null or jsonb_typeof(self_declared_profile -> 'mission') = 'string')
        and (self_declared_profile -> 'website' is null or jsonb_typeof(self_declared_profile -> 'website') = 'string')
      )
    );

comment on column public.workspaces.profile_source is
  'none: no profile; self_declared: self_declared_profile, never verified; passport: org_projection from Passport.';
comment on column public.workspaces.self_declared_profile is
  'What an organization without Passport said about itself (legalName, displayName, website, mission, address, contactEmail, orgType, ein). Not verified. Written by the API only; cleared when Passport links.';
