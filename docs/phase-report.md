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
- **Web app:** 46 of 67 design artboards are fully live, 7 are partial, 14 are reference boards
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

**Seven partial screens** (details in `apps/web/README.md`)
- Need a Passport change: representatives on the organization screen and the signer check against a
  representative (Passport shares representatives with member sessions only).
- No data source: account sessions, members' last-active time.
- Not built: budget category mapping, program owner and outcome totals, named funder contacts,
  interview slot picking in the web app (the API has propose and confirm routes), signature IP in
  the agreement response, `contactEmail` on the public funder record.

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
3. Close the seven partial screens once the decisions above are made.
