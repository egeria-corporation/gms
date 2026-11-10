# OpenGrants GMS

Free, open-source (AGPL-3.0) grants management for funders and awardees, built on
[CommonGrants](https://commongrants.org) v0.5.0 and [OpenGrants Passport](https://github.com/egeria-corporation/passport).
Hosted at `gms.opengrants.io`; self-hosting is a first-class target.

Funders design opportunities and forms, run multi-stage reviews, decide, issue awards, pay through
Passport and track reporting. Applicants apply from their Passport record, collaborate, report once
and get paid to a verified destination. Everything is exposed over CommonGrants and an MCP server.

## Status

Phase 0 (foundation) is in place, along with the pure-logic cores of later phases and the full design
ported into the web app. See `docs/phase-report.md` for what is verified and what is not.

## Run it

```bash
pnpm install
```

```bash
pnpm dev:web
```

Open http://localhost:5173. The web app currently renders the fixture workspaces from the design:

| URL | What |
|---|---|
| `/` | Landing |
| `/f/riverbend`, `/f/riverbend/o/community-health-2027` | Funder public page, opportunity |
| `/w/riverbend` | Funder workspace (Riverbend Community Foundation) |
| `/w/alder-creek` | Applicant workspace (Alder Creek Family Services) |
| `/review/assignments` | Reviewer portal |
| `/styleguide/status` | Status vocabulary and component reference |

The API Worker:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

```bash
pnpm dev:api
```

## Check it

```bash
pnpm typecheck && pnpm lint && pnpm gate:sensitive && pnpm test
```

```bash
pnpm spec:compile && pnpm spec:check
```

Database tests (pgTAP) need a local Supabase stack: `supabase start`, then `supabase test db`.

## Layout

| Path | What |
|---|---|
| `api/` | TypeSpec: CommonGrants v0.5.0 base plus `/gms` routes |
| `apps/api` | Cloudflare Worker (Hono): OAuth 2.1 server, well-known documents, route seams |
| `apps/jobs` | Cron Triggers and Queue consumers |
| `apps/web` | Vite + React: public pages, funder and applicant workspaces, reviewer portal |
| `packages/*` | db, protocol, forms, rules, workflow, review, passport-client, payments, notify, ledger, webhooks, mcp, and stubs for documents, assist, connectors, importers |
| `supabase/` | Migrations, seed, pgTAP tests |
| `docs/` | Decisions, data model, API surface, forms, rules, workflow, payments, MCP |

Working rules for contributors and coding agents are in `CLAUDE.md`.

## License

AGPL-3.0. See `LICENSE`.
