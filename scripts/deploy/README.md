# The deploy tool

`pnpm gms deploy <step>` deploys and upgrades a complete GMS instance (Supabase and Cloudflare, and
optionally Resend) from a clone of this repository. It is built to be driven one step at a time by
an AI coding agent or a person: the agent supplies judgement, the tool does the mechanics the same
way every time. The result codes are in [CODES.md](CODES.md).

Each step looks at what really exists, does only what is missing, and says what it did in one JSON
line. If a step is interrupted, run it again.

## What you need

Node 22 or newer, pnpm, git, and a checkout of a tagged release (`git checkout vX.Y.Z`), after
`pnpm install`. Accounts: Supabase and Cloudflare (a domain on Cloudflare is optional; without one the
instance lives on `workers.dev`). Optional: Resend, and a Passport deployment.

Logins, read in this order and never printed:

- Cloudflare: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, otherwise `pnpm --filter @gms/api exec wrangler login`.
- Supabase: `SUPABASE_ACCESS_TOKEN` (a personal access token from the dashboard, Account, Access Tokens). `supabase login` usually keeps its token in the system keyring, which this tool cannot read; it only reads the `access-token` file the CLI writes when there is no keyring (`$SUPABASE_HOME` or `~/.supabase`).
- Resend (optional): `RESEND_API_KEY`.

## The steps, in order

The order matters: `cloudflare` comes before `auth` because, without a custom domain, the instance's `workers.dev` address (which Auth needs as its site address) is only known once `cloudflare` has run. Each step's `next` field follows this order.

Add `--dry-run` to any step to see what it would do. Steps that change something stop and ask first;
re-run with `--yes` once the person agrees.

```bash
pnpm -s gms deploy doctor
pnpm -s gms deploy init --name acme --host grants.example.org --email you@example.org
pnpm -s gms deploy supabase
pnpm -s gms deploy migrate
pnpm -s gms deploy cloudflare
pnpm -s gms deploy auth
pnpm -s gms deploy secrets --recovery-file ~/keys/acme-gms-recovery.env
pnpm -s gms deploy deploy
pnpm -s gms deploy verify
```

| Step | What it does |
|---|---|
| `doctor` | Checks the tools, the logins, the Cloudflare account, how many Supabase projects exist (the free plan allows 2) and whether this is a clean tagged release. Changes nothing. |
| `init` | Records your choices in `deploy/config.json`: name (prefixes every resource), domain or workers.dev, Supabase region, organization, operator email, Passport and Resend on or off. |
| `supabase` | Creates the project and waits until it is healthy, or adopts one with `--adopt <ref>`. The database password is used once and not kept. |
| `migrate` | Applies `supabase/migrations/*.sql` in order, each in its own transaction, recorded in `supabase_migrations.schema_migrations`. A migration already recorded there or in the older `gms_meta.schema_migrations` is not run again. Warns first if the database already holds tables the GMS did not create. |
| `cloudflare` | Creates the R2 buckets, queues (with the dead-letter queue) and KV namespace, named `<name>-…`, and writes `deploy/generated/api.toml` and `jobs.toml` from the checked-in `wrangler.toml` files. |
| `auth` | Email sign-in on, email confirmation required, TOTP on, site address and return addresses (`/auth/callback`, `/signin`) set, then read back. |
| `secrets` | Generates the signing key and the two encryption keys, sets every Worker secret over stdin, and writes the recovery file. Never overwrites a secret that is already set. To replace one, name it: `--rotate SUPABASE_SERVICE_ROLE_KEY` (the two encryption keys also need `--rotate-keys`). Rotation is staged in `<recovery-file>.new` and resumes if interrupted. |
| `deploy` | Builds and deploys the API and jobs Workers (the OpenAPI document goes to the exports bucket, so no static-asset upload is needed), builds the web app for your addresses, and deploys the single front Worker that serves the app and forwards API paths to the API Worker. |
| `email` | Optional. Adds a sending domain at Resend, its DNS records (in Cloudflare when the zone is in your account, otherwise it lists them), a send-only key, and the Worker and Supabase mail settings. |
| `passport` | Optional. Registers the deployed instance with Passport: serves a one-time check code at `/.well-known/opengrants-passport-challenge`, shows a short code and a link, waits (up to 15 minutes) while the person signs in to Passport, types the code and approves, then stores the client id, client secret and webhook secret as Worker secrets (never shown) and removes the check code. Run it where its output stays visible, or in the background and read its stderr. `skipped` when the Workers already hold the credentials; `--rotate` registers again. |
| `verify` | Checks `/health`, the signing key, the sign-in server, the app settings and the sign-in page, then sends a sign-in code to the operator email. |
| `upgrade --to vX.Y.Z` | From a clean checkout at that tag: shows the release notes from `CHANGELOG.md`, asks, then runs `migrate`, `deploy` and `verify`. |
| `status` | Version, addresses, resources, optional parts, the last verify. Changes nothing. |

## The recovery file

`secrets` needs `--recovery-file <path>`, an absolute path outside this repository (it refuses
paths inside it, symbolic links, and files this tool did not write). It holds `CREDENTIALS_ENCRYPTION_KEY`, `WEBHOOK_SECRET_KEY`, `OAUTH_KID` and
`OAUTH_SIGNING_KEY_JWK`, mode 0600. Keep it in a password manager. If the two encryption keys are
lost, every stored Passport link, connected-app token and webhook secret becomes unreadable and has
to be set up again.

## Files the tool writes

All under `deploy/`, which git ignores. None holds a secret.

- `config.json`: your choices.
- `state.json`: project ref and URLs, resource names and ids, worker names, applied version, last verify.
- `generated/api.toml`, `generated/jobs.toml`: Wrangler configs for your instance.

## Doing a step by hand

Each step is a small, ordinary set of commands; `docs/self-host.md` describes them. The equivalents:

- `supabase`: create a project in the Supabase dashboard (or `POST https://api.supabase.com/v1/projects`).
- `migrate`: `node scripts/bootstrap-supabase.ts --db-url "<connection string>"`. It records in `gms_meta.schema_migrations`; `pnpm gms deploy migrate` honours that table, so you can switch between them.
- `auth`: Authentication settings in the Supabase dashboard (self-host.md section 1, items 3 to 5).
- `cloudflare`: `wrangler r2 bucket create`, `wrangler queues create`, `wrangler kv namespace create`, then edit `[env.production]` (section 2).
- `secrets`: `pnpm --filter @gms/api keygen`, then `wrangler secret put <NAME>` per Worker (section 3).
- `deploy`: section 6, or after `pnpm gms deploy cloudflare` use the generated configs:
  `pnpm --filter @gms/api exec wrangler deploy --config deploy/generated/api.toml`.
- `verify`: `curl https://<host>/health`, `/.well-known/jwks.json`, `/.well-known/oauth-authorization-server`.

## Limits

- Node 22.18 or newer runs the `.ts` files directly; on an older 22.x use `node --experimental-strip-types scripts/deploy/cli.ts deploy <step>`.
- `workers.dev` addresses need the account's workers.dev subdomain: the tool reads it with `CLOUDFLARE_API_TOKEN`, or pass `init --workers-subdomain <name>`.
- A custom domain must be a zone in the same Cloudflare account. Set `CLOUDFLARE_API_TOKEN` so `deploy` can check what already uses the domain; without it, or if something does, `deploy` needs `--replace-dns`.
- Project and organization names: `--org` takes the organization's slug (an id is translated).
- The Workers Free plan allows 5 cron triggers and a small script size; this instance needs the Workers Paid plan.
- The web build points at `passport.opengrants.io` even with Passport off (the app has no setting to turn that off).
