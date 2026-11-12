# Changelog

Each release has a section headed `## vX.Y.Z`. The deploy tool shows the matching section before an
upgrade, and the release workflow uses it as the GitHub Release notes.

## v1.0.1

Fixes from an independent review of v1.0.0 and from trial deployments.

### Fixed

- Imported awards attach only to organizations already connected to the funder: one that applied to it, shares its record with it, or holds an award the funder made in the GMS. Any other row of an award import keeps the recipient's name without linking a workspace, and the dry run reports it the same way as a name that matches nothing.
- The grantee directory shows an organization's Passport details (its Passport id, legal name, level and payee status, including bank name and last four digits) only while the organization shares its record with the funder, the same rule that already applied to sending it email. Otherwise it shows "Not shared".
- Report reminders, whether sent by hand or on the reminder plan, go only to organizations that share their record with the funder. A person can send at most one reminder by hand per requirement every 24 hours.
- Automatic reviewer conflict checks compare email domains only with an organization's Passport record. A domain in a self-declared profile is shown to staff as something to check; it never skips or assigns a reviewer.
- Deploy tool: `deploy` deploys the same version again when `init` changed a choice that shapes the build (Passport on or off, for example) and refreshes the generated Worker configs to match, instead of answering `skipped`. A new name or address goes through `cloudflare` first.
- Deploy tool: when a host cannot be reached, `verify` reports a failed check that names the host instead of stopping with "fetch failed".
- Deploy tool docs: read the last stdout line that starts with `{`. When a step does not succeed, `pnpm` prints its own `[ELIFECYCLE]` line after the result. Exit codes are unchanged.

### Changed

- API: in `GET /gms/grantees` and `GET /gms/grantees/{id}`, `payee` and `payeeStatus` may be null, and `legalName`, `passportOrgId` and the verification level are null while an organization does not share its record. `POST /gms/requirements/{id}/remind` can answer 409 `not_shared` and 429 `reminder_sent_recently`. Auto-assigning reviewers returns `coiHints`, and creating an assignment returns `coiHint`.

### Upgrade notes

- No database migrations and no new settings or secrets. Run `pnpm -s gms deploy upgrade --to v1.0.1` from a clean checkout of the tag.
- Links made by earlier award imports stay as they are, but such an award no longer counts as a connection when matching future imports. A grantee whose only link to the funder is an imported award, or that has withdrawn its consent, now shows "Not shared" and gets no report reminders until it applies or shares its record again.

## v1.0.0

The first release that can be deployed by a person or an AI coding agent without help from the
maintainers.

### Added

- `pnpm gms deploy <step>`: a deploy tool that creates and upgrades a complete instance on the person's own Supabase and Cloudflare accounts (and optionally Resend), one step at a time, each step idempotent, each run ending in one JSON result line. See `scripts/deploy/README.md`.
- `DEPLOY_WITH_AGENT.md`, `AGENTS.md` and the `/deploy-gms` skill for Claude Code: the runbook an agent follows, with the questions to ask, the points to stop and confirm, and the security rules.
- The `passport` step registers a self-hosted instance with OpenGrants Passport without pasting a secret: the tool shows a short code and a link, the person approves in Passport, and the credentials go straight into Worker secrets.
- The API Worker serves `/.well-known/opengrants-passport-challenge` from the optional secret `PASSPORT_REGISTRATION_CHALLENGE`, which the tool sets only while a registration is being approved. It answers 404 when the secret is not set.
- A rewritten `README.md` and a release workflow that tags and publishes each version.
- The GMS can be used without Passport. A workspace that has not linked Passport keeps a self-declared profile (name, website, mission, address, contact address, type and EIN), always labelled "Not verified" and never presented as a verified organization; linking Passport replaces it with the Passport record. Passport stays required for verification levels, organization change requests and payments through Passport. `init --passport off` sets up an instance without it.
- Per-opportunity options `requirePassport` (applicants must connect Passport before starting) and `acceptSelfReported` (eligibility may pass on what an applicant without Passport entered itself; otherwise it needs review).
- Daily limits on creating workspaces: five per account and twenty per network address, counted in the database.
- `GET /gms/config` reports `passport: { signIn, linking, payments }`, so the web app offers only what the instance has.
- Migrations `0026_self_declared_profile.sql` (the self-declared profile and `profile_source`) and `0027_workspace_creation_counts.sql` (the workspace creation counts).

### Upgrade notes

- An instance set up by hand (v0.9.0) is first brought under the tool: check out `v1.0.0`, run `init` with the same name and addresses, then `supabase --adopt <ref>` and `cloudflare --adopt-existing` so the tool recognises what exists, then `secrets` (it never overwrites a secret already set; it needs `--recovery-file`).
- Then `pnpm -s gms deploy upgrade --to v1.0.0` (or apply the migrations and redeploy by hand as in `docs/self-host.md`). `upgrade` applies this release's two migrations before it deploys: `0026_self_declared_profile.sql` adds `workspaces.profile_source` and `workspaces.self_declared_profile`, backfills every existing Passport-linked workspace to `profile_source = 'passport'` (the rest to `'none'`), and clears Passport data left on a workspace that has no Passport organization id (each cleared row is written to the ledger); `0027_workspace_creation_counts.sql` adds the table and functions behind the workspace creation limits. No settings change. The new secret `PASSPORT_REGISTRATION_CHALLENGE` is optional and normally absent.

## v0.9.0

The state of the code before the deploy tool: the full GMS (funder and applicant workspaces,
reviews, decisions, awards, payments through Passport, the CommonGrants and MCP interfaces) with
manual self-hosting described in `docs/self-host.md`.

### Upgrade notes

- This is the baseline. Apply `supabase/migrations/*.sql` in order and deploy the Workers as `docs/self-host.md` describes.
