# GMS v1 — build report

Branch `feat/v1` · 2026-09-27 · built autonomously from the "GMS v1: Autonomous Full-Stack Build Brief".

## 1. What was built

GMS is an AGPL-3.0 grants management platform: a public funding site per foundation, an applicant portal, a staff console, reviewer and board workspaces, a platform operator console, the CommonGrants API, a platform API (`/api/v1`), and an agent layer (MCP, A2A, OAuth). Every mutation from every surface goes through one action registry (163 actions) and executor that enforces validation, roles, scopes, risk tiers, row-level security, audit and the transactional outbox.

**Run it locally**

```bash
pnpm i
pnpm run doctor      # `pnpm doctor` is a pnpm built-in, so GMS uses `pnpm run doctor`
pnpm db:up
pnpm seed
pnpm dev             # → http://halcyon.localhost:3000
```

Sign-in links land in `/dev/mail`; staff TOTP secrets for the demo people are in `packages/fixtures/README.md`. Demo foundations: Halcyon Ridge Foundation (`halcyon`), Marigold Street Fund (`marigold`), Sunbeam (minimal).

## 2. Environment used

| | |
|---|---|
| Machine | Windows 11, Node 24.18, pnpm 11.18 |
| Database tier | **Embedded Postgres 18** (tier 3). Docker Desktop is installed but its daemon never started, so local Supabase (tier 1) was not used; no remote Supabase credentials. |
| Payment rail | **fake-mercury** (full simulation: accounts, recipient invites, request-send-money, approvals, webhooks with real HMAC signatures, settlement) + manual rail. Real Mercury adapter written against the public API; never called. |
| Email | **dev outbox** (captured in `dev_outbox`, viewable at `/dev/mail`). Resend/SMTP adapters written with a guard that only allows `@resend.dev` test addresses outside production. |
| Storage / scanner | local filesystem / noop ("not scanned"). Supabase Storage and ClamAV adapters written. |
| Secrets | AES-256-GCM (derived dev key). Supabase Vault adapter written. |
| Auth | TestAuthAdapter (magic links + TOTP against Postgres tables, same flows as Supabase). Supabase Auth adapter written. |
| LLM | fake (optional features only). Anthropic/OpenAI adapters written. |
| Diligence | IRS BMF / OFAC SDN importers + bundled fictional fixtures. |
| Live tests | **none ran** — no Mercury sandbox, Resend, Supabase or Netlify credentials. They skip automatically. |
| Deploy | **no preview deploy** — no Netlify credentials. `netlify.toml`, scheduled worker and background functions are in place. |

## 3. Coverage

