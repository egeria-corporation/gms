# PROGRESS

Read this first after any interruption, then `DECISIONS.md`, `ENVIRONMENT.md`, and `git log --oneline -30`.

## Working model
Core platform work happens on `feat/v1`; independent packages/screens are built by parallel agents in git worktrees
(`.claude/worktrees/*`, branches `worktree-agent-*`) and merged into `feat/v1` when they report back.

## Milestones
| M | Scope | Status |
|---|---|---|
| M0 | Bootstrap, doctor, monorepo, CI, adapters w/ fakes, DB tier, migrations, Kysely + RLS helper, worker wiring, outbox | **done** |
| M1 | Schema + RLS + matrix, auth (magic link, TOTP, step-up), tenancy, executor, branding engine, design system, shells | **done** |
| M2 | Programs, opportunities, forms engine + builder, public site A-01…A-07, CG read API, JSON-LD, markdown, llms.txt | **done** |
| M3 | Applicant portal B-01…B-09, B-15 | **done**; E2E flow 1 passes |
| M4 | Console core + review (C-01…C-08, R-01…R-05, D-01…D-03, H-03) | **done** (screens merged); E2E flow 3 in progress |
| M5 | Awards, agreements, board (R-06, R-07, B-10, E-01, E-02, H-02, H-05) | **done**; agreement generation fixed at merge; flow 3 in progress |
| M6 | Payments (P-01…P-08, fake Mercury, webhooks, reconciliation, manual rail) | **done** (screens merged); E2E flow 4 in progress |
| M7 | Post-award, diligence, comms (PA-01…03, B-11, B-12, CM-01…03) | **done** |
| M8 | Analytics & exports (AN-01…03, S-09) | **done**; seed + hourly worker refresh matviews |
| M9 | Platform API, webhooks, CG write routes | **done** |
| M10 | Agent layer | **done**; 31 evals + E2E flow 5 + OAuth consent test pass |
| M11 | Setup, settings, operator (F-01…F-05, S-01…S-09, G-01/G-02) | **done**; E2E flow 6 passes; operator console now requires aal2 |
| M12 | Hardening & ship | **done**: full gate green (lint, typecheck, 411 unit, 301 db, build, 10 E2E, 33 evals); docs; audit; RLS report; `pnpm shots`; REPORT.md. No preview deploy or PR (no Netlify credentials, no git remote). |

## Done (highlights)
- 11 migrations; RLS on every table; RLS matrix (5.7k assertions) + invariants + migration tests (262 DB tests passing at last run).
- `@gms/domain`, `@gms/actions` (executor + ~120 actions across every module), `@gms/adapters` (Mercury real/fake/manual, Resend/SMTP/dev outbox + guard, Supabase/local storage, ClamAV/noop, Vault/AES, Anthropic/OpenAI/fake LLM, IRS/OFAC importers + fixtures, Supabase/test auth), `@gms/ui`, `@gms/forms` core, `@gms/commongrants`, `@gms/email`, `@gms/pdf`.
- Worker: outbox dispatcher (emails, notifications, webhooks, follow-on system actions), exports (CSV/XLSX/990-PF/workspace zip), cron tasks; Netlify worker-tick + background export function.
- Web: proxy (tenant, CSP nonce, request id, root-host routing), auth + MFA + step-up, public site A-01…A-07, portal (sign-in, dashboard, org setup/vault, application detail + messages, agent confirmation, account, connected agents, grants hub, agreement signing, change requests, apply entry), console shell + home, dev mail viewer, CG routes, sitemap/robots/RSS.
- Verified in a browser: public site renders with tenant brand; staff magic-link → TOTP enrollment → console.

## In flight (agents)
None.

## Next
Hosted service (docs/hosting.md): Phase 2 code is PR `feat/hosted`. Waiting on the owner for Netlify, Supabase, Resend access and the Cloudflare NS records; then Phase 3 staging, Phase 4 production.

Docs written: README, docs/self-hosting.md, docs/security.md, docs/api.md, docs/agents.md.

## Known issues
- Docker daemon never started → tier 1 (local Supabase) untested in this run; tier 3 used throughout.

## Deferred (Should items)
See REPORT.md §8.
