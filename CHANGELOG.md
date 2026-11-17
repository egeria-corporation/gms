# Changelog

Each release has a section headed `## vX.Y.Z`. The deploy tool shows the matching section before an
upgrade, and the release workflow uses it as the GitHub Release notes.

## v1.11.0 — 2026-11-16

### Added

- **Español (beta).** The whole app can be used in Spanish: the public pages, sign-in, the applicant
  and funder screens, the reviewer portal, the form, report and email builders, emails, the fixed
  text of generated documents, share cards, and error messages. The language switcher in every
  public page's footer, the sign-in page, the account menu and the phone menu offers "English" and
  "Español (beta)". The Spanish is neutral Latin American Spanish with "usted", written against one
  glossary (`docs/i18n.md`).
  **A native speaker's review is welcome:** `docs/i18n.md` says how to find a message and propose a
  better wording.
- A signed-in person's language is saved with their account (`PUT /gms/me/preferences`, migration
  0043). Without an account, the page follows `?lang=`, then the `gms_lang` cookie, then the
  browser's language. `<html lang>` follows the language, and public pages carry `hreflang`
  alternates and Spanish page meta for `?lang=es`.
- Emails go in each recipient's language, the daily and weekly digests included; a funder's own
  edited templates are sent exactly as written. The board docket and the send-to-funder package
  print their fixed labels in the requester's language.
