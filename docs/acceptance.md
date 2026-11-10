# Acceptance walk-through

A manual script for the twelve end-to-end items in the v1 definition of done, sized for about 45
minutes on a deployed instance. Each item says what can be exercised **today without credentials**
(the web app in mock mode, and the API test suites that run the real routes over in-memory stores
and recorded Passport fixtures) and what **needs a live service**.

**Read this first.** As of 2026-11-10 no item has been run end to end against hosted Supabase,
Cloudflare, the Passport test deployment, Resend, Mercury or a real MCP client. The "today" column
is evidence that the pieces work in isolation, not that the item is done.

## Setup (5 minutes)

Deployed instance: follow `docs/self-host.md`, load the seed (`--seed`), and have at hand a
Passport test funder (Riverbend) and a Passport test nonprofit at L3 with an active destination.

Without credentials:

```bash
pnpm install
```

```bash
pnpm dev:web
```

Mock mode starts signed in; the sign-in code is `123456`. Funder workspace: `/w/riverbend`.
Applicant workspace: `/w/alder-creek`.

```bash
pnpm test
```

## The twelve items

| # | Item | Steps on a deployed instance | Exercised today without credentials | Needs live |
|---|---|---|---|---|
| 1 | Funder onboarding | Sign in with a code, enroll TOTP, `/onboarding/funder`: link the org, set brand, invite a teammate, create a program. Settings → Payments: connect the Passport client; status shows last OK | Web: sign-in, MFA and onboarding screens in mock mode. API: `workspaces.test.ts`, `oauth.test.ts`, Passport link with a recorded fixture | Supabase Auth (codes, TOTP); Passport funder client |
| 2 | Opportunity and competition | Create an opportunity, two forms in the form builder, a two-stage competition with a rubric and eligibility rules; pass the launch checklist; open. `GET /common-grants/opportunities/{id}` and `/forms/{id}`; open `/f/{handle}/o/{slug}` | Web: builders and public pages in mock mode. API: `design.test.ts` and `contract.test.ts` validate responses against the compiled spec | Nothing external; needs a deployed API for the public URLs |
| 3 | Applicant onboarding | "Continue with Passport", consent, land in the applicant workspace showing level and readiness | Web: onboarding and Organization in mock mode. API: `organization.test.ts` (consent start, callback, refresh, readiness, revoked consent) with fixtures | Passport consent screen and token exchange |
| 4 | Prefill and apply | Start an application; prefilled fields carry provenance; a teammate and a scoped consultant edit at once; budget validates; submit. Repeat with an API client over `/common-grants/applications/*` | Web: editor with autosave and two-client merge tests. API: `apply.test.ts`, `contract-applications.test.ts` | Passport profile for real prefill values; Supabase Realtime for presence |
| 5 | Eligibility and triage | Filter the applications table by eligibility and level; bulk decline with a template; letters arrive | Web: applications table in mock mode. API: `inbox.test.ts` (filters, bulk decline through the mail port) | Resend for delivery |
| 6 | Review | Assign one internal and one invited external reviewer; declare COI; score; panel ranks with mean, median, spread; allocator refuses over-allocation | Web: assignment matrix, reviewer portal, panel in mock mode. API: `grants.test.ts` (assignment, COI, scoring, a hand-computed ranking fixture, the allocator) | Resend for the reviewer invitation |
| 7 | Decision → award → agreement | Commit decisions; grantee accepts and signs; funder countersigns; award becomes active; Passport award id is stored | Web: award agreement and grant offer screens in mock mode. API: `grants.test.ts`, `contract-grants.test.ts` (executed PDF hash equals the ledgered hash; signing refused for agent tokens) | Passport award routes (egeria-corporation/passport#1) with `PASSPORT_AWARD_WRITE=true` |
| 8 | Payments | Tranche due on execution; readiness all pass; release; webhooks drive it to settled; `disbursedAmount` read back. Record an external tranche (resolve). Start a destination change in Passport: banner appears and release is blocked | API: `money.test.ts` (readiness matrix, idempotent release, destination change blocks and clears, resolve mode, Passport webhooks) with fixtures | Passport test deployment end to end: disbursements, webhooks, funder link for `payee.*` events |
| 9 | Requirements | Progress report due; reminders sent; grantee submits with prefilled fields; funder accepts; linked tranche becomes due; grantee shares the report with a second funder | API: `money.test.ts` (reminders idempotent across retries; accept releases the tranche; share by consent); `apps/jobs/test/jobs.test.ts` (every job runs) | Resend; jobs Worker cron on Cloudflare |
| 10 | Org changes | Change a profile field in Passport; it appears as pending in the funder's grantee directory; accept it. Propose a change from the funder; it is pending in Passport | API: `admin.test.ts` (grantee directory, org-change inbox, CommonGrants `/orgs`) with fixtures | Passport change ledger; nightly poll on the jobs Worker |
| 11 | MCP | Connect a Claude client to `https://<host>/mcp` (OAuth + PKCE, dynamic registration); list applications; summarize one; propose a decline that waits in `/approvals`; approve and reject one each. As an applicant agent: start, fill, validate, submit (held for approval). `GET /llms.txt`, `/.well-known/agent.json`, `/openapi.json` | API: `mcp.test.ts`, `oauth.test.ts`, `assist.test.ts` (gates, approve runs once, reject does not, human-only tools refuse agents). Web: approvals and OAuth consent in mock mode | A real MCP client; `ASSISTANT_ENABLED=true` and an Anthropic key for the summary |
| 12 | Connectors | Find funding: search, match, eligibility through OpenGrants. Connect Mercury (read-only); list outbound transactions; match one to a resolve-mode tranche. Register a custom MCP server, allow-list a read tool, see its result named in a summary | API: `inbox.test.ts` (discovery proxy with the fixture client), `admin.test.ts` (Mercury fixture feed, match, custom MCP registry), `assist.test.ts` (custom MCP result with the server's name) | OpenGrants MCP (tool names unverified), a Mercury token, a reachable custom MCP server. Google Workspace cannot be exercised: no production implementation |

## Keyboard-only pass (applicant)

On a deployed instance, with no pointer: sign in, open Find funding, start an application, move
through every section, attach a file, open and close the submit dialog, submit; then open Reports,
complete and submit a report. Record anything that cannot be reached or operated, and any focus
that lands nowhere visible. **Not yet done**: this pass and the axe run in CI are still open.

## After the walk-through

- `GET /gms/ledger` for the funder workspace: every status change, payment, consent and access
  change above has an entry.
- `node --experimental-transform-types scripts/gms.ts export --workspace <handle>` writes the bundle.
- Note every step that needed a workaround in `docs/decisions.md`.
