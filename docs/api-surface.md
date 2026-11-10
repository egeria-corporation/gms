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
| `GET /gms/workspaces`, `POST /gms/workspaces` | session | List the person's workspaces; create one and become its admin. Brand accent is contrast-checked (WCAG AA) and falls back to the system accent with a warning |
| `GET /gms/workspaces/{id}` | any member; tokens need `workspace:admin` | |
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
| `POST /gms/eligibility/evaluate` | `applications:read` | Rules from the body or an opportunity; an applicant's cached Passport record is read only with a live consent |
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
| `POST /gms/imports/bundle` | `workspace:admin`, admin in person | Restore a bundle written by `gms export`: `{ gms: <gms.json> }`. Rows keep their ids; existing rows are left alone; applications and awards whose applicant workspace is not on this instance are skipped and counted |
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

Public page data: `GET /gms/public/funders/{handle}` adds `open`, `forecasted`, `closed` and `pastAwards` (null unless the
workspace sets `settings.transparency`); the opportunity page adds `faq` and `documents`, written through
`PATCH /gms/opportunities/{id}` as `publish.faq` and `publish.documents` (https links only).

Gates: a tool a workspace adds to `settings.gatedTools` (or an API client's `gated_tools`) is refused for agent and
API-client tokens on the matching REST route with `403 approval_required` (`apps/api/src/auth/rest-gates.ts`).

Not available: account sessions (Supabase Auth exposes no per-user session list to the service role), a member's last
active time (not recorded), and connected apps and representatives (Passport serves both to member sessions only).

The applicant's Passport consent asks for `payee:read` as well as the three org scopes, so the payout-destination
panel can read bank name and last four digits. Set `PASSPORT_APPLICANT_PAYEE_READ=false` to leave it out. The GMS
client registered at Passport must list `payee:read` in its allowed scopes.

