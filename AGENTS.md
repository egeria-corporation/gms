# AGENTS.md — working on the GMS codebase

This file is for AI coding agents and humans alike. (For AI agents that *use* a running GMS, see `/agents.md` served by the app and `docs/agents.md`.)

## Commands

| Command | What it does |
|---|---|
| `pnpm i` | Install (pnpm 11, Node ≥ 22) |
| `pnpm run doctor` | Detect DB tier + adapters, write `ENVIRONMENT.md` (`pnpm doctor` is a pnpm built-in, so use `run`) |
| `pnpm db:up` / `pnpm db:down` | Start/stop the database (local Supabase, remote dev project, or embedded Postgres) and migrate |
| `pnpm db:migrate` / `pnpm db:reset` | Apply migrations / drop + re-create the local database |
| `pnpm db:types` | Regenerate `packages/db/src/types.gen.ts` from the live schema |
| `pnpm seed` / `pnpm seed --minimal` | Deterministic demo data / one workspace + one admin |
| `pnpm dev` | Web (http://halcyon.localhost:3000) + worker |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm e2e` | The verification gate |

## Layout

`apps/web` (Next.js, every surface + route handlers) · `apps/worker` (graphile-worker) · `packages/*` (db, domain, actions, adapters, ui, forms, commongrants, agents, pdf, email, fixtures, agent-evals) · `supabase/migrations` (schema source of truth) · `compat/supabase-shim.sql` (plain-Postgres tier).

## Rules (non-negotiable)

1. **Every mutation goes through an action** (`defineAction` in `packages/actions`). UI server actions, `/api/v1`, MCP, A2A, CommonGrants apply routes and workers all call `executor.execute()`. Never write to tables from a route handler or component.
2. **Never bypass RLS.** Request work runs in `withRls(claims, …)`. `withService` is only for the executor's system actor, workers and verified webhooks. The browser never talks to tables.
3. **Migrations are forward-only.** Never edit an applied migration; add a new file `supabase/migrations/<yyyymmddhhmmss>_<name>.sql`. Every new table: `workspace_id` (if grantmaker-owned) + index, RLS enabled, policies, and rows in the RLS matrix test.
4. **No hardcoded brand colors.** Use theme tokens (`var(--primary)`, Tailwind `bg-primary`, …). Branded surfaces get tenant CSS variables from the theming engine.
5. **Gates:** the RLS matrix (`pnpm test:db`) must cover every table; axe must show zero serious/critical violations on key routes; never delete/skip tests, loosen TS strictness, weaken a policy, or add blanket `eslint-disable`.
6. **Agents never get R3.** Approving payments, recording final decisions, signing agreements, changing roles, connecting/changing the bank or a payee are human-only. R2 actions from agents create approval requests confirmed inside GMS.
7. **Money** is integer cents + ISO currency. Status is always icon + text + color. Applicant text shown in AI contexts is quoted and labeled "applicant-supplied".
8. **Secrets** live in the SecretStore. Never log, commit, or send them to the client. Never store bank account numbers.
9. **Fictional data only** in fixtures; emails use the reserved `.example` TLD.
10. SPDX header `// SPDX-License-Identifier: AGPL-3.0-or-later` on every source file. Conventional commits. DCO sign-off (`git commit -s`).
