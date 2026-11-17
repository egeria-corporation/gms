# Importer adapters

A funder moving from another grants system brings its grant history with it. It drops in that
system's export and gets the column matching already filled in, or the GMS reads its records
straight from Fluxx or Zengine with credentials the funder creates there. Every path goes through
the import framework of v1.7.0 (`packages/importers`, `apps/api/src/services/imports.ts`): columns
that look like bank or identity details are dropped first, every row is checked (the dry run), and
only then imported, at most 5,000 rows a run, each source row at most once.

Facts about each system are as of November 2026, from the systems' public pages listed below. No
system's API was called while building this; Fluxx and Zengine were exercised against fake servers.

## What moves over

| From | How | What is imported | Files |
|---|---|---|---|
| Good Grants | CSV or Excel of Manage applications | Approved applications as grant history | The zip of up to 100 application PDFs per download (links expire in 48 hours), matched by the application's slug or title |
| SurveyMonkey Apply | Reports → Data Exports, CSV or XLSX, one program per export (up to 100 columns) | Awarded applications as grant history | The bulk PDF zip, matched by application id or title |
| Submittable (classic and Next) | Submissions → Export Data → Export Submissions: Submission Data (.csv) | Funded submissions as grant history | Submission PDFs (.zip) or Submission Files (.zip), matched by submission id or title |
| Foundant GLM | Export Data or a report, per process, CSV or .xlsx (save an older .xls as one of these) | Approved requests as grant history, with payment columns recorded as paid elsewhere | — |
| SmartSimple | A list view (level 1 applications) exported to CSV or .xlsx | Funded applications as grant history | — |
| OpenWater | Application data as CSV, .xlsx or JSON | Awarded applications as grant history | The bulk PDF zip, matched by application id or name |
| Fluxx | REST API v2 on the funder's own instance, with an OAuth application it creates at `/oauth/applications` | Grant requests, the organization each went to and the payments on it, one row per request; granted ones become grant history. For past reports, its reports (`request_report`), one row per report with its grant request's Fluxx id, title and organization | — |
| Zengine | REST API with an access token for the funder's own account, 250 requests per 5 minutes | The records of one form the person chooses | — |
| Bonterra CyberGrants | Reports → Create Ad Hoc Report (a tabular report on requests, payments or impact reports), exported as CSV or Excel | Approved requests as grant history, every request as a past application, impact reports as past reports; payee bank columns dropped | Request snapshots and impact report PDFs the funder saves into one zip, matched by Request ID (or report id) or title |

For grant history, applications that were never awarded are set aside. Every application, awarded
or not, its reviews and the reports on past grants can be imported as **imported history** instead
(below).

## Imported history (v1.12.0)

Three more funder targets, all read-only history, labelled "Imported history" wherever they show:

| Target | One row is | Fields | Read from the other columns |
|---|---|---|---|
| `history_applications` | a past application | organization (required), EIN, application title (required), call or round, program, submitted on, outcome or decision, amount requested, amount awarded, currency, application ID | every other kept column is a question, its cell the answer (plain text), except contact details and the system's bookkeeping (`QA_LEFT_OUT`: email, phone, address, submitter, payee, payments, owner, assigned, labels, votes, created/updated) |
| `history_reviews` | a review of a past application | application ID, application title, organization, reviewer (a name only), total score, recommendation, comment, reviewed on, review ID | a column whose name says score, rating, criterion, criteria, points or mark is a criterion score (`4`, `4.5`, `4/5`, `3 out of 5`; blank and `n/a` are no score) |
| `history_reports` | a report on a past grant | grant ID, grant title, organization, report title (required), due on, submitted on, status, report ID | — |

