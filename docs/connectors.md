# Connectors

Code: `packages/connectors` (ports and implementations), `apps/api/src/services/integrations.ts`
(routes), `apps/api/src/services/ports.ts` (OpenGrants), `apps/api/src/jobs.ts` (`pollBanks`),
`apps/api/src/services/imports.ts` (the import sources' use).

A connector is a port with a fixture implementation for tests and, where one exists, a production
implementation. Credentials are encrypted with `CREDENTIALS_ENCRYPTION_KEY` before they are stored
in `connector_accounts`; they are never returned or logged.

| Connector | Port | Production implementation | Checked against documentation | Run against the live service |
|---|---|---|---|---|
| Mercury (`mercury`) | `BankFeed` | `MercuryBankFeed` | Yes, 2026-11-10 (see below) | **No** |
| Google Workspace (`google_workspace`) | `WorkspaceApps` | `GoogleWorkspaceConnector` (Composio) | Yes, 2026-11-10 (see below) | No |
| Google Sheets import (`google_sheets`) | `SheetsSource` | `ComposioSheetsSource` (Composio tools) | Yes, 2026-11-15 (see below) | **No** |
| Slack alerts (`slack`) | `SlackAlerts` | `ComposioSlackAlerts` (Composio tools) | Tool slugs and schemas, 2026-11-17 | **No** |
| Google Calendar (`google_calendar`) | `CalendarSync` | `ComposioCalendarSync` (Composio tools) | Tool slugs and schemas, 2026-11-17 | **No** |
| Google Drive, applicants (`google_drive`) | `DriveFiles` | `ComposioDriveFiles` (Composio tools and proxy) | Tool slugs and schemas, 2026-11-17 | **No** |
| Salesforce import (`salesforce`) | `SalesforceSource` | `ComposioSalesforceSource` (Composio tools) | Tool slugs and schemas, 2026-11-17 | **No** |
| Airtable import (`airtable`) | `AirtableSource` | `ComposioAirtableSource` (Composio tools) | Yes, 2026-11-15 (see below) | **No** |
| OpenGrants discovery | `OpenGrantsClient` | `RestOpenGrantsClient` | Yes, 2026-11-11 (OpenAPI 1.2.0) | **Yes**, 2026-11-11: search and match against the live API |
| Custom MCP servers | `McpDirectory` | `HttpMcpDirectory` (`tools/list`, `tools/call`) | MCP Streamable HTTP, stateless JSON-RPC | Against in-process fakes only |
| Resend | `Mailer` (`@gms/notify`) | `ResendMailer` | Not re-checked in this pass | **No** |
| Anthropic (assistant) | `LlmClient` (`@gms/assist`) | `AnthropicLlmClient` (official SDK) | SDK types + request-shape test | **No** |

## Mercury

Read-only. The GMS reads outbound transactions to propose matches against `due` / `ready` tranches
(amount within one cent, same currency, counterparty name similarity ≥ 0.8). A person confirms a
match, which records the payment at Passport in resolve mode. The GMS never initiates a Mercury
payment, and Mercury is not a rail.

**Endpoints used** (both `GET`, bearer token, base `https://api.mercury.com/api/v1`):

| Endpoint | Query parameters sent | Notes |
|---|---|---|
| `/accounts` | `limit=1000`, `start_after=<last id>` on later pages | Cursor pagination |
| `/account/{accountId}/transactions` | `limit=1000`, `offset`, `order=asc`, `status=sent`, `start=<YYYY-MM-DD>` | Without `start` Mercury returns the last 30 days only |

**What was verified, and how.** On 2026-11-10 the two endpoint pages of Mercury's API reference
(`docs.mercury.com/reference/getaccounts`, `…/listaccounttransactions`) were read through a web
fetch tool: the paths, the parameter names above, the 1–1000 `limit` range, the `status` values
(`pending`, `sent`, `cancelled`, `failed`, `reversed`, `blocked`) and the 30-day default match the
code. The transaction field names the feed reads (`id`, `amount`, `postedAt`, `counterpartyName`,
`note`, `externalMemo`, `bankDescription`, `status`, `kind`) match the `Transaction` type in
Mercury's own Go SDK (`MercuryTechnologies/mercury-go`), and Mercury's events reference states that
`amount` is "positive for credits, negative for debits".

**What is still unverified.**
- The top-level response keys. The feed accepts either a bare array or an object keyed `accounts` /
  `transactions`; neither reference page showed the response body.
- Nothing has run against Mercury, sandbox or live. `api.mercury.com` and `docs.mercury.com` are not
  reachable from the build environment (the egress proxy answers 403).
- Which `kind` values a grant payment arrives as. The feed drops card activity, fees, and
  internal / treasury transfers by name and keeps everything else that is outbound and `sent`.

**What is kept per transaction:** id, posted date, amount, currency, counterparty name, memo.
Mercury returns bank details on the `details` field; the feed never reads that field, so account
and routing data never reach a table or a log.

A refused token surfaces as `ConnectorAuthError`; anything else as `ConnectorUnavailableError`, and
the poll retries on the next run. Connecting verifies the token first and saves nothing if Mercury
cannot be reached.

## Google Workspace (Composio)

The funder's Google Workspace: export a letter or agreement PDF to a Drive folder chosen in the
Google Picker, and read the directory to suggest members at invite time. Implemented by
`GoogleWorkspaceConnector` in `packages/connectors/src/composio.ts` behind the `WorkspaceApps` port.
**Nothing has run against Composio or Google yet**; the request shapes were checked against
Composio's reference and against Passport's production client (`passport/packages/composio`).

- **Entity:** the Composio `user_id` is the GMS workspace id. One entity per funder workspace.
- **Credentials:** Composio holds the Google token. The GMS stores no Google credential; the
  `connector_accounts` row keeps status and the two scope names only. The client keeps ids, status
  and scopes from a connected account and drops the rest of `state.val`.
- **Scopes (hard rule):** exactly `https://www.googleapis.com/auth/drive.file` and
  `https://www.googleapis.com/auth/admin.directory.user.readonly`, plus `openid email profile`.
  On every call the connector reads the account and checks `state.val.scope ∪ requested_scopes`.
  A connection holding anything else (`drive`, `drive.readonly`, `drive.metadata*`, any other API)
  is **deleted at Composio** and the request fails with `422 connector_scope_rejected`.
- **Configuration:** `COMPOSIO_API_KEY` and `COMPOSIO_GOOGLE_AUTH_CONFIG_ID` on the API Worker.
  Without both, `POST /gms/connectors/google_workspace` answers `503 connector_not_configured`.
  The API key needs Composio's **Proxy execute** permission. The auth config must be a custom
  Google OAuth client on the `googlesuper` toolkit created with exactly the scopes above; Passport's
  `packages/composio/README.md` has the step-by-step, including the Google Cloud project settings.

### Routes

| Route | What happens |
|---|---|
| `GET /gms/connectors/google_workspace` | Status. Never starts a connection; an unreachable Composio shows as not connected |
| `POST /gms/connectors/google_workspace` | Connected → `active`. Not connected → `pending` with `connectUrl`, Composio's hosted Google sign-in. The person returns to `{WEB_BASE_URL}/workspaces?connected=google_workspace`; calling the route again then reports `active` |
| `DELETE /gms/connectors/google_workspace` | Deletes every account the entity has on the auth config at Composio, then marks the row `revoked` |
| `GET /gms/directory/suggest?q=` | Up to 20 active directory people matching `q`. Any connector failure yields an empty list |

No route calls `exportToDrive` yet: the port method exists and is tested, but "Save to Drive" on a
letter or agreement still needs a route and the Picker on the web side (below).

### Composio calls

All on `https://backend.composio.dev`, authenticated with the `x-api-key` header.

| Call | Fields used | Checked against |
|---|---|---|
| `POST /api/v3.1/connected_accounts/link` | request `auth_config_id`, `user_id`, `callback_url`; response `redirect_url`, `connected_account_id`, `expires_at` | https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink |
| `GET /api/v3.1/connected_accounts` | query `user_ids`, `auth_config_ids`, `order_by`, `order_direction`, `limit`; response `items[].id`, `items[].status` | https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccounts |
| `GET /api/v3.1/connected_accounts/{id}` | response `id`, `status`, `auth_config.id`, `requested_scopes`, `state.val.scope` | Passport's client. The list page documents `id`, `status`, `auth_config.id` and `state.val`; `requested_scopes` and `state.val.scope` were **not** found in the pages read |
| `DELETE /api/v3.1/connected_accounts/{id}` | response `success`; 404 treated as already deleted | https://docs.composio.dev/reference/api-reference/connected-accounts/deleteConnectedAccountsByNanoid |
| `POST /api/v3.1/tools/execute/proxy` | request `connected_account_id`, `user_id`, `endpoint`, `method`, `parameters[{name,value,type:"query"}]`, `binary_body{base64,content_type}`; response `status`, `data` | https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy and https://docs.composio.dev/reference/api-reference/tools |
| `POST /api/v3.1/tools/execute/{slug}` | request `connected_account_id`, `user_id`, `arguments`; response `successful`, `error`, `data` | Passport's client only. Implemented on the client, **not used** by the connector, so no tool slugs are involved |
| Error body | `error.message`, `error.slug`, with the HTTP status | the delete page's error schema |

The connector uses the proxy rather than predefined Drive or Admin tools, as Passport does, so the
exact Google request (and therefore the scope it needs) is in this repository. The proxy rejects
cross-domain requests; every Google call below is on `www.googleapis.com`.

### Google calls (through the proxy)

| Purpose | Request |
|---|---|
| Directory | `GET https://www.googleapis.com/admin/directory/v1/users` with `customer=my_customer`, `viewType=admin_view`, `maxResults=200`, `orderBy=email`, a `fields` mask and `pageToken`; at most 3 pages, filtered by the query in the Worker. `403`/`404` (the account may not read the directory) means no suggestions. Same call as Passport's directory importer |
| Drive export | `POST https://www.googleapis.com/upload/drive/v3/files` with `uploadType=multipart`, `supportsAllDrives=true`, `fields=id,webViewLink`; the body is `multipart/related` (JSON `{name, parents:[folderId]}` then the PDF bytes), sent as the proxy's `binary_body`. `403`/`404` means the folder was not picked for this app |

### Not verified

- Nothing has been called live: not Composio, not Google.
- That the proxy forwards `binary_body.content_type` as the request's `Content-Type` for a
  `multipart/related` body. The reference documents the field; the multipart use is untested.
- How array query parameters are encoded on the list call. The connector sends one value per
  parameter (`user_ids=<id>`), which reads the same under either convention.
- `requested_scopes` and `state.val.scope` on the account read (see the table). If Composio stops
  returning both, the scope check sees an empty list and passes; the auth config is then the only
  guard. A live check should confirm at least one of them is present.
- Whether the supplied auth config was created with exactly the allowed scopes. If it was not,
  every connection will be refused and deleted, which is the intended failure.

### The Picker (web side, not built)

`drive.file` reaches only what the person picks. To export to Drive the web app must:

1. Get a short-lived Google Identity Services token with exactly the `drive.file` scope, for the
   **same Google OAuth client** the Composio auth config uses (grants are per Google Cloud project).
   The browser never receives the Composio-held token.
2. Open the Google Picker with that token and a Picker API key, in folder-selection mode.
3. Send only the picked **folder id** to the GMS. The person should pick while signed in as the
   Google account that connected.

That needs two public build-time values on the web app (the Google OAuth client id and a Picker API
key) and `https://accounts.google.com`, `https://apis.google.com` and `https://docs.google.com` in
its Content-Security-Policy.

## OpenGrants discovery

`RestOpenGrantsClient` calls the OpenGrants REST API (`OPENGRANTS_API_URL`, default
`https://ops.opengrants.io/functions/v1`, described by `https://ops.opengrants.io/openapi.json`)
with `OPENGRANTS_API_KEY` as a bearer token. Funding search is on when the key is set; without it
the routes answer 503 `opengrants_not_configured`.

| GMS route | OpenGrants call | Sent about the organization |
|---|---|---|
| `POST /gms/discover/opengrants/search` | `GET /grants-api?search=…&search_mode=hybrid&limit=20` | State (`states=…&include_national=true`) when known |
| `POST /gms/discover/opengrants/match` | `POST /match-grants-api` | Mission (required), state, applicant type |
| `…/eligibility`, `…/alerts` | none: the REST API has no such endpoint | 501 `opengrants_not_supported` |

Nothing else about the workspace leaves. Results are cached 15 minutes per organization. Matching
needs a mission on the Passport record; without one the route answers 422
`opengrants_profile_incomplete` and the person is told to add it in Passport.

**Why not the MCP server.** The hosted MCP at `mcp.opengrants.io/mcp` accepts OAuth sign-in only
(dynamic client registration, a person approves access); it answered `invalid_token` to an API key
on 2026-11-11. A server-side key therefore cannot use it. Its tools are also named
`opengrants_search_grants`, `opengrants_match_grants` and so on, not the names the first client
guessed. Eligibility checks and alerts exist only there and on opengrants.io.

**Limits.** The Pro plan allows 25 API requests a day and the Developer plan is unlimited; matching
needs Pro or Developer. The hosted install uses a Developer key (the API reported no limit).

Verify against the live API:

```bash
cd apps/api && OPENGRANTS_API_KEY=<key> node --experimental-transform-types scripts/opengrants-smoke.ts
```

## Custom MCP servers

`POST /gms/custom-mcp-servers` registers a server by URL. `isRegistrableMcpUrl` refuses anything
that is not HTTPS, carries credentials in the URL, is an IP literal, or names `localhost`, `.local`
or `.internal`. The optional auth header is stored encrypted. Tools are listed on request and an
admin chooses which are allowed; only tools that declare `readOnlyHint: true` can be allow-listed,
and nothing is callable until allowed.

The assistant is the only caller. For `summarize` and `compare-rubric` it calls each allow-listed
tool once (at most three tools per server, six results per draft, ten seconds each) with
`{ organizationName, ein? }` and nothing else, and only when the applicant's consent lets the
funder see the organization. A server that fails is skipped. Results reach the model as labelled
data and are shown with the server's name.

## Anthropic (assistant)

`AnthropicLlmClient` uses the official `@anthropic-ai/sdk`. One structured request per draft
(`output_config.format` from a Zod schema), adaptive thinking, `effort: medium`, the system prompt
as the cacheable prefix, and server-side refusal fallbacks (`fallbacks: "default"`). The model is
`ASSISTANT_MODEL`, defaulting to `claude-opus-5-5`. A refusal by the whole chain surfaces as
`422 assistant_declined`. Tested against a stubbed `fetch` for request shape and response parsing;
never run against the Anthropic API.

## Scope check fails closed

The GMS uses a Google connection only after reading its scopes from Composio and finding every one
on the allow-list (`drive.file`, `admin.directory.user.readonly`, the OpenID identity scopes).

- A scope outside the list: the connection is deleted at Composio and the call answers
  `422 connector_scope_rejected`.
- No scopes reported at all (neither `requested_scopes` nor `state.val.scope` on the account read):
  the allow-list cannot be checked, so the connection is treated as unusable. Connect, Drive export
  and the directory route answer `422 connector_scope_unverified`; the status read shows the
  connector as not connected; invite suggestions stay empty. The connection is left at Composio,
  because an unknown scope set is not proof of excess. Disconnect and connect again to clear it.

## Routes that use the connection

| Route | Who | What it does |
|---|---|---|
| `POST /gms/connectors/google_workspace/export` | Funder admin or program officer, signed in | `{ documentKind: "letter" \| "agreement" \| "snapshot", subjectId, folderId }`. Renders or loads the PDF (the same bytes as the download route) and uploads it to the folder chosen in the Google Picker. Returns the Drive file id, name and URL. Ledgered as `connector.drive_export` |
| `GET /gms/connectors/google_workspace/directory?q=` | Funder admin | Up to 20 people from the directory for invite suggestions. Read-only |

After Google sign-in, Composio sends the browser to
`{WEB_BASE_URL}/w/{handle}/settings/connectors?connected=google_workspace`.

## Import sources: Google Sheets and Airtable (Composio)

The import wizard (`/gms/imports`, `apps/api/src/services/imports.ts`) reads a spreadsheet or an
Airtable table the person points at, to import a funder's grant history or an applicant's
applications. Both sources are **read-only** and both go through Composio. A CSV or XLSX upload
needs neither and always works; the two connected sources are hidden (not listed by
`GET /gms/imports/sources`, `available.googleSheets` / `available.airtable` false in `/gms/config`)
until the server is configured for them.

Code: `packages/connectors/src/tabular.ts` (`ComposioSheetsSource`, `ComposioAirtableSource`, the
fixtures, the link readers and scope checks), on the same `ComposioClient` as Google Workspace.

- **Entity:** the Composio `user_id` is the GMS workspace id, funder or applicant. One connection per
  workspace per toolkit, on the toolkit's own auth config.
- **Credentials:** Composio holds the provider's token. The `connector_accounts` row
  (`google_sheets` / `airtable`, migration 0031) keeps status and scope names only, `secret_enc`
  null. The client keeps ids, status and scopes from an account read and drops the rest of
  `state.val`.
- **Who connects:** a workspace admin, signed in, of either kind (`POST /gms/connectors/{provider}`
  with an optional `returnTo`, a path inside the workspace; anything else falls back to
  `/w/<handle>/import`). Anyone who may import can then use the connection. Disconnecting deletes
  every account the entity has on that auth config at Composio, then marks the row `revoked`.
- **Scopes (checked before every use, as for Google Workspace):**
  - Google Sheets: exactly `https://www.googleapis.com/auth/spreadsheets.readonly`, plus
    `openid email profile` (either spelling). `…/auth/spreadsheets` (write) and any `…/auth/drive…`
    scope are refused.
  - Airtable: exactly `data.records:read` and `schema.bases:read`, plus `user.email:read`. Any
    `:write` or `:manage` scope is refused.
  - A connection holding anything else is **deleted at Composio** (`422 connector_scope_rejected`).
    One that reports no scopes, or lacks a required read scope, is left in place and not used
    (`422 connector_scope_unverified`).

### Configuration (what the owner sets up)

| Setting (API Worker) | What it is |
|---|---|
| `COMPOSIO_API_KEY` | The existing key. It needs permission to execute tools (and to manage connected accounts, as now) |
| `COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID` | **New.** An auth config on the `googlesheets` toolkit, OAuth2 with a custom Google OAuth client, scopes exactly `https://www.googleapis.com/auth/spreadsheets.readonly openid email profile`. The Google Sheets API must be enabled in that Google Cloud project |
| `COMPOSIO_AIRTABLE_AUTH_CONFIG_ID` | **New.** An auth config on the `airtable` toolkit, OAuth2, scopes exactly `data.records:read schema.bases:read` (`user.email:read` may be added) |

`COMPOSIO_GOOGLE_AUTH_CONFIG_ID` (Google Workspace, `googlesuper`, `drive.file` + directory) is not
reused: `drive.file` reaches only files picked in the Google Picker, so a pasted spreadsheet link
would not open, and adding a spreadsheets scope there would make every Google Workspace connection
fail its own allow-list. Each source has its own auth config, so each keeps a narrow scope set.

### Composio tools executed

Only these four, each with `POST /api/v3.1/tools/execute/{slug}` and the body
`{ connected_account_id, user_id, arguments }` (no `version`: REST v3.1 runs the latest; no `text`;
never `connected_account_id: "instant_account"`, which the client refuses). A response with
`successful: false` becomes one plain sentence; Composio's or the provider's error text is not
passed on.

| Tool | Arguments sent | Read from `data` | Checked against |
|---|---|---|---|
| `GOOGLESHEETS_GET_SHEET_NAMES` | `spreadsheet_id` | `sheet_names` (or `sheets[].properties.title`) | docs.composio.dev/toolkits/googlesheets and the toolkit listing of the tool (inputs `spreadsheet_id`, `exclude_hidden`) |
| `GOOGLESHEETS_VALUES_GET` | `spreadsheet_id`, `range` (`'Tab'!A1:GR5002`: the header, 5,000 rows and one more, 200 columns), `value_render_option: "FORMATTED_VALUE"`, `major_dimension: "ROWS"` | `values` (or `valueRanges[0].values`) | the tool listing (inputs `spreadsheet_id`, `range`, `start_row`, `end_row`, `major_dimension`, `value_render_option`, `date_time_render_option`) and Google's `spreadsheets.values.get` |
| `AIRTABLE_GET_BASE_SCHEMA` | `baseId` | `tables[].id`, `name`, `fields[].name` | docs.composio.dev/toolkits/airtable |
| `AIRTABLE_LIST_RECORDS` | `baseId`, `tableIdOrName` (the `tbl…` id), `pageSize: 100`, `maxRecords: 5001`, `cellFormat: "string"`, `timeZone: "utc"`, `userLocale: "en-us"`, `offset` on later pages (60 pages at most) | `records[].id`, `records[].fields`, `offset` | docs.composio.dev/toolkits/airtable |

The execute endpoint itself (path, body fields, `version` defaulting to latest on v3.1, the
`instant_account` value, the response `data`, `error`, `successful`, `log_id`, and the error body)
was checked on https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteByToolSlug
on 2026-11-15. The pages were read through a search service's fetch: docs.composio.dev is not
reachable directly from the build environment. Connect, list, read and delete of connected
accounts are the calls already documented above for Google Workspace.

The person pastes a link: `https://docs.google.com/spreadsheets/d/<id>/…` (or the id), and
`https://airtable.com/app…/tbl…` (or the base id). Only those hosts are accepted. The tab defaults
to the first; the table to the one in the link, else the first.

### What the import does with the rows

Before anything is shown, mapped or stored, `packages/importers/src/sensitive.ts` drops every
column whose header names bank or identity details, or whose values look like them (the ABA routing
checksum on nine digits, a formatted identity number, 10 to 19 bare digits). One matching cell drops
the whole column. Two exceptions: nine digits in a column named EIN are an EIN, and ten or eleven
digits in a column named phone are a phone number. Only the dropped columns' names are kept on the
run, and the wizard shows them.

### Not verified

- Nothing has run against Composio, Google or Airtable (this environment cannot reach them).
- The nesting of each tool's `data`. The reference documents `data` only as an object; the reader
  looks for the keys above in `data`, `data.response_data` and `data.data`, up to three levels.
- Whether `GOOGLESHEETS_VALUES_GET` honours a range beyond the sheet's last row without an error
  (Google's API does), and the toolkit's argument names, which can change between toolkit versions
  because the version is not pinned.
- Whether `AIRTABLE_LIST_RECORDS` paginates itself when `maxRecords` is given. The connector handles
  both: it follows `offset` when one comes back and stops one record past the limit.
- That Composio reports the granted scopes of these toolkits' accounts in `state.val.scope` or
  `requested_scopes`. If it reports neither, every connection is treated as unusable (the intended
  failure).
- XLSX reading (`read-excel-file` 9.3.17, MIT, its `universal` entry: fflate and saxen) ran in Node
  in the tests and was bundled for the Worker (`wrangler deploy --dry-run`); it has not run inside
  workerd.

## Fluxx and Zengine (v1.9.0)

Grant history pulled straight from Fluxx or Zengine does not go through Composio: the funder hands
the GMS its own read-only credentials, kept encrypted and deleted when the import is done. See
`docs/importers.md` (Fluxx and Zengine).

## Connected apps (v1.12.0): Slack, Google Calendar, Google Drive, Salesforce

Code: `packages/connectors/src/apps.ts` (the four connectors, their fixtures, scope rules and
`connectedAppPorts`), `apps/api/src/services/connector-alerts.ts` (Slack alerts),
`apps/api/src/services/calendar-sync.ts` (Google Calendar), `apps/api/src/services/integrations.ts`
(connect and disconnect, Drive copy and save), `packages/importers/src/sources/salesforce.ts` and
`apps/api/src/services/imports.ts` (the Salesforce source), routes in
`apps/api/src/routes/gms/connected-apps.ts` and `/gms/connectors/{provider}`, the jobs in
`apps/jobs/src/index.ts`, migration `0044_connected_apps.sql`, the screen
`apps/web/src/screens/shared/ConnectedApps.tsx` (Settings › Connected apps), and
`apps/web/src/components/DriveAttach.tsx`.

Every app is **hidden until configured**: without `COMPOSIO_API_KEY` and the app's own auth config,
its port is absent, `/gms/config` reports `available.<app>: false`, the screen does not show it, and
its routes answer `503 connector_not_configured`.

### Who does what

| Act | Who |
|---|---|
| Connect or disconnect Slack, Google Drive, Salesforce (`POST`/`DELETE /gms/connectors/{provider}`) | A workspace admin, signed in. Google Drive: applicant workspaces only |
| Choose the Slack channel and events, turn alerts on or off (`PUT`/`DELETE /gms/connected-apps/slack`) | A workspace admin, signed in |
| Connect my Google Calendar, choose a calendar, update now, disconnect | Each person, for themselves: funder staff (admin, program officer, finance, auditor) and applicant members (admin, editor, finance, viewer). Reviewers and consultants are left out |
| Attach a file from Google Drive, save the as-submitted copy | Applicant admins, editors and finance, signed in |
| Read the Slack settings (`GET /gms/connected-apps/slack`, MCP `get_slack_alerts`) | Workspace admins; agents with `workspace:admin` |

Agents and API clients get `403 person_required` on every connect, choose, post, write and copy:
there is no MCP tool for any of them. The only MCP tool is `get_slack_alerts`, read only.

### Composio

One auth config per toolkit, each from its own Wrangler secret on the API Worker (and, for Slack
and Calendar, the jobs Worker). The Composio `user_id` is the GMS workspace id.

| Secret | Toolkit | Scopes, exactly | Notes |
|---|---|---|---|
| `COMPOSIO_SLACK_AUTH_CONFIG_ID` | `slack` | `chat:write`, `channels:read` | Bot scopes. Never `*:history`, `users:*`, `groups:*`, `im:*`, `chat:write.public`. The app must be invited to the channel |
| `COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID` | `googlecalendar` | `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.events.owned` (+ `openid email profile`) | The narrowest pair that lists the person's calendars and writes events on calendars they own. `calendar`, `calendar.readonly`, `calendar.events` are refused. One connected account per person on the workspace's entity; `calendar_links.composio_account_id` names it, and every call uses that account only |
| `COMPOSIO_GOOGLE_DRIVE_AUTH_CONFIG_ID` | `googledrive` | `https://www.googleapis.com/auth/drive.file` (+ `openid email profile`) | **Must use the same Google OAuth client** (same Google Cloud project) as the Picker's `VITE_GOOGLE_OAUTH_CLIENT_ID`: a file picked in the Picker is granted to that project, and only then can the connection read it. `COMPOSIO_GOOGLE_AUTH_CONFIG_ID` is not reused: it also asks for `admin.directory.user.readonly`, which an applicant does not need |
| `COMPOSIO_SALESFORCE_AUTH_CONFIG_ID` | `salesforce` | `api` (+ `refresh_token`, `offline_access`, `id`, `openid`, `profile`, `email`) | Salesforce has no read-only OAuth scope. The GMS only ever runs a SOQL SELECT through `SALESFORCE_RUN_SOQL_QUERY` and follows its pages; recommend connecting as a Salesforce user whose profile is read-only. `full`, `web`, `visualforce`, `chatter_api`, `wave_api`, `cdp_*` and the like are refused |

The scopes are read from Composio and checked **before every use**, as for Google Workspace. A
connection holding anything else is deleted at Composio (`422 connector_scope_rejected`); one that
reports no scopes or lacks a required one is left in place and not used
(`422 connector_scope_unverified`). The connected account must be on the GMS's auth config and, when
Composio names it, on this workspace's entity.

**Tools executed** (`POST /api/v3.1/tools/execute/{slug}`, body `{ connected_account_id, user_id, arguments }`;
never `instant_account`). Slugs and argument names were checked with Composio's tool search and
schema tools on 2026-11-17; no tool was executed.

| Tool | Arguments the GMS sends | Read from `data` |
|---|---|---|
| `SLACK_LIST_ALL_CHANNELS` | `types: "public_channel"`, `exclude_archived: true`, `limit: 200`, `cursor` on later pages (10 at most) | `channels[].id`, `name`, `is_member`, `is_archived`, `is_private`; `response_metadata.next_cursor` |
| `SLACK_SEND_MESSAGE` | `channel` (the id), `markdown_text` (at most 1,000 characters), `unfurl_links: false`, `unfurl_media: false` | `ts` |
| `GOOGLECALENDAR_LIST_CALENDARS` | `min_access_role: "owner"`, `max_results: 100`, `page_token` (5 pages at most) | `calendars[].id`, `summary`, `summaryOverride`, `primary`, `accessRole`, `deleted`; `next_page_token` |
| `GOOGLECALENDAR_CREATE_EVENT` | `calendar_id`, `summary`, `description`, `start_date`, `end_date` (the next day: an all-day event), `create_meeting_room: false`, `send_updates: "none"`, `exclude_organizer: true`, `transparency: "transparent"` | `response_data.id` |
| `GOOGLECALENDAR_PATCH_EVENT` | `calendar_id`, `event_id`, `summary`, `description`, `start_time`, `end_time` (dates), `send_updates: "none"` | nothing; a failure means the event is gone and it is written again |
| `GOOGLECALENDAR_DELETE_EVENT` | `calendar_id`, `event_id`, `send_updates: "none"` | nothing; already gone is fine |
| `GOOGLEDRIVE_GET_FILE_METADATA` | `fileId`, `fields: "id,name,mimeType,size"`, `supportsAllDrives: true` | `name`, `mimeType`, `size` |
| `GOOGLEDRIVE_DOWNLOAD_FILE` | `fileId`, and `mime_type: "application/pdf"` for a Google Doc, Sheet, Slides or Drawing | `downloaded_file_content.{name, mimetype, s3url}`, `export_size_limit_exceeded` |
| `SALESFORCE_RUN_SOQL_QUERY` | `query` | `records[]`, `done`, `nextRecordsUrl` |
| `SALESFORCE_QUERY_MORE` | `next_records_url` (only a `/services/data/vNN.N/query/<locator>` path Salesforce returned) | the same |

Calendar's `UPDATE_EVENT` is not used: it takes timed events only and would add a Meet link by
default. Saving the as-submitted PDF to Drive uses the proxy (`POST
https://www.googleapis.com/upload/drive/v3/files`, `uploadType=multipart`, `fields=id,webViewLink`,
the same request as the funder's Drive export): `GOOGLEDRIVE_UPLOAD_FILE` needs the file in
Composio's own storage first.

### Slack alerts

Funder teams can hear about: a new application, a review assigned, an opportunity closing within
three days, a report due, a payment due. Applicant teams: a deadline within three days (outside and
on-platform applications), a report due, a payment due. The jobs Worker runs
`sendConnectorAlerts` every fifteen minutes (`connector-alerts`).

- **What is posted.** One message per event: the event's name, the record's title and a link to the
  GMS (`*New application*: <title>` and `[Open in the GMS](<link>)`), in the language of the admin
  who saved the settings. Never an applicant's answers, an email address, a person's name or an
  amount. Titles are written by applicants, so they are flattened to plain words first: no markup,
  no `<!channel>`, `@here` or links.
- **Once per event.** Before posting, the event is claimed in `alert_deliveries` (unique per
  subscription and event key, e.g. `new_application:<id>`, `deadline_soon:opp:<id>:<date>`). A second
  run or a second Worker finds the claim and posts nothing. A post Slack refuses is tried again on
  later runs, three times in all. The message text is not kept.
- **Stops at once.** The subscription is read again before every post: turning alerts off,
  unticking the event, choosing another channel, or disconnecting Slack (which deletes the
  settings) stops the next post. Turning alerts on starts from that moment; nothing older than seven
  days is ever alerted. At most 20 posts per channel per run.

### Google Calendar

`syncCalendars` runs every hour at :30 (`calendar-sync`); "Update now" and choosing a calendar run it
for one person at once.

- **What is written.** Funders: each opportunity's close date (`key_dates.closeDate`), within the
  funds a fund advisor may see. Applicants: outside applications' letter of inquiry, full and
  internal deadlines, built-in applications' stage closes, and reports due (the same dates as the
  `.ics` feed, which stays). All-day events: a title, the date, and a link to the GMS; no guests, no
  Meet link, no emails, shown as free time. In the person's language.
- **One-way and idempotent.** `calendar_links.event_map` keeps, per deadline (keyed without its date),
  the Google event id, the date and a digest of the title and description. New → create; a changed
  date or wording → patch; removed → delete; the same → nothing. An event the person deleted in Google
  is written again only when its deadline changes. Deadlines more than 60 days past are left alone,
  never deleted. At most 50 writes per person per run; the rest follow. The map is saved after every
  write.
- **Disconnecting** deletes the events written, then the connection at Composio, then the link.
  Choosing another calendar removes the events from the first.

### Google Drive (applicants)

- **Attach from Google Drive** sits beside the upload in the application editor, an outside
  application's attachments and the document vault. The browser opens the Google Picker with a
  short-lived `drive.file` token from Google Identity Services (refused if Google returns any broader
  Drive scope), the person picks one file, and the GMS copies it through the workspace's Drive
  connection (`POST /gms/connected-apps/google-drive/fetch`, at most 25 MB; Google Docs, Sheets and
  Slides come as PDF; folders and forms are refused). The bytes go back to the browser, which hands
  them to **the same upload** as a file from the computer, with the same size and type checks.
  Nothing is stored by the fetch itself.
- **Save the as-submitted copy to Google Drive** on a submitted application (the PDF of the forms as
  submitted) and on an outside application with its as-submitted PDF: created in My Drive through
  `drive.file`.
- The person should pick while signed in to Google as the account that connected (grants under
  `drive.file` are per Google account and project).

### Salesforce (import source)

Picked in the import wizard. Read once, at the person's request, through the same framework as every
source: sensitive columns dropped first, the dry run with its reconciliation, the commit, 5,000 rows
a run (the query asks for 5,001 and a run over 5,000 is refused).

- **Presets.** `npsp_grants`: Nonprofit Success Pack Opportunities whose record type is named like
  "Grant" (`Id, Name, Account.Name, StageName, Amount, npsp__Requested_Amount__c, CloseDate,
  npsp__Next_Grant_Deadline_Due_Date__c, npsp__Grant_Period_Start_Date__c,
  npsp__Grant_Period_End_Date__c, npsp__Grant_Program_Area_s__c, npsp__Grant_Requirements_Website__c,
  RecordType.Name, Description`); for grant history only the won ones (`IsWon = true`). The columns
  are named so the targets recognise them (the Account is the funder for an applicant, the grantee
  for a funder). Salesforce's stage names are not the GMS's, so for applications the stage column
  keeps its Salesforce name and is mapped only if the person chooses to. `accounts`: Accounts (`Id,
  Name, Type, Website, BillingCity, BillingState, BillingCountry, Description`).
- **A query of the person's own** is checked first (`checkSoql`): one SELECT, no semicolon, no
  `FOR UPDATE`, `FOR VIEW`, `FOR REFERENCE`, `UPDATE TRACKING` or `UPDATE VIEWSTAT` (they lock records
  or record a view), no data-changing verb, at most 4,000 characters; a `LIMIT 5001` is added when it
  has none. Refused: `422 invalid_query`. Relationship fields become `Account.Name` columns; child
  subqueries are left out.

### Owner setup

1. **Composio:** create the four auth configs above on your own OAuth apps (Slack app with bot
   scopes `chat:write channels:read`; a Google OAuth client with the Calendar API enabled for
   Calendar; the Picker's Google OAuth client with the Drive API and the Google Picker API enabled
   for Drive; a Salesforce connected app with `api refresh_token`). Set their ids as Wrangler
   secrets: `COMPOSIO_SLACK_AUTH_CONFIG_ID`, `COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID`,
   `COMPOSIO_GOOGLE_DRIVE_AUTH_CONFIG_ID`, `COMPOSIO_SALESFORCE_AUTH_CONFIG_ID` on the API Worker,
   and `COMPOSIO_API_KEY`, `COMPOSIO_SLACK_AUTH_CONFIG_ID`, `COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID`
   on the jobs Worker too.
2. **Google Cloud (the Picker's project):** OAuth consent screen with the `drive.file` scope; the
   OAuth client's authorised JavaScript origin is the web app's origin (`https://gms.opengrants.io`);
   an API key restricted to the Google Picker API and to that origin. Public build variables on the
   web app: `VITE_GOOGLE_OAUTH_CLIENT_ID` and `VITE_GOOGLE_PICKER_API_KEY` (already used by the
   funder's Drive export). The Content-Security-Policy must allow `https://accounts.google.com`,
   `https://apis.google.com` and `https://docs.google.com`.
3. **Composio callback:** each auth config returns to `{WEB_BASE_URL}/w/<handle>/settings/apps`
   (Slack, Drive, Calendar) or the import page (Salesforce), with `?connected=<provider>`.

### Not verified

- Nothing has run against Composio, Slack, Google or Salesforce. The connectors were tested against a
  fake Composio (an in-process `fetch`) with the slugs and arguments above; the API against fixtures.
- The nesting of each tool's `data`; the reader looks for its keys up to three levels down.
- Whether Composio reports these toolkits' granted scopes in `state.val.scope` or `requested_scopes`
  (if neither, every connection is treated as unusable, the intended failure), and whether a Slack
  bot connection reports its bot scopes there.
- `GOOGLEDRIVE_DOWNLOAD_FILE`'s `s3url`: its host (the Worker fetches any HTTPS URL on a public host
  it returns) and how long it lives.
- That `GOOGLECALENDAR_PATCH_EVENT` takes all-day `YYYY-MM-DD` dates in `start_time`/`end_time` as
  its schema says, and that `calendar.events.owned` is enough for create, patch and delete through
  Composio's tools.
- The NPSP field API names in the grants preset (`npsp__…`) were taken from NPSP's documentation as
  remembered, not from a live org; an org without NPSP should use the Accounts preset or its own
  query. `CurrencyIsoCode` is left out (single-currency orgs do not have it).
- The jobs Worker's Slack posts and calendar writes in workerd.
