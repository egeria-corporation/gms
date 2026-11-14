# Changelog

Each release has a section headed `## vX.Y.Z`. The deploy tool shows the matching section before an
upgrade, and the release workflow uses it as the GitHub Release notes.

## v1.6.0

### Write faster as a team

- The assistant drafts an answer to a funder's question from your own answer library and your
  organization's profile, and nothing else. It never makes up facts: what it does not know is left
  as [placeholders], it keeps to the word or character limit, and it flags any figure taken from an
  answer nobody has checked in a year. Nothing is saved until you accept it,
  and each application shows which answers the assistant helped write.
- The assistant can read a funder's guidelines, pasted or uploaded as a PDF or text file, and
  propose the questions, their limits and phase, the deadlines and the documents to attach, for you
  to review. It reads only guidelines you give it, never your own documents.
- The hosted site turns the assistant on with 100 uses per workspace per month; self-hosters set
  `ASSISTANT_MONTHLY_QUOTA` (default 40) and their own `ANTHROPIC_API_KEY`.
- The answer library keeps when each answer was last checked ("Mark as verified", and a stale badge
  after 12 months), short, medium and long versions, and tags. Inserting from the library offers the
  version that best fits the question's limit.
- A document vault for your organization's standing documents (IRS letter, audit, financials, board
  list, budget, annual report, logo), with expiry dates and a warning 30 days before. It never keeps
  bank letters, voided checks, ACH forms or anything with a Social Security number, and refuses
  files named like them. An application's checklist lists the documents the funder asks for and
  offers the matching ones from the vault.
- An optional go/no-go scorecard for the Deciding stage, switched on in Settings.
- Only a workspace admin or the application's owner approves an answer. Comments per question, a
  month calendar of deadlines, and milestone tasks offered when a full deadline is set.

### Win and keep it

- Awarded funding lists your outside awards next to awards made on this GMS, each labelled
  "Outside award" or "On this GMS". An outside award has its own page: the amount per
  year, the grant period, the award letter, what you owe the funder, and payments received.
- Obligations of an outside award: reports, expected payments, payments received and conditions,
  once or repeating every few months until the grant ends (up to 60). Changing a repeating
  obligation updates only future ones you have not touched.
- Reports are written in the same editor as applications, can reuse text from an earlier report,
  and are marked submitted with the date, the confirmation and a PDF of what was sent.
- Payments received are amounts and dates only, with the total received against the amount awarded.
  No money moves through the GMS and no bank details are kept.
- Reminders before and after a report or condition is due, and "Close out this award" once
  everything is done or received.
- When a funder declines, a reminder on the date its next round may open, and "Get an alert when it
  reopens".
- A funding summary by fiscal year: applications submitted, decided, awarded and declined, the win
  rate and the amounts asked and awarded, with a CSV export and a one-page PDF for your board. Set
  the month your fiscal year starts in Settings.

### Both

- Agents get the same capabilities through MCP. Drafts never save anything, and recording a
  report's submission always waits for a person.
- Everything here is the applicant organization's own record, visible only to its own team.

### Upgrade notes

- **Database migration `0030_write_and_keep.sql`.** Run it before deploying the API. It adds
  columns, all empty or defaulted, to answers (last checked, versions, tags), documents (type and
  expiry), outside applications (required documents, go/no-go, closeout) and outside questions (the
  report they belong to); widens three checks (answer provenance, assistant uses, comment threads);
  and adds two tables for the obligations of outside awards and their repeating series, with
  row-level security keeping them to the applicant workspace's own members. It changes, removes and
  copies no existing row, and needs no backfill.
- New optional setting `ASSISTANT_MONTHLY_QUOTA` (API Worker): assistant uses per workspace per
  month, default 40. The hosted site sets `ASSISTANT_ENABLED = "true"` and
  `ASSISTANT_MONTHLY_QUOTA = "100"`. The assistant stays off without `ANTHROPIC_API_KEY`, and the
  screens then hide its actions.
