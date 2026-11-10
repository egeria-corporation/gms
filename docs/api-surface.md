# API surface

All routes are served by `apps/api` (Cloudflare Worker, Hono). This file tracks the route tables of the
v1 build prompt (§9) against what the Worker answers today.

- **Implemented** — real behavior, covered by tests in `apps/api/test`.
- **Placeholder** — the route is mounted and answers `501` in the CommonGrants error shape
  (`{ "status": 501, "message": "…", "errors": [{ "code": "not_implemented" }] }`), so later phases
  have a seam to fill.

## Conventions

| Topic | Rule |
|---|---|
| Success envelope | `{ status, message, data }` or `{ status, message, items, paginationInfo }` (`apps/api/src/lib/errors.ts`) |
| Error envelope | `{ status, message, errors: [{ code, detail?, field? }] }`; `errors[0].code` is stable |
| OAuth endpoints | RFC shapes instead: RFC 6749 §5.2 errors on `/oauth/token`, RFC 7591 on `/oauth/register` |
| Pagination | `page` (from 1), `pageSize` (default 100, max 100) |
| Callers | A signed-in person (Supabase session bearer + `X-GMS-Workspace` header), a workspace API client (client-credentials token) or an agent acting for a person (authorization-code token). All resolve to one `Principal` and pass the same `requireScope` check |
| Workspace binding | Tokens carry `https://gms.opengrants.io/workspace_id` and are refused against any other workspace. Sessions name the workspace in `X-GMS-Workspace` (or a `:workspaceId` path segment) and must be members |
| Delegated tokens | Scopes are re-intersected with the person's current role on every request and every refresh |
| MFA | Funder `admin` / `finance` and applicant `admin` sessions must be `aal2` |
| Logging | Method, path, query parameter names, status, duration. Never bodies, query values, tokens, or bank/identity field values |

## Infrastructure

| Route | Status | Notes |
|---|---|---|
| `GET /health` | Implemented | Reports whether a database is configured |
| `GET /.well-known/jwks.json` | Implemented | Current ES256 key + `JWKS_EXTRA_PUBLIC_KEYS`; public members only |
| `GET /.well-known/oauth-authorization-server` | Implemented | RFC 8414 |
| `GET /.well-known/oauth-protected-resource` (and `/mcp` suffix) | Implemented | RFC 9728; what an MCP client reads first |
| `GET /.well-known/agent.json` | Implemented | Capabilities `mcp`, `commongrants:0.5.0`; lists human-gated actions |
| `GET /llms.txt`, `GET /llms-full.txt` | Implemented | Static text today; tool list to be generated from the `@gms/mcp` registry |
| `POST /oauth/token` | Implemented | `client_credentials`; `authorization_code` + PKCE S256; `refresh_token` with rotation |
| `GET /oauth/authorize` | Implemented | Validates the request, signs it, redirects to `{WEB_BASE_URL}/oauth/consent?req=…` |
| `GET /oauth/authorize/request` | Implemented | Session. What the consent screen shows: client, scopes, gated actions, the person's workspaces and what each can grant |
| `POST /oauth/authorize/decision` | Implemented | Session. `{ req, approve, workspaceId, scopes? }` → `{ redirectTo }`; consent is ledgered |
| `POST /oauth/register` | Implemented | Dynamic client registration: public clients, loopback or allow-listed HTTPS redirect hosts (`OAUTH_DCR_REDIRECT_HOSTS` extends the list) |
| `GET /openapi.json` | Placeholder | Serve the compiled TypeSpec document |
| `GET /sitemap.xml` | Placeholder | Phase 1 |
| `POST /webhooks/passport`, `POST /webhooks/resend` | Placeholder | Phases 2 and 4. Signing/verification helpers exist in `@gms/webhooks` and `@gms/passport-client` |
| `/mcp` (Streamable HTTP) | Placeholder | Phase 5 |
| `GET /f/{handle}`, `/f/{handle}/o/{slug}` | Served by `apps/web` | Public read routes that feed them arrive with phase 1 |

## Protocol routes (`/common-grants/…`) — all placeholder

