# @gms/web

Vite + React front end for OpenGrants GMS. `pnpm dev:web` serves it on :5173; with
`VITE_USE_MOCKS=true` every screen renders from the fixture workspaces in `src/mocks/`.

## Build settings

Read at build time (`src/env.ts`); all are public values.

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | The API Worker and the Supabase project |
| `VITE_USE_MOCKS` | `false` to use them; anything else renders the fixture workspaces |
| `VITE_PASSPORT_BASE_URL` | Passport, default `https://passport.opengrants.io` |
| `VITE_GOOGLE_PICKER_API_KEY`, `VITE_GOOGLE_OAUTH_CLIENT_ID` | Optional, both or neither. Switch on "Export to Drive" (the Google Picker). The client id must be the Google OAuth client the Composio auth config uses, because `drive.file` grants are per Google Cloud project. Without both, the export control says it is not configured and the Content-Security-Policy names no Google origin |
| `VITE_USERBACK_TOKEN` | Optional. Userback's public access token. Shows the feedback button and adds Userback's origins to the Content-Security-Policy. Unset (the default) and in mock mode nothing loads |

With both Google values set, `build/headers.ts` adds exactly these to the CSP: scripts from
`https://apis.google.com` and `https://accounts.google.com/gsi/client`, frames from
`https://docs.google.com` and `https://accounts.google.com/gsi/`, the Identity Services stylesheet
and endpoint, and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (Google's sign-in pop-up
must answer this window). This list has not been run against Google yet; if the Picker reports a
blocked resource, add that origin here and to `test/launch.test.tsx`.

Payments through Passport and the assistant are switched on the API (`PAYMENTS_FACILITATED`,
`ASSISTANT_ENABLED`); the web app reads them from `GET /gms/config` and `GET /gms/assist/status`.

## Accessibility

Target: WCAG 2.2 AA on every applicant-facing and public screen, at desktop (1440) and phone (390) widths.

### Automated, in the test suite

`test/a11y.test.tsx` renders each public and applicant route from the mocks (29 at desktop width,
9 in the phone layouts) and runs `axe-core` (pinned to 4.14.0 in `package.json`) with the
`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` tags. It fails on any serious or critical violation.

```bash
pnpm exec vitest run --project web apps/web/test/a11y.test.tsx
```

jsdom has no layout, so `color-contrast` and `target-size` are switched off there and checked in a
browser instead.

### Automated, in Chromium

Run the same axe build in a real browser against the mock dev server, at both widths, and check
for console errors and horizontal overflow at the same time:

1. `VITE_USE_MOCKS=true pnpm --filter @gms/web exec vite --port 5174`
2. With Playwright, for each route in `test/a11y.test.tsx` and each of 1440×900 and 390×844: load
   the page, inject `node_modules/axe-core/axe.min.js`, run
   `axe.run(document, { runOnly: { type: "tag", values: [the five tags above] } })`, and compare
   `document.documentElement.scrollWidth` with `window.innerWidth`.

Result on 2026-11-10 (27 routes × 2 widths): 66 serious findings before the fixes, 3 after.

| Rule | Before | After | Fix |
|---|---|---|---|
| `label-content-name-mismatch` | 44 | 0 | Avatar links carry their initials plus a visually hidden "Account: name" instead of an `aria-label` that hid the visible text |
| `link-in-text-block` | 10 | 0 | Links inside running text and banners are underlined |
| `color-contrast` | 8 | 0 | Landing stat, funder mark and banner link colors |
| `scrollable-region-focusable` | 2 | 0 | Scrolling table wrappers are focusable, labelled regions |
| `target-size` | 2 | 3 | See below |

