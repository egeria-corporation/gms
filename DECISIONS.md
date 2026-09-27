# DECISIONS

Decisions made during the autonomous v1 build. Format: **date · decision** — reason — how to reverse.
Items marked **(needs owner confirmation)** are also listed in `REPORT.md`.

## 2026-09-27

- **SPDX identifier is `AGPL-3.0-only` (needs owner confirmation).** — The brief asks for `-only` headers and to flag it. `-or-later` lets the FSF's future AGPL versions apply. — Replace `AGPL-3.0-only` with `AGPL-3.0-or-later` across the repo (`rg -l AGPL-3.0-only | xargs sed -i ...`) and in `package.json` `license` fields.
- **RLS roles are `gms_authenticated` / `gms_anon`, not Supabase's `authenticated` / `anon` (deviation from brief §2).** — The mechanism is identical to PostgREST (`set_config('role', …)` + `request.jwt.claims`), but using dedicated roles means Supabase's Data API (PostgREST) can never read or write GMS tables even if a self-hoster leaves it enabled; the `anon`/`authenticated` roles have all privileges revoked on GMS tables. `gms.uid()` is used in policies (same semantics as `auth.uid()`, no dependency on the `auth` schema's grants). — Rename the roles in migrations and `packages/db/src/client.ts`; re-grant to `anon`/`authenticated`.
- **Database tier 3 (embedded Postgres 18 via `embedded-postgres`) for this run.** — Docker Desktop is installed but its daemon never came up; no Supabase credentials. Tier 1/2 remain supported by `pnpm db:up` (auto-detected). — Start Docker, then `pnpm db:up` picks tier 1.
- **`pnpm run doctor` and `pnpm run setup` instead of `pnpm doctor` / `pnpm setup`.** — pnpm (v7+) has built-in `doctor` and `setup` commands that take precedence over package scripts; `pnpm setup` would edit the user's shell profile. — None needed; docs use `pnpm run …`.
- **TypeScript pinned to 5.9.3** (7.0 is the native Go port; Next.js and typescript-eslint still use the JS compiler API). — Bump when the ecosystem supports TS 7.
- **Own Kysely type generator (`scripts/db-types.ts`) instead of kysely-codegen.** — Needed type mappings that match our pg parsers (int8/numeric → `number`, timestamps → ISO `string`). — Swap in kysely-codegen with overrides.
- **Money columns are `bigint` cents parsed as JS `number`.** — Safe to ±9×10¹⁵ cents; avoids BigInt friction in RSC/JSON. — Change the int8 parser in `packages/db/src/client.ts`.
- **Workspace owner persona added: "Helen Ortiz, Executive Director" of Halcyon.** — The brief's personas have no owner. — Rename in `packages/fixtures`.
- **One role per workspace membership.** — Keeps RLS and UI simple; program officers review via assignment regardless of role. — Add a `roles text[]` column and update `gms.is_member`.
- **Reviewers never read `form_responses` / `application_submissions` directly;** they read `gms.reviewer_submission(app)`, a security-definer function that masks blind-flagged fields when the stage is blind. — Enforces blind review in SQL. — n/a.
- **Public transparency (A-05) reads the column-limited view `public_awards`,** not the `awards` table. — Holds, notes and contacts must never leave the database for anonymous users. — n/a.
- **Email templates are plain React elements rendered with `@react-email/render`.** — `@react-email/components` is deprecated on npm. — Swap components in `packages/email`.
- **Fake Mercury state lives in `gms_private.fake_rail_objects`,** so the web app, the worker and `/dev` simulate controls share one fake bank. — n/a.