| Module | Screens | Routes | Backend | Tests | Notes |
|---|---|---|---|---|---|
| Public site | A-01…A-07 | `/`, `/opportunities`, `/opportunities/[slug]`, `/opportunities/[slug]/eligibility`, `/awards`, `/embed/opportunities`, `/for-agents`, RSS, sitemap, JSON-LD, `.md` | done | E2E 1, 2, 6; axe | Markdown via `Accept: text/markdown` too |
| Applicant portal | B-01…B-15 | `/portal/**` | done | E2E 1, 3, 5; axe | autosave with ETags, collaborators, submission snapshot + receipt |
| Staff console core | C-01…C-08 | `/console`, `/console/programs`, `/opportunities`, `/pipeline`, `/applications`, `/grantees` | done | E2E 2, 3 | saved views, kanban, bulk decline preview |
| Form builder | FB-01…FB-08 | `/console/forms`, `/console/forms/[formId]` | done | unit (forms engine), E2E 2 | FB tabs share one route (no per-tab deep links yet) |
| Review | R-01…R-07, D-01…D-03 | `/console/review/**`, `/console/decisions/**`, `/review/**` | done | E2E 3; RLS matrix (blind mode, COI) | panel view polls every 5 s (Realtime is the upgrade path) |
| Board | E-01, E-02 | `/console/dockets/**`, `/board/**` | done | seed + curl smoke | board book PDF |
| Payments | P-01…P-08 | `/console/payments/**`, `/webhooks/mercury`, `/dev/mercury` | done | E2E 4; invariants (ceiling, maker-checker, gates) | request-send-money approval mode only |
| Post-award | PA-01…PA-03, B-11, B-12 | `/console/reports/**`, `/console/diligence`, `/console/awards/**` | done | DB + seed tests | report holds, amendments, OFAC screening |
| Communications | CM-00…CM-03 | `/console/comms/**`, `/webhooks/email` | done | unit (email rendering) | |
| Analytics | AN-01…AN-03 | `/console/analytics/**`, `/console/exports` | done | RLS matrix (views), seed | matviews refreshed hourly + after seed; n<5 suppression |
| Settings | S-00…S-09 | `/console/settings/**`, `/console/approvals/**` | done | E2E 6 (S-01) | step-up on keys, roles, tiers, support access |
| Setup / operator | F-01…F-05, G-01, G-02 | root host `/setup`, `/operator`, `/sign-in`, `/mfa`; `pnpm run setup` | done | smoke (agent) | operators need aal2 |
| OAuth consent | O-01 | `/oauth/consent` | done | E2E 5 (OAuth test) | |
| Outputs | H-01…H-05 | `/dev/preview/email/**`, `/dev/preview/pdf/**` | done | unit (PDF render) | |
| Design system | DS-01…DS-06, `/dev/catalog` | `/dev/design-system`, `/dev/catalog` | done | catalog unit test | |

Screenshots of every catalog route (590 of 591 captured; `/dev/catalog` times out waiting for network idle because it prefetches hundreds of links) (both tenants for branded surfaces, light + dark console, 1440 px + 390 px for public/portal): `artifacts/screens/index.html` and `artifacts/screens.zip` (gitignored; regenerate with `pnpm shots`).

## 4. CommonGrants conformance

| Route | Conformance | Status | Tested |
|---|---|---|---|
| `GET /common-grants/opportunities` | required | ✓ | contract (DB) + E2E 2 |
| `GET /common-grants/opportunities/{id}` | required | ✓ | contract |
| `POST /common-grants/opportunities/search` | optional | ✓ | contract |
| `GET /common-grants/forms`, `/forms/{id}` | experimental | ✓ | contract |
| `GET /common-grants/competitions`, `/competitions/{id}` | experimental (+ list as GMS extension) | ✓ | contract |
| `GET /common-grants/awards`, `/awards/{id}`, `POST /awards/search` | experimental | ✓ | contract |
| `POST /common-grants/applications/start` | experimental | ✓ (bearer or session) | contract |
| `GET /common-grants/applications/{id}` | experimental | ✓ | contract |
| `GET/PUT /common-grants/applications/{id}/forms/{formId}` | experimental | ✓ | contract |
| `PUT /common-grants/applications/{id}/submit` | experimental | ✓ (agents → approval request) | contract |
| `POST /common-grants/applications/search` | experimental | ✓ (staff) | contract |

58 CommonGrants tests (mappers, pagination, 33 route contract tests).

## 5. Agent layer