The remaining `target-size` findings are at 390px (editor, application status, settings), where a
sticky bar (the editor's validation sheet, the bottom tabs) overlaps a control at the page's
initial scroll position. The control is full size once scrolled into view; axe measures the
unobscured part. Settings was not reachable when the first run was made, so its finding is new
to the count, not a regression.

No console errors and no horizontal overflow on any route at either width.

### Keyboard-only pass

Done in Chromium at 1440 and 390 with the keyboard alone (Tab, Shift+Tab, arrows, Space, Enter, Escape).

Apply:

1. Find funding → Tab reaches the search field, filters and each opportunity; the tab list is one
   stop, and Left/Right move between its tabs.
2. Application editor → every field, the section list, "Insert from library" and Submit are
   reached in reading order; date fields take three stops (month, day, year), which is the
   browser's own control.
3. Submit opens the confirmation dialog with focus inside it; Tab stays in the dialog; Escape
   closes it and returns focus to Submit.

Report:

1. Reports → Tab to the requirement's action button, Enter selects it; the report opens below.
2. "Start report" → Enter; prefilled answers arrive with their source marked.
3. Tab through the fields and type; Space ticks the certification.
4. Submit with something missing: the report stays open, each problem is listed in words beside
   its field and in "To fix" (on phones, a one-line alert above the button).
5. Submit when complete: the report locks, the status reads "Submitted", and focus moves to the
   report's header (the button it was on no longer exists).

Fixed during the pass: focus was dropped to the page body after a report was submitted; the phone
report showed raw field paths when a submit was refused; public pages had no `main` landmark.

Every focusable control shows the theme's focus ring (`.gms :focus-visible` in `src/theme/app.css`).

### Not covered

Screen-reader testing with a real assistive technology (VoiceOver, NVDA, TalkBack) has not been
done. The funder and reviewer screens are outside this pass.

### Funder and reviewer screens (2026-11-10)

`test/a11y.test.tsx` now also covers 33 funder and reviewer routes (71 cases in all). The Chromium
run over 82 crawled routes at 1440 and 390:

| Rule | Before | After | Fix |
|---|---|---|---|
| `label-content-name-mismatch` | 24 | 0 | Visible text first, extra context in a visually hidden span; avatar initials hidden with "Account: name" |
| `color-contrast` | 10 | 0 | Disabled saved views use `aria-disabled` without opacity; calendar days outside the month are dashed, not faded |
| `target-size` | 8 | 0 | Padding on table, breadcrumb and small links; the phone validation sheet is docked, not overlaid |
| `scrollable-region-focusable` | 1 | 0 | Every `.tbl-wrap` is a focusable, labelled region |

Horizontal overflow at 390: 3 routes before (applications, panel, reporting), none after.

## End-to-end flows

`e2e/` holds the six design flows as Playwright tests. They run against the mock dev server
(started by `playwright.config.ts` on :5179) and move through the app by real clicks only, because
the mock API keeps its state in the page. Each flow fails on any console or page error.

```bash
pnpm --filter @gms/web e2e -- --trace off
```

| Flow | File | Ends at |
|---|---|---|
| 1 Funder launches a cycle | `flow1-launch-cycle.spec.ts` | Public opportunity page shows the open competition |
| 2 Review to award | `flow2-review-to-award.spec.ts` | Agreement countersigned |
| 3 Pay a tranche | `flow3-pay.spec.ts` | Tranche paid after the Passport event |
| 4 Applicant applies | `flow4-apply.spec.ts` | Application status "Submitted" |
| 5 Report and share | `flow5-report-and-share.spec.ts` | Accepted report shared with a second funder |
| 6 Agent triage with a human gate | `flow6-agent-triage.spec.ts` | Approval resolved, applications list updated |

Limits of mock mode: the funder and applicant mock stores are separate, so each side of a
cross-side flow works on its own seeded records; Passport settlement is simulated through
`window.__gmsMock.simulatePassport`; the consent screen's redirect to the agent is intercepted.

CI step (after install and build):

```yaml
- run: pnpm --filter @gms/web exec playwright install --with-deps chromium
- run: pnpm --filter @gms/web e2e -- --trace off
```

## Design coverage

Each artboard of the "OpenGrants GMS" canvas (as first implemented in commit `c03b4cd`) against the
live route. **live**: every section of the artboard renders from the API. **partial**: the screen is
live but the listed sections are absent because no API provides them yet. **static**: fixture
markup only. Compared by headings, table columns and tabs, not pixel by pixel.

Counts: 53 live, 0 partial, 14 static (67 artboards). The static ones are reference boards: email and PDF templates and the component styleguide.

| Artboard | Route | Status | Notes |
|---|---|---|---|
| public/Landing | `/` | live | |
| public/FunderPageRiverbend | `/f/:handle` | live | Past awards (only when the funder turns transparency on) with year filter and CSV, and questions drawn from its open opportunities |
| public/FunderPageCascade | `/f/:handle` | live | Same screen, driven by the handle; forecasted group shown when the funder has one |
| public/OpportunityPage | `/f/:handle/o/:slug` | live | Form previews, published guideline documents and FAQ; "View as CommonGrants JSON" opens the record in mock mode too |
| public/SignIn | `/signin` | live | Steps shown one at a time |
| public/WorkspaceSwitcher | `/workspaces` | live | |
| public/FunderOnboarding | `/onboarding/funder/:step` | live | |
| public/ApplicantOnboarding | `/onboarding/applicant` | live | "Invite teammates" and "Connect apps" follow the readiness step; apps connect in Passport, by link |
| public/Notifications | `/notifications` | live | Digest settings beside the list, per workspace |
| public/AccountSettings | `/account/agents` | live | Agents show client, scopes and last use. Sessions table from `GET /gms/me/sessions`: device, network address (the artboard's "Location"; no geolocation service is used), last active, signed in, second factor; another session is ended from the list |
| funder/Dashboard | `/w/:ws` | live | Recent activity reads the ledger |
| funder/Programs | `/w/:ws/programs/:id` | live | Committed, paid, remaining, committed by status, stage and application counts. Owner column and picker; outcomes rollup totals the numeric outcome fields of accepted reports; budget categories editor |
| funder/OpportunityBuilder | `/w/:ws/opportunities/:id/edit` | live | Public-card preview and "Test against an org" (typed facts; there is no route to search Passport organizations) |
| funder/FormBuilder | `/w/:ws/forms/:id/edit` | live | |
| funder/Competition | `/w/:ws/competitions/:id` | live | Stages table (opens, closes, form, rubric, entry rule) and reviewer pool. Entry rules describe who advances; score thresholds are not an API concept |
| funder/Applications | `/w/:ws/applications` | live | Score is the mean from the ranking; Days in stage counts from the stage's submission; "Review complete" filters status Recommended, "Flagged" filters the tag `flagged` |
| funder/ApplicationsEmpty | `/w/:ws/applications/first-run` | live | |
| funder/ApplicationDetail | `/w/:ws/applications/:id` | live | Budget and Documents tabs read the responses; assistant panel shows when the install enables it |
| funder/ReviewAssignment | `/w/:ws/reviews/assign` | live | |
| funder/ReviewerAssignments | `/review/assignments` | live | Shows the raw stage key |
| funder/ReviewerScoring | `/review/score/:appId` | live | |
| funder/Panel | `/w/:ws/competitions/:id/panel` | live | Per-criterion scores by reviewer, decision summary, internal discussion notes, letter preview |
| funder/AwardAgreement | `/w/:ws/awards/:id/agreement` | live | Nine-tab strip shared with Payments; signature records (IP is recorded but not returned by the API), documents, activity, closeout; Remaining and Next due in the list |
| funder/AwardPayments | `/w/:ws/awards/:id/payments` | live | Owns Payments, Requirements and Budget in the shared nine-tab strip |
| funder/PaymentsDue | `/w/:ws/payments/due` | live | Next 30 days and Readiness explained beside the list; Reconcile and Ledger are their own routes |
| funder/PaymentsInFlight | `/w/:ws/payments/in-flight` | live | Alerts grouped by cause with empty states; Mercury matching is `/payments/reconcile`. Alerts share this tab with In flight rather than having their own |
| funder/Reporting | `/w/:ws/reporting` | live | Calendar restored; submission view has no recipient name, taken from awards |
| funder/Grantees | `/w/:ws/grantees/:id` | live | Reports section; directory has level, total awarded, owner and tags |
| funder/Analytics | `/w/:ws/analytics` | live | Awards by region (recipient state), reviewer load, equity lens by region with groups under five withheld |
| funder/Communications | `/w/:ws/communications` | live | Bulk send by group with a confirmed count; last used and channel derived from the send log |
| funder/SettingsMcp | `/w/:ws/settings/mcp` | live | "Connect an agent" restored |
| funder/Approvals | `/w/:ws/approvals` | live | Request detail: exact inputs, applications affected, letter preview |
| applicant/Dashboard | `/w/:ws` | live | |
| applicant/Organization | `/w/:ws/organization` | live | Documents locker (references, read live), apps feeding the record, "Who has access" table. Representatives read live from Passport with a verified mark; each state (not shared, not linked, unreachable) is said plainly |
| applicant/FindFunding | `/w/:ws/find` | live | Alerts tab: registered with OpenGrants, remembered with saved listings |
| applicant/Editor | `/w/:ws/applications/:id/edit` | live | |
| applicant/EditorSubmit | `/w/:ws/applications/:id/edit/submit` | live | |
| applicant/Confirmation | `/w/:ws/applications/:id/submitted` | live | Title repeats the competition name in mock mode |
| applicant/ApplicationStatus | `/w/:ws/applications/:id` | live | Revision requests with diff, interview and decision sections. The applicant picks one of the offered interview times and confirms it; the funder offers times from the application |
| applicant/GrantOffered | `/w/:ws/grants/:id/offer` | live | "Before you sign", Documents and Messages; budget, amendments and closeout live on the grant screen |
| applicant/GrantPayments | `/w/:ws/grants/:id` | live | Payout destination read live from Passport with every state explained; Documents and Messages; budget category mapping (own ledger account to the funder's category) |
| applicant/Reports | `/w/:ws/reports` | live | Budget actuals table beside the report |
| applicant/AnswerLibrary | `/w/:ws/library` | live | "Adapt to a question" appears when the assistant is on; the draft is copied by the person, never inserted |
| applicant/TeamAccess | `/w/:ws/team` | live | Members, Consultants, Funders with access and Agents tabs. Last active per person; consultants show their organization, set on the invitation |
| applicant/Funders | `/w/:ws/funders` | live | Open items, documents and contact per funder. Named contacts come from the funder's settings; the public funder page shows the ones marked public |
| applicant/Settings | `/w/:ws/settings` | live | API tokens (secret shown once, never submit or sign), exports and leaving the workspace |
| applicant/phone/* (6: Dashboard, Organization, Editor, ApplicationStatus, Grant, Reports) | same routes at 390 | live | Same data as the desktop screens |
| shared/OAuthConsent | `/consent` | live | |
| shared/email/* (6) | `/preview/email/:kind` | static | Reference layouts for `packages/notify` |
| shared/pdf/* (3) | `/preview/pdf/:kind` | static | Reference layouts for `packages/documents` |
| styleguide/* (5) | `/styleguide/*` | static | Component reference |
