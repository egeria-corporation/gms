# Phase report — 2026-11-10 (end of build session)

## Summary

All six phases of the v1 build prompt are built in code and pass the automated gate. **None of the 15
definition-of-done items is met yet**, because each requires running against real services (hosted
Supabase, Cloudflare, the Passport test deployment, Resend, a real MCP client), and no credentials
were available. Everything below ran against mocks, fixtures, an in-process API, and CI's local
Supabase stack.

## What exists

- **API Worker:** every route in the prompt's API surface is implemented on one service layer with
  one authorization check, used by both REST and MCP. OAuth 2.1 server, 89 MCP tools over HTTP with
  human gates and approvals, inbound Passport and Resend webhooks, outbound webhooks with replay.
- **Jobs Worker:** due evaluators, reminders, digests, webhook delivery, Passport sync, award-mirror
  retry, stuck-release reconcile, Mercury poll, nightly ledger archive.
- **Web app:** 53 of 67 design artboards are live and none are partial; 14 are reference boards
  (email, PDF, styleguide). Sign-in with MFA, workspace switcher, form renderer and builder, six
  phone layouts matching the 390px artboards. Coverage table: `apps/web/README.md`.
- **Database:** 50+ tables with RLS, 14 migrations, seed, pgTAP.
- **Packages:** workflow, rules, review, forms, protocol, passport-client, payments, notify,
  documents (deterministic PDFs), ledger, webhooks, mcp, assist, connectors, importers.
- **Spec:** TypeSpec compiles and passes `cg check spec` against CommonGrants v0.5.0.
- **Scripts and docs:** `gms export` / `import`, API client creation, Supabase bootstrap; self-host
  guide, runbook, acceptance script, connectors, MCP, payments, workflow, forms, rules.
- **Passport** (`egeria-corporation/passport#1`): consented apps can read the Common App profile
  and list locker documents; funder award create/patch under `award:write`.

## What was verified

| Check | Result |
|---|---|
| Typecheck, lint, sensitive-data gate | pass |
| Unit and contract tests | 1,170 pass, 8 skipped locally (database integration; they run in CI) |
| Web ↔ API contract | every web API call runs against the real Worker in-process and the mock with the same assertions |
| Spec compile and CommonGrants check | pass |
| CI on the GMS PR | check, integration (real Supabase), e2e, secrets, audit: green on the last fully reported commit |
| Six design flows | pass end to end in Chromium, by real clicks, in mock mode |
| Accessibility | axe: zero serious or critical in jsdom on all routes; Chromium audit across 82 routes went from 43 serious to 2, both then fixed without a re-run; keyboard-only pass through apply and report |
| Worker deploy dry-runs | api, jobs and web bundle successfully |

## Definition of done: status

| # | Item | Built | Verified against real services |
|---|---|---|---|
| 1 | Funder onboarding and Passport link | yes | no |
| 2 | Opportunity, competition, forms, public page | yes | no |
| 3 | Applicant onboarding with Passport consent | yes | no |
| 4 | Prefill, concurrent editing, submit, protocol apply | yes | no |
| 5 | Eligibility, triage, bulk decline letters | yes | no (Resend) |
| 6 | Review, ranking, allocator | yes | no |
| 7 | Decision, award, agreement, Passport mirror | yes, mirror behind a flag | no (needs the Passport PR merged) |
| 8 | Payments | yes | no (needs Passport) |
| 9 | Requirements, reminders, sharing | yes | no |
| 10 | Org changes both ways | yes | no |
| 11 | MCP with a real Claude client | yes | no |
| 12 | Connectors | OpenGrants proxy and Mercury built; Composio is a stub | no |
| 13 | Protocol | yes | spec check passes; live validation only in-process |
| 14 | Ledger, export, self-host | yes | self-host guide not run on a clean account |
| 15 | Tests and docs | yes | CI green; concept and prompt documents not in `docs/` |

## Known gaps

**Stubbed or unverified integrations**
- Composio (funder Google Workspace): fixture only; connect returns "not configured".
- Mercury: endpoints checked against its documentation, never run live.
- OpenGrants MCP: tool names are guesses; the endpoint was unreachable from the build environment.
- Anthropic, Supabase Auth, Supabase Realtime, R2, Queues, KV: never exercised live.

**Screens that still depend on Passport or a field the API does not return**
- Representatives on the organization screen, and the signer check against a representative, need
  Passport to share representatives with consented apps. Until then those states are explained on
  the screen.
- Account sessions and members' last-active time show what the API returns. There is no richer
  activity source.
- The agreement records the signature IP. The API does not return it, so the screen does not show it.
- `contactEmail` on the public funder record can be empty.

Budget category mapping, program owners and outcome totals, named funder contacts, and interview
slot picking are built. The phone application status screen includes the same interview and decision
sections as the desktop screen, and an accepted application links to that offer.

**What a staging walk still needs**

These are configuration. The product does not stand in for them.

- Passport client credentials and `PASSPORT_AWARD_WRITE`. Until that flag is on, the agreement
  mirror stays pending, and both a facilitated release and "record what was paid elsewhere" stop
  on readiness. When the flag is on, mirroring an award also calls Passport `linkNonprofit`, so
  payment alerts for a destination change or a level drop can reach that funder. A 409 means the
  link is already there.
- `PAYMENTS_FACILITATED` for a payment sent through Passport. Without it the GMS only records a
  payment the funder made elsewhere.
- `RESEND_FROM` (and the Resend key). Commit, bulk send, report reminders, and syndication email
  succeed or return 503 depending on mail. The panel says when an award was created and the letter
  was not sent.
- The exports bucket, for the board docket.
- The jobs Worker cron: reminders, the award-mirror retry, and digests.
- Composio, Mercury, Zernio, and a custom MCP server stay "not set up on this server" until their
  secrets exist. An SSO domain stays pending until an operator activates it. That is the expected
  settings state, not a failed step.

Nothing in this list has been verified on live Passport, Resend, or Supabase. The keyboard-only
applicant pass in `docs/acceptance.md` is still open.

**Other**
- The mock stores for funder and applicant are separate, so the cross-side e2e flows use each
  side's seeded records rather than one shared record.
- No screen-reader testing.
- Consented apps see only profile values the organization has confirmed in Passport.
- Stuck `releasing` tranches are reconciled by a job; this has never run against Passport.

## Decisions waiting on the owner

1. Merge `egeria-corporation/gms#3` and `egeria-corporation/passport#1`.
2. Should consented apps see imported-but-unconfirmed profile values?
3. Assistant default model (`claude-opus-5-5`, overridable with `ASSISTANT_MODEL`).
4. Whether Passport should share representatives with consented apps.

## Next

1. Provide credentials; register the GMS client at Passport with `payee:read` in its allowed scopes.
2. Deploy to a test environment and run `docs/acceptance.md` item by item; fix what real services reveal.
3. Turn on the staging flags above and walk `docs/acceptance.md` on that install.
