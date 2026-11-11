# The hosted GMS: gms.opengrants.io

**2026-11-11:** `gms.opengrants.io` now points at the Workers and database described below (the owner chose this over a second set). `gms-staging.opengrants.io` permanently redirects to it. The Worker, bucket, queue and Supabase project names keep their `staging` suffix. The demo data was removed from the database; the five global templates were kept. There is no separate staging environment: every deploy goes to real users.

The rest of this page was written when the address was `gms-staging.opengrants.io`; read that name as `gms.opengrants.io`, and add `--redirect-from gms-staging.opengrants.io` to the front Worker build.

Deployed 2026-11-10 from a Claude Code cloud session. Production (`gms.opengrants.io`) is not deployed.

| Piece | Where |
|---|---|
| Web + API origin | `https://gms-staging.opengrants.io` (custom domain on the Worker `gms-web-staging`) |
| API Worker | `gms-api-staging` (reached through a service binding from `gms-web-staging`) |
| Jobs Worker | `gms-jobs-staging` (crons and the `gms-events-staging` queue consumer) |
| Database and auth | Supabase project `gms-staging` (`xjgyeotefkjqhiusuuan`, us-east-1), migrations 0001–0015 and `supabase/seed.sql` applied |
| Storage | R2 `gms-attachments-staging`, `gms-ledger-archive-staging`, `gms-exports-staging`; KV `gms-staging-RATE_LIMIT`; queues `gms-events-staging`, `gms-events-dlq-staging` |
| Passport | Points at `https://passport.opengrants.io`, redeployed from `main` on 2026-11-10 (API and jobs Workers, migration 0052). No GMS client is registered there yet, so Passport consent, prefill and payments do not work |
| Email | Resend domain `gms-staging.opengrants.io`, verified. A sending-only key (`gms-staging`) is set on both Workers; Supabase Auth sends sign-in codes through Resend SMTP with its own key (`gms-staging-auth-smtp`), from `noreply@gms-staging.opengrants.io` |

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

Also set on both: `RESEND_API_KEY`, `RESEND_FROM` (`noreply@gms-staging.opengrants.io`). API only:
`COMPOSIO_GOOGLE_AUTH_CONFIG_ID` (kept as a secret, as Passport does, so it stays out of the repository).

Staging switches (`apps/api/wrangler.toml`): assistant on with `claude-sonnet-5-5` (inactive until
`ANTHROPIC_API_KEY` is set), `PAYMENTS_FACILITATED=false`, `PASSPORT_AWARD_WRITE=true`.

Not set yet: `PASSPORT_GMS_CLIENT_ID`, `PASSPORT_GMS_CLIENT_SECRET`, `PASSPORT_WEBHOOK_SECRET`,
`RESEND_INBOUND_SECRET`, `COMPOSIO_API_KEY`, `ANTHROPIC_API_KEY`, `OPENGRANTS_API_KEY`.

## Sign in with Passport

Added 2026-11-11 (not deployed with this note). Going live needs, in this order:

1. Passport deployed with OpenID Connect (its migration `0055`).
2. The GMS client at Passport (`OpenGrants GMS`, owned by Egeria Corporation) given the sign-in
   redirect URIs `https://gms.opengrants.io/gms/passport/signin/callback` and
   `https://gms-staging.opengrants.io/gms/passport/signin/callback`.
3. GMS migrations `0016` and `0017` applied, then the API and web app redeployed. `0017` adds two
   triggers on `auth.users` (no account keeps a password; nothing set before an email was proven
   survives the proof) and clears any password already stored.

`PASSPORT_ISSUER` is not set on staging; the issuer defaults to `PASSPORT_BASE_URL`
(`https://passport.opengrants.io`), which is what Passport signs with.

## Known limits on staging

- Cloudflare Web Analytics injects a beacon script that the site's Content-Security-Policy blocks;
  it shows as a console error and is otherwise harmless.
- The seeded demo people use `.example` addresses and cannot sign in.
