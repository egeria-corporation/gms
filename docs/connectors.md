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

The port (`WorkspaceApps`: connection status, directory search, export a PDF to a Picker-chosen
Drive folder) and the routes exist. There is **no production implementation**, so
`POST /gms/connectors/google_workspace` answers `503 connector_not_configured`.

What is missing, exactly:
1. A Composio project and a Google auth config (`COMPOSIO_API_KEY`, `COMPOSIO_GOOGLE_AUTH_CONFIG_ID`).
2. Confirmation that the Google toolkit can be held to `drive.file` (through the Picker) plus
   `admin.directory.user.readonly`. Passport lists the same question as open; it can only be
   settled against a live auth config.
3. The request shapes. Composio's documentation index was readable on 2026-11-10 and says the
   session-based SDK and REST v3.1 are current, but the calls this port needs (create a connection
   link for an entity, execute the directory and Drive-upload tools) were not read in detail and are
   deliberately not written from memory.

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