- **Auth:** GMS's built-in OAuth 2.1 authorization server (PKCE S256, resource indicators, Dynamic Client Registration, Client ID Metadata Documents with SSRF protections, rotating refresh tokens with reuse detection) + PATs + foundation agent-account keys. Supabase OAuth 2.1 JWTs are also accepted when configured (Supabase doesn't support CIMD yet). O-01 consent lets people untick scopes.
- **MCP:** stateless Streamable HTTP at `/mcp`, protocol 2026-07-28 (also 2025-11-25/06-18/03-26). Hand-rolled on the SDK's types because SDK 1.30 is stateful and stops at 2025-11-25; the official SDK client passes an interop eval. Tools: public (3), applicant (10 curated + generated), staff (14 curated + generated). R2 tools return `approval_required` with a `confirmUrl`; R3 actions are never tools and return `human_only` on every channel.
- **A2A:** `/a2a` JSON-RPC (v1.0 method names + aliases), Agent Card at `/.well-known/agent-card.json`, skills: find_opportunities, check_eligibility, answer_opportunity_question, start_application, application_status, submit_report, request_extension. No push notifications (poll `tasks/get`).
- **Platform API:** `/api/v1` + OpenAPI 3.1 + Arazzo workflows, RFC 9457 errors, Idempotency-Key, ETag/If-Match, RateLimit headers.
- **Discovery:** `/llms.txt`, `/llms-full.txt`, `/agents.md`, protected-resource and authorization-server metadata.
- **Tests:** 33 scripted agent evals (MCP applicant/staff, SDK interop, A2A, OAuth, `/api/v1`, payment rules) + E2E flow 5 + the OAuth consent E2E.

## 6. Security summary

