# Self-hosting GMS

GMS runs as a Next.js app (web + route handlers) on Netlify with Supabase for Postgres, Auth, Storage and Vault, and a graphile-worker queue. You can also run the web app and worker on any Node 22 host with a Postgres 15+ database.

## 1. Create a Supabase project

1. Create a project at supabase.com (a dedicated project per GMS installation).
2. **Database → Connection string:** copy the **Session pooler** URI → `SUPABASE_DB_URL` (and `DATABASE_URL`).
3. **Project settings → API:** copy the URL → `SUPABASE_URL`, the anon key → `SUPABASE_ANON_KEY`, the service-role key → `SUPABASE_SERVICE_ROLE_KEY` (server-only).
4. **API → Data API:** GMS does not use PostgREST. You can disable the Data API or remove `public` from exposed schemas; GMS revokes the `anon`/`authenticated` roles' privileges on its tables either way.
5. **Auth:** enable email (magic link) sign-in. Set the site URL to your GMS origin and add `https://<your-host>/auth/callback` to redirect URLs. GMS sends sign-in emails through its own mailer (so you can brand them); configure SMTP or Resend in GMS (below). Enable **MFA (TOTP)**.
6. **Storage:** GMS creates private buckets (`applications`, `org-documents`, `brand`, `exports`, `agreements`, `reports`) on first use.
7. Optional: **Vault** for secrets (`GMS_SECRET_STORE=vault`); otherwise set `GMS_ENCRYPTION_KEY`.

Apply the schema with either `supabase link --project-ref <ref> && supabase db push` or `DATABASE_URL=<session pooler URI> pnpm db:migrate` (GMS records migrations in both `gms_meta` and `supabase_migrations`).

## 2. Configure environment variables

Copy `.env.example` and fill in at least:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` / `SUPABASE_DB_URL` | yes | Session pooler URI |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes (production) | Auth + Storage |
| `GMS_ENCRYPTION_KEY` | yes (production) | `openssl rand -hex 32` |
| `GMS_MODE` | yes | `single` (one foundation) or `multi` (tenants by hostname) |
| `DEFAULT_TENANT` | single mode | The workspace slug |
| `GMS_ROOT_DOMAIN` | multi mode | Tenants are `{slug}.{GMS_ROOT_DOMAIN}` or a verified custom domain |
| `GMS_ENV` | yes | `production` disables dev tools, `?state=` overrides and the test auth adapter |
| `RESEND_API_KEY` or `SMTP_URL` | recommended | Without either, email is captured, not sent |
| `MERCURY_ENV`, `MERCURY_API_TOKEN` | optional | Or connect the bank in the console (tokens go to the SecretStore) |
| `CLAMAV_HOST` | optional | Virus scanning for uploads |
| `GMS_SOURCE_URL` | recommended | Your fork's repository URL for the AGPL "Source code" link |

`pnpm run doctor` prints which adapters are active and writes `ENVIRONMENT.md`.

## 3. Create your workspace

Either open `https://<root host>/setup` (available only while no workspace exists) and follow the wizard — owner → brand → email → bank (skippable) → first program and opportunity → invite team — or run it headless:

```bash
pnpm run setup --slug halcyon --name "Halcyon Ridge Foundation" --owner-email you@example.org --owner-name "Your Name" --primary "#0F5E5A" --accent "#E0A526" --font "Source Serif 4"
```

The owner receives a sign-in link and enrolls TOTP on first visit to the console.

## 4. Deploy to Netlify

1. Create a Netlify site from your fork (or use the **Deploy to Netlify** button in the README). `netlify.toml` configures the Next.js runtime, the scheduled `worker-tick` function (every minute: opens/closes opportunities, drains the outbox, delivers webhooks, polls Mercury, nightly reconciliation) and background functions for long exports.
2. Set the environment variables above in **Site settings → Environment variables**. Also set `GMS_INTERNAL_SECRET` (random) for background-function calls.
3. Domains: in single mode point your domain at the site. In multi mode add a wildcard domain `*.grants.example.org` and set `GMS_ROOT_DOMAIN=grants.example.org`; per-foundation custom domains are added as Netlify domain aliases and recorded in `workspace_domains` (verified).

## 5. Connect Mercury (optional)

GMS uses Mercury in **approval mode**: GMS asks Mercury to send money (`request-send-money`), and a person with Mercury access approves each request inside Mercury. GMS never holds funds.

1. In Mercury, create an API token. For approval mode, a **read-only + request-send-money** (custom-scoped) token is enough; you do not need write access or an IP allowlist. Direct sending (read-write token + IP allowlist) is not implemented in v1.
2. In GMS: **Console → Payments → Connect bank → Mercury**, paste the token (you'll confirm with your authenticator). GMS stores it in the SecretStore, lists your accounts (last four digits only), and registers a webhook — Mercury returns the signing secret once, and GMS stores it immediately.
3. Map each program to the account that pays its grants.
4. OAuth mode requires Mercury partner approval; it is present but flag-gated.

Foundations that bank elsewhere use the **manual rail**: record payments made outside GMS, or import them from CSV.

## 6. Email domain

Set a sending domain in **Console → Settings → Integrations** and add the SPF, DKIM and DMARC records it shows. Until the domain is verified, GMS sends from its default sender with your foundation name.

## 7. Upgrades

```bash
git pull
pnpm i
pnpm run upgrade   # applies forward-only migrations, then runs doctor and a schema/RLS sanity check
```

Migrations are forward-only and recorded in `gms_meta.schema_migrations`. Never edit an applied migration.

## SAML SSO

SAML single sign-on is a Supabase paid feature. Configure the identity provider in Supabase (Auth → SSO), then enable **SSO** in Console → Settings → Integrations (flag-gated). Staff still enroll TOTP unless your IdP enforces MFA and you turn off `mfa_required` per member.

## Backups and data export

Use Supabase's point-in-time recovery for backups. Owners can export the entire workspace (JSON for every table plus a CommonGrants bundle) from **Console → Settings → Export**.
