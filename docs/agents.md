# AI agents

GMS treats AI agents as first-class users that always act **for a person**. They get the same permissions as that person, narrowed by the scopes the person granted. Anything consequential needs the person to confirm it in GMS, and some things only people can do at all.

Every tenant also serves a generated guide at `/agents.md` and summaries at `/llms.txt` and `/llms-full.txt`.

## The approval model

Every action in GMS has a risk tier:

| Tier | Examples | From an agent |
|---|---|---|
| R0 read | search opportunities, read an application | Runs |
| R1 reversible write | save answers, draft a message, propose a payment batch | Runs, audited as the agent acting for the person |
| R2 consequential | submit an application or report, send a message, advance an application | Creates an **approval request**; the person confirms in GMS (`/portal/confirm/{id}` or the console inbox) |
| R3 people-only | approve payments, change roles, connect a bank, change payee details | Refused with `human_only` — no scope grants it |

Foundations can raise an action's tier (never lower it) in Console → Settings → Agents. Applicant-written text is returned to agents wrapped as *untrusted applicant-supplied content* so staff-side agents don't follow instructions inside it.

## Connecting an agent

### MCP (recommended)

- Endpoint: `https://<foundation host>/mcp` — Streamable HTTP, **stateless** (no session id; `initialize` optional). Protocol `2026-07-28`; also accepts `2025-11-25`, `2025-06-18` and `2025-03-26`.
- Without a token you get the public tools: `search_opportunities`, `get_opportunity` and `check_eligibility`. (The A2A skill `answer_opportunity_question` answers questions from the published guidelines with citations.)
- With a token the tool list matches the person's role and the token's scopes. Applicants get tools such as `start_application`, `save_answers`, `validate_application`, `upload_attachment`, `request_submission`, `get_status`, `submit_report` and `get_payment_status`. Staff get `query_pipeline`, `screen_eligibility`, `assign_reviewers` (dry run by default), `draft_message`, `draft_award`, `propose_payment_batch`, `list_overdue_reports`, `run_report`, `get_portfolio_metrics` and more.
- Browser-based MCP clients must be listed in `GMS_MCP_ALLOWED_ORIGINS`; other `Origin` values get `403`.

### A2A

- Agent Card: `/.well-known/agent-card.json` (an extended card is available to authenticated callers).
- Endpoint: `/a2a` (JSON-RPC): `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, `agent/getAuthenticatedExtendedCard`, plus the v1.0 PascalCase aliases. Push notifications aren't supported; poll `tasks/get`.

### Platform API

`/api/v1` with an OpenAPI 3.1 document and Arazzo workflows — see [api.md](api.md).

## Authorization

### OAuth 2.1 (agents that support it)

1. Discover: `GET /.well-known/oauth-protected-resource/mcp` (or `/a2a`, `/api/v1`) names the authorization server; `GET /.well-known/oauth-authorization-server` lists its endpoints.
2. Register: use a **Client ID Metadata Document** (an `https` URL as `client_id`; GMS fetches it with SSRF protections and caches it for 24 hours) or Dynamic Client Registration at `/oauth/register`.
3. Authorize with PKCE (S256) and a `resource` indicator. The person signs in and sees the consent screen at `/oauth/consent`, which lists what the agent may do in plain language; they can untick scopes.
4. Exchange the code at `/oauth/token`. Access tokens (`gms_oat_`) last one hour and are bound to one resource; refresh tokens (`gms_ort_`) last 30 days and rotate — reusing an old refresh token revokes the client's tokens for that person.

When Supabase's OAuth 2.1 server is configured, GMS also accepts its JWTs (verified against JWKS, issuer, `client_id` and a resource-bound audience). Supabase doesn't support Client ID Metadata Documents yet, so GMS's built-in authorization server remains the default.

### Personal access tokens

For agents without OAuth support, a person creates a token in **Portal → Account → Connected agents** (or Console → Settings → API for staff), picks scopes and an expiry, and pastes it into the agent. Foundations can create **agent accounts** (`gms_ak_` keys) for their own automation; these act for the staff member who owns them.

## Scopes

| Scope | Allows |
|---|---|
| `opportunities:read` | Read opportunities and check eligibility |
| `profile:read`, `profile:write` | Read / update the person's profile and organizations |
| `applications:read`, `applications:write` | Read applications; start them, save answers, upload files |
| `applications:submit` | *Request* submission (the person still confirms) |
| `reports:write` | Draft reports and request report submission |
| `messages:read`, `messages:write` | Read and send messages (sending needs confirmation) |
| `messages:send` | Staff: send messages to applicants (a person confirms bulk sends) |
| `pipeline:read` | Staff: read the application pipeline |
| `reviews:write` | Staff: draft review assignments and scores |
| `awards:draft` | Staff: draft awards |
| `payments:read`, `payments:propose` | Staff: read payments, propose batches (never approve) |
| `analytics:read` | Staff: portfolio metrics and reports |

The authoritative list, with descriptions, is in `/.well-known/oauth-protected-resource`.

## Controls for people and foundations

- People see every connected agent, its scopes, last use and requests in **Connected agents**, and can pause or revoke it at any time.
- Foundations can turn MCP or A2A off, restrict which tools a client may use, set per-client rate limits, and require confirmation for more actions in **Console → Settings → Agents**. Every agent action appears in the audit log with the agent's name and the person it acted for.

## Evaluations

`pnpm evals` runs scripted agent scenarios against a throwaway database: an applicant agent finding, starting and requesting submission of an application over MCP (including with the official MCP SDK client); staff agents working with the pipeline, including prompt-injection text in applications; A2A tasks; the OAuth flow with PKCE and refresh rotation; and the `/api/v1` conventions. R3 actions are checked to be refused.