| Route | Auth | Phase |
|---|---|---|
| `GET /opportunities`, `GET /opportunities/{oppId}`, `POST /opportunities/search` | public for published; token for drafts | 1 |
| `GET /competitions/{compId}` | public for open/closed; token for drafts | 1 |
| `GET /forms`, `GET /forms/{formId}` | public for forms of published competitions | 1 |
| `POST /applications/start` | `applications:write` | 2 |
| `GET /applications/{appId}` | applicant, or funder with visibility | 2 |
| `PUT /applications/{appId}/forms/{formId}`, `GET …` | applicant | 2 |
| `PUT /applications/{appId}/submit` | `applications:submit` (human-gated for agents) | 2 |
| `POST /applications/search` | funder or applicant | 2 |
| `GET /awards`, `GET /awards/{awdId}`, `POST /awards/search` | funder or recipient | 3 |
| `GET /orgs`, `GET /orgs/{orgId}` | `org:read` | 2 |
| `PATCH /orgs/{orgId}`, `POST /orgs/{orgId}/changes`, `GET /orgs/{orgId}/changes[/{changeId}]` | token; forwarded to Passport | 6 |

## GMS routes (`/gms/…`)

Implemented now:

| Route | Auth | Notes |
|---|---|---|
| `GET /gms/me` | session | The person and the workspaces they can open (workspace switcher) |
| `GET /gms/whoami` | any caller | The resolved principal: kind, workspace, role, effective scopes |
| `GET /gms/ledger` | role `admin` or `auditor`; tokens need `workspace:admin` | Filters `subjectType`, `subjectId`, `eventType`, `from`, `to`; the workspace always comes from the principal |

Placeholder (every other `/gms/*` path answers 501). Funder side:

| Routes | Scope | Phase |
|---|---|---|
| `GET/POST /workspaces`, `GET/PATCH /workspaces/{id}`, members, invitations | `workspace:admin` | 1 |
| `POST /workspaces/{id}/passport/link`, `GET …/passport/status`, `DELETE …/link` | `workspace:admin` | 1 |
| `GET/POST /programs`, `GET/PATCH /programs/{id}` | `programs:*` | 1 |
| `GET/POST /opportunities`, `GET/PATCH /opportunities/{id}`, `POST …/publish`, `…/close`, `…/preview` | `opportunities:*` | 1 |
| `GET/POST /competitions`, `GET/PATCH /competitions/{id}`, `PUT …/stages`, `…/forms`, `…/rubric`, `POST …/launch-check`, `…/open`, `…/close` | `competitions:*` | 1 |
| `GET/POST /forms`, `GET/PATCH /forms/{id}`, `POST …/versions`, `…/publish`, `GET /forms/library`, `POST /forms/{id}/test-fill` | `forms:*` | 1 |
| `POST /eligibility/evaluate` | `applications:read` | 1 |
| `GET /applications`, `GET /applications/{id}`, `POST …/advance`, `…/request-revision`, `…/decline`, `…/tags`, `…/assign`, `POST /applications/bulk` | `applications:*` | 2–3 |
| `GET/POST /rubrics`, `GET/POST /review-assignments`, `POST /review-assignments/auto`, `PATCH /review-assignments/{id}`, `GET /reviews`, `GET /competitions/{id}/ranking` | `reviews:*` | 3 |
| `POST /decisions/propose`, `GET /decisions`, `POST /decisions/commit`, `GET /competitions/{id}/allocation` | `decisions:write` | 3 |
| `GET /awards`, `GET /awards/{id}`, `POST …/accept-offer`, `…/activate`, `…/suspend`, `…/complete`, `…/cancel`, `…/amendments`, `PATCH /amendments/{id}` | `awards:*` | 3 |
| `POST /awards/{id}/agreements`, `POST /agreements/{id}/send`, `…/sign`, `…/countersign`, `…/void`, `GET …/pdf` | `agreements:*` | 3 |
| `GET/PUT /awards/{id}/schedule`, `GET /tranches`, `GET /tranches/{id}/readiness`, `POST /tranches/{id}/release`, `…/record-external`, `…/hold`, `…/cancel` | `payments:read`, `payments:release` | 4 |
| `GET /payments/readiness`, `GET /payments/alerts`, `GET /bank-transactions`, `POST /bank-transactions/{id}/match` | `payments:*` | 4 |
| `GET/POST /awards/{id}/requirements`, `PATCH /requirements/{id}`, `POST …/waive`, `GET /requirements/due`, `POST /requirements/{id}/remind`, `GET /submissions/{id}`, `POST …/accept`, `…/return` | `requirements:*` | 4 |
| `GET/PUT /awards/{id}/budget`, `GET /awards/{id}/variance` | `awards:*` | 4 |
| `GET /grantees`, `GET/PATCH /grantees/{id}`, `GET /org-changes`, `POST /org-changes/{id}/accept`, `…/dismiss`, `POST /grantees/{id}/propose-change` | `grantees:*` | 6 |
| `GET /threads`, `POST /threads/{id}/messages`, `GET/POST /tasks` | `messages:*` | 2 |
| `GET/POST /templates`, `POST /templates/{id}/render`, `POST /communications/send` | `communications:*` | 3 |
| `GET /analytics/portfolio`, `GET /analytics/cycle/{competitionId}`, `GET /exports/990pf`, `POST /exports/bundle`, `POST /imports/csv` | `analytics:read`, `workspace:admin` | 6 |
| `GET/POST/DELETE /api-clients`, `/webhooks`, `GET /webhooks/{id}/deliveries`, `GET/DELETE /mcp-connections`, `GET/POST/DELETE /custom-mcp-servers`, `/connectors/{provider}`, `POST /connectors/{provider}/sync` | `workspace:admin` | 5 |
| `POST /assist/summarize`, `/compare-rubric`, `/draft-letter`, `/adapt-answer` | `assist` | 5 |