The sensitive screen still runs first. On top of it, every free-text value kept (answers, comments,
names, labels) has email addresses and bank or identity numbers removed (`historyText`, the same
stripper as the switch pages' note). No field takes a contact detail; a reviewer's name with an
email in it keeps the name only, and the database refuses a reviewer name holding "@".

**Linking, never guessing** (`apps/api/src/services/history.ts`):

- A past application links to its award by the export's own id: the row key the grant history import
  gave the same id (the run's own scope: its source and its Row ID column), so importing grant history
  first and then the applications of the same export links each funded one. Failing that, by the
  award's exact title and recipient (any case, single spaces) when exactly one award fits, and only
  when the outcome is not declined or withdrawn. Its organization is the award's recipient, else the
  one connected organization with its EIN or exact name (the rule of imported awards).
- A review links to its application by the export's id for the application (kept only as a SHA-256
  hash, `application_key`), then by exact title (and organization, when the export gives one). A
  review that arrives before its application waits by that key and is linked when it comes.
- A report links to its award as an application does, then through a past application of the same
  id that is linked to an award, then by exact title (and organization).
- A name that fits more than one record links to none. The export's ids are never stored as written.
- The same export imported again from another file (a re-saved CSV, the same records as .xlsx) is
  recognised by the export's id with the same title and organization, and skipped.

**Not live.** History is kept in its own tables (`history_applications`, `history_reviews`,
`history_reports`, migration 0046). No review queue, decision, payment, requirement, reminder or
competition reads them: a past application cannot be reviewed, decided or paid, a past review never
counts toward a score, and a past report is not a requirement and gates no payment.

**Who sees it.** Funder staff with their existing roles (admin, program officer, finance, observer,
auditor; RLS: `gms.is_staff`); never reviewers, external reviewers or the grantee. A fund advisor sees
the history of awards and programs in their funds. An API client needs `applications:read`, plus
`reviews:read` for reviews and `requirements:read` for reports. Importing is a person's (a signed-in
funder admin, as for grant history); there is no MCP tool for it.

**Where it shows.** "Imported history" on the grantee's page (by linked organization) and on the
award's page (by linked award): past applications open in place with their answers and reviews,
past reports with their file. `GET /gms/history?organization=…` or `?award=…`,
`GET /gms/history/applications/{id}`, and the files under `/gms/history/{applications|reports}/{id}/files/{docId}`.
The report builder has an "Imported history" data set: one row per past application, review and
report, with no reviewer name and no contact column.

**Files.** After a past application or past report import from a system with a zip, the same "Add the
PDFs and files" step attaches each file to the record its path names (by the export's id, then title),
as documents of the funder's own workspace with subjects `history_application_file` and
`history_report_file`. A fund advisor does not see them (they belong to no fund).