- The jobs Worker runs a new daily job at 14:35 UTC (`keep-reminders`) on the existing cron:
  document expiry warnings, obligation reminders and next-cycle reminders. They need outbound mail
  (`RESEND_API_KEY`, `RESEND_FROM`). New notification settings, on by default: "Documents
  expiring", "Grant reports and conditions" and "Next cycle" (categories `document_expiring`,
  `outside_obligation_due`, `outside_next_cycle`).
- The document vault, uploaded guidelines and the PDF kept when a report is marked submitted use the
  `ATTACHMENTS` file storage binding.

## v1.5.0

### Added

- **Apply anywhere.** An applicant organization can start, write, record and track an application to
  any funder, not only funders on this GMS. Outside applications are the organization's own records,
  visible only to its own team: never to funders on this GMS, never sent to Passport, never in
  CommonGrants output or funder analytics. The GMS never submits anything for you; it records what
  you submitted elsewhere, with a PDF of your answers as submitted.
- One pipeline of every application (on this GMS and outside it) and saved opportunity, with stages
  from prospect to awarded, deadlines, the ask and an owner.
- Questions pasted from a funder's guidelines are split into questions with their word or character
  limits. Answers keep every version, show words, characters and characters without spaces, and can
  come from the answer library. Export as text, Markdown or PDF.
- A light record per funder: contacts, notes, its portal and who holds the login, and past asks.
- A private calendar link with every deadline, for any calendar app. It is shown once and can be
  replaced or turned off.
- Deadline reminders by email 14, 7 and 2 days before and on the day, and upcoming deadlines in the
  weekly digest. The notification setting is "Application deadlines".
- CSV import (with a preview) and CSV or JSON export of outside applications.
- "Get help writing this": a request to OpenGrants consulting, showing exactly what will be sent.
- Find funding also shows opportunities on this GMS that are not taking applications yet, can open
  one OpenGrants listing's details, and saving an OpenGrants listing starts tracking it as a prospect.
- Agents get the same capabilities through MCP; recording a submission or a decision always waits
  for a person.

### Upgrade notes

- **Database migration `0029_outside_applications.sql`.** It adds six tables (funder records, outside
  applications, their questions and answer versions, calendar feeds, consulting requests), each with
  row-level security, and triggers that keep them in applicant workspaces and in the same workspace
  as what they point at. It changes no existing row. **It adds rows:** every listing an applicant
  saved from OpenGrants is copied into a prospect (with one ledger entry each); saved rows stay as
  they are, and GMS and alert rows are not copied. Running the copy again adds nothing.
- New optional setting `CONSULTING_REQUEST_TO` (API Worker): where consulting requests go. Unset,
  they go to hello@agents.opengrants.io. Requests need outbound mail (`RESEND_API_KEY`, `RESEND_FROM`).
- The jobs Worker runs a new daily job at 14:30 UTC (`outside-deadlines`) on the existing cron.
- Recording a submission keeps a PDF copy, so it needs the `ATTACHMENTS` file storage binding.

## v1.4.0

### Added

- An **Applications** step in the opportunity builder, after Publish. It shows the launch checklist
  (stage, published form, dates, rubric, eligibility rules, CommonGrants) with a link to fix each
  item that fails, and an **Open for applications** button that opens the competition only when
  every item passes, exactly as the Competition screen does.
- **Quick setup**, one button on that step. It makes, as drafts you can edit: a one-stage
  competition using the opportunity's opening and closing dates; a starter application form
  (project title, summary, amount requested, how the funds will be used, expected outcomes, a
  budget upload and a contact), published and pinned to the stage; and a starter rubric (alignment
  with the opportunity, feasibility, budget and community impact, each scored 1 to 5). It keeps
  anything already set, and running it again reuses what it made. The same action is
  `POST /gms/opportunities/{id}/quick-setup` and the MCP tool `quick_setup_competition`; both need
  `competitions:write`, `forms:write` and `reviews:write`, and a workspace that requires approval
  for creating competitions or forms, pinning forms or setting rubrics holds quick setup too.

### Changed

- The public opportunity page shows **Apply** only while a competition is open. Otherwise it says
  "Not taking applications yet", and a signed-in applicant can **Save** the opportunity to Find
  funding.