Applicant side:

| Routes | Scope | Phase |
|---|---|---|
| `POST /passport/consent/start`, `GET /passport/consent/callback`, `GET /me/organization`, `GET /me/readiness`, `POST /me/organization/refresh` | session | 2 |
| `GET /discover/competitions`, `POST /discover/opengrants/search`, `…/match`, `…/eligibility`, `…/alerts` | `discovery` | 2 |
| `GET /my/applications`, `POST /my/applications/{id}/sections/assign`, `…/comments`, `…/attachments`, `…/withdraw`, `GET …/status` | `applications:*` | 2 |
| `GET /my/awards`, `GET /my/awards/{id}`, `POST …/accept`, `…/amendments`, `GET …/schedule` | `awards:*` | 3 |
| `GET /my/requirements`, `GET /my/submissions/{id}`, `PUT …/forms/{formId}`, `POST …/submit`, `…/share` | `requirements:*` | 4 |
| `GET/POST/PATCH /my/answers`, `POST /my/answers/{id}/adapt` | `library:*` | 2 |
| `GET /my/consents`, `DELETE /my/consents/{id}`, `GET /my/funders` | session | 2 |

## Scopes

`workspace:admin`, `programs:read/write`, `opportunities:read/write`, `competitions:read/write`,
`forms:read/write`, `applications:read/write/submit`, `reviews:read/write`, `decisions:write`,
`awards:read/write`, `agreements:write`, `payments:read/release`, `requirements:read/write`,
`grantees:read/write`, `messages:read/write`, `communications:write`, `analytics:read`, `discovery`,
`library:read/write`, `org:read`, `assist`. The vocabulary, the role → scope table and the
descriptions shown on the consent screen live in `apps/api/src/auth/scopes.ts`.

`approvals:bypass` is not part of the vocabulary a client can request or a person can grant through
consent; it exists only as an explicit admin grant on a workspace API client (phase 5).

## Outbound webhook events

`application.submitted`, `application.status.changed`, `review.submitted`, `decision.committed`,
`award.created`, `award.status.changed`, `agreement.executed`, `tranche.due`,
`tranche.status.changed`, `disbursement.status.changed` (relayed from Passport), `requirement.due`,
`submission.received`, `submission.accepted`, `org.change.pending`, `approval.requested`, plus
`approval.resolved` and `opportunity.published` (named in §10.9 and §11.3).

Each delivery: `X-GMS-Timestamp` (Unix seconds), `X-GMS-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`,
`X-GMS-Event`, `X-GMS-Delivery`. Retries after 1 m, 5 m, 15 m, 1 h, 2 h, 4 h, 8 h and 8 h 39 m (24 hours
in total), then the delivery is `exhausted`. Signing, verification, the schedule and the stores are in
`packages/webhooks`.