- Things the API words in English are shown in the reader's language: eligibility explanations
  (a rule result's new `because` field says why it reads as it does), readiness checks, fiscal
  years, notification titles (`titleLocalized` beside `title`), report CSV header rows (the
  server writes them in the requester's language, scheduled files included), and the names an
  anonymized reviewer sees (`[solicitante]`, `Solicitante A-1042`).
- Errors on `/gms/` routes carry `detailLocalized` in Spanish for every code a person can meet (279
  codes and 70 kinds of missing record); `code` and the English `message` never change, and the
  CommonGrants routes, OAuth and MCP stay English.
- Dates read "15 de noviembre de 2026" in Spanish; money and numbers use the page's language.

### Changed

- Each area's messages (`public`, `shared`, `applicant`, `funder`) are a download of their own,
  loaded only with that area's screens. Against v1.10.0 the first page grows by 22.6 KB gzipped and
  everything an English visitor can download by 47.3 KB, most of it the text that moved out of the
  screens into the catalogs. Nothing Spanish is downloaded in English.
- The API and jobs Workers carry only the email and error messages (5,900 KiB and 3,106 KiB before
  compression; 1,264 KiB and 667 KiB gzipped), and the front Worker only the messages its pages' meta
  and share cards use (8,437 KiB; 3,013 KiB gzipped, with the web app it serves).
- Small English wording fixes: "Program officer" capitalised in role lists; "In flight" (was
  "InFlight"); counts that can be one are proper plurals ("1 record change", "in 1 day", "Over the
  limit by 1 character"); a readiness check spells out when the Passport record was last read
  ("Nov 14, 2026").

### Fixed

- The Feedback button on the hosted site (Userback's widget) failed colour contrast on every page: white
  on light blue, 2.54:1. It now uses the theme's dark teal with white text (8.7:1). Found by running
  axe against the live site after the v1.10.0 deploy; the mock-mode checks don't load the widget.

- A screen that mounted while its messages were still loading could trip React's hook check when
  it was replayed (React error 467, recovered by re-rendering the whole page). It showed as a rare
  page error on dialogs such as "Sign the grant agreement" and the gallery share dialog.
- End-to-end flows looked up a banner's words across the whole page, which raced the screen
  reader's copy of the same words; they now look only at the page's own text. The end-to-end
  server's port comes from `E2E_PORT`, and a run stops if that port serves another build.

### Known English text

- Content people write stays in the language it was written in: a funder's opportunities, forms,
  rules and emails; an applicant's answers; demo data in mock mode.
- The sentence the eligibility editor writes as a new rule's label (`lib/rules.ts`) is English, and
  is stored with the rule as the funder's own words.
- Agreements and award letters stay English: their bytes are re-rendered to check stored hashes.
- Server-written report preview warnings, the open-data feed's reasons, and in-app notification
  titles for an event the catalog does not name are English. MCP tool descriptions and the
  CommonGrants and REST field names are English by design.
- Eight error codes only an API client can meet (token checks, the OAuth authorize endpoint, the
  OpenAPI document, the social-posting `Idempotency-Key` header, two payload checks) keep their
  English message.

### Upgrade notes

- **Run migration `0043_user_preferences.sql` before deploying the API.** It adds one table
  (`user_preferences`) and changes no existing row; a person without a row keeps today's behaviour.
- No new settings or secrets.
- Deploy the API and jobs Workers, then rebuild and deploy the web app, then the front Worker with
  `--redirect-from`, as in `docs/staging.md`.

## v1.10.0 — 2026-11-16

### Added

- **Accessibility conformance report.** `docs/accessibility.md` reports conformance with WCAG 2.2
  level A and AA in the VPAT 2.5 format, criterion by criterion. It covers the web app, public
  pages, the apply widget, emails and the PDFs the GMS makes, and says plainly what is still partial.
  It is linked from the README and the landing page footer.
- Every route and dialog is checked with axe at desktop and phone width in the end-to-end suite, for
  each kind of person who can reach it. A new route without a check fails the suite.

### Fixed

- 75 accessibility issues across the app, each with a regression test:
  - a skip link on every page;
  - focus rings and form-control outlines with at least 3:1 contrast;
  - focus never hidden behind sticky parts;
  - nothing scrolls sideways at 320 px;
  - required state, help and errors tied to every form field;
  - status banners and import progress announced to screen readers;
  - dialogs that keep focus inside, close on Escape and return focus to the button that opened them;
  - link text that says where a link goes.
- Emails are sent as documents with their language. The board docket and the send-to-funder package
  PDFs carry their language and show their title.

### Still partial (see `docs/accessibility.md`)

- The PDFs are not tagged, because the PDF library cannot write tags. Each has a text equivalent: the
  docket's panel screen, and `answers.txt` in the send package.
- Award letters, agreements and their snapshots carry no PDF language, so that signed documents
  still re-render byte for byte for their hash checks.
- Not yet tested with screen readers or other assistive technology, and only in Chromium.

### Upgrade notes

- No database migrations, settings or secrets.
- Rebuild and deploy the web app, then the front Worker with `--redirect-from`, as in
  `docs/staging.md`.

## v1.9.0 — 2026-11-16

### Added

- **Grants-awarded pages**: a funder can list the grants it awards at `/f/{handle}/awards`, by year
  and program, each award on its own page with a share card ("{Funder} awarded {Recipient} a grant")
  and schema.org data. Off until the funder turns on "List awards on my public page" in Settings ›
  Public page; the funder can also hide amounts. The funder page's nav links to "Grants awarded".
- **Confidential awards**: the funder keeps any award confidential, and can make new awards in a
  program start confidential. A confidential award never appears on a public page, card, badge, the
  sitemap, a share kit, a social post or open data. Grantees can choose "Don't list us publicly".
- **Share this award**, on the funder's award screen and the grantee's grant screen: why an award is
  or is not public, three ready-to-edit posts, the award page link, the card image and a "Funded by"
  badge (`/badge/{slug}.svg`, verified only for a funder linked to OpenGrants Passport).
- **Social posting through Zernio**: funders announce open calls and awards on their own LinkedIn,
  Facebook, Instagram, X, Bluesky and Threads accounts, and grantees share their award. The composer
  starts from the call or the award, shows each platform's length limit and the exact post before
  anything goes out; only a person's click on Post sends it, now or at a scheduled time. Settings ›
  Social accounts connects and disconnects accounts (admins). Hidden unless the server has Zernio.
- A reach report on each call and award: each post's status and link per platform, Zernio's
  impressions, clicks and engagements, and the applications started from a shared link.
- **Funds**: one funder workspace runs many funds, each with its own name, public address, short
  description, colour from the theme palette, budget per fiscal year (beside its programs' budgets)
  and advisors. Settings → Funds; a fund switcher narrows the dashboard, programs and awards. Public
  fund pages at `/f/{handle}/{fundSlug}`; the funder page groups open calls by fund and an
  opportunity page names its fund.
- **"Advisor for {fund}"**: a program officer or reviewer who sees and acts only on one fund's
  programs and everything under them, on every screen, API route, MCP tool, report, digest and
  export.
- A **Fund** column in every report data set (organizations list their funds).
- **Send to the funder**, on an outside application: download a clean package (a PDF with a cover,
  every question and answer in order, the budget summary and the list of files; a ZIP with that PDF,
  the files and `answers.txt`), or email it to a funder contact under your name with replies to you,
  after a preview of exactly what goes out. Only this application's files and the vault documents
  used for its checklist are included; an answer that looks like a bank, card or identity number
  stops the package and names the question. Up to five emails a day per application and 20 MB of
  files per email (larger: download it instead). The footer follows the workspace's Powered by
  setting.
- **Guest reviewers**: an external reviewer who accepts an invitation lands on a one-screen welcome
  (funder, competition, how many applications, due date, the conflict-of-interest steps, Start
  reviewing). After their last review a done screen thanks them and offers once to run a review
  panel for their own organization.
- **Opt-in Monday digests**, each off until the person turns it on, per workspace: New matches (up
  to 10 new opportunities from OpenGrants and from funders here, never one already sent, saved or
  applied to), Deadlines (the next 3 weeks) and, for funder staff, This week's activity (counts and
  links only, never applicants' answers). "What we email you" in Notifications → Digest settings,
  a one-time prompt on Find funding and the funder dashboard, one-click unsubscribe with
  List-Unsubscribe headers, plain text and HTML with no tracking.
- **Moving from another grants system**: funders bring their grant history from Good Grants,
  SurveyMonkey Apply, Submittable, Foundant GLM, SmartSimple or OpenWater: choose the system, see how
  to export from it, drop in the export (CSV, Excel, or OpenWater's JSON) and the columns are matched
  for you. Each system's export format is recognised loosely; you confirm each field. A plain file
  from one of these systems is recognised too, and applications the export marks as never awarded
  are set aside with the reason.
- Read grant history straight from **Fluxx** (an application you create in your Fluxx instance) or
  **Zengine** (an access token), read-only, up to 5,000 records a run, continuing where the last run
  stopped. Credentials are checked, kept encrypted, never shown again, and deleted when the import
  is finished, on disconnect, or after a week unused. No request follows a redirect.
- After an import, add the system's zip of PDFs and files: each is matched to its award and attached
  for your team only (listed on the funder's award page, never the grantee's); the GMS does not read
  what is in them.
- MCP tools `get_award_share_kit`, `list_social_posts`, `list_funds`, `get_send_package` and
  `get_digest_preview`, all read only.
- API routes for award sharing, social posting and `POST /webhooks/zernio`, funds, the send package,
  guest review, digests and the importer adapters (see `docs/api-surface.md`).

### Changed

- Past awards on a funder's public page follow award sharing's listing switch and its one public
  rule, link to each award's page, and stay listed while amounts are hidden (shown as a dash, never
  $0). **The older transparency setting is retired**: it no longer lists anything and is no longer
  a workspace setting.
- **Open data** decides confidential, individual and unlisted awards with award sharing's rule, and
  its per-award Confidential switch sets the same flag. Marks made in v1.8.0 are still read for one
  release. An award whose grantee chose "Don't list us publicly" is left out ("The grantee asked not
  to be listed publicly").
- Every program belongs to a fund; existing programs are in their workspace's Default fund, and a
  program created without naming a fund goes there. An approval request an agent files for a fund
  advisor must name records of that advisor's funds.
- Scheduled reports are never sent to, or scheduled by, a member limited to some funds (the report
  covers every fund); the workspace ledger is for admins and auditors of every fund.
- Accepting an invitation as an external reviewer opens the guest welcome; its conflict-of-interest
  link opens the policy signing.
- The mailers carry attachments (Resend's attachment objects), so a package can be emailed.
- Applicant workspaces can set `poweredBy` through the workspace settings too.
- The jobs Worker runs content digests on Mondays at 15:10 UTC and can use `OPENGRANTS_API_KEY`.
- The sitemap names listed award pages and each funder's grants-awarded page.

### Fixed

- A fund advisor's event digest, and the Monday activity digest, could count other funds' records;
  both are now limited to the advisor's funds.
- A reviewer limited to one fund could be assigned another fund's application (and then could not
  open it); that assignment is now refused, and auto-assign leaves them out.

### Upgrade notes

- **Database migrations `0037_award_sharing.sql`, `0038_social_posting.sql`, `0039_funds.sql`,
  `0040_send_package.sql`, `0041_content_digests.sql`, then `0042_importer_adapters.sql`, in that
  order, before deploying the API.**
  - `0037` adds `awards.confidential`, `awards.recipient_unlisted`, `awards.public_slug` and
    `programs.awards_confidential`, and copies v1.8.0's open-data confidential marks into
    `awards.confidential`. **Listing of awards is off by default**: nothing becomes public until a
    funder turns on "List awards on my public page". A funder that used the old transparency
    setting should turn listing on to keep its past awards on its page.
  - `0038` adds the social tables and lets inbound events take Zernio deliveries.
  - `0039` **creates a "Default fund" for every funder workspace** and moves its existing programs
    into it (program dates are kept). A member whose scope names funds is no longer "staff" for
    row-level security; the Workers use the service role, so served requests do not change.
  - `0040` adds `package_sends`; `0041` adds the digest tables (everyone starts opted out); `0042`
    widens three checks and adds two nullable columns to `import_runs`. None of them removes or
    rewrites an existing row beyond `programs.fund_id`.
- **Zernio (optional; social posting stays hidden without it):** set the Wrangler secrets
  `ZERNIO_API_KEY` and `ZERNIO_WEBHOOK_SECRET` on the API Worker (the webhook secret is one you
  choose and also set on the endpoint), and add a Zernio webhook to
  `https://gms.opengrants.io/webhooks/zernio` (your `GMS_BASE_URL`) for `account.connected`,
  `account.disconnected`, `post.scheduled`, `post.published`, `post.partial`, `post.failed` and
  `post.cancelled`, for all profiles (`docs/social.md`).
- **`OPENGRANTS_API_KEY` on the jobs Worker** (today it is set only on the API): without it, new
  matches in digests come only from this site. Confirm `CREDENTIALS_ENCRYPTION_KEY`,
  `RESEND_API_KEY` and `RESEND_FROM` are set on the jobs Worker too; no digest is sent without them.
- **Resend:** confirm open and click tracking are off for the sending domain (gms.opengrants.io); the
  digests promise no tracking.
- No other new secrets: Fluxx and Zengine use `CREDENTIALS_ENCRYPTION_KEY`, imported files the
  existing file storage, package email the existing Resend settings.
- Redeploy the API, then the jobs Worker, then the web app and the front Worker, so award pages,
  cards, `/badge` and the fund pages are served.

## v1.8.0 — 2026-11-15

### Added

- **Report builder** for funders (Analytics → Report builder): five data sets (applications,
  awards, payments, reports and requirements, organizations) over whitelisted columns; filters
  (equals, any of, date and money ranges, relative dates), grouping by one or two columns with
  count, total and average, and sort; a preview of 200 rows and a CSV download of up to 50,000 rows,
  streamed, with formula-safe cells. No column carries bank, identity or contact data.
- Saved report views, private or shared with the workspace, and six starter views (Awards this
  year by program, Payments due next 90 days, Overdue reports, Applications by stage, Grantees by
  total awarded, Decline reasons).
- **Scheduled reports**: a saved view sent weekly or monthly to members of the workspace. The CSV
  is kept 30 days and the email carries counts and a signed-in download link, never the file. Each
  recipient can switch the emails off in Digest settings and still find the file in the app.
- **Open data exports** on the Reporting screen: a funder's awards in the 360Giving Data Standard
  (JSON and CSV, schema 1.4.3) and its published opportunities and awards as CommonGrants v0.5.0,
  for a year or a date range, after seeing how many awards go out and why the others are left out.
- "Publish my awards as open data": a public, cached 360Giving feed at
  `/gms/open-data/{handle}/360giving.json` for GrantNav, off by default; a workspace admin switches
  it on after saving the funder's registered 360Giving prefix. Without a prefix, files are drafts.
- Keep an award confidential so it is never exported. Awards to individuals, offers and cancelled
  awards are never exported, and grantees that have not verified with Passport and shared their
  record are exported by name only, with no address.
- **Single sign-on** (SAML 2.0) for funder workspaces through Supabase Auth: Settings → Security ·
  Single sign-on lists email domains (pending until OpenGrants connects the identity provider, then
  active), proves each with a DNS TXT record, shows the service-provider values for the IT team,
  and can require single sign-on for people on active domains.
- "Use single sign-on" on the sign-in page. A workspace that requires it says "This workspace
  requires single sign-on" and sends the person there; after an SSO sign-in the person keeps the
  role their email-code account holds in workspaces on that domain.
- **Conflict-of-interest policy** per competition: each reviewer signs it once (typed name and time,
  and any organizations they have a conflict with) before any application in the competition opens
  for them; a plain-language default until the funder writes its own; changing it asks reviewers to
  sign again. Agents cannot sign. New competitions require it; the funder can turn it off.
- A conflicts register per competition for program staff, observers and auditors: who signed and
  when, declared conflicts and the applicants they match, and every recusal with its reason, also as
  a CSV.
- **Anonymized review**, a per-stage setting (off by default): reviewers see "Applicant A-1042"
  instead of the organization, no EIN, website, address or contacts, no fields the form marks as
  saying who applied, attachments under neutral names, and "[applicant]" wherever the
  organization's name, website, email or EIN appears in an answer. The web app, the CommonGrants
  routes, MCP tools, the assistant and the AI summary all give the same view. Staff always see
  everything.
- "Says who applied" in the form builder marks a field that anonymized review hides.
- **Board docket PDF** from the panel: a cover, a summary table and a page per application;
  comments marked for program staff only are left out unless included on purpose.
- Reviewers choose whether their narrative and comments are for the panel or program staff only.
- **Template gallery** at `/templates`: ready-to-use application forms, rubrics, report forms, email
  templates and program kits, filtered by kind, tag and words, each previewed read-only and shared
  under CC BY 4.0. "Use this template" copies an item into a funder workspace as its own drafts.
- Nine starter templates from OpenGrants on every install: a common application, a general
  operating support application, a small capacity-building application, a five-criterion rubric, an
  interim report, a final report, an award email, a decline email and a small grants program kit.
- "Share to the gallery" on forms, rubrics and email templates for workspace admins. Contact details
  and the organization's names are taken out first, a moderator reviews every submission before it
  is public, the author's team sees the decision in the notification bell, and the author can
  withdraw at any time. A moderation queue at `/gallery/moderation` for the operators named in
  `GALLERY_MODERATORS`.
- **Switch pages** at `/switch` and `/switch/{system}` for Good Grants, Submittable, SurveyMonkey
  Apply, Foundant GLM, Zengine, Fluxx, SmartSimple, Bonterra CyberGrants, OpenWater and
  spreadsheets: what each exports and how (with sources), what comes over, what stays behind and
  why, the steps, and the published list price with its source where there is one, all as of
  November 2026. Each page has its own title, description and share text for search engines and
  links, and all of them are in the sitemap; the landing page links to them.
- **Request a free migration** on every switch page. The preview shows exactly what will be sent;
  the request goes to OpenGrants with replies to the person, who gets a confirmation. Numbers in the
  note that look like bank or identity numbers are removed first. Anyone can send; API and agent
  tokens cannot, and there is no MCP tool.
- MCP tools `list_report_views`, `run_report_view`, `open_data_summary`, `get_coi_policy`,
  `get_conflicts_register`, `search_gallery` and `get_gallery_item`, all read only.
- API routes under `/gms/reports`, `/gms/report-views`, `/gms/report-files`, `/gms/open-data`,
  `/gms/sso`, `/gms/gallery`, `/gms/migration-requests`, and the competition's `coi-policy`,
  `conflicts-register`, `review-settings` and `dockets` (see `docs/api-surface.md`).

### Changed

- **Live review panels keep reviewing.** Competitions that existed before this release do not ask
  reviewers to sign the conflict-of-interest policy until the funder turns it on in the competition's
  policy dialog; reviewers in the middle of a review are not interrupted.
- A message on an application thread is no longer emailed to reviewers. They could not open
  threads, but were mailed the message and the applicant's name.
- Requests by a signed-in person to a workspace that requires single sign-on for their email domain
  are refused unless the session came through that domain's identity provider; connecting a new
  agent to such a workspace needs the same. API clients and existing agent tokens are unaffected.
- The two older direct CSV imports (a funder's awards, and an applicant's applications) are a
  signed-in person's, like the import wizard: agent and API-client tokens get the same "human only"
  refusal.
- A stage's review settings (anonymized review, who sees others' scores, panel open) can be changed
  at any time from Review assignment, and are kept when a draft competition's stages are saved again.
- Rendered PDFs support page breaks and tables.
- Downloads keep the file name the server gives them (the web app can now read it).

### Fixed

- The reasons the server gives for a field (a report column, a merge field, a form definition, a
  score) were never listed under an error message anywhere in the app; they are now.

### Upgrade notes

- **Database migrations `0033_review_parity.sql`, `0034_report_builder.sql`,
  `0035_workspace_sso_domains.sql`, then `0036_template_gallery.sql`, in that order, before deploying
  the API.**
  - `0033` adds the conflict-of-interest policy and signature tables, a check on stage settings, and
    `competitions.coi_policy_required`: every competition that already exists gets `false`, so its
    reviewers keep reviewing without a policy until the funder turns it on; new competitions get
    `true`.
  - `0034` adds the report views, schedules and files tables. `0035` adds `workspace_sso_domains`
    and the operator functions `gms.activate_sso_domain`, `gms.deactivate_sso_domain` and
    `gms.lift_sso_requirement`.
  - `0036` adds the gallery tables and **brings the nine starter templates** (Common application,
    General operating support application, Small capacity-building grant application, Five-criterion
    rubric, Interim report, Final report, Award letter email, Decline email, Small grants program
    kit). Read them before you deploy: they are public on `/templates` as soon as the API is up.
  - None of them removes an existing row; only the new column above is set on existing
    competitions.
- **Single sign-on only:** the Supabase project must be on the Pro plan or above with SAML 2.0
  switched on (Authentication → Providers → SAML 2.0), and `https://<your web address>/signin` must
  be on the Auth redirect allow list. Register each workspace's identity provider with
  `scripts/sso/register-provider.mjs` (it reads `SUPABASE_ACCESS_TOKEN` from your own shell only),
  then run the `gms.activate_sso_domain` line it prints (`docs/sso.md`). Without this nothing
  changes: no workspace requires single sign-on.
- **`GALLERY_MODERATORS`** (API Worker secret, by name; never a `[vars]` entry): the user ids or
  email addresses of the people who review shared templates, comma-separated. Until it is set,
  nobody moderates and nothing new is published; the nine starters still show.
- No other new secrets. Scheduled reports and board dockets use the existing `EXPORTS` R2 bucket
  (already bound on the API and jobs Workers), and scheduled report emails the existing
  `RESEND_API_KEY` and `RESEND_FROM` on the jobs Worker. The migration request uses the existing
  `CONSULTING_REQUEST_TO`, `RATE_LIMIT` and `OAUTH_SIGNING_KEY_JWK`.
- Rebuild and redeploy the web app and then the front Worker after the API, so the switch pages and
  the template gallery get their own titles, descriptions and share text.

## v1.7.0 — 2026-11-15

### Added

- **Share previews.** A link to a funder page or a call now previews that page: its own title, a
  description that says whether it is open, forecasted or closed, and a share image with the
  funder, the call, the amount and the deadline or status. A funder not verified with OpenGrants
  Passport says so on its image.
- Search engines get schema.org data on public pages (the call as a grant with its funder and
  amount, breadcrumbs, the funder as an organization), a robots.txt, and a sitemap that keeps
  forecasted and closed calls with their last change.
- **Embed an opportunity on your own website.** The Publish step gives a copy-paste snippet (an
  iframe, with an optional resize script), a copy button and a live preview. The widget shows the
  call, its deadline or status, who can apply, and an Apply button that opens your public page in a
  new tab; when the call is not taking applications it says so instead. No sign-in, no cookies.
- "Powered by OpenGrants Grant Management System" links to the home page from your public page
  footers, the apply widget and the email applicants get when they apply. It never appears in
  review, decision or award emails. Funder admins can turn it off in Settings > Public page.
- **Invite someone into a draft** by email, from the assignee picker of an outside application's
  questions or a built-in application's sections. They join as a consultant who can open only that
  application and write its answers, and the question or section is assigned to them when they
  accept. One email, sent on your click, with no reminders; addresses are masked while invitations
  wait and in the activity log.
- A one-time, dismissible "Writing with others? Invite a teammate" note in the application editors.
- **AI summary** on the funder's application review screen and the reviewer's scoring screen,
  marked "Review before relying on it". It is written once for each version of the answers and
  every reviewer reads the same one, so the monthly assistant quota is spent once. It never scores
  or decides, and it is hidden when the assistant is off.
- **Import from a spreadsheet.** Bring your grants with you in a few minutes: a funder imports its
  grant history (past awards to named organizations, with what was paid) from Awards, and an
  applicant imports its applications from Applications. From a CSV file, an Excel workbook (.xlsx),
  Google Sheets or Airtable.
- The import wizard suggests which column fills each field and remembers your choice for the next
  file with the same columns. Before anything is imported it checks every row and shows what will be
  created, skipped or needs a fix, with the amounts by year. Importing the same rows again creates
  nothing new. Up to 5,000 rows at a time.
- Columns that look like bank details or a person's identity numbers are left out before anything is
  shown or stored, and the check names them so you can see what was left out. Any nine-digit number
  is left out unless its column is named EIN, so a ZIP+4 code written as nine digits is left out too.
- Payments in an imported grant history are recorded as paid elsewhere. Nothing is paid from the GMS
  and nothing goes through Passport.
- Google Sheets and Airtable are read-only through Composio, connected by a workspace admin, and
  offered only where the server is set up for them.
- Agents can read an import's check through MCP (`get_import_preview`); only a person imports the
  rows.
- The public funder page tells each call apart by whether it takes applications now
  (`acceptingApplications`), and the public funder data carries the funder's Powered by setting
  (`poweredBy`).

### Changed

- Cards on a funder's public page offer Apply only while the call is taking applications;
  otherwise they offer View details.
- The default description and share image no longer say "No Passport needed"; the default image is
  now 1200x627.
- A workspace can send at most 20 invitations a day, from Team & access and from the editors
  together.
- The built-in application editor opens for consultants.
- The assistant panel on an application keeps "Compare to rubric"; summaries moved to the AI summary
  panel.
- The older CSV imports (applications, and a funder's awards) leave out columns whose values look
  like bank or identity numbers, not only columns named for them.
- Agent and API-client tokens cannot commit an import; a person does, on the import screen.

### Fixed

- The front Worker applies the security headers to each page's own address, as Cloudflare's static
  assets do, and honours rules that remove a header. It used the rules for the app's index page on
  every page.
- A public opportunity page no longer writes a second block of schema.org data in the page body
  with a deadline property schema.org does not have; the one in the page head is complete.
- A payment recorded as made outside Passport showed "destination •••• undefined" on the award's
  Payments tab; it shows the last four digits again, and "Paid elsewhere" when there are none.

### Upgrade notes

- **Database migrations `0031_imports.sql`, then `0032_invites_summaries.sql`, in that order, before
  deploying the API.**
  - `0031` adds three tables for saved column mappings, import runs and the run log, with row-level
    security keeping them to the workspace's own staff, and lets connector accounts be Google Sheets
    or Airtable (the provider check is widened; every existing row still passes).
  - `0032` adds a table for the shared AI summaries (`application_summaries`, service role only), a
    column for the notes a member dismissed (`workspace_members.dismissed_notes`, empty by default),
    and the daily invitation limit (an index and a trigger that refuses a workspace's 21st
    invitation in a rolling day; invitations already sent count toward the first day).
  - Neither changes, removes or copies an existing row.
- **New optional settings for imports from Google Sheets and Airtable** (API Worker secrets, set by
  name; see `docs/connectors.md`). Without them only CSV and Excel files are offered, with no setup.
  - `COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID`: a Composio auth config on the `googlesheets` toolkit,
    OAuth2 with your own Google OAuth client, scopes exactly
    `https://www.googleapis.com/auth/spreadsheets.readonly`, `openid`, `email` and `profile`, with
    the Google Sheets API enabled in that Google Cloud project.
  - `COMPOSIO_AIRTABLE_AUTH_CONFIG_ID`: a Composio auth config on the `airtable` toolkit, OAuth2,
    scopes `data.records:read` and `schema.bases:read`.
  - The existing `COMPOSIO_API_KEY` must be allowed to execute tools as well as manage connected
    accounts, and both auth configs must accept the web app's address as a callback
    (`{WEB_BASE_URL}/w/<handle>/import`).
- "Powered by" is on for every funder after the upgrade, including existing ones; an admin turns it
  off in Settings > Public page (`settings.poweredBy`).
- Rebuild and redeploy the web app and then the front Worker (`scripts/build-front-worker.mjs`,
  with `--redirect-from` as in `docs/staging.md`) after the API. Until the front Worker is rebuilt it
  serves no share images or robots.txt, and other sites cannot frame the apply widget. The two-Worker
  layout with static assets (`apps/web/wrangler.jsonc`) frames the widget but serves the public
  pages with the default meta.

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
