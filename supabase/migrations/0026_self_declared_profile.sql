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
--   * adds `workspaces.profile_source` (not null, default 'none') and backfills it: 'passport' on
--     every workspace that carries a Passport organization id, 'none' on the rest. No other column
--     of an existing row changes. Every existing row satisfies the new checks after the backfill
--     (no row has a self-declared profile yet, and 'passport' is set only where the id is present).
--   * adds `workspaces.self_declared_profile` (jsonb, null on every existing row).
--   * no new grants and no policy changes: `authenticated` keeps its table-level SELECT on
--     workspaces under the existing policy; only the API (service role) writes these columns.
-- Opportunity options `requirePassport` and `acceptSelfReported` need no column: they live in
-- `opportunities.publish`, the opportunity's existing options object (absent = false).

alter table public.workspaces
  add column profile_source text not null default 'none',
  add column self_declared_profile jsonb;

update public.workspaces set profile_source = 'passport' where passport_org_id is not null;

alter table public.workspaces
  add constraint workspaces_profile_source_check
    check (profile_source in ('none', 'self_declared', 'passport')),
  -- 'passport' means the Passport record is the profile, so there must be an organization behind it.
  add constraint workspaces_profile_source_passport_check
    check (profile_source <> 'passport' or passport_org_id is not null),
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
        and (self_declared_profile -> 'ein' is null or (self_declared_profile ->> 'ein') ~ '^[0-9]{9}$')
        and (self_declared_profile -> 'address' is null or jsonb_typeof(self_declared_profile -> 'address') = 'object')
      )
    );

comment on column public.workspaces.profile_source is
  'none: no profile; self_declared: self_declared_profile, never verified; passport: org_projection from Passport.';
comment on column public.workspaces.self_declared_profile is
  'What an organization without Passport said about itself (legalName, displayName, website, mission, address, contactEmail, orgType, ein). Not verified. Written by the API only; cleared when Passport links.';
