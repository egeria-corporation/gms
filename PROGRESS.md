# PROGRESS

Read this first after any interruption, then `DECISIONS.md`, `ENVIRONMENT.md`, and `git log --oneline -30`.

## Working model
Core platform work happens on `feat/v1`; independent packages/screens are built by parallel agents in git worktrees
(`.claude/worktrees/*`, branches `worktree-agent-*`) and merged into `feat/v1` when they report back.

## Milestones
| M | Scope | Status |
|---|---|---|
| M0 | Bootstrap, doctor, monorepo, CI, adapters w/ fakes, DB tier, migrations, Kysely + RLS helper, worker wiring, outbox | **done** (CI workflow written; gate run pending full app) |
| M1 | Schema + RLS helpers + matrix, auth (magic link + TOTP + step-up), tenancy, action executor, branding engine, design system, shells | **done** except S-01/S-02/S-06 screens (admin agent) |
| M2 | Programs, opportunities, forms engine + builder, public site A-01…A-07, CG read API, JSON-LD, markdown, llms.txt | core done (public site, CG API, forms core); builder UI + opportunity editor in progress (forms-react agent, then console grantmaking) |
| M3 | Applicant portal B-01…B-09, B-15 | **done**; E2E flow 1 passes |
| M4 | Console core + review (C-01, C-06…C-08, R-01…R-05, D-01…D-03) | C-01 done; rest queued for a console agent after forms-react |
| M5 | Awards, agreements, board | backend done; B-10 signing done; staff screens queued |
| M6 | Payments | backend done; screens + webhooks in progress (finance agent) |
| M7 | Post-award, diligence, comms | backend done; screens in progress (finance + admin agents) |
| M8 | Analytics & exports | exports done in worker; analytics schema + screens in progress (admin agent) |
| M9 | Platform API, webhooks, CG write routes | **done** (/api/v1 + OpenAPI + Arazzo mounted; CG accepts bearer tokens); S-07 screen with admin agent |
| M10 | Agent layer | **done**: MCP, A2A, OAuth AS + O-01 consent, discovery files mounted; 31 agent evals + E2E flow 5 pass; S-04/S-05 screens with admin agent |
| M11 | Setup, settings, operator | in progress (admin agent) |
| M12 | Hardening & ship | not started |

## Done (highlights)
- 11 migrations; RLS on every table; RLS matrix (5.7k assertions) + invariants + migration tests (262 DB tests passing at last run).
- `@gms/domain`, `@gms/actions` (executor + ~120 actions across every module), `@gms/adapters` (Mercury real/fake/manual, Resend/SMTP/dev outbox + guard, Supabase/local storage, ClamAV/noop, Vault/AES, Anthropic/OpenAI/fake LLM, IRS/OFAC importers + fixtures, Supabase/test auth), `@gms/ui`, `@gms/forms` core, `@gms/commongrants`, `@gms/email`, `@gms/pdf`.
- Worker: outbox dispatcher (emails, notifications, webhooks, follow-on system actions), exports (CSV/XLSX/990-PF/workspace zip), cron tasks; Netlify worker-tick + background export function.
- Web: proxy (tenant, CSP nonce, request id, root-host routing), auth + MFA + step-up, public site A-01…A-07, portal (sign-in, dashboard, org setup/vault, application detail + messages, agent confirmation, account, connected agents, grants hub, agreement signing, change requests, apply entry), console shell + home, dev mail viewer, CG routes, sitemap/robots/RSS.
- Verified in a browser: public site renders with tenant brand; staff magic-link → TOTP enrollment → console.

## In flight (agents)
console grantmaking/review/board (C-02…C-08, FB, R, D, E) · console finance (payments/reports/diligence/awards + Mercury webhooks + dev Mercury controls) · console admin (settings, approvals, comms, analytics, setup wizard, operator, dev catalog/design-system/previews).

## Next (mine)
Merge the three console agents as they land → E2E flows 2, 3, 4, 6 → full gate → `pnpm run upgrade` script + `pnpm shots` → security pass (audit, RLS report) → REPORT.md → PR if a remote exists.

Docs written: README, docs/self-hosting.md, docs/security.md, docs/api.md, docs/agents.md.

## Known issues
- Docker daemon never started → tier 1 (local Supabase) untested in this run; tier 3 used throughout.

## Deferred (Should items)
- (none yet)
