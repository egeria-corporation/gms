# OpenGrants GMS

Free, open-source (AGPL-3.0) grants management for funders and grantees, built on
[CommonGrants](https://commongrants.org) v0.5.0. Sign up with just an email and use it: no
[OpenGrants Passport](https://github.com/egeria-corporation/passport) account is needed, and Passport
is an optional upgrade for verification and payments. Hosted at `gms.opengrants.io`, and you can run
your own copy.

## Deploy with Claude Code

You need a Supabase account, a Cloudflare account (the Workers Paid plan) and Claude Code. In an
empty folder, run:

```bash
git clone --branch v1.2.1 https://github.com/egeria-corporation/gms.git && cd gms && pnpm install && claude "/deploy-gms"
```

Claude asks a few questions, stops before anything that costs money or changes DNS, and finishes
with a report of what it set up. It never asks you to paste a secret. Any other coding agent can
follow [DEPLOY_WITH_AGENT.md](DEPLOY_WITH_AGENT.md) the same way.

## Deploy by hand

The deploy tool is an ordinary command-line program: `pnpm -s gms deploy <step>`. Its steps, flags
and result codes are in [scripts/deploy/README.md](scripts/deploy/README.md). The long-form manual
reference is [docs/self-host.md](docs/self-host.md).

## What it does

Funders design opportunities and forms, run multi-stage reviews, decide, issue awards, pay through
Passport and track reporting. Applicants apply from their Passport record, collaborate, report once
and get paid to a verified destination. Everything is exposed over CommonGrants and an MCP server.

## Local development

```bash
pnpm install
pnpm dev:web      # http://localhost:5173, fixture workspaces
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm dev:api      # the API Worker on :8787
```

Check your work:

```bash
pnpm typecheck && pnpm typecheck:deploy && pnpm lint && pnpm gate:sensitive && pnpm test
pnpm spec:compile && pnpm spec:check
```

Database tests (pgTAP) need a local Supabase stack: `supabase start`, then `supabase test db`.

## Layout

| Path | What |
|---|---|
| `api/` | TypeSpec: CommonGrants v0.5.0 base plus `/gms` routes |
| `apps/api` | Cloudflare Worker (Hono): OAuth 2.1 server, well-known documents, API |
| `apps/jobs` | Cron Triggers and Queue consumers |
| `apps/web` | Vite + React: public pages, funder and applicant workspaces, reviewer portal |
| `packages/*` | db, protocol, forms, rules, workflow, review, passport-client, payments, notify, ledger, webhooks, mcp and more |
| `scripts/deploy/` | The deploy tool |
| `supabase/` | Migrations, seed, pgTAP tests |
| `docs/` | Decisions, data model, API surface, forms, rules, workflow, payments, MCP, self-hosting |

## Links

- [CHANGELOG.md](CHANGELOG.md): releases and upgrade notes
- [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md): working rules for contributors and coding agents
- [docs/decisions.md](docs/decisions.md): decisions and why

## License

AGPL-3.0. See `LICENSE`.
