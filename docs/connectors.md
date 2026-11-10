# Connectors

Code: `packages/connectors` (ports and implementations), `apps/api/src/services/integrations.ts`
(routes), `apps/api/src/services/ports.ts` (OpenGrants), `apps/api/src/jobs.ts` (`pollBanks`).

A connector is a port with a fixture implementation for tests and, where one exists, a production
implementation. Credentials are encrypted with `CREDENTIALS_ENCRYPTION_KEY` before they are stored
in `connector_accounts`; they are never returned or logged.

| Connector | Port | Production implementation | Checked against documentation | Run against the live service |
|---|---|---|---|---|
| Mercury (`mercury`) | `BankFeed` | `MercuryBankFeed` | Yes, 2026-11-10 (see below) | **No** |
| Google Workspace (`google_workspace`) | `WorkspaceApps` | **None**: `FixtureWorkspaceApps` only | No | No |
| OpenGrants discovery | `OpenGrantsClient` | `McpOpenGrantsClient` | **No** (tool names are a guess) | **No** |
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

`McpOpenGrantsClient` calls the hosted OpenGrants MCP (`OPENGRANTS_MCP_URL`) with a stateless
`tools/call`, passing the applicant's organization context (org type, region, mission, revenue
band) and nothing else about the workspace. Results are cached 15 minutes per organization.

**The tool names are unverified.** The proxy maps its four routes to `search_grants`,
`match_grants`, `check_eligibility` and `create_funding_alert`. `mcp.opengrants.io` was not
reachable from the build environment (proxy 403) and the OpenGrants connector in the build session
was not authorized, so `tools/list` was never read. Before enabling discovery, run `tools/list`
against the hosted MCP and correct `MCP_TOOL` in `apps/api/src/services/ports.ts`, and check how
results are shaped (`listingsFrom` accepts `items`, `results` or `grants`). Until then the routes
work against the fixture client only.

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