**Presets** (each system's export carries this data):

| System | Past applications | Past reviews | Past reports |
|---|---|---|---|
| Good Grants | yes | yes (review scores export) | — |
| SurveyMonkey Apply | yes | — | — |
| Submittable | yes (Submission Data) | yes (Reports, or a submission's Reviews tab .csv) | — |
| Foundant GLM | yes | — | — |
| SmartSimple | yes (level 1) | yes (level 2) | — |
| OpenWater | yes | yes (judging data) | — |
| Bonterra CyberGrants | yes | — | yes (impact reports) |
| Fluxx (API) | yes (grant requests, declined ones included) | — | yes (`request_report`: type, due date, approval, status) |
| Zengine (API) | yes | yes | yes (the person picks the form) |

Import grant history first, then applications, then reviews and reports, so each finds the record it
belongs to.

## How an export is recognised

Each adapter (`packages/importers/src/adapters/<system>.ts`) has a header signature: headers only
that system's exports carry (strong) and headers they usually carry. A file is recognised when it
has two strong headers, or one and at least three usual ones, and no other system matches as well.
Detection reads only the columns that survived the sensitive screen.

The public help pages describe each export but rarely list its exact column headings, so every file
adapter matches loosely (`headersConfirmed: false`) and the person confirms each field on the match
step. Fluxx's columns are the GMS's own (the puller writes them), so its preset is exact.

The mapping is filled in this order: a mapping the person saved for exactly these columns; then the
system's preset (one column per field, the first candidate present); then the general suggestion
for what is left. A plain file that matches a system's signature gets that system's preset too, and
the match step says so; when the person named one system and the file looks like another, it
offers the other's matching.

## Never awarded

For grant history, a row is set aside as skipped, with the reason, when a decision or status column
of that system (or the column mapped to Status) holds a "never awarded" word (Declined, Rejected,
Withdrawn, In progress, Draft…; each system adds its own, such as Good Grants' "undecided"), or when
its amount awarded is blank or zero. A value such as "Completed" or "Closed" is an awarded grant
that has ended and is imported. Set-aside rows create nothing and are not errors to fix.

## Sensitive columns

Nothing changes here: the screen of v1.7.0 runs first on every table, whatever adapter is chosen,
and an adapter cannot reach a dropped column. The fixtures of every system include such columns
(by header, such as "Bank acct", "IBAN", "Payee routing", "Year of birth", "D.O.B.", "TIN", "SIN",
"Driver license", and by value, nine-digit and long account-style numbers made at test time) and
the tests check that each is dropped and that no value of one reaches the plan, the run or its log.

The Fluxx and Zengine pullers name every field they read (Fluxx's `cols`, Zengine's `attributes`)
and none is a bank or identity field; Fluxx's `tax_id` and bank account relations are never asked
for, and Zengine file and signature fields are skipped.

## Fluxx and Zengine

- **Connecting** (`POST /gms/imports/connections/{fluxx|zengine}`): a funder workspace admin, signed
  in. Agents and API clients get 403 `human_only`: handing credentials to another system changes
  access. Fluxx takes the instance address (HTTPS on `*.fluxx.io` or `*.fluxxlabs.com` only, one
  constant, `FLUXX_HOST_SUFFIXES`) and the application id and secret; Zengine takes an access token.
  No request follows a redirect (`redirect: "manual"`; a 3xx answer, or an answer from another
  host, stops the pull), so the credentials and the records never leave the host that was checked.
  The credentials are checked with one read, stored as AES-GCM ciphertext under
  `CREDENTIALS_ENCRYPTION_KEY` in `connector_accounts.secret_enc` (a column no signed-in user may
  read), and never returned.
- **Deleted**: when a run that read the source to its end finishes, when the person disconnects,
  when the source rejects them, or when they have not been used for 7 days
  (`PULLER_CREDENTIAL_TTL_MS`). The ledger records `connector.credentials_deleted` with the reason,
  never the credential.
- **Pulling**: the read and check steps pull again each time (nothing pulled is stored before the
  screen runs); at most 5,000 rows a run. A source with more says where the next run starts
  (`nextPage`, kept on the run as `source_next_page`); the summary offers "Continue with the next
  records", and rows imported before are skipped by their key, so starting over is safe too.
- **Read-only**: every request is a GET, except Fluxx's one OAuth token request.
- **Rate limits**: Zengine's 250 requests per 5 minutes is kept per token with a sliding window
  (one per Worker isolate); a 429 from either system is retried after its `Retry-After`. A pull
  waits at most 20 seconds in all (`MAX_RATE_WAIT_MS`) and otherwise stops with 429
  `source_rate_limited`, saying how long to wait. Server errors (502–504) are retried twice.
- **Fluxx's joins**: organizations and payments are looked up only for granted requests, 50 ids a
  request, with Fluxx's JSON `filter` (`{"group_type":"or","conditions":[["id","eq",…]]}`); what
  was paid is the sum of the paid `request_transaction`s, recorded on the award as paid elsewhere.
- **Fluxx reports** (past reports): `request_report` is read with seven fields only (`id`,
  `request_id`, `report_type`, `due_at`, `approved_at`, `has_been_approved`, `state`), never the
  grantee's contact fields or the report's text the model also carries; each report's grant request
  is looked up by id for its title and organization (`id`, `project_title`,
  `program_organization_id`). `Grant Fluxx ID` is the grant request's `Fluxx ID` in a grant history
  pull, so a report links to the award that request became. Fluxx keeps no submitted date on a
  report, so the column is left for the person to map.

## Files from a zip

After a grant history import from a system with a zip (Good Grants, SurveyMonkey Apply, Submittable,
OpenWater), the summary offers "Add the PDFs and files". The browser opens the zip (fflate,
`@gms/importers/zip`) and sends only the file paths (`POST /gms/imports/runs/{id}/files/match`).
The run log keeps no source ids, only each row's key (a hash of the target, the source and the id),
so each id-shaped token of a path is hashed the same way and looked up by key; failing that, a path
segment that equals the imported title, when only one award has it. A path matching two awards is
left out. The person then attaches the matched files one by one (`POST /gms/imports/runs/{id}/files`,
a person only, 25 MB each); the server matches the path again before it stores the file. Files are
documents of the funder's own workspace with subject `imported_award_file` on the award: the
grantee never sees them, and the award's shared documents list does not show them. A file whose
name suggests bank or identity documents (a voided check, a W-9) is refused. No file's contents
are read: no document AI (CLAUDE.md).

## Sources (as of November 2026)

- Good Grants: https://goodgrants.com/pricing ; https://docs.goodgrants.com/api-reference
- Submittable: https://submittable.help/en/articles/904906 ; https://next.support.submittable.com/hc/en-us/articles/36503809146903
- SurveyMonkey Apply: https://help.surveymonkey.com/en/apply/analyze/data-exports
- Foundant GLM: https://foundant.com/products/grant-management-software-for-foundations
- SmartSimple: https://wiki.smartsimple.com/wiki/SmartConnect_-_RESTful_API
- OpenWater: https://help.getopenwater.com/en/articles/3110614-openwater-rest-api
- Bonterra CyberGrants: https://bonterratech.com/pricing/corporate-social-responsibility ; https://help.bonterratech.com/cybergrants/articles/Knowledge/360022404614-Create-a-Tabular-Report (ad hoc tabular reports, exported as CSV or Excel) ; https://help.bonterratech.com/cybergrants/articles/Knowledge/360033927354-Request-Record-Overview (Request ID, request snapshot, impact reports) ; https://help.bonterratech.com/cybergrants/articles/Knowledge/360056876293-Print-an-Impact-Report
- Submittable reviews: https://submittable.help/en/articles/3341187-automated-scoring-for-forms (download all reviews as .csv) ; https://intercom.help/self-guided-implementation/en/articles/8295921-exporting-data-from-your-account (applications and review data from Reports, tied by Submission ID)
- Fluxx: https://github.com/RockefellerArchiveCenter/fluxx_exporter (OAuth application at `/oauth/applications`, REST v2 at `/api/rest/v2`) and an open-source Fluxx reader, https://github.com/bruin-data/ingestr (token request, `cols`, `page`, `per_page`, the `records` envelope)
- Zengine: https://zenginehq.github.io/developers/rest-api/ (rate limit), `/auth/` (OAuth), `/conventions/querying-options/` (`limit` up to 100, `page`, `attributes`), `/conventions/response-format/` (`totalCount`, `data`)

## Not verified

- No exact column headings were confirmed for Good Grants, SurveyMonkey Apply, Submittable,
  SmartSimple or OpenWater; Foundant GLM's "Process Name" and "Amount Awarded" come from a public
  script reading a GLM data set. The person confirms every field.
- How each system names the files in its zip: matching uses the export's id anywhere in the path,
  then the title.
- Fluxx: the JSON `filter` shape with `group_type` "or", `per_page` 100 being accepted, and the
  `request_transaction` fields `amount_paid`, `paid_at`, `has_been_paid`, `request_id` on every
  instance (each instance's model is its own). The `request_report` field names come from the
  open-source reader's model list (bruin-data/ingestr `fluxx_resources.go`, read 2026-11-17), not a
  live instance; the report states (`new`, `approved` …) are each instance's own.
- Zengine: sending the token as `Authorization: Bearer` (its docs show `?access_token=`, which
  would put the token in URLs and logs, so it is not used); the `/forms/{id}/fields` path; that
  `page` starts at 1.
- Nothing has run against a live Fluxx or Zengine.
- Imported history: no export heading of any system's review or report export was confirmed, nor
  CyberGrants' report column names (its help pages name Request ID, Organization Name, Project
  Title, Proposal Type, Grant Amount and Status, and the impact report's type, status and due date).
  The person confirms every field.

## Not yet

- Spreadsheets/Airtable trackers and GrantHub need no adapter: their exports import through the plain
  file, Google Sheets or Airtable paths.
