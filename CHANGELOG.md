# Changelog

Each release has a section headed `## vX.Y.Z`. The deploy tool shows the matching section before an
upgrade, and the release workflow uses it as the GitHub Release notes.

## v1.2.0

### Added

- Give an award directly: a funder admin or program officer can offer an award to an organization that has not applied, by its name and a contact email (Awards, then New award; `POST /gms/awards/direct`). The contact gets an email with a link; they sign in with that same address (no Passport needed), choose or set up their organization's workspace, and accept or decline. Accepting attaches the award to that workspace and shares the organization's record with the funder; from there the award follows the usual steps (agreement, payment schedule, reports). Nothing is ever matched by an organization's name or EIN.
- The funder's admins, program officers and finance members can resend the invitation (a new link, optionally to a new address) and sees where it stands on the award: sent, accepted, declined, expired or withdrawn. Withdrawing the award (cancel) also ends the link. Invitations, new or resent, are limited in any 24 hours to 25 per funder workspace (10 for a funder not verified with OpenGrants Passport), 25 per person across their workspaces, 50 per network address and 500 for the whole service, and to 3 per invited address in any 7 days across all funders. The email names a funder linked to Passport by its Passport legal name and says when the funder is not verified with OpenGrants Passport (linked at L1 or above). The funder's message, the organization name, the title and a decline reason are plain text without web or email addresses, and a funder whose own name reads as one is asked to rename its workspace.
- Agents: `create_direct_award` always waits for a person's approval. No agent can accept or decline an award for an organization.

### Changed

- API: an award's `recipient` can have `workspaceId: null` (and null `verification`) while a direct award waits to be accepted, and carries `recipient.invitation` for direct awards. Such an award is not in `/common-grants/awards` until it is accepted. New routes: `POST /gms/awards/direct`, `POST /gms/awards/{id}/invitation/resend`, and `POST /gms/award-invitations/lookup`, `/accept` and `/decline`.

### Upgrade notes

- One database migration, `0028_direct_awards.sql`: two new tables for the service role only (`award_invitations`, `award_invitation_sends`, which keeps only a digest of each invited address), four functions only the service role may run and one internal helper they use, the consent basis `award`, and the new table in the same-workspace rules. No existing row changes. Outbound mail (`RESEND_API_KEY`, `RESEND_FROM`) must be configured to give awards directly; without it the route answers 503 and creates nothing.
## v1.1.0

A clearer front door: the landing page and sign-up now say plainly that funders and grantees can
sign up with an email address and use the GMS without OpenGrants Passport.

### Changed

- The landing page is rebuilt on the design system. It leads with email sign-up, has equal start
  buttons for funders and for grantees and applicants, a table of what works without Passport, a
  short "What Passport adds" card (shown only when the instance offers Passport), a self-host section
  pointing to `DEPLOY_WITH_AGENT.md`, and a short FAQ.
- On phones the header keeps Sign in visible and puts the section links behind a Menu button.
- Sign-in carries the choice from the landing page (`/signin?as=funder` or `?as=grantee`) straight to
  the right setup instead of asking again, and tells admins before the code step that they will add an
  authenticator app.
- Applicant setup accepts `start=email` (open the email-only setup first), `name=` (pre-fill the
  organization's name) and `next=` (a same-origin page to return to afterwards).
- Shared links now show a title, description and preview image (`/brand/og-preview.png`).

### Upgrade notes

- No database migrations and no setting changes. `pnpm -s gms deploy upgrade --to v1.1.0` redeploys
  the Workers and the web app.

## v1.0.1

Fixes from an independent review of v1.0.0 and from trial deployments.

### Fixed

- Imported awards attach only to organizations already connected to the funder: one that applied to it, shares its record with it, or holds an award the funder made in the GMS. Any other row of an award import keeps the recipient's name without linking a workspace, and the dry run reports it the same way as a name that matches nothing.
- The grantee directory and the payment views (the tranche list, readiness checks, payment alerts, award details and the matching MCP tools) show an organization's Passport details (its Passport id, legal name, level and payee status, including bank name and last four digits, and holds caused by them) only while the organization shares its record with the funder, the same rule that already applied to sending it email. Otherwise they show "Not shared", and the organization cannot be paid through Passport from that funder until it shares its record again. Passport's alerts and holds about an organization reach only the funders it shares its record with; an alert about a payment reaches only the funder that made it. A new award is recorded at Passport only for an organization that shares its record with the funder.
- Report reminders, whether sent by hand or on the reminder plan, go only to organizations that share their record with the funder. A person can send at most one reminder by hand per requirement every 24 hours.
- Automatic reviewer conflict checks compare email domains only with an organization's Passport record. A domain in a self-declared profile is shown to staff as something to check; it never skips or assigns a reviewer.
- Deploy tool: `deploy` deploys the same version again when `init` changed a choice that shapes the build (Passport on or off, for example) and refreshes the generated Worker configs to match, instead of answering `skipped`. A new name or address goes through `cloudflare` first.
- Deploy tool: when a host cannot be reached, `verify` reports a failed check that names the host instead of stopping with "fetch failed".
- Deploy tool docs: read the last stdout line that starts with `{`. When a step does not succeed, `pnpm` prints its own `[ELIFECYCLE]` line after the result. Exit codes are unchanged.

### Changed

- API: in `GET /gms/grantees` and `GET /gms/grantees/{id}`, `payee` and `payeeStatus` may be null, and `legalName`, `passportOrgId` and the verification level are null while an organization does not share its record. In `GET /gms/tranches` the recipient's `pendingDestinationChange` may be null, a hold caused by a payee fact reads `held_at_passport`, and `GET /gms/payments/alerts` can return a `record_not_shared` alert. `POST /gms/requirements/{id}/remind` can answer 409 `not_shared` and 429 `reminder_sent_recently`. Auto-assigning reviewers returns `coiHints`, and creating an assignment returns `coiHint`.

### Upgrade notes

- No database migrations and no new settings or secrets. Run `pnpm -s gms deploy upgrade --to v1.0.1` from a clean checkout of the tag.
- Links made by earlier award imports stay as they are, but such an award no longer counts as a connection when matching future imports. A grantee whose only link to the funder is an imported award, or that has withdrawn its consent, now shows "Not shared", gets no report reminders and cannot be paid through Passport until it applies or shares its record again.
- An operator who wants to review those earlier links can list awards marked imported whose recipient has no submitted application to, and no live consent with, the funder that imported them:

  ```sql
  select a.id, a.workspace_id as funder, a.recipient_workspace_id as recipient, a.title, a.status, a.created_at
    from public.awards a
   where 'imported' = any (a.conditions)
     and a.recipient_workspace_id is not null
     and not exists (select 1 from public.applications p where p.workspace_id = a.workspace_id and p.applicant_workspace_id = a.recipient_workspace_id and p.submitted_at is not null)
     and not exists (select 1 from public.consents c where c.funder_workspace_id = a.workspace_id and c.applicant_workspace_id = a.recipient_workspace_id and c.revoked_at is null)
   order by a.workspace_id, a.created_at;
  ```

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
