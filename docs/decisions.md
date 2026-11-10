# Decisions

One line each: date · decision · why.

- 2026-11-10 · Replaced the 2026-09-27 bootstrap (Next.js + Netlify + graphile-worker, Mercury as the rail) with the v1 build prompt's layout (Cloudflare Workers + Hono, Vite + React, Supabase, Passport-only payments) · the owner chose the rebuild; the old stack conflicts with the prompt's non-negotiables. The old code remains in git history on `main`.
- 2026-11-10 · Root tooling (tsconfig, eslint, vitest projects, sensitive-data gate, gitleaks, CI) mirrors `egeria-corporation/passport` · one set of conventions across both repos.
- 2026-11-10 · The web app adopts the Claude Design canvas stylesheet as-is: `tokens.css` is the OpenGrants Design System export, `app.css` is the product CSS from the canvas · the design-system export has landed, so no neutral interim theme is needed.
- 2026-11-10 · Passport's payments provider is Stripe Connect (Passport `docs/decisions.md`, 2026-11-03), not Moov as the GMS prompt says · the live Passport behavior wins; the GMS only calls Passport routes, so nothing else changes.
- 2026-11-10 · `@opengrants/cg-plugin-passport` is not on npm yet · `packages/protocol` reads the three Passport custom fields with a local helper until the plugin is published.
- 2026-11-10 · Web screens were ported from the design canvas artboards one-to-one (`apps/web/src/screens`), with the shared top bar and rail extracted into `components/shells.tsx` and icons mapped to `lucide-react` · exact visual match first; screen content is still the canvas fixture copy and gets replaced by API data phase by phase.
- 2026-11-10 · Base link rules in `app.css` use `:where(.gms) a` · otherwise the link color outranks `.btn`, `.tab` and `.chip` on anchors and primary buttons lose their white label.
- 2026-11-10 · Funder and applicant workspaces share `/w/:ws/...`; the router resolves the screen from the workspace kind · matches the canvas URLs. The six applicant screens with a 390px artboard switch to it below 720px.
- 2026-11-10 · Canvas boards C1–C3, S1 and the Passport consent board are served under `/styleguide/*`; email and PDF boards under `/preview/email/*` and `/preview/pdf/*` · they are references and templates, not workspace screens (Passport hosts its own consent page).
- 2026-11-10 · `packages/forms` validates with its own interpreter for the schema subset; Ajv 2020 is kept at `@gms/forms/ajv` for Node tooling and as a test oracle · Workers forbid Ajv's runtime code generation.
- 2026-11-10 · MCP human gates: `decline_application` is gated by default in addition to the six in the spec, overrides can only add gates, and `approvals:bypass` cannot be granted through consent · definition-of-done item 11 expects a proposed decline to wait for approval; signing, accepting and releasing stay human-only.
- 2026-11-10 · Database: `authenticated` is SELECT-only and all writes go through the service role; reviewers have no direct policy on `form_responses` (masking is applied by the API) · one write path, through the workflow machines.
- 2026-11-10 · CommonGrants routes use bare UUIDs; prefixed ids (`app_…`) are for `/gms/` routes. Stages sit at `customFields.gms.value.stages` because a CG CustomField wraps its value · protocol fidelity.
- 2026-11-10 · `@common-grants/sdk` 0.9.1 has no Zod schemas for CompetitionBase, FormBase, ApplicationBase, AppFormResponse or OrganizationBase; `packages/protocol` defines them locally from the core TypeSpec · needed to validate every projection.
- 2026-11-10 · OAuth: authorization requests reach the web consent screen as a signed 10-minute JWT; delegated tokens are re-intersected with the member's current role on every request · same shape as Passport.
- 2026-11-10 · Workflow: decline is allowed from submitted, screening, under_review, interview, recommended and waitlisted; award cancel from any non-terminal status; ranking uses sample standard deviation with a 15-point default spread threshold · needed for bulk triage and the panel view.
- 2026-11-10 · Owner decision: the September work (`feat/v1`, `feat/hosted`, PRs #1 and #2) is retired and nothing is ported from it; v1 is built fresh from the build prompt and the design canvas, with no features beyond the prompt (no board voting, diligence screening or audit-log screen) · one design, one stack. PRs #1 and #2 are closed; the branches remain on GitHub.
- 2026-11-10 · Owner decision: Passport is the portable identity / common app and the GMS leverages it. Where Passport cannot yet serve the GMS (profile read for consented clients, funder award routes), Passport is changed rather than the GMS working around it · see the Passport PR from branch `claude/gms-integration`.
- 2026-11-10 · The tranche machine gains `releasing → held` and `held → releasing|initiated` · Passport creates a held disbursement itself during a destination change.
- 2026-11-10 · Owner decision: the applicant's Passport consent includes `payee:read` in addition to `org:read org.changes:read org.changes:write` · applicants see their own payout destination status (bank name and last four) in the GMS, as the design shows. This widens the consent in the build prompt's decision table; `PASSPORT_APPLICANT_PAYEE_READ=false` turns it off. Organizations that consented before this change see the panel as not shared until they reconnect.
- 2026-11-10 · Supabase sessions are verified against the project's published signing keys (ES256/RS256, JWKS), with the legacy HS256 secret still accepted; a bearer is treated as a session by its issuer, not its algorithm · new Supabase projects sign sessions asymmetrically, which the first staging deploy showed.
- 2026-11-10 · Staging (`gms-staging.opengrants.io`) is served by a generated front Worker with the web app embedded and a service binding to the API, and `/openapi.json` falls back to the exports bucket · the session's deploy token could not upload static assets or edit zone routes. Production keeps the route layout. See `docs/staging.md`.

## Open differences with Passport (need an owner decision)

Found by reading `egeria-corporation/passport` at the time of this build; details in `docs/payments.md`.

- The §14 award routes (`award:write`, `POST/PATCH /passport/funders/{orgId}/awards`) do not exist in Passport yet. The mirror client is behind `awardWrite: false`; no facilitated payment can run end to end until that PR lands.
- Passport has no `GET /passport/funders/{id}` or `send-funds.ach`; readiness check 3 reads `GET …/funders/{orgId}/sources` (`canDebit`).
- Rails are `auto | standard | instant`; `scheduledFor` is refused; memo is capped at 140 characters.
- Passport creates a `held` disbursement itself during a destination change (with `/release` and `/cancel`). The GMS tranche machine from §10.1 has no `releasing → held` transition; it needs one, or the GMS must refuse release earlier.
- `payee.*` webhooks reach only funders linked through `POST …/funders/{orgId}/links`.
- `GET /passport/orgs/{orgId}/profile` is user-session only, so profile-based prefill and eligibility (`profile.*`) cannot use the stored consent token.
