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
| Fluxx | REST API v2 on the funder's own instance, with an OAuth application it creates at `/oauth/applications` | Grant requests, the organization each went to and the payments on it, one row per request; granted ones become grant history | — |
| Zengine | REST API with an access token for the funder's own account, 250 requests per 5 minutes | The records of one form the person chooses | — |

Applications that were never awarded are set aside, not imported: the GMS has no target yet for
another funder's past applications or reviews (see "Not yet" below).

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
  instance (each instance's model is its own).
- Zengine: sending the token as `Authorization: Bearer` (its docs show `?access_token=`, which
  would put the token in URLs and logs, so it is not used); the `/forms/{id}/fields` path; that
  `page` starts at 1.
- Nothing has run against a live Fluxx or Zengine.

## Not yet

- A funder target for another system's past applications (declined, withdrawn) and its reviews:
  they are set aside today. When such targets exist, the adapters' presets can name them.
- Bonterra CyberGrants, Spreadsheets/Airtable trackers and GrantHub need no adapter: their exports
  import through the plain file, Google Sheets or Airtable paths.
