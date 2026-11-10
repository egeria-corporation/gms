-- 0001_init: foundations shared by every later migration.
--
--   * gms.uuid_v7()          time-ordered UUID primary keys (RFC 9562).
--   * gms.touch_updated_at() BEFORE UPDATE trigger keeping updated_at current.
--   * gms.*_statuses()       the status vocabularies of packages/workflow/src/statuses.ts.
--
-- The GMS never stores bank or identity numbers. Passport owns organizations and money; the GMS
-- keeps Passport ids, bank name and last4 for display, and nothing else about a destination.

create schema if not exists gms;
comment on schema gms is 'GMS helper functions (ids, triggers, RLS predicates). No tables live here.';

-- UUIDv7: 48-bit Unix ms timestamp, version 7, 74 random bits, variant 10. gen_random_uuid()
-- supplies the random bits and the variant; the timestamp is overlaid and the version nibble set
-- (0100 -> 0111). clock_timestamp() keeps ids generated inside one transaction ordered.
create or replace function gms.uuid_v7()
returns uuid
language sql
volatile
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.set_bit(
      pg_catalog.set_bit(
        overlay(
          pg_catalog.uuid_send(pg_catalog.gen_random_uuid())
          placing substring(
            pg_catalog.int8send(floor(extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid;
$$;

create or replace function gms.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Status vocabularies. Keep in step with packages/workflow/src/statuses.ts (a unit test in
-- packages/db compares the two).
create or replace function gms.application_statuses() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['draft','submitted','screening','under_review','recommended','accepted','declined','waitlisted','revision_requested','interview','withdrawn'];
$$;
create or replace function gms.award_statuses() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['offered','accepted','active','suspended','completed','cancelled'];
$$;
create or replace function gms.agreement_statuses() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['draft','sent','signed_by_grantee','countersigned','executed','voided'];
$$;
create or replace function gms.tranche_statuses() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['scheduled','due','ready','releasing','initiated','settled','held','failed','returned','cancelled'];
$$;
create or replace function gms.requirement_statuses() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['scheduled','due','overdue','submitted','under_review','accepted','returned','waived'];
$$;
create or replace function gms.submission_statuses() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['draft','submitted','under_review','accepted','returned'];
$$;
create or replace function gms.verification_levels() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['L0','L1','L2','L3'];
$$;

-- Scope vocabulary of the GMS OAuth server (build spec §9). `approvals:bypass` is the explicit
-- grant that lets a client skip human gates (§10.9); it is never part of a default grant.
create or replace function gms.scopes() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array[
    'workspace:admin','programs:read','programs:write','opportunities:read','opportunities:write',
    'competitions:read','competitions:write','forms:read','forms:write',
    'applications:read','applications:write','applications:submit','reviews:read','reviews:write',
    'decisions:write','awards:read','awards:write','agreements:write','payments:read','payments:release',
    'requirements:read','requirements:write','grantees:read','grantees:write','messages:read','messages:write',
    'communications:write','analytics:read','discovery','library:read','library:write','org:read','assist',
    'approvals:bypass'
  ];
$$;

create or replace function gms.webhook_events() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array[
    'opportunity.published','application.submitted','application.status.changed','review.submitted',
    'decision.committed','award.created','award.status.changed','agreement.executed','tranche.due',
    'tranche.status.changed','disbursement.status.changed','requirement.due','submission.received',
    'submission.accepted','org.change.pending','approval.requested','approval.resolved'
  ];
$$;
