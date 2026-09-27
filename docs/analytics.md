# Analytics

GMS defines every reporting metric **once**, in SQL, in the `analytics` schema
(`supabase/migrations/20260927001400_analytics.sql`). The console dashboards (AN-01), the report builder (AN-02) and
external BI tools all read the same definitions.

## What's in the schema

| Materialized view | One row per | Metric |
|---|---|---|
| `analytics.pipeline_funnel` | opportunity | Applications that reached each stage: started → submitted → reviewed → awarded (plus declined, withdrawn/ineligible). "Reached" uses the current status and the append-only `status_history`. |
| `analytics.time_in_stage` | workspace × status | Days spent in each status: completed intervals (average, median, 90th percentile) and applications currently in the status (average days so far). |
| `analytics.budget_by_program` | workspace × program × fiscal year × currency | Budget (`program_budgets`), committed (active/completed original awards + approved amendments, in the award's fiscal year), paid (payments sent or reconciled, in the fiscal year sent), unpaid commitments and remaining budget. |
| `analytics.cashflow_forecast` | workspace × month × currency | Scheduled installments due that month next to what was actually paid that month. |
| `analytics.portfolio_by_cause` | workspace × cause × currency | Committed dollars and award counts by cause area (the opportunity's cause terms, else the program's cause area). Awards tagged with several causes are split evenly so totals add up. |
| `analytics.portfolio_by_county` | workspace × county × currency | Committed dollars, awards and grantees by the grantee's county (mailing address, else the first county served). |
| `analytics.outcomes` | indicator | Sum of reported indicator values and how many awards reported them. |
| `analytics.demographics` | workspace × question × answer | Voluntary demographic responses, aggregated. Cells with fewer than 5 responses are suppressed (`responses` is null, `suppressed` is true); when a question has exactly one suppressed cell, its smallest visible sibling is suppressed too so the hidden value can't be recovered by subtraction. There is never a row-level view. |

Fiscal years are named by the calendar year in which they end (`analytics.fiscal_year(date, start_month)`, using
`workspaces.fiscal_year_start_month`).

## Refreshing

Every matview has a unique index, so it can be refreshed without blocking readers
(`refresh materialized view concurrently analytics.<name>`). The worker refreshes all of them hourly and nightly
(`refreshAnalytics` in `apps/worker/src/tasks.ts`). From SQL: `select analytics.refresh_all();`. Each row carries
`refreshed_at`, which the dashboards show.

## Who can read what

* **The app** reads through `public.analytics_*` views (one per matview). They run with the view owner's privileges and
  return only rows where `gms.is_staff(workspace_id)` is true for the signed-in person's verified claims — staff of that
  workspace (owner, admin, program officer, finance, auditor). They are `security_barrier` views and read-only.
  They are covered by the RLS matrix (`packages/db/test/rls-expectations.ts`).
* **Request roles** (`gms_anon`, `gms_authenticated`) have no privileges on the `analytics` matviews themselves: those
  span every workspace and cannot carry row-level security.
* **BI tools** (Metabase, Evidence, Superset…) connect with the read-only `gms_analytics` role, which has `select` on
  everything in the `analytics` schema (including matviews added later, via default privileges) and nothing else.

### Connecting Metabase (or another BI tool)

`gms_analytics` is created by the first migration as a `nologin` role. Give it a login on a server you control
(Supabase: SQL editor, as `postgres`):

```sql
alter role gms_analytics with login password '<a long random password>';
-- Optional: restrict the connection further.
alter role gms_analytics set search_path = analytics;
alter role gms_analytics set default_transaction_read_only = on;
alter role gms_analytics connection limit 5;
```

Then add a PostgreSQL database in Metabase with that user, the session-pooler host/port, and schema filter
`analytics`. The role can only `select` from the `analytics` schema, so it cannot see applications, people, bank data
or anything row-level.

**Multi-tenant deployments:** the matviews contain every workspace. Don't give a tenant a `gms_analytics` login;
either give them exports (Insights → Exports) or create a per-tenant role with row-level filtered views, e.g.

```sql
create role halcyon_bi login password '…';
create schema bi_halcyon;
create view bi_halcyon.budget_by_program as
  select * from analytics.budget_by_program where workspace_id = '<workspace uuid>';
grant usage on schema bi_halcyon to halcyon_bi;
grant select on all tables in schema bi_halcyon to halcyon_bi;
```

## Adding a metric

1. Add a materialized view to `analytics` in a new migration, with a unique index (concurrent refresh) and a
   `refreshed_at` column.
2. Add a `public.analytics_<name>` view filtered by `gms.is_staff(workspace_id)`, revoke default privileges from the
   request roles and grant `select` to `gms_authenticated` (see the migration for the pattern).
3. Add the view to the RLS matrix and point `packages/db/test/world.ts` at one of its workspace-A rows.
4. Regenerate types: `pnpm db:types`.
