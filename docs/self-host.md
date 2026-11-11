# Self-hosting OpenGrants GMS

One Supabase project and one Cloudflare account run a full instance. Hosted and self-hosted run
the same code.

**Status of this guide.** Every command here was run or dry-run in the build environment:
migrations and seed against a local PostgreSQL 16, `wrangler deploy --dry-run` for the three
Workers, and the web build with its CSP. **No step has been run against a real Cloudflare account
or a hosted Supabase project yet**, so expect to adjust resource ids and report what differs.

## What you need

| | |
|---|---|
| Node 22.7+ and pnpm 11 | Build and scripts (the CLI scripts use Node's built-in TypeScript support) |
| `psql` | Applying migrations |
| A Supabase project | Postgres, Auth (magic link + TOTP), Realtime |
| A Cloudflare account with a zone | Workers, R2, Queues, KV, Cron Triggers |
| A Resend account and a sending domain | Email. Optional for a first look: without it nothing is mailed |
| An OpenGrants Passport deployment | Identity, verification and payments. Optional for a first look: without it workspaces cannot link organizations or pay |

Optional: an Anthropic API key (the drafting assistant), a Mercury read-only token per funder
(reconciliation), an OpenGrants API key (discovery).

## 1. Supabase

1. Create a project. Note the project URL, the `anon` key, the `service_role` key and the JWT secret
   (Settings → API), and the database connection string (Settings → Database).
2. Apply the schema:

```bash
pnpm install
```

```bash
node scripts/bootstrap-supabase.ts --db-url "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
```

   Add `--seed` for the fictional demo data (never in production). The script records what it
   applied in `gms_meta.schema_migrations` and is safe to re-run after an upgrade. `supabase db push`
   works as well if you prefer the Supabase CLI; use one or the other, not both.
3. Authentication → Providers → Email: enable email sign-in with one-time codes / magic links;
   turn "Confirm email" off (the code is the confirmation).
4. Authentication → Multi-factor: enable TOTP enroll and verify. The GMS requires TOTP for funder
   admin and finance and for applicant admin.
5. Authentication → URL configuration: Site URL = your web origin (`https://gms.example.org`);
   add `https://gms.example.org/auth/callback` to the redirect URLs.
6. Authentication → SMTP: point Supabase's own mail (sign-in codes) at Resend's SMTP, or any SMTP
   you run. The built-in sender is rate-limited and not for production.
7. Realtime is used for presence in the application editor; leave it enabled.

Row Level Security is on for every table. The Workers use the service-role key and filter by
workspace in code; the `authenticated` role has read-only policies and no user ever needs the
service-role key.

## 2. Cloudflare resources

Create these once per environment (names are yours; the ones below match `[env.production]`):

```bash
wrangler r2 bucket create gms-attachments
```

```bash
wrangler r2 bucket create gms-ledger-archive
```

```bash
wrangler r2 bucket create gms-exports
```

```bash
wrangler queues create gms-events
```

```bash
wrangler queues create gms-events-dlq
```

```bash
wrangler kv namespace create RATE_LIMIT
```

Then edit `[env.production]` in `apps/api/wrangler.toml` and `apps/jobs/wrangler.toml`:
- bucket and queue names, if you chose others;
- the KV namespace `id` printed by the last command (the checked-in id is a placeholder);
- `routes` and `zone_name` for your host, and the `*_BASE_URL` / `OAUTH_ISSUER` variables.

| Binding | Kind | Worker | Used for |
|---|---|---|---|
| `ATTACHMENTS` | R2 | api | Uploaded files (application attachments, rendered PDFs) |
| `LEDGER_ARCHIVE` | R2 | api, jobs | Nightly JSONL ledger archive with a hash chain |
| `EXPORTS` | R2 | api, jobs | Export bundles |
| `GMS_EVENTS` | Queue | api (producer), jobs (consumer) | Inbound webhook processing; dead letters go to `gms-events-dlq` |
| `RATE_LIMIT` | KV | api | Per-token MCP rate limits |
| `ASSETS` | Static assets | api | The compiled OpenAPI document |

Cron Triggers (jobs Worker, UTC):

| Schedule | Job |
|---|---|
| `*/5 * * * *` | Outbound webhook deliveries that are due |
| `*/15 * * * *` | Tranche due evaluator; requirement due/overdue evaluator and reminders |
| `0 * * * *` | Passport sync: award mirror retry, disbursed amounts, payee level and status |
| `0 */6 * * *` | Mercury poll (read-only) |
| `30 2 * * *` | Organization-change poll; ledger archive |
| `0 15 * * *` | Daily notification digest |
| `5 15 * * 1` | Weekly notification digest (Mondays) |

## 3. Secrets

Generate the OAuth signing key and two 32-byte keys:

```bash
pnpm --filter @gms/api keygen
```

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set each secret with `wrangler secret put <NAME> --env production`, in `apps/api` and again in
`apps/jobs` for the names marked *both*. `apps/api/.dev.vars.example` lists every name.

| Secret | Worker | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | both | |
| `SUPABASE_ANON_KEY` | api | |
| `SUPABASE_JWT_SECRET` | api | Only for projects that sign sessions with the legacy HS256 secret. Current projects sign with an asymmetric key, which the API verifies from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` |
| `OAUTH_KID`, `OAUTH_SIGNING_KEY_JWK` | api | From `keygen`. Keep the printed public key for rotation |
| `JWKS_EXTRA_PUBLIC_KEYS` | api | Only during a key rotation (see the runbook) |
| `CREDENTIALS_ENCRYPTION_KEY` | both | Encrypts stored Passport client secrets, refresh tokens and connector tokens. Losing it strands every link |
| `WEBHOOK_SECRET_KEY` | both | Encrypts outbound webhook signing secrets |
| `PASSPORT_GMS_CLIENT_ID`, `PASSPORT_GMS_CLIENT_SECRET` | both | Step 5 |
| `PASSPORT_WEBHOOK_SECRET` | api | Step 5 |
| `RESEND_API_KEY`, `RESEND_FROM` | both | Step 4. `RESEND_FROM` like `Riverbend Grants <grants@mail.example.org>` |
| `RESEND_INBOUND_SECRET` | api | Step 4 |
| `ANTHROPIC_API_KEY` | api | Only with `ASSISTANT_ENABLED = "true"` |
| `PAYMENTS_FACILITATED` | api, jobs | Plain variable, default `"false"`. `"true"` turns on release through Passport; otherwise payments are recorded after being paid outside the GMS |
| `OPENGRANTS_API_KEY` | api | Optional |

Non-secret variables live in `[env.production.vars]`: `GMS_BASE_URL`, `WEB_BASE_URL`,
`OAUTH_ISSUER`, `PASSPORT_BASE_URL`, `PASSPORT_ISSUER`, `OPENGRANTS_MCP_URL`, `ASSISTANT_ENABLED`,
`ASSISTANT_MODEL`, `PASSPORT_AWARD_WRITE`, `RESEND_INBOUND_DOMAIN`, `OAUTH_DCR_REDIRECT_HOSTS`.

## 4. Resend

1. Add and verify a sending domain (SPF, DKIM, DMARC records). Set `RESEND_FROM` to an address on it.
2. Webhooks: add `https://<host>/webhooks/resend` for delivery events and inbound mail; put the
   signing secret in `RESEND_INBOUND_SECRET`.
3. Inbound: receive mail for a domain or subdomain (for example `reply.example.org`) and set
   `RESEND_INBOUND_DOMAIN` to it. Replies to thread notifications are addressed to
   `thread+<id>@<that domain>` and land back in the thread.

## 5. Passport

1. Register the GMS as an OAuth client at your Passport deployment, named "OpenGrants GMS", with
   the authorization-code + PKCE grant, scopes `org:read org.changes:read org.changes:write payee:read`, and
   the redirect URIs `https://<host>/gms/passport/consent/callback` (link an organization from
   inside the GMS) and `https://<host>/gms/passport/signin/callback` (Sign in with Passport). Put
   the id and secret in `PASSPORT_GMS_CLIENT_ID` / `PASSPORT_GMS_CLIENT_SECRET`.
   Sign in with Passport needs nothing else: it uses the same client, `CREDENTIALS_ENCRYPTION_KEY`
   and the Supabase service-role key, and it asks Passport for `openid email` on top of the scopes
   above (Passport grants identity scopes to any authorization-code client). `PASSPORT_ISSUER`
   must equal the `iss` of Passport's tokens when it differs from `PASSPORT_BASE_URL`. Without the
   client the button reports that Passport sign-in is not set up and email sign-in still works.
   Migration `0016` adds the service-role lookup the callback uses.
2. Subscribe to Passport webhooks at `https://<host>/webhooks/passport` and set
   `PASSPORT_WEBHOOK_SECRET` to the subscription's signing secret.
3. Each funder connects its own Passport client in Settings → Payments (client credentials with
   `org:read payee:read award:write disbursement:read disbursement:write`, created in Passport's
   funder console). Nothing to configure per funder on the server.
4. Set `PASSPORT_AWARD_WRITE = "true"` once your Passport serves the funder award routes
   (`POST /passport/funders/{orgId}/awards`). Until then awards are not mirrored and facilitated
   payments cannot run.

The GMS never stores bank or identity data and has no payment path outside Passport.

## 6. Deploy

```bash
pnpm spec:compile && pnpm --filter @gms/api build:openapi
```

```bash
pnpm --filter @gms/api exec wrangler deploy --env production
```

```bash
pnpm --filter @gms/jobs exec wrangler deploy --env production
```

Build the web app with your origins; the build writes `dist/_headers` with a Content-Security-Policy
limited to those origins:

```bash
VITE_USE_MOCKS=false VITE_API_BASE_URL=https://gms.example.org VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<anon key> VITE_PASSPORT_BASE_URL=https://passport.example.org pnpm --filter @gms/web build
```

```bash
pnpm --filter @gms/web exec wrangler deploy
```

Route the web Worker to your host with a custom domain in `apps/web/wrangler.jsonc`. The API
Worker's routes (`/gms/*`, `/common-grants/*`, `/oauth/*`, `/.well-known/*`, `/mcp*`,
`/webhooks/*`, `/llms.txt`, `/llms-full.txt`, `/openapi.json`, `/sitemap.xml`) take precedence on
the same host.

## 7. Check it

```bash
curl -s https://gms.example.org/health
```

`database` should read `configured`. Then:
`/.well-known/jwks.json` serves your key, `/.well-known/oauth-authorization-server` names your
issuer, `/llms.txt` lists the tools, and signing in at the web origin sends a code and asks for
TOTP enrollment. `docs/acceptance.md` is the full walk-through.

## Operator commands

```bash
node --experimental-transform-types scripts/create-api-client.ts --workspace <handle> --name "Board dashboard" --scopes applications:read,awards:read
```

```bash
node --experimental-transform-types scripts/gms.ts export --workspace <handle> --out ./export
```

```bash
node --experimental-transform-types scripts/gms.ts import ./export --workspace <handle>
```

All three need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment and are ledgered
as `system:cli`.

## Known limits

- Attachments are stored in R2 for every size. The Supabase Storage tier for files up to 25 MB is
  implemented (`@gms/documents`) but not wired into the Worker.
- Uploaded files are not virus-scanned (the scan hook is a stub).
- Google Workspace (Composio) has no production implementation; OpenGrants discovery tool names and
  the Mercury response envelope are unverified. See `docs/connectors.md`.
- Upgrades: pull, `pnpm install`, re-run the bootstrap script, redeploy the three Workers.
