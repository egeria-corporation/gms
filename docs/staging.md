# The hosted GMS: gms.opengrants.io

`gms.opengrants.io` runs on the Workers, database and storage below. Their names keep a `staging`
suffix from before the address moved on 2026-11-11, and the API Worker is the `[env.staging]` block
of `apps/api/wrangler.toml`. There is no separate staging environment: every deploy reaches real users.

**Last deployed:** v1.7.0 on 2026-11-16, with database migrations 0001–0032.

| Piece | Where |
|---|---|
| Web + API origin | `https://gms.opengrants.io`, a custom domain on the Worker `gms-web-staging`. `https://gms-staging.opengrants.io` is a second custom domain on the same Worker and redirects permanently to it |
| API Worker | `gms-api-staging`, reached through a service binding from `gms-web-staging` |
| Jobs Worker | `gms-jobs-staging`: crons and the `gms-events-staging` queue consumer |
| Database and auth | Supabase project `gms-staging` (`xjgyeotefkjqhiusuuan`, us-east-1). Applied migrations are recorded in `supabase_migrations.schema_migrations` |
| Storage | R2 `gms-attachments-staging` (`ATTACHMENTS`), `gms-ledger-archive-staging`, `gms-exports-staging` (`EXPORTS`, which also holds `site/openapi.json`); KV `gms-staging-RATE_LIMIT`; queues `gms-events-staging`, `gms-events-dlq-staging` |
| Passport | `https://passport.opengrants.io` and `https://app.passport.opengrants.io`. The GMS client is registered, and accepted awards are mirrored (`PASSPORT_AWARD_WRITE=true`) |
| Email | Resend, from `noreply@gms.opengrants.io`. Supabase Auth sends sign-in codes through Resend SMTP with its own key |
| Assistant | On, model `claude-sonnet-5-5`, 100 uses per workspace per month (`ASSISTANT_MONTHLY_QUOTA`) |
| Feedback | Userback widget, switched on by `VITE_USERBACK_TOKEN` at build time |

## Why the layout differs from the production layout

The deploy token available to a Claude Code cloud session cannot upload Workers static assets or
edit zone routes. The hosted site therefore uses a generated front Worker instead of the two-Worker
route layout:

- `scripts/build-front-worker.mjs` embeds `apps/web/dist` in a Worker script and forwards the API
  path prefixes to the API Worker over a service binding. One custom domain gives both the same origin.
- The API Worker is deployed without its static-asset binding, so `/openapi.json` is served from the
  exports bucket (`site/openapi.json`). Every deploy must upload it (step 6 below).

With a token that has **Workers Routes: Edit** on the zone, and a deploy run outside the session
proxy (for example GitHub Actions), `wrangler deploy --env staging` in `apps/api` and `apps/web`
deploys the production layout instead.

## Deploy a release

Run from a clean checkout of the release tag. From a cloud session, set `CLOUDFLARE_API_TOKEN` (the
proxy supplies the real token) and `CLOUDFLARE_ACCOUNT_ID` for every `wrangler` command. Keep the
order: the database first, then the API, the jobs Worker and the web app.

1. Check out the tag and install.

   ```bash
   git checkout vX.Y.Z && pnpm install --frozen-lockfile
   ```

2. Read the release's **Upgrade notes** in `CHANGELOG.md`: new migrations, settings, secrets and
   bindings.

3. Apply each new migration, in order, before deploying the API. Find the last applied one:

   ```sql
   select version from supabase_migrations.schema_migrations order by version desc limit 1;
   ```

   Run each newer file in one transaction, with its history row (Supabase SQL editor, or the
   Management API `POST /v1/projects/xjgyeotefkjqhiusuuan/database/query`):

   ```sql
   begin;
   -- the whole of supabase/migrations/00NN_name.sql
   insert into supabase_migrations.schema_migrations (version, name) values ('00NN', 'name');
   commit;
   ```

4. Compile the API description.

   ```bash
   pnpm spec:compile && pnpm --filter @gms/api build:openapi
   ```

5. Deploy the API without its asset binding.

   ```bash
   cd apps/api && sed -e '/^\[assets\]$/,/^run_worker_first = true$/d' wrangler.toml > wrangler.session.toml
   ```

   ```bash
   pnpm exec wrangler deploy --config wrangler.session.toml --env staging && rm wrangler.session.toml
   ```

6. Publish the API description. Skip this and `/openapi.json` keeps describing the previous release.

   ```bash
   pnpm exec wrangler r2 object put gms-exports-staging/site/openapi.json --file public/openapi.json --content-type application/json --remote
   ```

7. Deploy the jobs Worker (from the repository root).

   ```bash
   pnpm --filter @gms/jobs exec wrangler deploy --env staging
   ```

8. Build the web app. Both keys are public values that the live bundle already carries. The anon
   key is in the Supabase project's API settings; the Userback access token is in the Userback
   project's settings.

   ```bash
   VITE_USE_MOCKS=false VITE_API_BASE_URL=https://gms.opengrants.io VITE_SUPABASE_URL=https://xjgyeotefkjqhiusuuan.supabase.co VITE_SUPABASE_ANON_KEY=<anon key> VITE_PASSPORT_BASE_URL=https://passport.opengrants.io VITE_PASSPORT_WEB_URL=https://app.passport.opengrants.io VITE_USERBACK_TOKEN=<Userback access token> pnpm --filter @gms/web build
   ```