- **RLS:** 111/111 tables have RLS enabled; 374 policies; the matrix covers 115/115 public relations with 6,020 allow/deny assertions over 14 principals (`docs/rls-coverage.md`, regenerated by `scripts/rls-report.ts`). Supabase's `anon`/`authenticated` roles have no privileges on GMS tables.
- **Money:** maker-checker, aal2 for approvals, payee/hold gates and the award ceiling are enforced as database triggers as well as in actions; payment approval, role changes and bank changes need a fresh TOTP step-up; agents can propose but never approve.
- **Headers:** nonce-based CSP with `strict-dynamic`, `frame-ancestors 'self'` (embeds excepted), HSTS in production, nosniff, referrer and permissions policies.
- **Dependency audit:** `undici` overridden to a patched version; one accepted moderate advisory (`uuid` < 11.1.1 via exceljs — affects APIs exceljs doesn't call).
- **Open risks:** see `docs/security.md` ("Known gaps"): `style-src 'unsafe-inline'`; security-definer outbox/idempotency helpers callable by request roles (server-side only); optional ClamAV.

## 7. Decisions

All decisions are in `DECISIONS.md` (date · decision · reason · how to reverse).

**Confirmed by the owner (2026-09-28):**

1. **License: `AGPL-3.0-or-later`** (changed from the brief's `-only` across every file, `package.json` and the OpenAPI document).
2. **Reviewers need TOTP**; board members don't (their votes are still people-only).
3. **Final decisions don't require a step-up** (people-only R3, no fresh TOTP).
4. **Payments use approval mode only** (request-send-money, approved by a person in Mercury); direct send is not implemented.
5. **Built-in OAuth server is the default** (Supabase OAuth 2.1 tokens accepted when configured).
6. **Blind review masks identifying fields automatically**; applicants' own free text is not redacted.
7. **The repository stays private for now.**

**Other defaults (no confirmation needed):** embedded Postgres tier for development and tests; MCP and A2A hand-rolled on the official types (stateless 2026-07-28; A2A v1.0 JSON shapes not verified against the final spec text); frame policy `'self'` so GMS can show its own PDF previews; the console follows the OS light/dark preference.

**Still open:** the security contact address in `docs/security.md` is a placeholder.

## 8. Known issues and deferred items

- Tier 1 (local Supabase via Docker) and every live integration (Mercury sandbox, Resend, Supabase Auth, Netlify preview) are untested — no daemon or credentials.
- Form builder tabs (FB-02…FB-08) have no deep links; `?state=lint` loads a model with checker errors but doesn't open the Check tab.
- "Add to question bank" from inside the builder is not implemented (templates are).
- R-04 panel view polls instead of using Supabase Realtime.
- Scheduled digests on saved reports (AN-02) are stored but not sent.
- `messages.mark_read` isn't wired on the staff application page.
- Two grantmaking tables (`grantee_profiles`, `application_duplicate_dismissals`) are accessed with parameterized SQL rather than generated Kysely types in a few places.
- Stretch items (§13) were not started: built-in agents, AI form import, MCP Apps, CG `/orgs` sync, peer A2A diligence, Spanish i18n, co-editing presence, live OpenGrants syndication, Stripe billing, Web Bot Auth, MCP Server Card. (ClamAV scanning exists as an adapter.)

## 9. Steps to production

1. **Mercury:** apply for Mercury's OAuth partner program (OAuth mode is present, flag-gated); until then use a read-only + request-send-money custom token per foundation. Run the sandbox live tests with `MERCURY_ENV=sandbox`.
2. **Supabase:** create a production project; apply migrations (`supabase db push` or `pnpm db:migrate`); enable magic link + TOTP MFA; set redirect URLs; switch `GMS_AUTH_MODE` off test mode; configure Vault or `GMS_ENCRYPTION_KEY`; enable point-in-time recovery.
3. **Domains:** wildcard domain for multi-tenant mode, custom domains per foundation (verified in `workspace_domains`).
4. **Email:** verify the sending domain (SPF, DKIM, DMARC) in Resend; point the Resend webhook at `/webhooks/email`.
5. **SAML SSO:** Supabase paid feature; flag-gated in GMS.
6. **SOC 2 path:** the audit log, access reviews (team page), MFA enforcement, support-access grants and data export give a starting control set; add vendor reviews, incident response and change-management evidence.
7. **Security contact:** replace the placeholder address in `docs/security.md`.

## 10. Links

- Preview deploy: **none** (no Netlify credentials).
- Screenshots: `artifacts/screens/index.html`, `artifacts/screens.zip` (local; `pnpm shots`).
- Repository: https://github.com/egeria-corporation/gms (private). `main` starts at the bootstrap commit.
- Pull request: https://github.com/egeria-corporation/gms/pull/1 (draft, `feat/v1` → `main`).

## Verification gate

Run on the final tree of `feat/v1` (embedded Postgres, fake adapters):

| Step | Result |
|---|---|
| `pnpm lint` | ✓ 0 problems (`--max-warnings=0`) |
| `pnpm typecheck` | ✓ 14/14 packages |
| `pnpm test` (unit) | ✓ 415 passed · 5 skipped (live Mercury sandbox / Supabase / Resend tests, no credentials) |
| `pnpm test:db` | ✓ 309 passed (RLS matrix, invariants, migrations, seed, CommonGrants contract, agents) |
| `pnpm build` | ✓ |
| `pnpm e2e` (Playwright + axe, `next start`) | ✓ 10 passed — flows 1–6 and the OAuth consent test; zero serious/critical axe violations on every checked page |
| `pnpm evals` | ✓ 33 passed |

E2E flows: 1 applicant (eligibility → EIN prefill → LOI → receipt → Submitted) · 2 staff (form builder → scheduled opportunity → public site + CommonGrants feed) · 3 review (COI gate → rubric scores → final decision → two-installment award → agreement signed) · 4 payments (payee onboarding via fake Mercury → Priya builds, can't approve → Marcus approves with step-up → Mercury approval → Sent → Reconciled → disbursed amount + remittance email) · 5 agent (PAT → MCP save/submit → approval_required → Maya confirms → audit "Grant Writer Assistant, acting for Maya Chen"; staff agent proposes a draft batch, approval refused) · 6 branding (S-01 color change → auto-corrected with a warning → public site updates).

Bugs the E2E flows found and fixed along the way included: the step-up dialog never ran the action after a correct code; agreement generation always failed; fake Mercury onboarding links pointed at the wrong host; the payment-sent email failed on every send; agent submissions weren't validated before asking the person to confirm. The final screenshot review also found that blind review leaked EINs, attestation signatures and attachment file names; blind stages now hide identifying answers automatically (migration 1700).
