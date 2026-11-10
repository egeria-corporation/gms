# Phase report — 2026-11-10

## What shipped

- **Rebuild.** The September bootstrap (Next.js, Netlify, Mercury as the rail) is replaced by the v1
  layout: Cloudflare Workers + Hono, Vite + React, Supabase, Passport-only payments.
- **Design.** All 65 artboards of the OpenGrants GMS canvas are in `apps/web` as routed React screens,
  using the canvas stylesheet, the OpenGrants Design System tokens and fonts, shared workspace shells
  and `lucide-react` icons. Six applicant screens switch to their phone layout below 720px.
- **Database.** 50 tables from the data model with RLS on every one, UUIDv7 keys, an append-only
  ledger, seed data and pgTAP tests.
- **API Worker.** OAuth 2.1 server (client credentials, auth code + PKCE, refresh, dynamic client
  registration), JWKS, the inbound token check, session and workspace middleware, well-known and
  agent documents. Business routes answer 501 behind clear seams.
- **Packages.** workflow (all state machines), rules, review, forms, protocol (CommonGrants
  projections), passport-client, payments, notify, ledger, webhooks, mcp (89 tools, human gates).
- **Spec.** The TypeSpec document compiles (182 paths) and passes `cg check spec` against v0.5.0.

## What was verified

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm gate:sensitive` | pass |
| `pnpm test` | 457 tests pass across 29 files |
| `pnpm spec:compile`, `pnpm spec:check` | pass |
| Migrations, seed and pgTAP (78 assertions) | pass on a local Postgres 16 with a stubbed `auth` schema |
| Web: every route loaded in Chromium at 1440px (390px for phone layouts) | no console errors, no horizontal overflow, no 404s |

## What was not verified, and what is not built

- Nothing has run against a hosted Supabase project, a Cloudflare account, the Passport test
  deployment, Resend, Mercury, Composio or a real MCP client. No credentials were available in this
  session. `supabase start` was not run (no Docker), and the migrations target Postgres 17 but were
  tested on 16.
- **None of the 15 definition-of-done items is met end to end.** The screens show the canvas fixture
  content; they are not yet reading from the API. Sign-in, MFA, forms and dialogs are static markup:
  the modals on the submit, sign and workspace-switcher routes are always open, and buttons other
  than the row-density and thread-filter toggles do nothing yet.
- The `/gms` and `/common-grants` business routes, the Streamable HTTP mount for MCP, the React form
  renderer, the jobs Worker, PDF rendering, the assistant, connectors, importers, export and
  self-host docs are not built.
- The API's Supabase stores were written from the data-model spec in parallel with the migrations;
  their column names have not been reconciled against the migrations.
- Screens were compared with the design by eye on a sample, not by pixel diff.
- `docs/source/v1-build-prompt.md` and `docs/concept.md` are not in the repo; add the two source files.

## Decisions needed

See "Open differences with Passport" in `docs/decisions.md`. The one that blocks payments: the
`award:write` routes from §14 do not exist in Passport yet.

## Next

1. Reconcile the API stores with the migrations and run the integration suite on a local Supabase.
2. Phase 1: programs, opportunities, competitions and forms routes; the React form renderer; replace
   fixture content on the public pages, opportunity builder and form builder with API data.
3. Open the Passport PR for the §14 award routes.
