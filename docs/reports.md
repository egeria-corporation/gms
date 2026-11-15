# Reports

The report builder answers questions like "every award in 2027 by program, with what was paid and
what is still owed, and the overdue reports", as a table a funder can save, share with colleagues
and get by email every week or month.

Code: `apps/api/src/services/report-engine.ts` (column whitelist, definition check, filter, group,
sort, CSV), `apps/api/src/services/report-builder.ts` (data sets, views, schedules, files, the job),
`apps/api/src/routes/gms/reports.ts`, `apps/jobs/src/reports.ts`, `apps/web/src/screens/funder/ReportBuilder.tsx`.
API: `api/reports.tsp`. Tables: migration `0034_report_builder.sql`.

## Who

Members of a funder workspace who may read reports: admin, program officer, finance, observer,
auditor (the roles with `analytics:read`). Reviewers and external reviewers may not. Each data set
also needs its own read scope (applications, awards, payments, requirements, grantees), so an API
token or agent sees only what its scopes allow.

Saving, sharing, changing, removing and scheduling a view are done by a signed-in person in the GMS
(`VIEW_WRITES_PEOPLE_ONLY`). API clients and agents can read the catalog, preview, download and run
views; they cannot save or schedule one.

## Data sets

Every column is on a whitelist with a label, a type (text, number, money, date, status) and a
source. A definition names columns by key; the server builds the report from the whitelist and
refuses any other name (422 `unknown_column`). Nothing a client sends is used as a column name or
as SQL. `defineDataSet` refuses a column whose key, label or source reads like bank, payout,
identity or contact data (`NOT_REPORTABLE`), so one cannot be added by mistake.

| Data set | Rows | Columns |
|---|---|---|
| Applications | Submitted applications (never drafts) | application, applicant, opportunity, competition, program, stage, status, requested amount, currency, submitted on, year submitted, average score, reviews submitted, decision, decline reason |
| Awards | Awards | award, program, recipient, recipient verified, status, awarded amount, currency, award date, award year, start, end, paid elsewhere (recorded), scheduled not yet paid, next payment date, overdue reports, disbursed through Passport |
| Payments | Tranches | payment (n of N), award, program, recipient, amount, currency, due, status, how it is paid, recorded paid elsewhere, paid on |
| Reports and requirements | Requirements of awards | requirement, type, award, program, recipient, due, status, days overdue |
| Organizations | Organizations that submitted an application here or hold an award from here | organization, verified, location, state or region, applications submitted, awards, total awarded, currency |

Amounts are integer minor units as recorded in the GMS:

- **Paid elsewhere (recorded)** adds up the payments the funder recorded as paid outside the GMS
  (resolve mode, settled). A payment made through Passport is not "paid elsewhere".
- **Scheduled, not yet paid** adds up payments that are scheduled, due, ready, held, failed or in flight.
- **Disbursed through Passport** is Passport's `disbursedAmount` as last read back. It is shown read
  only, labelled as Passport's figure, and can never be added up or averaged.
- Amounts in different currencies are never added together: such a group's total is left blank
  with a note to group by currency.

Organizations follow the grantee directory's consent rule: the Passport legal name and the location
show only while the organization shares its record with the funder; otherwise the workspace's own
name and no location. "Verified" says Verified with Passport, Self-declared (not verified), or Not
verified. No EIN, address line, email or phone is reportable.

## Building

Pick a data set, columns (1-30), filters (up to 20), group by one or two columns with count, total
and average, and sort (up to three keys). Filters:

- `eq` and `in` (up to 100 values) on any column; status values must be the column's own;
- `between` on dates, money and numbers. Dates are `YYYY-MM-DD` or relative to the day the report
  runs: `today`, `startOfYear`, `endOfYear`, `startOfMonth`, `endOfMonth`, each with an optional
  `+Nd` or `-Nd` (`today+90d`). Money is in minor units over the API and in dollars on screen.

Preview shows the first 200 rows (or groups) and how many matched. A CSV download holds up to
50,000 rows, streamed; a larger result says so (`X-Report-Truncated`). A data set reads at most
50,000 records from its base table and says so when there were more. CSV cells that start with
`=`, `+`, `-`, `@`, a tab or a carriage return are prefixed with an apostrophe so a spreadsheet does
not run them; money is written in units with two decimals and statuses in words. Each download is
ledgered (`report.exported`) with its data set and row count, never its rows.

## Views

A saved view is a name, an optional description, a definition and who sees it: only its owner
(private, the default) or the whole workspace (shared). The owner changes it; the owner, or an
admin for a shared view, removes it, which stops its schedule and removes its files. A view sent to
other people cannot be made private until its schedule sends it only to its owner.

Six starter views ship with every workspace, read only (save a copy to change or schedule one):
Awards this year by program, Payments due next 90 days, Overdue reports, Applications by stage,
Grantees by total awarded, Decline reasons.

## Scheduled CSV

The owner of a saved view may send it weekly (on a weekday) or monthly (on day 1-28) to 1-20
members of the workspace, by user id. Every recipient must be a live member whose role reads
reports and the view's data set; a private view goes only to its owner. Never an outside address.

The jobs Worker runs on every 5-minute tick. A schedule is due once its send time (13:00 UTC on its
day) has come in the current ISO week or month, and only for periods whose send time is after the
schedule was set. For each due schedule it:

1. checks again: the owner must still read the report (otherwise the schedule stops, `owner_left`),
   and recipients who left the workspace or can no longer read it are skipped (none left: it stops,
   `no_recipients` or `view_private`);
2. claims the period: one `report_files` row per view and period (unique), so the file is written
   and mailed once;
3. writes the CSV to the EXPORTS bucket at `exports/<workspace>/reports/<view>/<period>.csv`;
4. emails each recipient through Resend: the view's name, the period, the row count and a link to
   `/w/<handle>/report-builder?file=<id>`, where the file is downloaded signed in. The email holds
   no row of the report and no attachment. Each email carries an idempotency key per file and
   person; a run that stopped before every email went out is finished by the next one without
   sending anyone a second copy.

Files are kept 30 days: the download then answers 410 `file_expired`, and the job removes the object
and its row. Only the people a file was sent to can download it.

Without the EXPORTS binding or outbound mail (`RESEND_API_KEY`, `RESEND_FROM`) the job writes and
sends nothing and logs why. The job is what removes old files: R2 lifecycle rules match a key
prefix, and report files sit under each workspace's own `exports/<workspace>/` folder beside its
export bundles, so a bucket rule cannot single them out.

## MCP

`list_report_views` and `run_report_view` (first 200 rows), both `analytics:read`, through the same
service and authorization as the routes. There is no tool to save, share or schedule a view.

## Routes

| Route | What |
|---|---|
| `GET /gms/reports/data-sets` | The data sets and their columns |
| `POST /gms/reports/preview` | First 200 rows of a definition |
| `POST /gms/reports/export` | CSV of a definition (`{ definition, name? }`) |
| `GET /gms/report-views` | Starter views and the saved views the caller may see |
| `POST /gms/report-views` | Save a view (a person) |
| `GET`, `PATCH`, `DELETE /gms/report-views/{id}` | One view; change it (owner); remove it |
| `POST /gms/report-views/{id}/run` | First 200 rows of a view |
| `GET /gms/report-views/{id}/export` | CSV of a view |
| `GET /gms/report-views/{id}/recipients` | Members the view can be sent to |
| `PUT`, `DELETE /gms/report-views/{id}/schedule` | Schedule a view (owner, a person); stop it |
| `GET /gms/report-files` | Scheduled files sent to the caller |
| `GET /gms/report-files/{id}/download` | One of them, while it is kept |
