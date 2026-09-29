# Contributing to GMS

Thanks for helping build open-source grants management. GMS is licensed under the **GNU Affero General Public License v3.0** (see `LICENSE`).

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/) instead of a CLA. Every commit must be signed off, certifying that you wrote the change or otherwise have the right to submit it under the project's license:

```
Signed-off-by: Your Name <you@example.org>
```

Add it automatically with `git commit -s`. Pull requests with unsigned commits can't be merged.

## Getting started

```bash
pnpm i
pnpm run doctor
pnpm db:up
pnpm seed
pnpm dev
```

Then open http://halcyon.localhost:3000. See `AGENTS.md` for commands, layout and the rules every change must follow (mutations go through actions, never bypass RLS, forward-only migrations, no hardcoded brand colors, accessibility and RLS gates).

## Before you open a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm e2e
```

- Add tests with your change. New tables need RLS policies **and** entries in the RLS matrix (`packages/db/test/rls-expectations.ts`).
- Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- Use conventional commit messages (`feat(portal): …`, `fix(payments): …`).
- Copy for applicants is warm and plain (about an 8th-grade reading level); staff copy is concise with verbs on buttons.

## Reporting security issues

Please don't open a public issue. See `docs/security.md` for how to report a vulnerability privately.
