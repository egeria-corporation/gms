# PROGRESS

Read this first after any interruption, then `DECISIONS.md`, `ENVIRONMENT.md`, and `git log --oneline -30`.

## Current milestone: M0 (bootstrap) → M1 (foundation)

### Done
- Monorepo (pnpm 11 + Turborepo), strict TS 5.9, ESLint flat config, Prettier, Vitest projects (unit / db / evals).
- Schema v1: migrations 0100–0600 (tenancy, commons, programs/forms/opportunities, applications/review, awards/payments, post-award/comms/compliance, internals). RLS on every table; SQL invariants (payment ceiling, payee-ready gate, holds, maker-checker, immutable published forms, append-only audit/submissions/signatures/status history).
- `@gms/db`: Kysely client, `withRls` / `withService`, migration runner (records gms_meta + supabase_migrations), embedded Postgres controller, type generator, test harness.
- `@gms/domain`: statuses with exact labels, state machines, money + Mercury fees, roles/scopes/tiers, eligibility engine, timezone deadlines, RFC 9457 errors. 13 unit tests.
- `@gms/actions`: `defineAction`, executor (validation, roles, scopes, R2→approval, R3 refusal, step-up, audit+outbox in-transaction, idempotency, tier overrides), `decideApproval`. 8 DB tests.
- `pnpm run doctor` + ENVIRONMENT.md.

### Next
- Adapters (real + fake), UI package (design system/theme), RLS matrix tests, web app skeleton (tenancy, auth, shells), worker, seed.

## Known issues
- (none yet)

## Deferred (Should items)
- (none yet)
