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
| Callers | A signed-in person (Supabase session bearer + `X-GMS-Workspace` header), a workspace API client (client-credentials token) or an agent acting for a person (authorization-code token). All resolve to one `Principal`; the route builds a `ServiceContext` from it and calls a service function, which makes the one `authorize()` check (scope, role, workspace kind, ownership, consent) |
| Ids | `/gms` routes use prefixed ids (`opp_`, `cmp_`, `frm_` + UUID) and accept the bare UUID too; `/common-grants` routes use bare UUIDs. Programs, rubrics, workspaces and users have no prefix |
| Someone else's record | `404`, never `403`, so ids cannot be probed |
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
| `GET /llms.txt`, `GET /llms-full.txt` | Implemented | Tool lists, gate marks and (in the full file) input schemas are generated from the `@gms/mcp` registry |
| `POST /oauth/token` | Implemented | `client_credentials`; `authorization_code` + PKCE S256; `refresh_token` with rotation. A rotated refresh token used again revokes the whole consent |
| `GET /oauth/authorize` | Implemented | Validates the request, signs it, redirects to `{WEB_BASE_URL}/oauth/consent?req=…` |
| `GET /oauth/authorize/request` | Implemented | Session. What the consent screen shows: client, scopes, gated actions, the person's workspaces and what each can grant |
| `POST /oauth/authorize/decision` | Implemented | Session. `{ req, approve, workspaceId, scopes? }` → `{ redirectTo }`; consent is ledgered |
| `POST /oauth/register` | Implemented | Dynamic client registration: public clients, loopback or allow-listed HTTPS redirect hosts (`OAUTH_DCR_REDIRECT_HOSTS` extends the list) |
| `GET /openapi.json` | Implemented | The compiled TypeSpec document, shipped as a static asset (`pnpm spec:compile && pnpm --filter @gms/api build:openapi`); `503` when it has not been built |
| `GET /sitemap.xml` | Implemented | Active funder pages and published opportunities with `publish.sitemap` and `publish.publicPage` on |
| `POST /webhooks/passport`, `POST /webhooks/resend` | Placeholder | Phases 2 and 4. Signing/verification helpers exist in `@gms/webhooks` and `@gms/passport-client` |
| `POST /mcp` (Streamable HTTP) | Implemented | Stateless JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`; batches of up to 20; `GET` answers 405. A 401 carries `WWW-Authenticate: Bearer resource_metadata=…`. Tokens must act for a person (authorization code flow). See the MCP section below |
| `GET /f/{handle}`, `/f/{handle}/o/{slug}` | Served by `apps/web` | Data comes from `GET /gms/public/funders/{handle}` and `…/opportunities/{slug}` below |

## Protocol routes (`/common-grants/…`)

Implemented responses are validated against the compiled OpenAPI document in
`apps/api/test/contract.test.ts` and `contract-applications.test.ts`.

| Route | Auth | Status |
|---|---|---|
| `GET /opportunities`, `GET /opportunities/{oppId}`, `POST /opportunities/search` | public for published; a token for the owning workspace also reads drafts | Implemented. `OpportunityDetails` carries the competitions the caller may see; `awards` arrive with phase 3 |
| `GET /competitions/{compId}` | public for open/closed under a published opportunity; token for drafts | Implemented. Stages in `customFields.gms.value.stages` |
| `GET /forms`, `GET /forms/{formId}` (`?version=`) | public for form versions pinned by a public competition; token for the workspace's other versions | Implemented |
| `POST /applications/start` | `applications:write`, applicant workspace | Implemented. Body `{ competitionId, organizationId?, title? }`. Creates the draft, prefills the first stage's forms from the cached Passport record (provenance `passport`), stores an eligibility preview in `customFields.gms.value.eligibility` (`preview: true`). `201`; starting again returns the same application with `200` |
| `GET /applications/{appId}` | the applicant; the funder once it has been submitted | Implemented. Anyone else gets `404` |
| `GET /applications/{appId}/forms/{formId}`, `PUT …` | applicant, `applications:write` to write | Implemented. `PUT { response }` merges; validation errors come back in the response and never fail the save. Passport-owned fields are not editable (the ignored paths are listed in `customFields.gmsRejected`). Edits by an agent are marked `agent:<client>` |
| `PUT /applications/{appId}/submit` | `applications:submit` (human-gated for agents through MCP) | Implemented. Re-validates the stage's forms (`422` lists what is missing), runs the rules, stamps `verificationLevel` and the attestation URL, locks the stage's responses, records the applicant → funder consent, sends the acknowledgment, emits `application.submitted` |
| `POST /applications/search` | `applications:read` | Implemented. The applicant's own applications, or the funder's submitted ones |
| `GET /awards`, `GET /awards/{awdId}`, `POST /awards/search` | funder or recipient (`awards:read`) | Implemented. `AwardBase`; `funding.disbursedAmount` is the cached Passport value, absent until Passport reports one |
| `GET /orgs`, `GET /orgs/{orgId}` | `org:read` | Placeholder (phase 2) |
| `PATCH /orgs/{orgId}`, `POST /orgs/{orgId}/changes`, `GET /orgs/{orgId}/changes[/{changeId}]` | token; forwarded to Passport | Placeholder (phase 6) |

## GMS routes (`/gms/…`)

Implemented:

| Routes | Auth | Notes |
|---|---|---|
| `GET /gms/me` | session | The person and the workspaces they can open, each with `id`, `handle`, `kind`, `role`, `displayName`, `brand`, `requiresMfa`, `passportOrgId`, `verificationLevel` |
| `GET /gms/whoami` | any caller | The resolved principal: kind, workspace, role, effective scopes |
| `GET /gms/ledger` | role `admin` or `auditor`; tokens need `workspace:admin` | Filters `subjectType`, `subjectId`, `eventType`, `from`, `to`; the workspace always comes from the principal |
| `GET /gms/workspaces`, `POST /gms/workspaces` | session | List the person's workspaces; create one and become its admin. Brand accent is contrast-checked (WCAG AA) and falls back to the system accent with a warning |
| `GET /gms/workspaces/{id}` | any member; tokens need `workspace:admin` | |
| `PATCH /gms/workspaces/{id}`, `GET/POST …/members`, `PATCH/DELETE …/members/{userId}`, `POST …/invitations` | `workspace:admin`, role `admin` to change | A workspace always keeps one admin. The invitation token is returned once; only its hash is stored. Sending the invitation email arrives with `@gms/notify` wiring |
| `POST /gms/invitations/accept` | session | `{ token }`; one use, expires |
| `POST /gms/workspaces/{id}/passport/link`, `DELETE …/link` | funder `admin`, signed-in person only | Verifies the client against Passport (funding sources) before saving; secret stored AES-GCM encrypted, never returned |
| `GET /gms/workspaces/{id}/passport/status` | `workspace:admin`, funder | Live check: `pass`, `fail` or `unknown` (Passport unreachable) |
| `GET/POST /gms/programs`, `GET/PATCH /gms/programs/{id}` | `programs:*`, funder | Budget changes are ledgered with both values |
| `GET/POST /gms/rubrics` | `reviews:*`, funder | Workspace rubrics plus the shared library |
| `GET/POST /gms/opportunities`, `GET/PATCH /gms/opportunities/{id}`, `POST …/publish`, `…/close`, `…/preview` | `opportunities:*`, funder | Publish validates and stores the CommonGrants projection and emits `opportunity.published` |
| `GET/POST /gms/competitions`, `GET/PATCH /gms/competitions/{id}`, `PUT …/stages`, `…/forms`, `…/rubric`, `POST …/launch-check`, `…/open`, `…/close` | `competitions:*`, funder | Launch check returns the readiness checklist shape (`key`, `state`, `label`, `reason`, `fixHref`); `open` is refused until every line passes. `forms` on an open competition needs `migrate: true` (re-validation of in-progress responses arrives with phase 2) |
| `GET/POST /gms/forms`, `GET/PATCH /gms/forms/{id}`, `POST …/versions`, `…/publish`, `GET /gms/forms/library`, `POST /gms/forms/{id}/test-fill` | `forms:*` | Definitions are checked by `@gms/forms` on every save; published versions are immutable |
| `POST /gms/eligibility/evaluate` | `applications:read` | Rules from the body or an opportunity; an applicant's cached Passport record is read only with a live consent |
| `GET /gms/public/funders/{handle}`, `GET /gms/public/funders/{handle}/opportunities/{slug}` | none | Published fields only, edge-cacheable |
| `POST /gms/passport/consent/start` | session | `{ workspaceId?, returnTo? }` → `{ authorizeUrl, scopes, expiresInSeconds }`. PKCE verifier and initiator travel in `state`, sealed with `CREDENTIALS_ENCRYPTION_KEY` (10 minutes) |
| `GET /gms/passport/consent/callback` | none (the sealed `state`) | Exchanges the code, caches the organization and its Common App profile, creates or links the applicant workspace, stores the refresh token encrypted. Always `302` to the web app: `?passport=linked&ws=<handle>` or `?passport=error&reason=…` |
| `GET /gms/me/organization`, `POST /gms/me/organization/refresh`, `GET /gms/me/readiness` | `org:read`, applicant | The cached `OrganizationBase`, the folded profile with per-field sources, the level, and the readiness checklist (`pass`/`fail`/`unknown`) |
| `GET /gms/my/consents`, `DELETE /gms/my/consents/{id}`, `GET /gms/my/funders` | `org:read` / applicant `admin` to revoke / `applications:read` | Who may read the cached record, and the funders applied to |
| `GET /gms/my/applications`, `GET …/{id}/status`, `POST …/{id}/withdraw` | `applications:*`, applicant | List with funder, stage and progress; the status timeline; withdraw |
| `POST /gms/my/applications/{id}/sections/assign` | `applications:write` | `{ formId, sections: { key: userId \| null } }` |
| `GET/POST /gms/my/applications/{id}/comments`, `POST …/comments/{commentId}/resolve` | `applications:*` | Field comments inside the applicant team; never visible to the funder |
| `GET/POST /gms/my/applications/{id}/attachments` | `applications:*` | Upload (`contentBase64`, up to 25 MB, SHA-256 computed) or a Passport locker reference (no copy) |
| `GET/POST /gms/my/answers`, `PATCH /gms/my/answers/{id}` | `library:*` | Editing saves a new version |
| `GET /gms/discover/competitions` | `discovery` | Open competitions with the caller's eligibility |
| `POST /gms/discover/opengrants/{search,match,eligibility,alerts}` | `discovery` | Proxied to the hosted OpenGrants MCP with the organization's type, region, mission and revenue band; cached 15 minutes per organization and query; listings that point at a GMS opportunity carry `gms` |
| `GET/POST /gms/discover/saved` | `discovery` | Saved listings |
| `GET /gms/applications` | `applications:read`, funder | Filters `competitionId`, `stage`, `status` (comma list), `eligibility` (`true`/`false`/`unknown`), `level`, `tag`, `assignee` (user id or `unassigned`), `q`; `sortBy`, `sortOrder`; also returns `counts` by status. Reviewers see assigned applications only |
| `GET /gms/applications/{id}`, `POST …/eligibility` | `applications:read` | Responses with provenance, eligibility results, the consented Passport record, timeline. Reviewers get masked responses; external reviewers no organization |
| `POST /gms/applications/{id}/advance`, `…/request-revision`, `…/tags`, `…/assign` | `applications:write` | Through the application machine; a revision unlocks the current stage and emails the applicant |
| `POST /gms/applications/{id}/decline` | `applications:write` and `decisions:write` | Records a committed decision, then declines and sends the letter |
| `POST /gms/applications/bulk` | `applications:write` | `{ action, applicationIds, params }`; each application succeeds or fails on its own |
| `GET/POST /gms/threads`, `POST /gms/threads/{id}/messages` | `messages:*` | Shared thread, or the caller's side's internal thread (never shown to the other side) |
| `GET/POST /gms/tasks`, `PATCH /gms/tasks/{id}` | `messages:*` | |
| `GET /gms/approvals`, `GET /gms/approvals/{id}`, `POST /gms/approvals/{id}/decision` | people in the workspace; deciding needs the gated tool's scope | `{ approve, note? }`. Approving runs the original call once as the approver; the approval ends `executed` or `failed` |

### Review to award (phase 3)

Implemented. Signing, countersigning, accepting an offer, committing decisions and sending
communications are **people only**: a client-credentials or delegated (agent) token answers
`403 human_only`. Through MCP the gated tools return `pending_approval` and run as the approver;
`sign_agreement` never runs for an agent.

| Route | Scope | Notes |
|---|---|---|
| `GET /gms/review-assignments` | `reviews:read` | Staff see the matrix; reviewers see their own. Filters: `competitionId`, `applicationId`, `stage`, `reviewerUserId`, `status` |
| `POST /gms/review-assignments` | `reviews:write` (staff) | 409 `conflict_of_interest` for a declared conflict or a matching email domain; moves the application to `under_review` |
| `POST /gms/review-assignments/auto` | `reviews:write` (staff) | Capacity, expertise tags, COI exclusion; `dryRun` returns the plan only |
| `POST /gms/review-assignments/invite` | `reviews:write` (staff, person) | Emails an invitation; accepting creates an `external_reviewer` member scoped to the competition |
| `GET /gms/review-assignments/{id}` | `reviews:read` | The reviewer's view: rubric, own review, the application masked for their role (no organization record for external reviewers) |
| `PATCH /gms/review-assignments/{id}` | `reviews:write` | `action`: `declare_coi`, `save`, `submit`, `recuse`, `reschedule`. Scoring needs the COI declaration first |
| `GET /gms/reviews?applicationId=` | `reviews:read` | Blind by default: a reviewer sees other reviews only once the stage's panel is open (`stages[].panelOpen`, `reviewMode`) |
| `GET /gms/competitions/{id}/ranking?stage=` | `reviews:read` (staff, observer, auditor) | Mean, median, sample stdev, n, spread flag; recomputed on read |
| `GET /gms/competitions/{id}/allocation` | `reviews:read` | Budget − committed awards − open proposals, in minor units |
| `POST /gms/decisions/propose`, `GET /gms/decisions` | `decisions:write` / `reviews:read` | A new proposal replaces the application's open one |
| `POST /gms/decisions/commit` | `decisions:write` (person) | 409 `over_allocation` unless an admin sends `override.reason`. Approve → award `offered`, agreement draft, schedule, requirements, letter |
| `GET /gms/awards`, `GET /gms/awards/{id}`, `POST /gms/awards` | `awards:read` / `awards:write` | Detail includes agreement, tranches, requirements, amendments |
| `POST /gms/awards/{id}/activate`, `/suspend`, `/resume`, `/complete`, `/cancel` | `awards:write` (staff) | Through the award machine; suspend holds due tranches, cancel cancels open ones |
| `GET/POST /gms/awards/{id}/amendments`, `PATCH /gms/amendments/{id}` | `awards:*` | Extension moves the end date; supplemental creates a child award; Passport is patched when mirrored |
| `GET /gms/awards/{id}/letter.pdf` | `awards:read` | Award letter PDF |
| `GET /gms/my/awards`, `/my/awards/{id}`, `/my/awards/{id}/schedule` | `awards:read` (recipient) | |
| `POST /gms/my/awards/{id}/accept` (also `POST /gms/awards/{id}/accept-offer`) | `awards:write` (recipient admin, person) | Then mirrors the award to Passport when `PASSPORT_AWARD_WRITE=true`; a failed mirror never undoes acceptance |
| `POST /gms/my/awards/{id}/amendments` | `awards:write` (recipient) | |
| `POST /gms/awards/{id}/agreements` | `agreements:write` (staff) | Draft from a template version; refused while a live agreement exists |
| `GET /gms/agreements/{id}`, `GET /gms/agreements/{id}/pdf` | `awards:read` | Either party. The PDF is the executed document once executed; `X-Content-SHA256` carries its hash |
| `POST /gms/agreements/{id}/send` | `agreements:write` (staff) | Renders and hashes the document; sends the award letter email |
| `POST /gms/agreements/{id}/sign` | `agreements:write` (recipient admin, person) | Typed name, attestation, network address, time, document hash. The offer must be accepted first |
| `POST /gms/agreements/{id}/countersign` | `agreements:write` (staff, person) | Executes: award `active`, `onExecution` tranches `due`, executed PDF stored and its hash ledgered (`agreement.document_executed`) |
| `POST /gms/agreements/{id}/void` | `agreements:write` (staff) | Refused once executed |
| `GET/POST /gms/templates`, `GET /gms/templates/{id}`, `POST /gms/templates/{id}/render` | `communications:write` | Immutable versions; built-ins under `builtin:*`; 422 lists missing merge fields |
| `POST /gms/communications/send`, `GET /gms/communications` | `communications:write` (send: staff, person) | Nothing is sent unless every letter renders; the log is read from the ledger |

Placeholder (every other `/gms/*` path answers 501). Funder side:

| Routes | Scope | Phase |
|---|---|---|
| `GET/PUT /awards/{id}/schedule`, `GET /tranches`, `GET /tranches/{id}/readiness`, `POST /tranches/{id}/release`, `…/record-external`, `…/hold`, `…/cancel` | `payments:read`, `payments:release` | 4 |
| `GET /payments/readiness`, `GET /payments/alerts`, `GET /bank-transactions`, `POST /bank-transactions/{id}/match` | `payments:*` | 4 |
| `GET/POST /awards/{id}/requirements`, `PATCH /requirements/{id}`, `POST …/waive`, `GET /requirements/due`, `POST /requirements/{id}/remind`, `GET /submissions/{id}`, `POST …/accept`, `…/return` | `requirements:*` | 4 |
| `GET/PUT /awards/{id}/budget`, `GET /awards/{id}/variance` | `awards:*` | 4 |
| `GET /grantees`, `GET/PATCH /grantees/{id}`, `GET /org-changes`, `POST /org-changes/{id}/accept`, `…/dismiss`, `POST /grantees/{id}/propose-change` | `grantees:*` | 6 |
| `GET /analytics/portfolio`, `GET /analytics/cycle/{competitionId}`, `GET /exports/990pf`, `POST /exports/bundle`, `POST /imports/csv` | `analytics:read`, `workspace:admin` | 6 |
| `GET/POST/DELETE /api-clients`, `/webhooks`, `GET /webhooks/{id}/deliveries`, `GET/DELETE /mcp-connections`, `GET/POST/DELETE /custom-mcp-servers`, `/connectors/{provider}`, `POST /connectors/{provider}/sync` | `workspace:admin` | 5 |
| `POST /assist/summarize`, `/compare-rubric`, `/draft-letter`, `/adapt-answer` | `assist` | 5 |

Applicant side:

| Routes | Scope | Phase |
|---|---|---|
| `GET /my/requirements`, `GET /my/submissions/{id}`, `PUT …/forms/{formId}`, `POST …/submit`, `…/share` | `requirements:*` | 4 |
| `POST /my/answers/{id}/adapt` | `library:read`, `assist` | 5 |

## MCP (`POST /mcp`)

The endpoint dispatches through `@gms/mcp` (scope, side, input validation, human gates, rate limit
of 120 calls per minute per token, ledger attribution `user:<id>/client:<id>`) into the same service
functions the REST routes call (`apps/api/src/services/mcp-layer.ts`).

| Side | Tools backed by a service today |
|---|---|
| Funder | `list_programs`, `get_program`, `list_opportunities`, `get_opportunity`, `publish_opportunity`, `list_competitions`, `get_competition`, `list_forms`, `get_form`, `list_applications`, `get_application`, `run_eligibility`, `advance_application`, `request_revision`, `decline_application` (gated), `tag_application`, `get_approval` |
| Applicant | `get_my_organization`, `get_passport_readiness`, `find_competitions`, `check_eligibility`, `search_opengrants`, `match_opengrants`, `create_funding_alert`, `list_applications`, `get_application`, `start_application`, `fill_form_response`, `insert_answer`, `validate_application`, `submit_application` (gated), `withdraw_application`, `list_answers`, `save_answer`, `list_messages`, `reply`, `get_approval` |

Every other declared tool is listed by `tools/list` and answers a tool error saying it is not
available on this server yet. Resources `gms://opportunity|competition|form|application|org/{id}`
are readable; `gms://award/{id}` arrives with awards.

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
