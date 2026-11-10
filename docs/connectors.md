# Connectors

Code: `packages/connectors` (ports and implementations), `apps/api/src/services/integrations.ts` (routes), `apps/api/src/jobs.ts` (`pollBanks`).
A connector is a port with a fixture implementation for tests and, where one exists, a production implementation. Credentials are encrypted with the workspace key before they are stored in `connector_accounts`; they are never returned or logged.

| Connector | Port | Production implementation | Verified against the live service |
|---|---|---|---|
| Mercury (`mercury`) | `BankFeed` | `MercuryBankFeed` | **No** |
| Google Workspace (`google_workspace`) | `WorkspaceApps` | **None**: `FixtureWorkspaceApps` only | No |
| Custom MCP servers | `McpDirectory` | `HttpMcpDirectory` (`tools/list` over streamable HTTP) | Against a local server only |

## Mercury

Read-only. The GMS reads outbound transactions to propose matches against `due` / `ready` tranches (amount within one cent, same currency, counterparty name similarity ≥ 0.8). A person confirms a match, which records the payment at Passport in resolve mode. The GMS never initiates a Mercury payment.

- What is kept per transaction: id, posted date, amount, currency, counterparty name, memo. Account and routing numbers are dropped at the connector boundary and never reach a table or a log.
- `MercuryBankFeed` calls `GET /api/v1/accounts` and `GET /api/v1/account/{id}/transactions` with a bearer token. **These paths and the response fields were written from memory of Mercury's API, not from its documentation**: the documentation host was not reachable from the build environment (the egress proxy answered 403). Check both against Mercury's current API reference and a sandbox token before enabling the connector.
- A refused token surfaces as `ConnectorAuthError`; anything else as `ConnectorUnavailableError`, and the poll retries on the next run. Connecting verifies the token first and saves nothing if Mercury cannot be reached.

## Google Workspace (Composio)

The port (`WorkspaceApps`) and the routes exist. There is **no Composio implementation**: production is wired without one, so `POST /gms/connectors/google_workspace` answers `503 connector_not_configured`. Building it needs the Composio project and the scope restriction (`drive.file` through the Picker, directory read-only) confirmed first.

## Custom MCP servers

`POST /gms/custom-mcp-servers` registers a server by URL. `isRegistrableMcpUrl` refuses anything that is not HTTPS, carries credentials in the URL, is an IP literal, or names `localhost`, `.local` or `.internal`. The optional auth header is stored encrypted. Tools are listed on request and an admin chooses which are allowed; nothing is callable until allowed.
