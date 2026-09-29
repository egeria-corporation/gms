# GMS — open-source grants management

GMS is a grants management platform for foundations and other grantmakers. Staff publish funding opportunities and build application forms without code; applicants check eligibility and apply through a portal branded with the foundation's name, logo and colors; reviewers score against rubrics; staff decide, award, and pay grants from the foundation's own bank account; grantees report on their work. AI agents are first-class users — through MCP, A2A and OAuth — and people always confirm anything consequential.

- **License:** [GNU AGPL-3.0](LICENSE) for the whole repository. The hosted version has full feature parity; nothing is held back from the open-source code.
- **Not white-label:** every branded surface shows "Powered by GMS · Source code", linking to the exact version that is running (AGPL §13).
- **Your bank does the paying:** GMS never holds funds and never stores bank account numbers. Grantees onboard through Mercury recipient invites; payments use maker-checker approval in GMS and then Mercury's request-send-money flow, which a person approves in Mercury. A manual rail records payments made through any other bank.
- **Open standards:** GMS implements the [CommonGrants](https://commongrants.org) protocol (opportunities, forms, applications, awards), serves `/llms.txt`, `/agents.md` and an A2A Agent Card, and exposes an MCP server and an OpenAPI 3.1 platform API generated from one action registry.

## What's inside

| Surface | Path | Who |
|---|---|---|
| Public funding site | `/`, `/opportunities`, `/awards`, `/for-agents` | Everyone |
| Applicant portal | `/portal` | Applicants and grantees |
| Staff console | `/console` | Program, finance and admin staff (TOTP required) |
| Reviewer workspace | `/review` | Reviewers |
| Board docket | `/board` | Board members |
| CommonGrants API | `/common-grants/*` | Partners and agents |
| Platform API | `/api/v1/*` (OpenAPI at `/api/v1/openapi.json`) | Integrations and agents |
| MCP / A2A | `/mcp`, `/a2a`, `/.well-known/agent-card.json` | AI agents |
| Setup wizard / operator console | `/setup`, `/operator` on the root host | Self-hosters and platform operators |

## Quick start (local)

Requirements: Node 22+, pnpm 11. Docker is optional (without it GMS runs on an embedded Postgres).

```bash
pnpm i
pnpm run doctor        # detects the database tier and which adapters are real or fake; writes ENVIRONMENT.md
pnpm db:up             # local Supabase if Docker is available, otherwise embedded Postgres; applies migrations
pnpm seed              # deterministic, fictional demo data (Halcyon Ridge Foundation, Marigold Street Fund)
pnpm dev               # web app + worker
```

Open **http://halcyon.localhost:3000**. Sign in with any seeded email (for example `maya@eastside-youth-music.example` for the applicant, or `helen@halcyonridge.example` for the foundation owner); sign-in links are captured at **http://halcyon.localhost:3000/dev/mail**. Staff accounts need a TOTP code — the dev-only secrets are in `packages/fixtures/README.md`.

`pnpm doctor` and `pnpm setup` are pnpm built-ins, so GMS's scripts are `pnpm run doctor` and `pnpm run setup`.

## Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/egeria-corporation/gms#DATABASE_URL=&SUPABASE_URL=&SUPABASE_ANON_KEY=&SUPABASE_SERVICE_ROLE_KEY=&GMS_ENCRYPTION_KEY=&GMS_MODE=single&DEFAULT_TENANT=&GMS_ROOT_DOMAIN=)

GMS runs on **Next.js on Netlify** with **Supabase** (Postgres, Auth, Storage, Vault) and a **graphile-worker** queue driven by a Netlify Scheduled Function. See [docs/self-hosting.md](docs/self-hosting.md) for the full guide: Supabase project setup, environment variables, `pnpm run setup`, Mercury token setup, email domain, and upgrades.

## Documentation

- [docs/self-hosting.md](docs/self-hosting.md) — install, configure, upgrade
- [docs/api.md](docs/api.md) — CommonGrants coverage, `/api/v1`, webhooks
- [docs/agents.md](docs/agents.md) — MCP, A2A and OAuth guides; scopes; the approval model
- [docs/security.md](docs/security.md) — threat model, RLS approach, reporting vulnerabilities
- [docs/architecture.md](docs/architecture.md) — the product and architecture outline
- [AGENTS.md](AGENTS.md) — commands and rules for contributors (human or AI)
- [CONTRIBUTING.md](CONTRIBUTING.md) — DCO sign-off and the verification gate

## Repository layout

```
apps/web            Next.js app (every surface + route handlers)
apps/worker         graphile-worker tasks + cron (also used by Netlify functions)
packages/db         Kysely types, RLS transaction helper, migration runner, test harness
packages/domain     statuses, state machines, money, roles/scopes, eligibility, errors
packages/actions    action registry + executor (scopes, risk tiers, approvals, audit, outbox)
packages/adapters   payments (Mercury real/fake, manual), email, storage, scanner, secrets, LLM, diligence, auth
packages/ui         design system, theming engine, patterns, shells
packages/forms      form model/compiler/validator + React renderers and the no-code builder
packages/commongrants  CommonGrants mappers, schemas, route handlers
packages/agents     MCP server, A2A, OAuth, platform API, discovery files
packages/email      branded transactional email
packages/pdf        award letters, agreements, application packets, remittances, board books
packages/fixtures   deterministic demo data (`pnpm seed`)
supabase/migrations schema source of truth (RLS on every table)
```

## License

Copyright © GMS contributors. Licensed under the GNU Affero General Public License v3.0 — see [LICENSE](LICENSE). If you run a modified version of GMS as a network service, you must offer its source to your users; the built-in "Source code" footer link does that for you when `GMS_SOURCE_URL` points at your fork.
