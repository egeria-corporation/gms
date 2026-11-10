# Staging: gms-staging.opengrants.io

Deployed 2026-11-10 from a Claude Code cloud session. Production (`gms.opengrants.io`) is not deployed.

| Piece | Where |
|---|---|
| Web + API origin | `https://gms-staging.opengrants.io` (custom domain on the Worker `gms-web-staging`) |
| API Worker | `gms-api-staging` (reached through a service binding from `gms-web-staging`) |
| Jobs Worker | `gms-jobs-staging` (crons and the `gms-events-staging` queue consumer) |
| Database and auth | Supabase project `gms-staging` (`xjgyeotefkjqhiusuuan`, us-east-1), migrations 0001–0014 and `supabase/seed.sql` applied |
| Storage | R2 `gms-attachments-staging`, `gms-ledger-archive-staging`, `gms-exports-staging`; KV `gms-staging-RATE_LIMIT`; queues `gms-events-staging`, `gms-events-dlq-staging` |
| Passport | Points at `https://passport.opengrants.io`, redeployed from `main` on 2026-11-10 (API and jobs Workers, migration 0052). No GMS client is registered there yet, so Passport consent, prefill and payments do not work |
| Email | Resend domain `gms-staging.opengrants.io` created, **not verified** until its four DNS records are added. A sending-only key (`gms-staging`) is set on both Workers |

## How this differs from the production layout

The deploy token available to the session could not upload Workers static assets or edit zone
routes, so staging uses a generated front Worker instead of the two-Worker route layout:

- `scripts/build-front-worker.mjs` embeds `apps/web/dist` in a Worker script and forwards the API
  path prefixes to the API Worker over a service binding. One custom domain gives both the same origin.
- The API Worker is deployed without its static-asset binding; `/openapi.json` is served from the
  exports bucket (`site/openapi.json`).

With a token that has **Workers Routes: Edit** on the zone and a deploy run outside the session
proxy (for example GitHub Actions), `wrangler deploy --env staging` in `apps/api` and `apps/web`
deploys the production layout instead.

## Redeploy

```bash
pnpm spec:compile && pnpm --filter @gms/api build:openapi
```

Deploy the API without the asset binding (copy `apps/api/wrangler.toml` without its `[assets]`
block to `apps/api/wrangler.session.toml`):

```bash
pnpm --filter @gms/api exec wrangler deploy --env staging --config wrangler.session.toml
```

```bash
pnpm --filter @gms/jobs exec wrangler deploy --env staging
```

Build the web app with the staging origins and the project's anon key, then the front Worker:

```bash
VITE_USE_MOCKS=false VITE_API_BASE_URL=https://gms-staging.opengrants.io VITE_SUPABASE_URL=https://xjgyeotefkjqhiusuuan.supabase.co VITE_SUPABASE_ANON_KEY=<anon key> VITE_PASSPORT_BASE_URL=https://passport.opengrants.io pnpm --filter @gms/web build
```

```bash
node scripts/build-front-worker.mjs --name gms-web-staging --host gms-staging.opengrants.io --api gms-api-staging
```

```bash
pnpm --filter @gms/web exec wrangler deploy --config .front-worker/wrangler.toml
```

## Secrets set

API: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `OAUTH_KID`,
`OAUTH_SIGNING_KEY_JWK`, `CREDENTIALS_ENCRYPTION_KEY`, `WEBHOOK_SECRET_KEY`. Jobs: the Supabase pair
and the two encryption keys. The generated keys exist only in Cloudflare; they were not saved anywhere else.

Also set on both: `RESEND_API_KEY`, `RESEND_FROM` (`noreply@gms-staging.opengrants.io`).

Not set yet: `PASSPORT_GMS_CLIENT_ID`, `PASSPORT_GMS_CLIENT_SECRET`, `PASSPORT_WEBHOOK_SECRET`,
`RESEND_INBOUND_SECRET`, `COMPOSIO_API_KEY`, `ANTHROPIC_API_KEY`, `OPENGRANTS_API_KEY`.

## Known limits on staging

- Sign-in email comes from Supabase's built-in mailer: a few messages per hour, and only to
  addresses that belong to the Supabase organization. Configure Resend SMTP in the project to lift that.
- Cloudflare Web Analytics injects a beacon script that the site's Content-Security-Policy blocks;
  it shows as a console error and is otherwise harmless.
- The seeded demo people use `.example` addresses and cannot sign in.
