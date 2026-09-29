<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Hosted GMS (gms.opengrants.io): runbook

How the hosted service is set up and operated. Self-hosters: see [self-hosting.md](self-hosting.md); this document
is the same stack with the hosted choices filled in.

## Shape

| | Staging | Production |
|---|---|---|
| Platform home, sign-in, operator console | `staging.gms.opengrants.io` | `gms.opengrants.io` |
| Foundations | `{slug}.staging.gms.opengrants.io` | `{slug}.gms.opengrants.io` |
| Netlify site | `gms-staging` (production branch: `staging`) | `gms-prod` (production branch: `main`) |
| Supabase project | `gms-staging` | `gms-prod` |
| Email | Resend, delivered only to `GMS_EMAIL_ALLOWLIST` | Resend, to anyone |
| Payments | Mercury sandbox or manual rail | Mercury sandbox or manual rail (real Mercury is not enabled yet) |
| Data | fictional demo data | real foundations only; never seeded |

Two separate Netlify sites, because Netlify runs scheduled functions (the every-minute worker) only on a site's
production deploys. **Deploy previews are built only by `gms-staging`** — turn them off on `gms-prod` (Site
configuration → Build & deploy → Deploy previews: *Don't deploy pull requests*), or a PR preview would run against
the production database.

Hosted choices: foundations get a subdomain only (`GMS_CUSTOM_DOMAINS=false`). Anyone who needs their own domain or
a dedicated deployment asks from **Settings → Workspace → Custom domain or dedicated deployment**; the request is
emailed to `GMS_SUPPORT_EMAIL` and listed on the foundation's page in the operator console. The service is free
(workspace plan `free`); there is no billing.

## 1. DNS: delegate gms.opengrants.io from Cloudflare to Netlify

Netlify can only issue the wildcard certificates (`*.gms.opengrants.io`, `*.staging.gms.opengrants.io`) when it hosts
the DNS for that name, so the `gms` subdomain is delegated; the rest of opengrants.io stays on Cloudflare.

1. Netlify → **Domains** → *Add or register domain* → `gms.opengrants.io` → create the DNS zone. Netlify shows four
   nameservers (`dns1.p0X.nsone.net` … `dns4.p0X.nsone.net`).
2. Cloudflare → opengrants.io → **DNS** → add four records: type `NS`, name `gms`, content = each Netlify
   nameserver. (NS records are never proxied.)
3. Remove any other Cloudflare records named `gms` or `*.gms`.
4. Check: `dig NS gms.opengrants.io +short` returns the Netlify nameservers (can take up to an hour).

## 2. Supabase (repeat for gms-staging and gms-prod)

1. Create the project (US region close to Netlify's functions). Production: a paid plan with point-in-time recovery.
2. **Database → Connection string**: copy the *Transaction pooler* URI (port 6543) → `DATABASE_URL`, and the *Session
   pooler* URI (port 5432) → `DATABASE_SESSION_URL`.
3. **Project settings → API**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
4. **API → Data API**: turn it off (GMS never uses PostgREST, and revokes Supabase's `anon`/`authenticated` roles
   on its tables either way).
5. **Authentication → Sign in / Providers**: email (magic link) on, sign-ups on; **Multi-factor**: TOTP on.
   **URL configuration**: Site URL `https://gms.opengrants.io` (staging: `https://staging.gms.opengrants.io`);
   redirect URLs `https://*.gms.opengrants.io/**` and `https://gms.opengrants.io/**` (staging: the same under
   `staging.gms.opengrants.io`).
6. Apply the schema from a trusted machine:

   ```bash
   DATABASE_SESSION_URL="<session pooler URI>" pnpm run upgrade
   ```

   `upgrade` applies the forward-only migrations and checks RLS, grants and the audit log.

## 3. Resend

1. Add the sending domain `mail.gms.opengrants.io`; add the SPF, DKIM and return-path records Resend shows to the
   **Netlify DNS zone** for `gms.opengrants.io` (step 1), plus `_dmarc.mail.gms.opengrants.io` →
   `v=DMARC1; p=quarantine; rua=mailto:support@opengrants.io`.
2. Create one API key per environment → `RESEND_API_KEY`.
3. Webhook → `https://gms.opengrants.io/webhooks/email` (events: delivered, bounced, complained) → signing secret →
   `RESEND_WEBHOOK_SECRET`.

## 4. Netlify sites

Create `gms-prod` and `gms-staging` from `egeria-corporation/gms` (build settings come from `netlify.toml`).

**Domains**
- `gms-prod`: primary domain `gms.opengrants.io`, domain alias `*.gms.opengrants.io`.
- `gms-staging`: primary domain `staging.gms.opengrants.io`, domain alias `*.staging.gms.opengrants.io`.
- **HTTPS**: *Verify DNS configuration* → *Provision certificate* (wildcard, via the delegated zone).

**Environment variables** (Site configuration → Environment variables; mark secrets as secret)

| Variable | gms-prod | gms-staging |
|---|---|---|
| `GMS_ENV` | `production` | `staging` |
| `GMS_MODE` | `multi` | `multi` |
| `GMS_ROOT_DOMAIN` | `gms.opengrants.io` | `staging.gms.opengrants.io` |
| `GMS_CUSTOM_DOMAINS` | `false` | `false` |
| `GMS_SUPPORT_EMAIL` | `support@opengrants.io` | `support@opengrants.io` |
| `DATABASE_URL` | prod transaction pooler | staging transaction pooler |
| `DATABASE_SESSION_URL` | prod session pooler | staging session pooler |
| `GMS_DB_POOL_MAX` | `3` | `3` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | prod project | staging project |
| `NEXT_PUBLIC_SUPABASE_URL` | same as `SUPABASE_URL` | same |
| `GMS_ENCRYPTION_KEY` | `openssl rand -hex 32` (new, keep a copy in the password manager) | a different one |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | prod | staging |
| `GMS_EMAIL_ALLOWLIST` | — | the team's addresses, comma-separated |
| `GMS_INTERNAL_SECRET` | random, for background functions | a different one |
| `NEXT_PUBLIC_GMS_SOURCE_URL` | `https://github.com/egeria-corporation/gms` | same |

Never set `GMS_AUTH_MODE` on either site. The build fails with a list of what's missing if a deployed environment
is misconfigured (`apps/web/lib/deploy-config.ts`); losing `GMS_ENCRYPTION_KEY` makes stored bank tokens and webhook
secrets unreadable.

**Build**: production branch `main` (prod) / `staging` (staging). Deploy previews: off on prod, on for staging.

## 5. First deploy

1. Staging: push `staging`; wait for the deploy; open `https://staging.gms.opengrants.io/api/health` → `{"status":"ok"}`.
2. Seed staging with the fictional demo data from a trusted machine: `DATABASE_URL=<staging session URI> pnpm seed`.
   (Not yet verified: seeding creates the demo people through Supabase Auth instead of the test adapter — check this
   on the first staging run. Staging has no dev tools and `.example` addresses can't receive mail, so test with your
   own accounts.)
3. Make yourself an operator (then sign in at the root host and enroll TOTP):

   ```bash
   DATABASE_URL="<session pooler URI>" SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm run operator:add --email you@opengrants.io --name "Your Name"
   ```

4. Walk the smoke checklist below on staging. Then production: merge to `main`, run `pnpm run upgrade` against prod,
   `operator:add`, smoke check, and create the first foundation from `https://gms.opengrants.io/setup` (or
   `pnpm run setup` against prod). Never seed production.

**Smoke checklist**: `/api/health` ok · root host shows the directory · sign in with a magic link (real email) and
enroll TOTP · operator console lists the tenant · create a test foundation → public site at `{slug}.…` with its
brand · submit a test application · receipt email arrives · a custom deployment request reaches
`GMS_SUPPORT_EMAIL` · `/dev/mail` returns 404.

## 6. Operations

- **Uptime**: monitor `https://gms.opengrants.io/api/health` (200 = app and database up; 503 = database down) every
  minute, alert support@opengrants.io.
- **Worker**: the operator console home shows outbox backlog and stalled jobs per tenant; Netlify → Functions →
  `worker-tick` logs show each run.
- **Backups**: Supabase daily backups + point-in-time recovery (prod). Test a restore into a scratch project once
  a quarter.
- **Deploy**: merge to `main` → Netlify builds and publishes. Migrations first: run `pnpm run upgrade` against prod
  before merging a PR that adds one (migrations are additive, so the old build keeps working).
- **Roll back**: Netlify → Deploys → pick the previous deploy → *Publish deploy*. Database changes are forward-only;
  fix forward with a new migration.
- **Rotate secrets**: Supabase keys and Resend keys rotate in their dashboards → update Netlify env → redeploy.
  `GMS_ENCRYPTION_KEY` cannot be rotated in place yet (stored secrets are encrypted with it).
- **Support access**: operators see tenant data only while a foundation admin grants time-boxed access; every view is
  in that foundation's audit log.
- **Security reports**: support@opengrants.io ([SECURITY.md](../SECURITY.md)).
