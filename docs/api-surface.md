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
| `GET /oauth/authorize` | Implemented | Validates the request, signs it, redirects to `{WEB_BASE_URL}/consent?req=…` (`GET /oauth/consent` redirects there too) |
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
| `GET /opportunities`, `GET /opportunities/{oppId}`, `POST /opportunities/search` | public for published; a token for the owning workspace also reads drafts | Implemented. `OpportunityDetails` carries the competitions the caller may see; `awards` arrive with phase 3. The list and search leave out a call whose public page is off (`publish.publicPage: false`, unlisted, v1.12.0); it stays readable by its id |
| `GET /competitions/{compId}` | public for open/closed under a published opportunity; token for drafts | Implemented. Stages in `customFields.gms.value.stages` |
| `GET /forms`, `GET /forms/{formId}` (`?version=`) | public for form versions pinned by a public competition; token for the workspace's other versions | Implemented. A report form pinned by a requirement is readable, at the pinned version, by the grantee who owes the report and the funder who asked for it; everyone else gets 404 |
| `POST /applications/start` | `applications:write`, applicant workspace | Implemented. Body `{ competitionId, organizationId?, title? }`. Creates the draft, prefills the first stage's forms from the cached Passport record (provenance `passport`), stores an eligibility preview in `customFields.gms.value.eligibility` (`preview: true`). `201`; starting again returns the same application with `200` |
| `GET /applications/{appId}` | the applicant; the funder once it has been submitted | Implemented. Anyone else gets `404` |
| `GET /applications/{appId}/forms/{formId}`, `PUT …` | applicant, `applications:write` to write | Implemented. `PUT { response }` merges; validation errors come back in the response and never fail the save. Passport-owned fields are not editable (the ignored paths are listed in `customFields.gmsRejected`). Edits by an agent are marked `agent:<client>` |
| `PUT /applications/{appId}/submit` | `applications:submit`, a person (an agent or API-client token gets `403 approval_required`; agents submit through the MCP tool, which files the approval) | Implemented. Re-validates the stage's forms (`422` lists what is missing), runs the rules, stamps `verificationLevel` and the attestation URL, locks the stage's responses, records the applicant → funder consent, sends the acknowledgment, emits `application.submitted` |
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
| `GET /gms/workspaces`, `POST /gms/workspaces` | session | List the person's workspaces; create one and become its admin. Brand accent is contrast-checked (WCAG AA) and falls back to the system accent with a warning. Optional `profile` creates it without Passport, with a self-declared profile (`profileSource: "self_declared"`). `passportOrgId` is refused. Capped at 5 per account and 20 per network address (IPv6 by /64; only `CF-Connecting-IP`, forwarded headers only with `TRUSTED_PROXY="true"`) per day, counted in Postgres (migration 0027) so the cap holds across sessions, Workers and parallel requests: `429 too_many_workspaces` |
| `PATCH /gms/workspaces/{id}/profile` | `workspace:admin`, role `admin` | Merge patch of the self-declared profile (`null` removes a field; `legalName` stays). Ledgered as `workspace.profile_updated` with field names. `409 profile_from_passport` for a Passport workspace |
| `GET /gms/workspaces/{id}` | any member; tokens need `workspace:admin` | |
| `PATCH /gms/workspaces/{id}` settings | `workspace:admin`, role `admin` | `settings` is a merge patch of the keys an admin may set only (`USER_SETTINGS` in `services/workspaces.ts`: funders `contactEmail`, `gatedTools`, `defaultRail`, `poweredBy`; applicants `gatedTools`, `poweredBy` and the v1.6.0/v1.7.0 keys; `transparency` is retired in v1.9.0, award listing has its own route). Server-owned keys (`passportPayee`, `assistMonthlyQuota`) and `contacts` (own route) are dropped; a bad value is `422 invalid_setting` |
| `PATCH /gms/workspaces/{id}`, `GET/POST …/members`, `PATCH/DELETE …/members/{userId}`, `POST …/invitations` | `workspace:admin`, role `admin` to change | A workspace always keeps one admin. The invitation token is returned once; only its hash is stored. Sending the invitation email arrives with `@gms/notify` wiring |
| `DELETE /gms/workspaces/{id}/members/me` | person, any role | Leave the workspace. Refused for the last admin and for any agent or token |
| `POST /gms/invitations/accept` | session | `{ token }`; one use, expires |
| `POST /gms/workspaces/{id}/passport/link`, `DELETE …/link` | funder `admin`, signed-in person only | Verifies the client against Passport (funding sources) before saving; secret stored AES-GCM encrypted, never returned |
| `GET /gms/workspaces/{id}/passport/status` | `workspace:admin`, funder | Live check: `pass`, `fail` or `unknown` (Passport unreachable) |
| `GET/POST /gms/programs`, `GET/PATCH /gms/programs/{id}` | `programs:*`, funder | Budget changes are ledgered with both values |
| `GET/POST /gms/rubrics` | `reviews:*`, funder | Workspace rubrics plus the shared library |
| `GET/POST /gms/opportunities`, `GET/PATCH /gms/opportunities/{id}`, `POST …/publish`, `…/close`, `…/preview` | `opportunities:*`, funder | Publish validates and stores the CommonGrants projection and emits `opportunity.published` |
| `GET/POST /gms/competitions`, `GET/PATCH /gms/competitions/{id}`, `PUT …/stages`, `…/forms`, `…/rubric`, `POST …/launch-check`, `…/open`, `…/close` | `competitions:*`, funder | Launch check returns the readiness checklist shape (`key`, `state`, `label`, `reason`, `fixHref`); `open` is refused until every line passes. `forms` on an open competition needs `migrate: true` (re-validation of in-progress responses arrives with phase 2) |
| `GET/POST /gms/forms`, `GET/PATCH /gms/forms/{id}`, `POST …/versions`, `…/publish`, `GET /gms/forms/library`, `POST /gms/forms/{id}/test-fill` | `forms:*` | Definitions are checked by `@gms/forms` on every save; published versions are immutable |
| `POST /gms/eligibility/evaluate` | `applications:read`, not reviewers | Rules from the body or an opportunity; an applicant's cached Passport record is read only with a live consent, and then each result carries the outcome and label only (no `actual`, and `explain` does not quote what was found). Reviewer roles get 403 |
| `GET /gms/public/funders/{handle}`, `GET /gms/public/funders/{handle}/opportunities/{slug}` | none | Published fields only, edge-cacheable |
| `POST /gms/passport/consent/start` | session | `{ workspaceId?, returnTo? }` → `{ authorizeUrl, scopes, expiresInSeconds }`. PKCE verifier and initiator travel in `state`, sealed with `CREDENTIALS_ENCRYPTION_KEY` (10 minutes) |
| `GET /gms/passport/consent/callback` | none (the sealed `state`) | Exchanges the code, caches the organization and its Common App profile, creates or links the applicant workspace, stores the refresh token encrypted. Always `302` to the web app: `?passport=linked&ws=<handle>` or `?passport=error&reason=…` |
| `GET /gms/me/organization`, `POST /gms/me/organization/refresh`, `GET /gms/me/readiness` | `org:read`, applicant | The cached `OrganizationBase`, the folded profile with per-field sources, the level, and the readiness checklist (`pass`/`fail`/`unknown`) |
| `GET /gms/me/documents` | `org:read`, applicant | The organization's Passport locker as references (id, kind, name, type, SHA-256, `attachable`), read live with the stored consent. Never bytes. Needs Passport's `GET /passport/orgs/{orgId}/documents` (egeria-corporation/passport#1) |
| `GET /gms/my/consents`, `DELETE /gms/my/consents/{id}`, `GET /gms/my/funders` | `org:read` / applicant `admin` to revoke / `applications:read` | Who may read the cached record, and the funders applied to |
| `GET /gms/my/applications`, `GET …/{id}/status`, `POST …/{id}/withdraw` | `applications:*`, applicant | List with funder, stage and progress; the status timeline; withdraw |
| `POST /gms/my/applications/{id}/sections/assign` | `applications:write` | `{ formId, sections: { key: userId \| null } }` |
| `GET/POST /gms/my/applications/{id}/comments`, `POST …/comments/{commentId}/resolve` | `applications:*` | Field comments inside the applicant team; never visible to the funder |
| `GET/POST /gms/my/applications/{id}/attachments` | `applications:*` | Upload (`contentBase64`, up to 25 MB, SHA-256 computed) or a Passport locker reference (no copy) |
| `GET/POST /gms/my/answers`, `PATCH /gms/my/answers/{id}` | `library:*` | Editing saves a new version. Each `usedIn` entry carries `applicationTitle` and `funderName` |
| `GET /gms/discover/competitions` | `discovery` | Open competitions with the caller's eligibility |
| `POST /gms/discover/opengrants/{search,match,eligibility,alerts}` | `discovery` | Proxied to the hosted OpenGrants MCP with the organization's type, region, mission and revenue band; cached 15 minutes per organization and query; listings that point at a GMS opportunity carry `gms` |
| `GET/POST /gms/discover/saved` | `discovery` | Saved listings |
| `GET /gms/applications` | `applications:read`, funder | Filters `competitionId`, `stage`, `status` (comma list), `eligibility` (`true`/`false`/`unknown`), `level`, `tag`, `assignee` (user id or `unassigned`), `q`; `sortBy`, `sortOrder`; also returns `counts` by status. Reviewers see assigned applications only |
| `GET /gms/applications/{id}`, `POST …/eligibility` | `applications:read` | Responses with provenance, eligibility results, the consented Passport record, timeline. Reviewers get masked responses; external reviewers no organization |
| `POST /gms/applications/{id}/advance`, `…/request-revision`, `…/tags`, `…/assign` | `applications:write` | Through the application machine; a revision unlocks the current stage and emails the applicant |
| `POST /gms/applications/{id}/decline` | `applications:write` and `decisions:write`, a person (tokens get `403 approval_required`, also for bulk decline) | Records a committed decision, then declines and sends the letter |
| `POST /gms/applications/bulk` | `applications:write` | `{ action, applicationIds, params }`; each application succeeds or fails on its own |
| `GET/POST /gms/threads`, `POST /gms/threads/{id}/messages` | `messages:*` | Shared thread, or the caller's side's internal thread (never shown to the other side) |
| `GET/POST /gms/tasks`, `PATCH /gms/tasks/{id}` | `messages:*` | |
| `GET /gms/approvals`, `GET /gms/approvals/{id}`, `POST /gms/approvals/{id}/decision` | list: people; read: the requester (person or agent), people holding the gated tool's scope, admins and auditors (404 otherwise); deciding needs the gated tool's scope | `{ approve, note? }`. Approving runs the original call once as the approver; the approval ends `executed` or `failed` |

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
| `GET`, `PUT /gms/competitions/{id}/coi-policy` | `reviews:read` / `reviews:write` (staff) | The conflict-of-interest policy reviewers sign; a change is a new version (docs/reviews.md) |
| `POST /gms/competitions/{id}/coi-policy/sign` | session only (the reviewer) | Typed name, the version read, declared organizations; 409 `policy_changed`; agents and API clients refused |
| `GET /gms/competitions/{id}/conflicts-register`, `…/conflicts-register.csv` | `reviews:read` (staff, observer, auditor) | Signatures, declared conflicts with their matches, recusals with reasons |
| `GET`, `PUT /gms/competitions/{id}/review-settings` | `reviews:read` / `reviews:write` (staff) | Per stage: `anonymized`, `reviewMode`, `panelOpen` |
| `POST /gms/competitions/{id}/dockets`, `GET …/dockets/{docketId}` | `reviews:read` (admin, program officer) | The board docket PDF, kept in the EXPORTS bucket; 503 `exports_unavailable` without it |
| `GET /gms/competitions/{id}/allocation` | `reviews:read` | Budget − committed awards − open proposals, in minor units |
| `POST /gms/decisions/propose`, `GET /gms/decisions` | `decisions:write` / `reviews:read` | A new proposal replaces the application's open one |
| `POST /gms/decisions/commit` | `decisions:write` (person) | 409 `over_allocation` unless an admin sends `override.reason`. Approve → award `offered`, agreement draft, schedule, requirements, letter |
| `GET /gms/awards`, `GET /gms/awards/{id}`, `POST /gms/awards` | `awards:read` / `awards:write` | Detail includes agreement, tranches, requirements, amendments |
| `POST /gms/awards/{id}/activate`, `/suspend`, `/resume`, `/complete`, `/cancel` | `awards:write` (staff) | Through the award machine; suspend holds due tranches, cancel cancels open ones |
| `GET/POST /gms/awards/{id}/amendments`, `PATCH /gms/amendments/{id}` | `awards:*` | Extension moves the end date; supplemental creates a child award; Passport is patched when mirrored |
| `GET /gms/awards/{id}/letter.pdf` | `awards:read` | Award letter PDF |
| `GET /gms/my/awards`, `/my/awards/{id}`, `/my/awards/{id}/schedule` | `awards:read` (recipient) | The detail carries `payoutDestination` |
| `GET /gms/my/awards/{id}/payout-destination` | `awards:read` (recipient) | Bank name and last four digits, read live from Passport with the grantee's consent, never stored. `state`: `ok`, `none`, `not_linked`, `not_shared` (the consent lacks `payee:read`), `unknown` (Passport unreachable) |
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

### Payments, requirements, budgets (Phase 4)

Release, record-external and bank match are **human only**: the service refuses any caller that is not a signed-in person (`403 human_only`), whatever scopes the token has. Through MCP, `release_tranche` and `record_external_payment` create a pending approval and run as the approver.

| Route | Scope (role) | Notes |
|---|---|---|
| `GET/PUT /gms/awards/{id}/schedule` | `payments:read` / `payments:release` (admin, finance) | Tranches must sum to the award; settled tranches are not replaced |
| `GET /gms/tranches` | `payments:read` | Filters `awardId`, `status`, `dueBefore` |
| `GET /gms/tranches/{id}/readiness` | `payments:read` | Seven checks, each `pass` / `fail` / `unknown`, with `summary.releasable` and the hold banner |
| `POST /gms/tranches/{id}/release` | `payments:release` (person) | `{ rail?, confirmDuplicate? }`. Idempotent: the tranche id is Passport's `Idempotency-Key`. `409 not_ready` carries the failing checks |
| `POST /gms/tranches/{id}/record-external` | `payments:release` (person) | `{ reference, paidAt, destinationLast4 }` → Passport resolve mode |
| `POST /gms/tranches/{id}/hold`, `…/release-hold`, `…/cancel` | `payments:release` | `release-hold` is an addition to the build prompt |
| `POST /gms/tranches/{id}/reconcile` | person, role `finance` or `admin` | Resolves a tranche stuck in `releasing` by repeating the identical request under the same Idempotency-Key. An addition to the build prompt |
| `GET /gms/payments/readiness`, `GET /gms/payments/alerts` | `payments:read` | Payments center |
| `GET /gms/bank-transactions`, `POST /gms/bank-transactions/{id}/match` | `payments:read` / `payments:release` (person) | Matching calls record-external |
| `GET/POST /gms/awards/{id}/requirements`, `PATCH /gms/requirements/{id}`, `POST …/waive`, `POST …/remind` | `requirements:read` / `requirements:write` | Reminders go to each member of the grantee's workspace by their notification preferences (category `requirement`): at once, in their digest, or not at all. The organization's address is used only when no member has opted in |
| `GET /gms/requirements/due` | `requirements:read` | |
| `GET /gms/submissions`, `GET /gms/submissions/{id}`, `POST …/accept`, `POST …/return` | `requirements:*` | Accepting makes `onReportAccepted` tranches due. `GET /gms/submissions` is an addition |
| `GET/PUT /gms/awards/{id}/budget`, `GET /gms/awards/{id}/variance` | `awards:read` / `awards:write` | |
| `GET /gms/my/requirements`, `POST /gms/my/requirements/{id}/start` | `requirements:read` / `requirements:write` (applicant) | Start prefills from Passport and the last accepted report |
| `GET /gms/my/submissions/{id}`, `PUT …/forms/{formId}`, `POST …/submit`, `POST …/share` | `requirements:*` (applicant) | Share copies an accepted report to another funder the applicant has a consent with |
| `GET/PUT /gms/my/awards/{id}/budget` | `awards:read` / `awards:write` (applicant) | Actuals; addition |

### Grantees, analytics, integrations

| Route | Scope (role) | Notes |
|---|---|---|
| `GET /gms/grantees`, `GET/PATCH /gms/grantees/{id}` | `grantees:read` / `grantees:write` | Bank facts are `bankName` and `last4` only |
| `GET /gms/org-changes`, `POST …/accept`, `POST …/dismiss`, `POST /gms/grantees/{id}/propose-change` | `grantees:*` | Proposals go to Passport; any key that names bank or identity data is refused |
| `GET /gms/directory/suggest` | `grantees:read` | Addition |
| `GET /common-grants/orgs`, `GET /common-grants/orgs/{id}`, `POST /common-grants/orgs/search` | `grantees:read` | Consented organizations only |
| `GET /gms/analytics/portfolio`, `GET /gms/analytics/cycle/{competitionId}` | `analytics:read` | |
| `GET /gms/exports/990pf`, `POST /gms/exports/bundle`, `POST /gms/imports/csv` | `analytics:read` / `workspace:admin` | CSV cells are guarded against formula injection. `exports/bundle` in an applicant workspace exports that organization's own applications, reports, answers and organization reference |
| `POST /gms/imports/bundle` | none | Answers 410 `import_not_available`. Restoring a bundle is the operator's `gms import` (`apps/api/scripts/gms.ts`): rows are written as exported, so it is never available from a workspace. The operator's import sets every row's workspace to the target, skips rows that reference another workspace's records, and does not adopt ids that exist elsewhere |
| `GET/POST/DELETE /gms/webhooks`, `GET /gms/webhooks/{id}/deliveries` | `workspace:admin` | The secret is shown once |
| `POST /gms/webhooks/{id}/deliveries/{deliveryId}/replay` | `workspace:admin`, person | A new delivery with the same event and body |
| `GET/POST/DELETE /gms/api-clients` | `workspace:admin` (create/revoke: person) | Works for applicant workspaces too; their tokens never carry `applications:submit`, `agreements:write` or `workspace:admin` |
| `GET /gms/mcp-connections`, `DELETE /gms/mcp-connections/{id}` | session | Both sides. An admin sees and revokes every agent connected to the workspace; any other member their own (`mine`). Revoking also revokes the OAuth grant. Only a person revokes |
| `GET/POST/DELETE /gms/custom-mcp-servers`, `GET/PATCH /gms/custom-mcp-servers/{id}[/tools]` | `workspace:admin` | Private and non-HTTPS URLs are refused |
| `GET/POST/DELETE /gms/connectors/{provider}`, `POST /gms/connectors/{provider}/sync` | `payments:read` / `payments:release` | `mercury`, `google_workspace`. See `docs/connectors.md` |
| `GET /gms/ledger` | `workspace:admin` (ledger roles) | |

### Applicant screens, notifications

| Route | Scope | Notes |
|---|---|---|
| `GET /gms/my/applications/{id}/sections`, `GET /gms/applications/{id}/sections` | `applications:read` | `[{ formId, stage, sections }]`. The funder's application detail also carries `formResponses[].sectionAssignments`. Reviewers get neither |
| `POST /gms/my/applications/{id}/forms/{formId}/insert-answer` | `applications:write` + `library:read` | `{ answerId, path }` (JSON pointer). The field's provenance becomes `library`; the answer id is kept on the answer's `usedIn` (`{ applicationId, formId, path, version, insertedAt }`), because provenance values carry no ids. A later hand edit makes the field `user` again. The CommonGrants `PUT …/forms/{formId}` is unchanged |
| `GET /gms/my/applications/{id}/status`, `GET /gms/applications/{id}` | `applications:read` | A `submit` event that follows a revision request carries `revision: { requestedAt, message, changes[{ formId, path, before, after, wordsBefore, wordsAfter, wordDelta }] }`. The snapshot it is computed from is stored on the `request_revision` event and never returned |
| `GET /gms/notifications[?unread=true]`, `POST /gms/notifications/read` | session | Derived on read from the workspace ledger and, for applicants, the events on their applications. A member's own actions are left out. `{ ids }` or `{ all: true }` |
| `GET/PUT /gms/me/notification-preferences` | session | `{ digest, channels: { <category>: { inApp, email } } }`. `inApp` filters the list; `email` and `digest` are stored but no mail job reads them yet |

Not built: `GET /gms/me/documents`. Passport (branch `claude/gms-integration`) has an `org_documents` table but no route that lists an organization's locker to a consented client, so the GMS has nothing to read. Attachments still accept a `passportDocumentId` the web app obtained elsewhere.

### Inbound webhooks

| Route | Notes |
|---|---|
| `POST /webhooks/passport` | `X-Passport-Signature: v1=…` over `<timestamp>.<body>`, 300 s tolerance, deduped on the event id in `inbound_events` |
| `POST /webhooks/resend` | Svix signature. Delivery events update the communication log; inbound mail to `RESEND_INBOUND_DOMAIN` is threaded onto the application or award it replies to |

### Placeholder (501)

| Routes | Scope | Phase |
|---|---|---|
| `GET /gms/assist/status` | `assist` | Implemented. `{ enabled, quota }`; the web app hides the assistant when `enabled` is false |
| `POST /gms/assist/summarize`, `/compare-rubric`, `/draft-letter`, `/adapt-answer` | `assist` | Implemented. Drafts only. 404 `assistant_disabled` unless `ASSISTANT_ENABLED=true` and a model key is set; 429 `assist_quota_exhausted`; 422 `assistant_declined`. Every call is logged in `assist_calls` |
| `POST /gms/my/answers/{id}/adapt` | `library:read`, `assist` | Implemented. Same as `/assist/adapt-answer` with the answer in the path |

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

## Read models for the workspace screens

All implemented. Each starts with the shared authorization check; none returns bank or identity data.

| Route | Purpose | Scope |
|---|---|---|
| `GET /gms/applications?view=review_complete\|flagged`, `sortBy=score` | List items now carry `score` (mean overall, 0–100, current stage), `reviews { assigned, submitted, complete }`, `daysInStage`, `flagged` | `applications:read` |
| `GET /gms/applications/{id}/budget`, `…/documents` | Proposed budget rows; attachments with SHA-256 and source (`passport_locker` or storage) | `applications:read` |
| `GET /gms/applications/{id}/follow-ups`, `GET /gms/my/applications/{id}/follow-ups` | Revision requests, interview state, committed decision (rationale on the funder side only) | `applications:read` |
| `POST /gms/applications/{id}/interview`, `POST /gms/my/applications/{id}/interview/confirm` | Funder offers times; applicant confirms one of them | `applications:write` |
| `GET /gms/programs/{id}/rollup` | Committed by award status, paid (from Passport), remaining, owner | `programs:read` |
| `GET /gms/competitions/{id}/reviewers` | Reviewer pool with capacity, tags and load | `reviews:read` |
| `GET /gms/competitions/{id}/panel-summary?stage=` | Per-criterion means per application; decision counts and proposed total | `reviews:read` |
| `GET/POST /gms/competitions/{id}/notes` | Panel discussion notes (funder-internal thread) | `reviews:read` / `reviews:write` |
| `GET /gms/approvals/{id}/preview` | Affected applications and, for a decline, each rendered letter | person, same rule as the approval |
| `GET /gms/awards/{id}/activity`, `…/signatures`, `…/closeout`, `…/closeout.pdf` | Ledger activity, signature records, closeout checklist and its PDF | `awards:read` |
| `GET /gms/awards/{id}/documents`, `GET/POST /gms/awards/{id}/messages` (also under `/gms/my/awards/{id}/…`) | A grant's documents and its shared thread, for either party | `awards:read`, `messages:*` |
| `GET /gms/payments/upcoming?days=30`, `GET /gms/payments/ledger` | Tranches falling due; ledger events about tranches | `payments:read` |
| `GET /gms/grantees/{granteeId}/reports` | A grantee's requirements and latest submissions | `grantees:read` |
| `GET /gms/grantees` | Items now carry `totalAwardedMinor` | `grantees:read` |
| `GET /gms/analytics/breakdowns` | Awards by region, reviewer load, tax status and budget band from records shared through Passport ("Not shared" otherwise) | `analytics:read` |
| `GET /gms/templates/usage`, `POST /gms/communications/bulk` | Last-used per template; send to an applications view (people only; `dryRun` previews) | `communications:write` |
| `GET /gms/activity?limit=` | Recent workspace activity in words (staff) | `applications:read` |
| `GET /gms/me/access` | Funders by consent, connected agents, team | `org:read` |
| `GET /gms/my/funders/detail` | Open items, documents and public contact per funder | `applications:read` |
| `GET/POST /gms/discover/alerts`, `DELETE /gms/discover/alerts/{alertId}` | Saved funding alerts (up to 25) | `discovery` |

Public page data: `GET /gms/public/funders/{handle}` adds `open`, `forecasted`, `closed` and `pastAwards` (since v1.9.0
null unless the funder lists awards, `settings.awardSharing.listAwards`, and shows amounts; only awards that pass
`isPubliclyListable`, with a `page` link each; `settings.transparency` alone no longer lists them, see
[award-sharing.md](award-sharing.md)); the opportunity page adds `faq` and `documents`, written through
`PATCH /gms/opportunities/{id}` as `publish.faq` and `publish.documents` (https links only).

Gates: a tool a workspace adds to `settings.gatedTools` (or an API client's `gated_tools`) is refused for agent and
API-client tokens on the matching REST route with `403 approval_required` (`apps/api/src/auth/rest-gates.ts`).

Not available: account sessions (Supabase Auth exposes no per-user session list to the service role), a member's last
active time (not recorded), and connected apps and representatives (Passport serves both to member sessions only).

The applicant's Passport consent asks for `payee:read` as well as the three org scopes, so the payout-destination
panel can read bank name and last four digits. Set `PASSPORT_APPLICANT_PAYEE_READ=false` to leave it out. The GMS
client registered at Passport must list `payee:read` in its allowed scopes.


## Launch preparation

Switches, the signer rule and the data behind the screens that were partial. Tests: `apps/api/test/launch.test.ts`,
`apps/api/test/composio.test.ts`; database: `supabase/migrations/0015_launch_prep.sql`, `supabase/tests/database/03_own_sessions.test.sql`.

### Switches

| Route | Status | Notes |
|---|---|---|
| `GET /gms/config` | Implemented | No token. `{ passport: { signIn, linking, payments }, facilitatedPayments, assistantEnabled, available }`. Each `passport` flag is true only when the server has the Passport base URL, the GMS client id and secret and the credentials key (sign-in also the account port, payments also `PAYMENTS_FACILITATED="true"`). The same object is `features` on `GET /gms/me` |
| `POST /gms/tranches/{id}/release` | Implemented | With `PAYMENTS_FACILITATED` unset or not `true` (the default): `409 facilitated_payments_disabled`, checked before anything else. The MCP `release_tranche` tool answers `conflict` with the same message, and the reconcile job does nothing |
| `GET /gms/tranches/{id}/readiness`, `GET /gms/payments/readiness` | Implemented | Each tranche carries `mode` (`facilitated` or `resolve`) and `modeNote`; in `resolve` mode `releasable` is false. The center also returns `facilitatedPayments` |
| `POST /gms/tranches/{id}/record-external` | Implemented | Unchanged and available in both modes. It still needs the award's Passport mirror (`409 not_mirrored` without one) |
| `GET /gms/assist/status` | Implemented | `{ enabled, model, monthlyQuota, used, quota }`; `model` is `ASSISTANT_MODEL` or the built-in default, and the three are null when off |
| `POST /gms/assist/*` | Implemented | Off: `404 assistant_disabled` on every drafting route, before the body is read |

### Who may sign for the grantee

| Route | Status | Notes |
|---|---|---|
| `GET /gms/me/representatives` | Implemented | `org:read`, applicant. `{ state, items[{ id, name, title, role, isControlOfficer, verified, verificationLevel, verifiedAt }], manageUrl }`, read live from Passport `GET /passport/orgs/{orgId}/verified-representatives` with the workspace's consent. `state`: `ok`, `not_linked`, `not_shared`, `unknown`. Never stored, no contact details |
| `GET /gms/me/organization` | Implemented | Adds `representatives: { state, items }` |
| `POST /gms/my/awards/{id}/accept`, `POST /gms/awards/{id}/accept-offer` | Implemented | Optional body `{ name }`. When Passport lists verified representatives the name is required (`422 signer_name_required`) and must match one (`403 not_a_representative`). The answer adds `signerAuthority { rule, reason, representativeId, verificationLevel }`; ledger `award.acceptance_signer_checked` |
| `POST /gms/agreements/{id}/sign` | Implemented | The typed `name` is checked the same way. `signerAuthority` is returned, kept on the signature record (`authority`) and ledgered as `agreement.signer_checked` |

Names are compared without case, accents, punctuation or extra spaces. The rule is `passport_representative` when the name
matched, and `admin_role` (the earlier rule: an admin of the recipient workspace) when Passport could not say, with the reason:
`passport_not_linked`, `representatives_not_shared`, `passport_unavailable` or `no_verified_representatives`.

| Route | Status | Notes |
|---|---|---|
| `GET /gms/awards/{id}/signatures` | Implemented | `ip` is returned to funder `admin` and `finance` only; other roles and API clients get `ip: null`, `ipVisible: false`. Adds `signerRule`, `signerRuleReason` |
| `GET /gms/my/awards/{id}/signatures` | Implemented | The grantee's view. Its admins see the address of the grantee's own signer; the funder's signer's address is never returned here |

### Budgets, programs, people

| Route | Status | Notes |
|---|---|---|
| `GET` / `PUT /gms/programs/{id}/budget-categories` | Implemented | `{ categories: string[] }` (up to 50 unique names). Stored as `defaults.budgetCategories`, which `PATCH /gms/programs/{id}` also accepts and validates (`422 invalid_budget_categories`). Programs return `budgetCategories` |
| `GET /gms/awards/{id}/budget-mapping`, `GET /gms/my/awards/{id}/budget-mapping` | Implemented | `{ awardId, categories, mapping[{ category, ownCategory }] }`. `categories` is the program's list, else the approved budget's categories |
| `PUT /gms/my/awards/{id}/budget-mapping` | Implemented | Grantee only. `{ mapping[{ category, ownCategory }] }`; several of the grantee's categories may map to one of the funder's. `422 unknown_budget_category` |
| `GET /gms/awards/{id}/variance`, `GET /gms/my/awards/{id}/variance` | Implemented | Actuals are folded into the funder's categories through the mapping. Adds `mapping` and `unmappedCategories` |
| `GET /gms/programs`, `GET` / `PATCH /gms/programs/{id}` | Implemented | Programs return `ownerUserId`, `ownerName`, `owner { userId, name }`. `ownerUserId` is writable and must be a member of the workspace (`422 owner_not_a_member`); null clears it |
| `GET /gms/programs/{id}/rollup` | Implemented | Adds `owner` and `outcomes { reportsAccepted, totals[{ key, label, unit, total, reports }] }`: numeric report fields marked `outcome: true` (form `fieldMeta`, or the control's options, with an optional `unit`), added up over accepted reports |
| `GET /gms/me/sessions` | Implemented | Session, no workspace. `[{ id, createdAt, lastActiveAt, userAgent, device, ip, aal, mfa, current }]`, the caller's own sessions only |
| `DELETE /gms/me/sessions/{id}` | Implemented | Ends another of the caller's sessions. `409 current_session` for the one in use; anyone else's session is `404`. Ledgered |
| `GET /gms/workspaces/{id}/members` | Implemented | Members return `lastActiveAt` (written at most once every 15 minutes per member, on authenticated requests by a person) and `organization` |
| `POST /gms/workspaces/{id}/invitations` | Implemented | Optional `organizationName` for the `consultant` role (`422 organization_for_consultants` otherwise); kept as `scope.organization` on the invitation and the membership |
| `GET /gms/contacts` | Implemented | Funder. The workspace's named contacts, `[{ name, title, email, phone, public }]`, kept in `settings.contacts` |
| `PUT /gms/contacts` | Implemented | Funder admin. `{ contacts[] }` (at most 20) replaces the list. Ledgered |
| `GET /gms/my/funders/detail` | Implemented | Each funder adds `contacts[]` (all of them) and `contactEmail` |
| `GET /gms/public/funders/{handle}` | Implemented | `funder` adds `contactEmail` (`settings.contactEmail`, else the published organization address) and `contacts[]` (public ones only) |
| `POST /gms/applications/{id}/interview` | Implemented | `{ slots[], note?, location? }`. The state returned, and `interview` in both follow-ups routes, lists `proposed.slotOptions[{ id, at }]` beside `proposed.slots[]` |
| `POST /gms/my/applications/{id}/interview/confirm` | Implemented | `{ slotId }` (`slot_1`…) or `{ slot }` (the time); `confirmed` returns `{ slot, slotId, at }` |

### Google Workspace

| Route | Status | Notes |
|---|---|---|
| `POST /gms/connectors/google_workspace/export` | Implemented | Funder `admin` or `program_officer`, people only. `{ documentKind: "letter" \| "agreement" \| "snapshot", subjectId, folderId }` → `201 { documentKind, subjectId, fileId, fileName, url }`. The PDF comes from the same service as the download. Ledger `connector.drive_export`. `409 drive_folder_unavailable`, `422 connector_scope_rejected`, `422 connector_scope_unverified` |
| `GET /gms/connectors/google_workspace/directory?q=` | Implemented | Funder admin. Up to 20 `{ email, name }`. `409 connector_not_connected`; scope refusals as above. `GET /gms/directory/suggest` stays as the quiet variant that returns `[]` on any failure |
| `POST /gms/connectors/google_workspace` | Implemented | The Composio link now returns to `/w/{handle}/settings/connectors?connected=google_workspace`. A connection whose scopes Composio does not report is refused: `422 connector_scope_unverified` |

## Without Passport

A workspace that has not linked Passport keeps a self-declared profile (see `docs/decisions.md`,
2026-11-12). What changes for callers:

- **Names beside the badge**: for a Passport workspace `name` is the Passport legal name and the
  workspace's own display name comes second as `workspaceName` (null when the same).
- **`verification: { source: "passport" | "self_declared" | "none", level }`** on every applicant a
  funder sees (inbox list and detail `applicant`, grantee list and detail, award `recipient`,
  exports, the 990-PF list as `recipientVerification`, MCP `get_passport_status`) and on the funder
  public page. `level` is Passport's, and only while the organization shares its record.
- **Inbox and grantee detail** give a self-declared profile as `selfDeclared`, apart from the Passport
  record (`organization` / `organization.projection`), which is null without Passport. A
  self-declared profile is never served as a CommonGrants organization.
- **Opportunity options** in `publish`: `requirePassport` (start answers `403 passport_required`
  without a live Passport link) and `acceptSelfReported` (otherwise a rule met on self-reported
  facts is `unknown`, needs review). Both default to false; `applicantOptions` gives them resolved.
- **Eligibility** results carry `selfReported: true` on rules that read the organization's own
  word; rules on Passport-only facts (all of `org.customFields`, `org.status`,
  `profile.*`) are `unknown` for an applicant without Passport. A failing rule stays failing.
- **Prefill** from a self-declared profile marks provenance `self_declared` ("you entered"), and
  `passportField` fields stay editable for an applicant without Passport.
- **Readiness** (`GET /gms/me/readiness`) for a workspace without Passport: `profile_complete`
  (legal name and contact email) and, where this server can link, an `optional` check
  `passport_optional` that is never counted in `summary`.
- **Letters** go to the Passport record's email, else the workspace's admins at the address they
  sign in with (at most five). A self-declared `contactEmail` is shown, never emailed.
- **Linking later** through the consent flow sets `profileSource: "passport"`, clears the profile
  and ledgers `workspace.profile_replaced_by_passport` with the names of the fields that differed.
- In the OpenAPI document the new response fields are optional so existing clients keep
  compiling; this server always sends them.

## Share, embed, invite and import (v1.7.0)

Tests: `apps/web/test/front-worker.test.ts`, `apps/api/test/share-pages.test.ts`, `embed.test.ts`,
`redteam-embed.test.ts`, `invites-summaries.test.ts`, `redteam-cowriter.test.ts`, `imports.test.ts`,
`imports-mcp.test.ts`, `redteam-import-sensitive.test.ts`; database: migrations `0031_imports.sql`,
`0032_invites_summaries.sql`.

### Public pages, share cards and the apply widget

| Route | Status | Notes |
|---|---|---|
| `GET /robots.txt`, `GET /og/home.png`, `GET /og/f/{handle}.png`, `GET /og/f/{handle}/o/{slug}.png` | Served by the front Worker | robots.txt disallows the app's screens and allows `/gms/public/`. Share images are 1200x627 PNGs drawn on request and kept at the edge for 5 minutes; an unknown page is 404, an API failure redirects to the default card. The web Worker with static assets does not serve them |
| `GET /f/{handle}`, `/f/{handle}/o/{slug}` | Served by the front Worker | Each page's own title, description, canonical address, Open Graph and Twitter tags and schema.org JSON-LD, from the public data below; the default meta when it is not found, fails or takes over 2 s |
| `GET /embed/f/{handle}/o/{slug}` | Served by `apps/web` | The apply widget. The one path other sites may frame: `frame-ancestors *`, no `X-Frame-Options`; every other path keeps `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| `GET /gms/public/embed/funders/{handle}/opportunities/{slug}` | Implemented | No token. The widget's data: `funder { handle, name, brand, verified }`, `opportunity { slug, title, status, closeDate, opensDate, acceptedApplicantTypes, eligibility (up to 3 labels), moreEligibility }`, `acceptingApplications`, `poweredBy`, `links.page`. Built on the opportunity page's data: 404 wherever the page is, nothing the page hides. Edge-cacheable |
| `GET /gms/public/funders/{handle}`, `…/opportunities/{slug}` | Implemented | Each opportunity card adds `acceptingApplications` (published as open with an open competition); `funder` adds `poweredBy` (false only when an admin turned it off) |
| `GET /sitemap.xml` | Implemented | Keeps forecasted and closed calls still published; an opportunity's `lastmod` is the latest of it and its public competitions, a funder page's the latest of the funder and its listed opportunities |
| `PATCH /gms/workspaces/{id}` settings | Implemented | Funders may set `poweredBy` (boolean; `null` removes it, which means on). `workspace.updated` records an on/off switch's new value and only `"changed"` for other settings |

### Inviting someone into a draft, and the AI summary

| Route | Status | Notes |
|---|---|---|
| `POST /gms/draft-invitations` | Implemented | Applicant `admin`, a signed-in person only (agents and API clients `403 human_only`; no MCP tool). `{ email, draft: { kind: "outside_application" \| "application", id, questionId? \| formId + section? } }` → `201` with the address masked. One email; `409 already_invited` while one waits, `409 already_member`, `409 application_locked` for a built-in application no longer a draft, `429` past 20 invitations a workspace a day (with Team & access invitations) |
| `GET /gms/draft-invitations?kind=&id=` | Implemented | `applications:read`, not consultants. `{ invitations[], canInvite, perDay, remainingToday }`, addresses masked |
| `POST /gms/invitations/accept` | Implemented | Adds `draft { kind, id, questionId, formId, section, assigned }` for an invitation into a draft, which needs the signed-in address to be the invited one (`403 email_mismatch`). The person joins as `consultant` scoped to that draft |
| `GET /gms/me/notes`, `POST /gms/me/notes/dismiss` | Implemented | Session. The one-time notes the person dismissed in this workspace (`{ note: "invite_teammate" }`) |
| `GET /gms/assist/summary?applicationId=`, `POST /gms/assist/summary` | Implemented | Funder `assist`. The AI summary kept per application and response version (the version the caller may see); GET never calls the model, POST writes it on the first request and spends the quota once. `404 assistant_disabled` when off; `429 assist_quota_exhausted` only when none is kept |
| A cowriter (consultant whose scope names outside drafts only) | Implemented | Opens that draft, its questions and its comments (`GET /gms/outside-applications/{id}`, `…/questions`, `…/comments`, the question's answer, status, answers and comments). Every other workspace route answers 403 `cowriter_draft_only` or 404 |

### Import from a spreadsheet

| Route | Status | Notes |
|---|---|---|
| `GET /gms/imports/sources?target=` | Implemented | `target` is `outside_applications` (applicant, `applications:write`) or `award_history` (funder `admin`, `workspace:admin`, a person). Fields, limits (5,000 rows, 4 MB workbooks) and the sources this server offers: CSV and XLSX always, Google Sheets and Airtable only when their Composio auth configs are set |
| `POST /gms/imports/read` | Implemented | `{ target, source: { kind: "csv", text } \| { kind: "xlsx", base64, sheet? } \| { kind: "google_sheets", url, sheet? } \| { kind: "airtable", url, table? } }` → columns with three sample values, the columns left out (`dropped[{ column, reason, why }]`) and a suggested or saved mapping. Stores nothing. A column whose header or any value looks like bank or identity data is never read |
| `POST /gms/imports/preview` | Implemented | `{ target, source, mapping, saveMapping? }` → `201`: the dry run, stored with its log for 24 hours (at most 10 waiting), with the reconciliation (create, skip, fix, amounts by year). Rows imported before are skipped. `422 mapping_incomplete` |
| `GET /gms/imports/runs?target=`, `GET /gms/imports/runs/{id}` | Implemented | The last 20 runs; one run and its log with links to what each row created |
| `POST /gms/imports/runs/{id}/commit` | Implemented | A signed-in person only (agents and API clients `403 human_only`). Imports the next batch; call again until `done`. Each row is written once, whoever calls. `410 import_expired` after a day. Grant history payments are recorded as paid elsewhere (resolve mode, no digits), never through Passport |
| `GET/POST/DELETE /gms/connectors/{provider}` | Implemented | Adds `google_sheets` and `airtable` (read-only Composio connections), workspace admin of either kind. `GET /gms/config` adds `available.googleSheets` and `available.airtable` |
| `POST /gms/outside-applications/import`, `POST /gms/imports/csv` | Implemented | The older direct imports screen columns by header and by value as the wizard does; a field mapped to a dropped column counts as unmapped |
| MCP `get_import_preview` | Implemented | Funder (`workspace:admin`) and applicant (`applications:write`) sides. A run's reconciliation, progress and dropped column names. No tool commits an import |

## Reports, open data, single sign-on, switching and review (v1.8.0)

Tests: `apps/api/test/report-builder.test.ts`, `contract-reports.test.ts`, `reports-mcp.test.ts`,
`open-data.test.ts`, `sso.test.ts`, `redteam-sso.test.ts`, `migration-request.test.ts`,
`review-parity.test.ts`, `gallery.test.ts`, `redteam-cowriter.test.ts`; database: migrations
`0033_review_parity.sql` to `0036_template_gallery.sql`.

### Report builder (`docs/reports.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/reports/data-sets` | Implemented | The five data sets and their whitelisted columns. Funder roles with `analytics:read`, plus each data set's own read scope |
| `POST /gms/reports/preview`, `POST /gms/reports/export` | Implemented | The first 200 rows (or groups) of a definition; up to 50,000 rows as CSV, streamed, with `X-Report-Rows`, `X-Report-Total`, `X-Report-Truncated` and `Content-Disposition`, all readable by the web app (CORS expose list) |
| `GET/POST /gms/report-views`, `GET/PATCH/DELETE /gms/report-views/{id}`, `POST …/run`, `GET …/export`, `GET …/recipients` | Implemented | Starter views and saved views; saving, changing and removing a view is a signed-in person's (`403 person_required`) and only the owner's (`not_owner`); an admin may remove a shared one |
| `PUT/DELETE /gms/report-views/{id}/schedule` | Implemented | Weekly or monthly, the owner in person; recipients are members who may read the view (`422 recipient_not_allowed`). A recipient who switched off the `report` notification category's email still finds the file in the app |
| `GET /gms/report-files`, `GET /gms/report-files/{id}/download` | Implemented | Files sent to the caller, kept 30 days (`410 file_expired`) |
| MCP `list_report_views`, `run_report_view` | Implemented | Read only (`analytics:read`); no tool saves, shares or schedules |

### Open data (`docs/open-data.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/open-data/summary` | Implemented | Funder `admin`, `program_officer`, `finance`, `auditor` (`analytics:read`). What an export of the period would hold and what it leaves out, with reasons |
| `GET /gms/open-data/360giving.json`, `…/360giving.csv`, `…/commongrants.json` | Implemented | 360Giving 1.4.3 and CommonGrants v0.5.0 (the award projection is `projectAwardRow` in services/awards.ts, the same as `GET /common-grants/awards`). `X-Open-Data-Draft: true` without a registered prefix |
| `PUT /gms/open-data/settings`, `PUT /gms/open-data/awards/{id}/confidential` | Implemented | A signed-in person only (`403 human_only`); the prefix and the feed switch are the admin's |
| `GET /gms/open-data/{handle}/360giving.json` | Implemented | No token, any origin (in the central open CORS list, the feed path only). `404` until published |
| MCP `open_data_summary` | Implemented | Counts only |

### Single sign-on (`docs/sso.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/sso/settings` | Implemented | Funder admins; API clients with `workspace:admin` may read |
| `POST /gms/sso/domains`, `DELETE /gms/sso/domains/{id}`, `POST /gms/sso/domains/{id}/check` | Implemented | A signed-in admin only (`403 human_only` for agents and API clients); no MCP tool |
| `PUT /gms/sso/requirement` | Implemented | Turning it on needs an active domain and an admin signed in through that domain's own identity provider now (`409 sso_session_required`); turning it off is always allowed |
| `POST /gms/sso/join` | Implemented | After an SSO sign-in, joins each workspace whose active domain matches the address and whose provider the session came through |
| Any workspace route | Implemented | A session for an address on a required domain that did not come through that domain's provider gets `403 sso_required` on every workspace route (`redteam-sso.test.ts`, every GET of the document); connecting an agent needs the same. API clients and existing agent tokens are unaffected |

### Switching (`docs/switching.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/migration-requests/form`, `POST /gms/migration-requests/preview`, `POST /gms/migration-requests` | Implemented | No token needed; a person's session is accepted; any other token `403 person_only`. The preview is exactly what is sent; numbers that look like bank or identity numbers are removed from the note (`stripSensitiveNumbers`, packages/importers). No MCP tool |
| `/switch`, `/switch/{system}` | Served by the front Worker | Each page's title, description and Open Graph text from `seoFor()`; listed in the sitemap |

### Review parity changes from the integration

| Route | Status | Notes |
|---|---|---|
| `GET/PUT /gms/competitions/{id}/coi-policy` | Implemented | `required` says whether reviewers sign before anything opens: on for new competitions, off for competitions that existed before migration 0033 until the funder turns it on. `PUT { required }` is a signed-in person's (`403 human_only`) |
| `POST /gms/imports/csv`, `POST /gms/outside-applications/import` | Changed | A signed-in person only, like the import wizard's commit: agent and API-client tokens get `403 human_only` with the same message |

## Template gallery

Approved items are public; the rest is a funder workspace's or a moderator's. Details, the stripping
rules and the starter library: `docs/gallery.md`.

| Route | Status | Notes |
|---|---|---|
| `GET /gms/gallery?kind=&tag=&q=` | Implemented | No token. Approved items, most used first, and the tag vocabularies (`tags`). `kind` one of `application_form`, `report_form`, `rubric`, `email_template`, `program_kit` (`400` otherwise) |
| `GET /gms/gallery/{slug}` | Implemented | No token. One approved item with its `snapshot` (`forms`, `rubrics`, `emails`); `404` once withdrawn |
| `POST /gms/workspaces/{workspaceId}/gallery/items/{slug}/copy` | Implemented | Funder workspace; each part needs its own scope (`forms:write`, `reviews:write`, `communications:write` with an admin or program officer role), all checked first. `201 { item, created[] }`: new draft forms, a new rubric, new email templates. Ledger `gallery.copied` |
| `POST /gms/workspaces/{workspaceId}/gallery/preview` | Implemented | Funder admin, signed in. `{ source: { type: form \| rubric \| template, id, version? }, extraNames? }` → the cleaned snapshot, what was stripped, the names replaced. Saves nothing. `409 form_not_published`, `422 not_shareable` |
| `GET /gms/workspaces/{workspaceId}/gallery/submissions` | Implemented | The workspace's submissions with status, decision and reason (`forms:read`) |
| `POST /gms/workspaces/{workspaceId}/gallery/submissions` | Implemented | Funder admin, signed in (`403 human_only` for an agent, `person_required` for an API client). Adds `title`, `summary`, `tags`, `licence: "CC-BY-4.0"`. `409 already_submitted`. Ledger `gallery.submitted` |
| `POST /gms/workspaces/{workspaceId}/gallery/submissions/{id}/withdraw` | Implemented | Funder admin, signed in. Pending or approved; an approved item leaves the gallery. Ledger `gallery.item_withdrawn` |
| `GET /gms/gallery/moderation/me` | Implemented | Signed in. `{ moderator }` |
| `GET /gms/gallery/moderation/queue` | Implemented | Moderators (`GALLERY_MODERATORS`). Pending submissions, oldest first. `403 not_a_moderator` |
| `POST /gms/gallery/moderation/submissions/{id}/approve` | Implemented | Moderators. `{ slug? }` → the published item. Ledger `gallery.item_approved` in the author's workspace |
| `POST /gms/gallery/moderation/submissions/{id}/reject` | Implemented | Moderators. `{ reason }` (3 to 2,000 characters), shown to the author. Ledger `gallery.item_declined` |

## Award sharing (v1.9.0)

Details in [award-sharing.md](award-sharing.md); routes in `api/award-sharing.tsp`. Every public route answers only for
awards that pass `isPubliclyListable` (`apps/api/src/services/award-sharing.ts`), with the same 404 otherwise.

| Route | Status | Notes |
|---|---|---|
| `GET /gms/public/funders/{handle}/awards` | Implemented | No token. The awards the funder lists, newest first, with `years`, `programs` and `amountsShown`. 404 while the funder does not list awards. Cached like the funder page |
| `GET /gms/public/funders/{handle}/awards/{slug}` | Implemented | No token. One listed award, its funder and `verified` (linked to Passport). Found by the token at the end of the slug |
| `GET /gms/public/badges/{slug}.svg` | Implemented | No token. The "Funded by" badge, `Cache-Control: public, max-age=3600`; a plain-text `404 Not found` for anything not public. The front Worker serves it at `/badge/{slug}.svg` |
| `GET /gms/awards/{id}/sharing`, `GET /gms/my/awards/{id}/sharing` | Implemented | `awards:read`, funder side and grantee side. Listed or not and why (`reason`), the switches, `canChange`, and the share kit while public |
| `PUT /gms/awards/{id}/confidential` | Implemented | `{ confidential }`. Funder `admin` or `program_officer`, a signed-in person (agents and API clients `403 human_only`) |
| `PUT /gms/my/awards/{id}/listing` | Implemented | `{ unlisted }`: "Don't list us publicly". Grantee `admin`, a signed-in person |
| `GET/PUT /gms/award-sharing/settings` | Implemented | `{ listAwards?, showAmounts? }` in `settings.awardSharing` (not a `PATCH /workspaces` key). Read: funder staff (`awards:read`); write: funder `admin`, a signed-in person. Returns counts and program defaults |
| `PUT /gms/programs/{id}/award-sharing` | Implemented | `{ awardsConfidential }`: new awards in the program start confidential (a database trigger applies it). Funder `admin` or `program_officer`, a signed-in person |
| MCP `get_award_share_kit` | Implemented | Funder and grantee sides, `awards:read`. The share kit, or nothing for an award that is not public. No tool lists awards, marks one confidential or unlists one |

## Social posting through Zernio (v1.9.0)

Every route answers 404 `social_not_configured` unless `ZERNIO_API_KEY` and `ZERNIO_WEBHOOK_SECRET` are both set; `GET /gms/config` adds `available.social`. See docs/social.md.

| Route | Status | Notes |
|---|---|---|
| `GET /gms/social` | Implemented | Platforms with their limits, the workspace's connected accounts, `canConnect`, `canPost`. Staff (`analytics:read` funder, `awards:read` applicant) |
| `POST /gms/social/connect` | Implemented | `{ platform }`. A signed-in admin (agents and API clients `403 human_only`). Creates the workspace's Zernio profile on first use; returns Zernio's `authUrl`, which returns to `/w/{handle}/settings/social?gs=…` |
| `POST /gms/social/connect/callback` | Implemented | `{ state, profileId, accountId, connected?, username? }` → `201` the account. `403 connect_state_invalid` (forged, altered, expired, another person or workspace, another profile); `409 account_not_listed` when Zernio does not list the account under this workspace's profile |
| `DELETE /gms/social/accounts/{id}` | Implemented | A signed-in admin. Disconnects at Zernio, then here |
| `GET /gms/social/compose?subjectType=&subjectId=` | Implemented | The composer's starting texts, link (`utm_source=social`) and share card; `shareable: false` with a reason for an unpublished or closed call and for an award that is not publicly listed. A read: agents may use it |
| `POST /gms/social/posts/preview` | Implemented | A signed-in admin or editor. The exact `body` Zernio will receive, each platform's length, problems, and a `previewToken` (null while there is a problem). `409 not_shareable`, `422 account_not_connected` |
| `POST /gms/social/posts` | Implemented | A signed-in admin or editor (agents and API clients `403 human_only`), `Idempotency-Key` header (a UUID, `400 idempotency_key_required`). The body must be the one previewed (`409 preview_required`, `preview_changed`); the same key returns the post already made (`409 idempotency_key_reused` for other content); Zernio's 409 counts as sent. `503 zernio_unavailable`: not confirmed, post again with the same key |
| `GET /gms/social/posts?subjectType=&subjectId=` | Implemented | The reach report: the last 50 posts with status, per-account links and Zernio's counts (read at most every 30 minutes, ten Zernio calls per report), totals, and for a call `applicationsFromSocial` |
| `POST /webhooks/zernio` | Implemented | `X-Zernio-Signature` (HMAC-SHA256 of the raw body) checked first (`401`); stored once by event id (`duplicate`); older than a day `400 stale`; applied only to the workspace whose profile it names. Account and post events |
| MCP `list_social_posts` | Implemented | Funder (`analytics:read`, an opportunity or award or all) and applicant (`awards:read`, its awards). No tool posts, schedules or connects |

## Funds (v1.9.0)

Tests: `apps/api/test/funds.test.ts`, `redteam-funds.test.ts`; database: migration `0039_funds.sql`,
`supabase/tests/database/14_funds.test.sql`. Model and rules: `docs/funds.md`.

| Route | Status | Notes |
|---|---|---|
| `GET /gms/funds`, `GET /gms/funds/{id}` | Implemented | `programs:read`. `{ items, scoped }`; each fund with `budgets`, `totals` (its budget per fiscal year beside its programs'), `programIds`; one fund adds `advisors` |
| `POST /gms/funds`, `PATCH /gms/funds/{id}`, `PUT /gms/funds/{id}/budgets` | Implemented | Funder `admin`. Colours from the theme palette only; reserved addresses refused; budgets one per fiscal year, ledgered with both values |
| `POST /gms/funds/{id}/advisors` | Implemented | Funder `admin`, a signed-in person. An invitation with `program_officer` or `reviewer` and `scope.fundIds`. No MCP tool |
| `POST /gms/programs`, `PATCH /gms/programs/{id}` | Implemented | Add `fundId`. A program always has a fund (the default fund when none is named) |
| `GET /gms/public/funders/{handle}/funds/{slug}` | Implemented | No token. The fund page: `funder`, `fund { name, slug, description, brand, isDefault }`, its published opportunity cards |
| A fund advisor (a member whose scope names `fundIds`, not an admin) | Implemented | Every route and MCP tool reads and writes through their funds only (`fundScopeOf` in the one authorization path); other funds' records answer 404 |
| MCP `list_funds` | Implemented | Funder `programs:read` |

## Send to the funder, guest reviewers, digests and importer adapters (v1.9.0)

Tests: `apps/api/test/send-package.test.ts`, `contract-send-package.test.ts`, `guest-reviewer.test.ts`,
`content-digests.test.ts`, `contract-digests.test.ts`, `import-adapters.test.ts`,
`redteam-funds.test.ts`, `redteam-cowriter.test.ts`, `human-only.test.ts`; database: migrations
`0040_send_package.sql`, `0041_content_digests.sql`, `0042_importer_adapters.sql`.

### Send to the funder (`docs/send-package.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/outside-applications/{id}/package` | Implemented | Applicant `applications:read`. What the package holds: cover, questions in order, budget summary, the files (this application's own and the vault documents used for its checklist), any answer that blocks it (named, never echoed), and whether email is available |
| `GET /gms/outside-applications/{id}/package.pdf`, `GET …/package.zip` | Implemented | The PDF, or a ZIP with the PDF, the files and `answers.txt`. Up to 60 MB; `422 sensitive_answer` while an answer looks like a bank, card or identity number |
| `POST /gms/outside-applications/{id}/package/email/preview`, `POST …/package/email` | Implemented | A signed-in admin or editor only (agents and API clients `403 human_only`). The preview is exactly what is sent (`409 preview_changed`); up to 20 MB of attachments (`422 package_too_large_to_email`: download it instead) and five emails a day per application; `503 mail_attachments_unavailable` on a mailer that cannot carry files |
| `PUT /gms/send-package/settings` | Implemented | `{ poweredBy }`, the footer line, an applicant admin in person (also a `PATCH /gms/workspaces/{id}` settings key since v1.9.0) |
| MCP `get_send_package` | Implemented | Read only (`applications:read`); no tool emails a package |

### Guest reviewers

| Route | Status | Notes |
|---|---|---|
| `GET /gms/guest-review/welcome` | Implemented | An external reviewer, signed in: funder, competitions, counts, due date, the conflict-of-interest note and its link (`/review/assignments?ws=…&sign=1` opens the policy signing) |
| `GET /gms/guest-review/done` | Implemented | Done when at least one review is submitted and none is open (recusals aside); the reviewer portal goes there after the last review |
| `POST /gms/guest-review/offer` | Implemented | `{ event: shown \| clicked \| dismissed }`: the once-only offer to run a panel, counted in the GMS's own ledger |

### Opt-in digests (`docs/digests.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/digests`, `PUT /gms/digests` | Implemented | The person's own choices in this workspace; turning a digest on or off is the person's (agents and API clients `403 person_required`) |
| `GET /gms/digests/preview?digest=` | Implemented | Next Monday's email as it would be written now; a fund advisor's counts are their funds' only. MCP `get_digest_preview` (read only) |
| `POST /gms/digests/unsubscribe`, `GET /gms/digests/unsubscribe` | Implemented | No token: the signed link is the proof (RFC 8058 one-click on POST; GET only redirects). `400 invalid_link`, `410 link_expired` |

### Importer adapters (`docs/importers.md`)

| Route | Status | Notes |
|---|---|---|
| `POST /gms/imports/read`, `POST /gms/imports/preview` | Changed | Sources also `json` (OpenWater), `fluxx` and `zengine`; an export from Good Grants, SurveyMonkey Apply, Submittable, Foundant GLM, SmartSimple or OpenWater is recognised loosely and the person confirms each field |
| `GET/POST/DELETE /gms/imports/connections/{fluxx\|zengine}` | Implemented | Funder admin, a signed-in person to connect (agents and API clients `403 human_only`). Credentials checked with one read, stored encrypted, never returned; requests never follow a redirect |
| `GET /gms/imports/zengine/forms` | Implemented | The forms the stored Zengine token can open |
| `POST /gms/imports/runs/{id}/files/match`, `GET/POST /gms/imports/runs/{id}/files` | Implemented | After an import has finished: match a system's zip by paths, then attach each file (a person, 25 MB each). Stored as the funder's own documents, listed on the funder's award page, never the grantee's |

## Connected apps, syndication, imported history, funder loops, the award kit and bilingual forms (v1.12.0)

Every write below is a signed-in person's (agents and API clients get `403 human_only` or
`person_required`, checked before the body is read) unless it says otherwise; `GET /gms/config`
says which connected apps this server offers (`available.slack`, `googleCalendar`, `googleDrive`,
`salesforce`).

### Connected apps (`docs/connectors.md`)

| Route | Status | Notes |
|---|---|---|
| `POST/DELETE /gms/connectors/{slack\|google_drive\|salesforce}` | Implemented | Workspace admin. Composio connection on the workspace's entity; scopes checked before every use, a broader connection deleted at Composio |
| `GET/PUT/DELETE /gms/connected-apps/slack`, `GET /gms/connected-apps/slack/channels` | Implemented | Read: `workspace:admin` (an agent reads, as the screen does). Alerts: a public channel and the events; one short message per event, never answers or amounts. 503 `connector_not_configured` until `COMPOSIO_SLACK_AUTH_CONFIG_ID` is set |
| `GET/POST/PUT/DELETE /gms/connected-apps/calendar`, `GET …/calendars`, `POST …/sync` | Implemented | The person's own calendar (`calendar_links`): connect, choose, sync now, disconnect. Deadlines as all-day events, kept in step hourly by the jobs Worker |
| `POST /gms/connected-apps/google-drive/fetch`, `POST …/save` | Implemented | Applicants. Copy a file picked in the Google Picker (`drive.file`, 25 MB, the upload's own checks), or save the as-submitted copy to Drive |
| `POST /gms/imports/read`, `POST /gms/imports/preview` | Changed | Source `salesforce`: a preset (per target) or a SOQL SELECT of the person's own, checked first (`invalid_query`) |
| MCP `get_slack_alerts` | Implemented | Funder and applicant, read only. No tool connects an app, changes alerts, writes a calendar or copies a file |

### Syndication (`docs/syndication.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/public/feeds/opportunities.json`, `.csv`, `.rss` | Implemented | No token. Open and upcoming calls with their public page on and in the feeds, only what each page shows; `region`, `category`, `funder`, `closingWithin`; cached 300 s with an ETag |
| `GET /gms/public/feeds/opengrants.json` | Implemented | No token. CommonGrants `OpportunityBase` records of the calls in the OpenGrants index, for OpenGrants to pull (`page`, `pageSize` ≤ 100, `modifiedSince`) |
| `GET /gms/opportunities/{id}/syndication` | Implemented | `opportunities:read`. The Share this call panel: feeds, the OpenGrants index status, PND's send-by date and state, counts of starts from feeds and PND |
| `PUT /gms/opportunities/{id}/syndication/feeds` | Implemented | `opportunities:write`. `{ feeds }`: leave a call out of every feed |
| `POST /gms/opportunities/{id}/syndication/pnd/preview`, `POST …/pnd` | Implemented | Admin or program officer, a person. The email to Philanthropy News Digest, sent as previewed, once per call, until four weeks before the earliest deadline |
| MCP `get_opportunity_syndication` | Implemented | Read only |

### Imported history (`docs/importers.md`, `docs/reports.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/history` | Implemented | `applications:read`, the funder's staff (`HISTORY_ROLES`). `?organization=` or `?award=`: past applications, reviews (with `reviews:read`) and reports (with `requirements:read`); fund advisors see their funds' rows |
| `GET /gms/history/applications/{id}` | Implemented | One past application with its answers and reviews |
| `GET /gms/history/applications/{id}/files/{docId}`, `GET /gms/history/reports/{id}/files/{docId}` | Implemented | A file attached from the export's zip; outside every fund |
| `POST /gms/imports/read`, `/preview`, `GET /gms/imports/sources` | Changed | Targets `history_applications`, `history_reviews`, `history_reports`; the `cybergrants` adapter; Fluxx reads `request_report` for past reports |
| `POST /gms/reports/preview`, report views | Changed | Data set `history` ("Imported history") |

### Funder loops

| Route | Status | Notes |
|---|---|---|
| `GET /gms/public/for-funders` | Implemented | No token. `?ref=` (a package link) or `?invite=`: the region and, from ten up, how many organizations there keep their applications here (a number only) |
| `GET /gms/public/partners`, `GET /gms/public/join/{token}`, `GET …/logo` | Implemented | No token. The partner directory (approved listings) and an intermediary's co-branded onboarding page and logo |
| `POST /gms/referrals/claim` | Implemented | A person, for a workspace they made within the hour: counts the join for the link or invitation it came from, once |
| `GET /gms/peer-invitations`, `POST …/preview`, `POST /gms/peer-invitations` | Implemented | Funder admin. Five a week, one per address; the note holds no link; sent as previewed |
| `GET /gms/partner-settings`, `POST/DELETE …/onboarding-link`, `POST …/onboarding-link/replace`, `PUT/PATCH/DELETE …/onboarding-link/logo`, `PUT …/listing`, `POST …/listing/withdraw` | Implemented | Funder admin of an intermediary (two or more named funds) |
| `GET /gms/partners/moderation/me`, `GET …/queue`, `POST …/listings/{id}/approve`, `POST …/listings/{id}/reject` | Implemented | A person's session only; operators in `DIRECTORY_MODERATORS` (else `GALLERY_MODERATORS`) |
| `GET /gms/reusable-profile` | Implemented | `org:read`, applicants. The organization fields every funder here sees, verified or self-declared |

### Award kit (`docs/award-sharing.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/awards/{id}/sharing`, `GET /gms/my/awards/{id}/sharing` | Changed | The kit adds the portrait card's words and public address (`portrait.imageUrl`), the carousel, a press release, the federal statement, the pages to tag; the three posts in the reader's language |
| `PUT /gms/awards/{id}/federal-funding` | Implemented | Funder. `{ funded, amount?, percent?, source? }`; the statement only with both numbers |
| `GET /gms/awards/{id}/sharing/carousel.pdf`, `GET /gms/my/awards/{id}/sharing/carousel.pdf` | Implemented | `awards:read`. 6 to 10 pages of 1080 × 1350; 409 `not_public` otherwise |
| `GET/PUT /gms/share-kit/profile` | Implemented | The workspace's social page and consent to be tagged; for funders the credit wording and standard description. Write: admin, a person |
| `POST /gms/social/reminders/{id}/dismiss` | Implemented | Funder admin, a person: dismiss "Two weeks left" for a call |
| `GET /gms/social/compose?subjectType=program&subjectId=…`, `POST /gms/social/posts` | Changed | A program as the subject: "Meet our grantees", publicly listed awards only |
| Front Worker `GET /og/f/{handle}/awards/{slug}/portrait.png` | Implemented | No token. The portrait card under the award page's rules (404 otherwise); `?amount=1` draws the amount while the funder shows amounts; `?lang=` |
| MCP `get_award_share_kit` | Changed | Describes the portrait card, carousel, press release and federal statement it returns |

### Bilingual forms (`docs/forms.md`, "Languages")

| Route | Status | Notes |
|---|---|---|
| `PATCH /gms/forms/{id}`, `PATCH /gms/opportunities/{id}` | Changed | `translations`: the funder's Spanish beside its own text (an opportunity's in `customFields.translations`); an assistant draft is never stored on an opportunity. Changing the other language of a published call is a person's |
| `POST /gms/forms/{id}/publish`, `POST /gms/opportunities/{id}/publish` | Changed | A form version or call that carries another language is published by a person only (`403 human_only` for agents and API clients); a form holding an unreviewed draft is refused |
| `POST /gms/translations/forms/{id}/draft`, `POST /gms/translations/opportunities/{id}/draft` | Implemented | `assist` with `forms:write` / `opportunities:write`, funders. The assistant's drafts of missing or stale texts; saves nothing; one call against the monthly quota (agents may draft) |
| `GET /gms/public/funders/{handle}/opportunities/{slug}` | Changed | Title, summary and eligibility in the reader's language (`?lang=`, cookie, `Accept-Language`); `opportunity.language` and `opportunity.translations`; `Vary: Accept-Language, Cookie` |


## Live co-editing, the QuickBooks sync, the operators' measures and single sign-on (v1.13.0)

### Live co-editing (`docs/co-editing.md`)

| Route | Status | Notes |
|---|---|---|
| `POST /gms/presence/passes` | Implemented | A signed-in person's session only (agents and API clients 403 `person_required`). The pass to a draft's private Realtime channel, issued by `access()`/`loadOutside()`; 404 to anyone who cannot open the draft, 409 `not_a_draft` once submitted. The editor leaves the channel when any call for the draft answers 403 or 404 |

### Share-kit downloads (`docs/award-sharing.md`)

| Route | Status | Notes |
|---|---|---|
| `POST /gms/awards/{id}/sharing/uses`, `POST /gms/my/awards/{id}/sharing/uses` | Implemented | A person's session only (403 `person_required` for tokens). `{ kind: "press_release" \| "portrait" }`: counted in `share_kit_uses` as the award, the part and the day, once a day; 409 `not_public`, 404 for another side's award |
| `GET /gms/awards/{id}/sharing/carousel.pdf`, `GET /gms/my/awards/{id}/sharing/carousel.pdf` | Changed | A person's download is counted the same way (an agent's is not) |

### QuickBooks sync, record-keeping only (`docs/accounting.md`)

| Route | Status | Notes |
|---|---|---|
| `POST /gms/connectors/quickbooks`, `DELETE /gms/connectors/quickbooks` | Implemented | A workspace admin, signed in (agents and API clients refused). Connect through Composio, accounting scope only; disconnecting turns the sync off |
| `GET /gms/accounting`, `GET /gms/accounting/options`, `GET /gms/accounting/vendors` | Implemented | `payments:read`, admins and finance staff (and their agents): the mapping, QuickBooks' accounts, classes, locations and vendors (any run of five or more digits in a name shown as "•••" and the last four) |
| `PUT /gms/accounting/settings`, `PUT /gms/accounting/vendors` | Implemented | Admins and finance staff, in person (`humanOnly`, before the body is read): the mapping, the switch, a grantee's vendor |
| `GET /gms/accounting/entries` | Implemented | `payments:read`. Settled and returned payments (newest 200) next to their QuickBooks entries; `?compare=true` reads at most 25 back from QuickBooks, writing nothing |
| `POST /gms/accounting/entries/{id}/handled`, `POST /gms/accounting/entries/{id}/retry` | Implemented | Admins and finance staff, in person: "Mark as fixed" and "Try again". The GMS never changes or deletes a QuickBooks entry and never moves money |
| MCP `get_accounting_sync` | Implemented | Read only |

### The operators' growth measures (`docs/measures.md`)

| Route | Status | Notes |
|---|---|---|
| `GET /gms/operator/me` | Implemented | A signed-in person's session only (tokens 401 `session_required`): whether they are on `OPERATORS` (else `GALLERY_MODERATORS`); an email entry never matches a single sign-on session |
| `GET /gms/operator/measures` | Implemented | Operators only (403 `not_an_operator`, before any body is read). The nine measures over the last 30 days, counts only |
| `POST /gms/operator/lost-deals` | Implemented | Operators only. `{ reason, day? }` from a fixed list; no free text |
| `GET /gms/operator/search-console`, `DELETE …`, `POST …/connect`, `PUT …/site`, `GET …/report` | Implemented | Operators only. Google Search Console through Composio, `webmasters.readonly`; the GMS's own property; clicks and impressions by kind of page, never by address |

### Single sign-on (`docs/sso.md`)

| Route | Status | Notes |
|---|---|---|
| Every route that accepts a person's session | Changed | A single sign-on session is accepted only when its address's domain is an active domain registered for one of its identity providers; otherwise 403 `sso_domain_mismatch` |
