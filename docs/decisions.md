# Decisions

One line each: date · decision · why.

- 2026-11-10 · Replaced the 2026-09-27 bootstrap (Next.js + Netlify + graphile-worker, Mercury as the rail) with the v1 build prompt's layout (Cloudflare Workers + Hono, Vite + React, Supabase, Passport-only payments) · the owner chose the rebuild; the old stack conflicts with the prompt's non-negotiables. The old code remains in git history on `main`.
- 2026-11-10 · Root tooling (tsconfig, eslint, vitest projects, sensitive-data gate, gitleaks, CI) mirrors `egeria-corporation/passport` · one set of conventions across both repos.
- 2026-11-10 · The web app adopts the Claude Design canvas stylesheet as-is: `tokens.css` is the OpenGrants Design System export, `app.css` is the product CSS from the canvas · the design-system export has landed, so no neutral interim theme is needed.
- 2026-11-10 · Passport's payments provider is Stripe Connect (Passport `docs/decisions.md`, 2026-11-03), not Moov as the GMS prompt says · the live Passport behavior wins; the GMS only calls Passport routes, so nothing else changes.
- 2026-11-10 · `@opengrants/cg-plugin-passport` is not on npm yet · `packages/protocol` reads the three Passport custom fields with a local helper until the plugin is published.