9. Build and deploy the front Worker. **Always pass `--redirect-from`.** `wrangler deploy` replaces
   the Worker's custom domains with exactly the ones in the generated config, so leaving it out
   detaches `gms-staging.opengrants.io` and the old address stops working.

   ```bash
   node scripts/build-front-worker.mjs --name gms-web-staging --host gms.opengrants.io --redirect-from gms-staging.opengrants.io --api gms-api-staging
   ```

   ```bash
   pnpm --filter @gms/web exec wrangler deploy --config .front-worker/wrangler.toml
   ```

## Check after a deploy

- `https://gms.opengrants.io/health` answers 200.
- `https://gms.opengrants.io/openapi.json` lists the release's new routes.
- `https://gms-staging.opengrants.io/` redirects permanently (308, keeping the path) to `https://gms.opengrants.io/`. The Worker
  `gms-web-staging` shows both hostnames under its custom domains.
- The landing page, a public opportunity page and the sign-in page load in a browser with no page
  errors. The only expected console errors are Cloudflare's own scripts (see Known limits).
- The latest row of `supabase_migrations.schema_migrations` is the release's last migration.
- `https://gms.opengrants.io/robots.txt` answers 200 and names the sitemap; `/og/home.png` is a PNG;
  the source of a public opportunity page shows its own `<title>` and `og:image`.
- A public opportunity's apply widget (`/embed/f/{handle}/o/{slug}`) answers with
  `frame-ancestors *` and no `X-Frame-Options`; the opportunity page itself keeps
  `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

## Settings and secrets

**Settings** (`[env.staging.vars]` in `apps/api/wrangler.toml`):
- the URLs above;
- `ASSISTANT_ENABLED=true`, `ASSISTANT_MODEL=claude-sonnet-5-5` and `ASSISTANT_MONTHLY_QUOTA=100`;
- `PASSPORT_AWARD_WRITE=true` and `PAYMENTS_FACILITATED=false`.

`CONSULTING_REQUEST_TO` is not set, so consulting requests go to `hello@agents.opengrants.io`.

**Secrets** (names only; values live in Cloudflare):
- **API:**
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`;
  - `OAUTH_KID` and `OAUTH_SIGNING_KEY_JWK`;
  - `CREDENTIALS_ENCRYPTION_KEY` and `WEBHOOK_SECRET_KEY`;
  - `RESEND_API_KEY` and `RESEND_FROM`;
  - `PASSPORT_GMS_CLIENT_ID` and `PASSPORT_GMS_CLIENT_SECRET`;
  - `ANTHROPIC_API_KEY`, `OPENGRANTS_API_KEY`, `COMPOSIO_API_KEY` and `COMPOSIO_GOOGLE_AUTH_CONFIG_ID`.
- **Jobs:**
  - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`;
  - `CREDENTIALS_ENCRYPTION_KEY` and `WEBHOOK_SECRET_KEY`;
  - `RESEND_API_KEY` and `RESEND_FROM`;
  - `PASSPORT_GMS_CLIENT_ID` and `PASSPORT_GMS_CLIENT_SECRET`.

**Not set:** `PASSPORT_WEBHOOK_SECRET` and `RESEND_INBOUND_SECRET`; and, new in v1.7.0,
`COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID` and `COMPOSIO_AIRTABLE_AUTH_CONFIG_ID` (API). Until they are,
imports offer CSV and Excel files only. New in v1.8.0: `GALLERY_MODERATORS` (API, a secret, not a
`[vars]` entry). Until it is set, nobody moderates the template gallery and nothing new is published;
the nine starter items still show.

## Sign in with Passport

Live. The GMS client at Passport (`OpenGrants GMS`, owned by Egeria Corporation) has the sign-in
redirect URIs `https://gms.opengrants.io/gms/passport/signin/callback` and
`https://gms-staging.opengrants.io/gms/passport/signin/callback`. Accounts keep no password
(migration `0017`).

When the person has set it up, Passport's authenticator serves as the second step (migration `0018`).
`PASSPORT_ISSUER` is `https://passport.opengrants.io`, which is what Passport signs with.

## Single sign-on (SAML)

Not switched on yet. It needs the `gms-staging` project on the Supabase Pro plan or above with SAML 2.0
switched on (Authentication → Providers → SAML 2.0) and migration `0035`. Per workspace domain, after
the admin's DNS check passes: dry run, then `--apply`, with `SUPABASE_ACCESS_TOKEN` set (never printed):

```
node scripts/sso/register-provider.mjs --project-ref xjgyeotefkjqhiusuuan --domain <domain> \
  --metadata-url <identity provider metadata URL> --workspace <workspace id> [--apply]
```

then run the `select gms.activate_sso_domain(…)` line it prints in the SQL editor. Lockout recovery
is `select gms.lift_sso_requirement('<workspace id>', '<reason>');`. Details: `docs/sso.md`.

## Known limits

- Cloudflare injects two scripts of its own into the site's pages, and the site's Content-Security-Policy
  blocks both:
  - the Web Analytics beacon;
  - an inline script for Cloudflare's JavaScript detections (bot management),
    `/cdn-cgi/challenge-platform/.../jsd`.

  Each shows as a console error and is otherwise harmless. To run either, allow it in the CSP;
  otherwise switch the feature off in the Cloudflare dashboard.
