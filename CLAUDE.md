# OpenGrants GMS — working rules

Free, open-source (AGPL-3.0) grants management for funders and awardees, hosted at `gms.opengrants.io`.
Full design: `docs/source/v1-build-prompt.md` (the v1 build prompt). Decisions taken while building:
`docs/decisions.md` (date, decision, why). Design reference: the "OpenGrants GMS" Claude Design canvas;
its stylesheet lives in `apps/web/src/theme/` (tokens.css = OpenGrants Design System, app.css = product CSS).

## Division of labor with Passport

- **Passport owns organizations and money**: profile, assurance level, attestation, PayeeCredential,
  destinations, disbursements, `Award.funding.disbursedAmount`.
- **The GMS owns the funder's process**: programs, opportunities, competitions, forms, applications,
  reviews, decisions, award lifecycle, agreements, payment schedules, requirements, budgets, messages.
- Awards are mirrored: GMS is authoritative for lifecycle, Passport for amounts disbursed.

## Non-negotiable constraints

- **Stack**: Supabase (Postgres, Auth, Storage, RLS), Cloudflare (Workers, Queues, Cron, R2, KV, static
  assets), TypeScript strict, Hono, Vite + React. No new hosting vendors. Email via Resend, connected
  apps via Composio, models via the Anthropic API.
- **No Microsoft products or services.**
- **No bank or identity data.** Never store, log or transmit routing numbers, account numbers, SSNs,
  dates of birth or government ID numbers. Show `last4` and `bankName` from the PayeeCredential only.
  `pnpm gate:sensitive` enforces this.
- **No money path outside Passport.** Facilitated payments go through `POST /passport/disbursements`;
  resolve mode records what the funder paid elsewhere. No GMS table holds a destination, no GMS route
  sets one, no GMS code adds to `disbursedAmount`.
- **CommonGrants v0.5.0 exactly.** Protocol routes under `/common-grants/`, GMS routes under `/gms/`.
  Never add fields to a CG model outside `customFields`; validate every projection with
  `@common-grants/sdk` before persisting.
- **Passport is the source of verified identity.** A workspace may link a Passport `orgId`; one that
  doesn't keeps a self-declared profile, always shown as not verified, never presented as a verified
  CommonGrants organization, and replaced by the Passport record when it links. Facilitated payments,
  verification levels and organization change requests stay Passport-only.
- **Agents get the UI's capabilities, no more.** MCP tools and REST routes share one service layer and
  one authorization check. Human-gated tools cannot be bypassed by any client.
- **State changes go through `packages/workflow`.** No route writes a status column directly:
  guard → write → ledger → webhook.
- **Secrets** come from Wrangler secrets / Supabase vault / `.dev.vars` (gitignored).
- **Design**: use the theme tokens and the classes in `apps/web/src/theme/app.css`; never ad-hoc colors.
  Status is always icon + label, never color alone. Icons come from `lucide-react`, sized with the `ic` classes.
- SPDX header `// SPDX-License-Identifier: AGPL-3.0-only` on source files. Conventional commits.

## Layout

`api/` TypeSpec · `apps/api` Hono Worker · `apps/jobs` cron + queues · `apps/web` Vite + React ·
`packages/*` (db, protocol, forms, rules, workflow, review, passport-client, payments, notify,
documents, ledger, webhooks, mcp, assist, connectors, importers) · `supabase/` migrations, seed, pgTAP.

## Commands

```
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm gate:sensitive
pnpm spec:compile && pnpm spec:check
pnpm dev:web      # Vite on :5173 (VITE_USE_MOCKS=true renders the fixture workspaces)
pnpm dev:api      # wrangler dev on :8787
```

## Do not build (v1)

Payments to individuals, third-party e-signature vendors, document-AI extraction, Grants.gov/SAM.gov
submission, reviewer stipends, custom domains for funder pages, mobile apps, SOC 2 work, a CRM,
Candid import, anything Microsoft.