- An opportunity that is published but has no open competition shows "Published, not taking
  applications" in the Opportunities list and the builder header, with a link to set up
  applications, and the Dashboard lists it as a task.

### Fixed

- The opportunity builder no longer ticks a step the funder has not opened (for example "Who can
  apply", whose 501(c)(3) default is valid). Every step of an opportunity saved before counts as
  visited.

### Upgrade notes

- No database migrations and no setting changes. Opportunities already published without a
  competition now say so; open the Applications step and use Quick setup to start taking
  applications.

## v1.3.2

### Fixed

- Switching a human gate on or off (Settings, Human gates) no longer makes the list flash to
  "Loading gates" and the switch move late. The switch flips at once, stays disabled while the
  change saves, and goes back with a message naming the gate if the save fails. Elsewhere, a list
  that refreshes after a change keeps showing what it had until the new data arrives, instead of
  going blank.
- Authenticator apps now name the two-step verification entry "OpenGrants".
- In the applicant workspace, "My grants" is now "Awarded funding" (menu, page title and heading,
  breadcrumbs, the reports page and the line under an accepted decision), and the phone tab says
  "Awards". The address is still `/grants`.
- Creating a funding alert failed: the app asked OpenGrants first, which does not take alerts and
  answered "not available". Alerts are now kept by the GMS's own alerts service
  (`/gms/discover/alerts`), and OpenGrants is not asked.
- The landing page no longer says "No Passport account needed." or "No Passport required". Where
  the server can link Passport, it presents OpenGrants Passport as an optional add-on: a free,
  verified profile for your organization that you set up once and share with the funders you
  choose. Signing up with an email is unchanged.

### Upgrade notes

- None. No database migrations and no setting changes.

## v1.3.1

### Fixed

- With Userback switched on, its Feedback button sat at the bottom of the page instead of the
  corner: the widget positions it with inline `<style>` elements, which the Content-Security-Policy
  refused. When `VITE_USERBACK_TOKEN` is set, `style-src` now also allows `'unsafe-inline'`. Scripts
  stay strict, and nothing changes when the token is unset.

### Upgrade notes

- No database migrations and no setting changes.

## v1.3.0

### Added

- An optional feedback button for testers, powered by Userback. It is off unless the web build has
  `VITE_USERBACK_TOKEN` (Userback's public access token); with it unset, which is the default and
  the case in demo mode, nothing loads and the Content-Security-Policy is unchanged. When it is on,
  the app tells Userback only the person's id, name and email. Two-step verification (QR code, setup
  key, code boxes), one-time secrets (API, agent and webhook secrets, the Passport client secret),
  bank name, last four digits and pending destination changes are marked so Userback leaves them out
  of screenshots and recordings, and sign-in code boxes are not recorded. The landing page says so
  in its answer to "Who can see my organization's information?", only when the button is on.

### Upgrade notes

- No database migrations.
- Optional build-time setting `VITE_USERBACK_TOKEN`. Self-hosters leave it unset.

## v1.2.2

### Fixed

- The two-step verification screen no longer flashes "Open your authenticator app for the current
  code" to a new admin while it is still preparing the set-up (QR code). Until it knows whether the
  person already has an authenticator, it says "Getting your second step ready…" and shows no code
  box.

### Upgrade notes

- No database migrations and no setting changes.

## v1.2.1

### Fixed

- A new funder could not finish setup: after creating the workspace, saving the brand (or inviting
  the team, or creating the first program) failed with "This role requires two-step verification".
  The person signed in with an email code before they had a workspace, so sign-in never asked for
  the second step, and the setup pages did not send them to it. Setup now takes a new admin through
  setting up an authenticator app right after the workspace is created and returns to the brand
  step; any setup page reached without the second step sends the person to it; and a refused save
  shows "Set up two-step verification to continue" with a link instead of a dead end. Sign-in now
  shows the second step whenever a page asks for it (`step=mfa`), even before the list of the
  person's workspaces has caught up.

### Upgrade notes

- No database migrations and no setting changes.

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
