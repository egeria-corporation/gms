# OpenGrants GMS Accessibility Conformance Report

**WCAG Edition, based on VPAT® Version 2.5 (WCAG 2.2)**

| | |
|---|---|
| **Name of product and version** | OpenGrants GMS 1.9.0, with the accessibility fixes of 2026-11-16 |
| **Report date** | 2026-11-16 |
| **Product description** | Free, open-source (AGPL-3.0) grants management for funders and grant seekers: programs, opportunities, applications, reviews, awards, payments through OpenGrants Passport, reports, and an applicant's own grant seeking. Hosted at gms.opengrants.io; anyone may host their own copy. |
| **Contact information** | Open an issue at https://github.com/egeria-corporation/gms/issues and label it `accessibility`. |
| **Notes** | This report covers what the GMS itself renders and sends. It is honest about what is partial; each partial item has a plan below. A screen reader pass with real assistive technology has not been done yet (see "Known limits"). |
| **Evaluation methods used** | Automated testing with axe-core in a real browser on every route and every dialog, scripted keyboard and layout checks, colour contrast computed from the theme tokens, and review of the code. Details under "How this was tested". |

## Applicable standards and guidelines

| Standard / guideline | Included in report |
|---|---|
| Web Content Accessibility Guidelines 2.0 | Level A (Yes), Level AA (Yes), Level AAA (No) |
| Web Content Accessibility Guidelines 2.1 | Level A (Yes), Level AA (Yes), Level AAA (No) |
| Web Content Accessibility Guidelines 2.2 | Level A (Yes), Level AA (Yes), Level AAA (No) |

## Terms

- **Supports**: the functionality of the product has at least one method that meets the criterion without known defects, or meets it with equivalent facilitation.
- **Partially Supports**: some functionality of the product does not meet the criterion.
- **Does Not Support**: the majority of product functionality does not meet the criterion.
- **Not Applicable**: the criterion is not relevant to the product.
- **Not Evaluated**: the product has not been evaluated against the criterion (used only for AAA).

## Scope

| Part | What it covers | How it was checked |
|---|---|---|
| **Web app** | Funder workspace (admin, program officer, finance and reviewer roles), applicant workspace (admin, editor, consultant invited into one draft), reviewer portal (staff reviewers, external and guest reviewers), account, agent consent, onboarding, import, settings | Every route in the router, as each kind of person, at desktop and phone width |
| **Public pages** | Landing, sign-in (email code, single sign-on), funder pages, opportunity pages, funds, grants-awarded pages and award pages, template gallery, switch pages, digest unsubscribe, award claim | The same, signed out |
| **Embed widget** | The apply card funders put on their own sites (`/embed/f/:handle/o/:slug`) | The same |
| **Emails** | Everything `packages/notify` sends through Resend: invitations, direct awards, reminders, digests, send-package, migration requests | Review of the templates and the mailer |
| **Generated PDFs** | Board docket, send package, award letter, grant agreement (and executed copy), application snapshot | Review of `packages/documents` |

Out of scope: pages and widgets other services render (OpenGrants Passport, Stripe's embedded components, an organization's single sign-on page, the Google file picker, the optional Userback feedback widget, Composio), and the demo-only design boards and template previews under `/styleguide/` and `/preview/`, which exist only in demo (mock) mode. Those boards were still checked with axe and fixed (see the findings table), but they are drawn at fixed design widths and do not reflow.

## Table 1: Success Criteria, Level A

| Criteria | Conformance Level | Remarks and Explanations |
|---|---|---|
| 1.1.1 Non-text Content (Level A) | Supports | **Web:** the logo has text alternatives; decorative images (`alt=""`) and every icon (`aria-hidden`) are hidden, because status is always an icon plus a word. The "Funded by" badge SVG has `role="img"`, an `aria-label` and a `<title>`, and the badge code funders copy carries `alt`. Share-card images carry `og:image:alt` and `twitter:image:alt` that say what the card says. The embed widget's funder logo is decorative next to the funder's name. **Emails:** no images. **PDFs:** text only. |
| 1.2.1 Audio-only and Video-only (Prerecorded) (Level A) | Not Applicable | No audio or video. |
| 1.2.2 Captions (Prerecorded) (Level A) | Not Applicable | No video. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) (Level A) | Not Applicable | No video. |
| 1.3.1 Info and Relationships (Level A) | Partially Supports | **Web: Supports.** Landmarks on every screen (banner, navigation, main), headings, labelled tables, fieldsets and groups; every form field's label, required state, help and error are tied to the control (`aria-required`, `aria-invalid`, `aria-describedby`). Some screens step from a level-1 to a level-3 heading; no information is lost. **Emails: Supports** (paragraphs, headings, lists, links). **PDFs: Does Not Support.** pdf-lib cannot write a structure tree, so no PDF the GMS makes is tagged: headings and tables are visual only. Text equivalents: the send package carries `answers.txt` with every question and answer; the board docket's scores and recommendations are on the competition's panel screen and each application's page. Plan below. |
| 1.3.2 Meaningful Sequence (Level A) | Partially Supports | **Web: Supports**: the DOM order is the reading order at every width. **PDFs: Partially Supports**: text is drawn top to bottom in reading order, but without tags a screen reader works the order out itself; not verified with one. |
| 1.3.3 Sensory Characteristics (Level A) | Supports | Instructions do not rely on shape, size, position or sound. |
| 1.4.1 Use of Color (Level A) | Supports | Status is an icon and a label, never colour alone; errors have an icon and words; links inside text are underlined (including links inside checkbox labels, fixed in this pass); calendar days outside the month are dashed, not faded. |
| 1.4.2 Audio Control (Level A) | Not Applicable | No audio. |
| 2.1.1 Keyboard (Level A) | Supports | Every control is reachable and works with the keyboard, checked by tabbing through every route at both widths. Tab lists use the arrow keys; every scrolling table is a focusable, labelled region so it can be scrolled from the keyboard. No function needs a pointer. Choices built as groups of buttons (scores, outcomes) are one Tab stop per choice rather than arrow-key groups. |
| 2.1.2 No Keyboard Trap (Level A) | Supports | Modal dialogs keep Tab inside on purpose and close with Escape; nothing else holds focus. |
| 2.1.4 Character Key Shortcuts (Level A) | Not Applicable | No single-character shortcuts. |
| 2.2.1 Timing Adjustable (Level A) | Supports | The only time limit inside the app is the life of an emailed sign-in code; "Send a new code" gives a fresh one at any time. |
| 2.2.2 Pause, Stop, Hide (Level A) | Supports | Nothing moves, blinks or scrolls by itself. Progress counts update only during an import the person started. |
| 2.3.1 Three Flashes or Below Threshold (Level A) | Supports | Nothing flashes. |
| 2.4.1 Bypass Blocks (Level A) | Supports | "Skip to main content" is the first stop on every page (added in this pass); every screen also has landmarks and headings. |
| 2.4.2 Page Titled (Level A) | Supports | **Web:** every screen sets a title naming the screen and the workspace or funder (tabs of one screen share its title). **Emails:** the subject is the document title. **PDFs:** every PDF has a title; the board docket and send package ask the viewer to show it. |
| 2.4.3 Focus Order (Level A) | Supports | Focus moves in reading order; a dialog takes focus when it opens and gives it back to the control that opened it, including dialogs whose first field focuses itself (fixed in this pass). |
| 2.4.4 Link Purpose (In Context) (Level A) | Supports | Links say where they go; "Open" and "Details" links and buttons are named by what they open (fixed in this pass). |
| 2.5.1 Pointer Gestures (Level A) | Supports | No multipoint or path-based gestures. |
| 2.5.2 Pointer Cancellation (Level A) | Supports | Actions run on click. A dialog closes on a completed click outside it, not on the press (fixed in this pass). Menus close when pressed outside, which is undone by opening them again. |
| 2.5.3 Label in Name (Level A) | Supports | Every accessible name starts with the visible words (checked by axe on every route; copy buttons and the awards list's View links fixed in this pass). |
| 2.5.4 Motion Actuation (Level A) | Not Applicable | Nothing responds to device motion. |
| 3.1.1 Language of Page (Level A) | Partially Supports | **Web: Supports** (`lang="en"`). **Emails: Supports**: sent as a document with `lang="en"` (fixed in this pass). **PDFs: Partially Supports**: the board docket and send package name their language (fixed in this pass); the award letter, agreement and application snapshot do not yet, because their bytes are re-rendered to verify a stored hash and must not change for documents already signed. Plan below. |
| 3.2.1 On Focus (Level A) | Supports | Focus never changes context. |
| 3.2.2 On Input (Level A) | Supports | Changing a setting never changes context by itself. The one choice that opens something, "Invite someone by email…" at the end of an assignee picker, opens its dialog when picked with a pointer or with Enter in the open list; reached by arrowing or typing through the closed picker it waits for Enter and says so (fixed in this pass). |
| 3.2.6 Consistent Help (Level A) | Supports | Where the feedback widget is switched on, it is in the same place on every page; the public pages' footer is the same on every page. |
| 3.3.1 Error Identification (Level A) | Supports | Errors are described in words next to the field, announced, and tied to the field (`aria-invalid`, `aria-describedby`): forms, application forms, sign-in (email, single sign-on, the one-time code and authenticator code), scoring and money fields (fixed in this pass). |
| 3.3.2 Labels or Instructions (Level A) | Supports | Every field has a visible label; required fields show an asterisk and say "required" to assistive technology (fixed in this pass); help text is part of the field's description. |
| 3.3.7 Redundant Entry (Level A) | Supports | Steps reuse what was entered: the sign-in email carries to single sign-on, onboarding and award claims carry the organization's name, reports prefill from the grant and earlier reports, applications fill from the organization's Passport or self-declared profile and the answer library. |
| 4.1.1 Parsing (Level A) | Supports | For WCAG 2.0 and 2.1; removed in WCAG 2.2. React renders well-formed markup with unique ids. |
| 4.1.2 Name, Role, Value (Level A) | Supports | Native controls throughout; custom switches, radios and menus carry their role and state; every labelled region, group and image has a role that exposes its name (fixed in this pass). |

## Table 2: Success Criteria, Level AA

| Criteria | Conformance Level | Remarks and Explanations |
|---|---|---|
| 1.2.4 Captions (Live) (Level AA) | Not Applicable | No live media. |
| 1.2.5 Audio Description (Prerecorded) (Level AA) | Not Applicable | No video. |
| 1.3.4 Orientation (Level AA) | Supports | No screen is locked to one orientation. |
| 1.3.5 Identify Input Purpose (Level AA) | Supports | Fields about the person or their organization carry their autofill purpose (`email`, `name`, `organization`, `tel`, `street-address`, `one-time-code`); fields about someone else (a grantee's contact, an invitee) are left off. |
| 1.4.3 Contrast (Minimum) (Level AA) | Supports | **Web:** axe checks contrast on every route at both widths; every distinct text colour pair in use was also computed in the browser across all routes (55 pairs, all at or above 4.5:1, or 3:1 for large text), and text on the two brand gradients was checked against both ends (white on #0D2A43 and #145450: 14.7:1 and 8.7:1). A funder's brand colour is checked when saved and falls back to the system accent below 4.5:1. A resolved comment was faded below 4.5:1 (fixed in this pass). **PDFs:** ink #1E2D2B and muted #4A5C5A on white (7:1 and more). **Emails:** no colours set. |
| 1.4.4 Resize Text (Level AA) | Supports | Browser zoom to 200% and beyond keeps all content and function (checked as reflow at 640 and 320 CSS pixels). Font sizes are in pixels, so a browser's "text size only" setting does not enlarge them; page zoom does. |
| 1.4.5 Images of Text (Level AA) | Supports | No images of text in the app beyond the logo. The award share card is an image for social posts by design; its words are on the award page and in its `alt`. |
| 1.4.10 Reflow (Level AA) | Supports | Every product route fits 320 CSS pixels without sideways scrolling (checked on every route; nine layouts fixed in this pass). Data tables scroll inside their own focusable region, as the criterion allows. The demo-only design boards, email previews at their 640px design width and PDF previews at paper size do not reflow; they are not part of the product people use. |
| 1.4.11 Non-text Contrast (Level AA) | Supports | Field outlines, switches, drawn checkboxes and radios, and empty matrix cells are 3.5:1 or more on every surface they sit on; the focus ring is dark teal (8.7:1 on white) with a white halo for dark surfaces (all fixed in this pass, computed from the tokens in a test). |
| 1.4.12 Text Spacing (Level AA) | Supports | With line height 1.5, paragraph spacing 2, letter spacing 0.12 and word spacing 0.16 applied to every route, no text is clipped or lost (scripted check, and screenshots). |
| 1.4.13 Content on Hover or Focus (Level AA) | Supports | No custom content appears on hover or focus; the few `title` tooltips are the browser's own. |
| 2.4.5 Multiple Ways (Level AA) | Supports | Workspace rail, search, breadcrumbs, dashboards and notifications; public pages link to each other from the funder page. |
| 2.4.6 Headings and Labels (Level AA) | Supports | Headings and labels describe their topic or purpose. |
| 2.4.7 Focus Visible (Level AA) | Supports | Every focusable control shows the focus ring, checked by tabbing through every route; hidden file inputs show focus on the button that stands for them (fixed in this pass). |
| 2.4.11 Focus Not Obscured (Minimum) (Level AA) | Supports | Checked by tabbing through every route at both widths: sticky parts keep a scroll margin, stop sticking on phones where they would cover too much, and the assignment matrix scrolls a cell clear of its sticky column (fixed in this pass). |
| 2.5.7 Dragging Movements (Level AA) | Supports | Nothing in the GMS uses drag and drop; form fields are reordered with Move up and Move down buttons. |
| 2.5.8 Target Size (Minimum) (Level AA) | Supports | Targets are at least 24 by 24 pixels or spaced so (checked by axe on every route at both widths); links inside text are excepted. |
| 3.1.2 Language of Parts (Level AA) | Supports | The interface is in English. Text people type in another language is theirs and not marked. |
| 3.2.3 Consistent Navigation (Level AA) | Supports | The top bar and rail are the same, in the same order, on every workspace screen. |
| 3.2.4 Consistent Identification (Level AA) | Supports | Controls with the same function have the same name and icon. |
| 3.3.3 Error Suggestion (Level AA) | Supports | Errors say how to fix them, for example "Enter the amount in dollars, such as 25000". |
| 3.3.4 Error Prevention (Legal, Financial, Data) (Level AA) | Supports | Signing an agreement needs a typed name, an attestation and a confirmation; payments, submissions, withdrawals, revocations and sends are confirmed in a dialog first; payments go through Passport's own checks. |
| 3.3.8 Accessible Authentication (Minimum) (Level AA) | Supports | Sign-in is an emailed one-time code (paste fills all six boxes; `autocomplete="one-time-code"`), single sign-on through the organization's own page, or a Passport sign-in link. The authenticator code for admins accepts paste. No password, puzzle or memory test. |
| 4.1.3 Status Messages (Level AA) | Supports | "Saving…" and "Saved" notes are live regions; errors are alerts; banners that appear after an action on the same screen (a save, an upload, a decision) are spoken once through one polite live region that is always on the page, while banners that are part of a screen as it opens are read with it; import and attach progress counts are status regions (fixed in this pass). Which banners are spoken follows a rule (an action on this screen in the last eight seconds), not each banner's own setting; to be confirmed in the screen-reader pass. |

## Table 3: Success Criteria, Level AAA

Not evaluated.

## How this was tested

- **Automated, in a real browser.** `apps/web/e2e/a11y-every-route.spec.ts` runs axe-core 4.14.0 (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`) through Playwright 1.63 in Chromium on 148 route cases, each at 1440×900 and 390×844 with the system set to light and to dark (592 page checks), and fails on any violation, any console error, and sideways scrolling on a phone. The cases cover every route in `apps/web/src/app/App.tsx` as the people who use it: funder admin, staff reviewer, guest reviewer (signed in from an invitation), applicant admin, consultant scoped to one draft, cowriter invited into a draft, and signed out. A route added to the router without an entry in `apps/web/e2e/a11y-routes.ts` fails the suite. The same spec opens 47 dialogs and the workspace menu and checks axe inside each, that Tab stays inside, that Escape closes it and that focus returns to its opener.
- **Dialogs found by crawling.** A script pressed every button on every route and recorded what opened: 55 distinct dialogs and menus; the 48 in the spec cover every kind, and the rest are the same dialog for another row (another tranche, another document).
- **Scripted manual checks**, on every route case: tabbing through every control at both widths (reached, focus ring present, not hidden by anything sticky, no trap); reflow at 320 and 640 CSS pixels; the WCAG text-spacing override; the colour of every text node against its background, and the outline of every form control; link names; image alternatives; autofill purposes; headings and landmarks.
- **In the unit tests** (jsdom): `apps/web/test/a11y.test.tsx` (axe on the routes and panels it lists, without the colour and layout rules jsdom cannot check) and `apps/web/test/a11y-fixes.test.tsx` (one regression test per class of fix, including the theme's non-text contrast computed from the tokens); `packages/notify` and `packages/documents` test the email document and the PDFs' language.
- **Code review** of the email templates and mailer, the PDF renderer, the sign-in paths and every component the scripts flagged.
- **Dark mode.** The GMS has one, light, theme. With the system set to dark it stays in that theme, and it was checked in both settings.

Run them:

```bash
pnpm --filter @gms/web e2e -- e2e/a11y-every-route.spec.ts    # every route and dialog, both widths, light and dark
pnpm exec vitest run --project web apps/web/test/a11y.test.tsx apps/web/test/a11y-fixes.test.tsx
```

## What this pass found and fixed (2026-11-16)

Counted once per issue under its main criterion; an issue is one component or one layout, however many screens show it.

| Criterion | Found | Fixed | What |
|---|---|---|---|
| 1.3.1 Info and Relationships | 16 | 16 | Page not found had no main landmark or level-1 heading; 13 labels on plain elements that do not expose them; the workspace menu held its items in a list; required fields said so only with a hidden asterisk (one component, 80 fields) |
| 1.3.5 Identify Input Purpose | 2 | 2 | Funder setup's organization name; organization fields typed on an application without Passport |
| 1.4.1 Use of Color | 1 | 1 | A licence link inside a checkbox label was not underlined |
| 1.4.3 Contrast (Minimum) | 1 | 1 | Resolved comments faded to 70% |
| 1.4.10 Reflow | 9 | 9 | Fund and template action rows, long status badges, a public page header that clipped its links at 390px, long email addresses, letter text, card footers, breadcrumbs, the agent consent header |
| 1.4.11 Non-text Contrast | 5 | 5 | Focus ring 2.95:1; field outlines 1.4:1; switch track 2.0:1; drawn checkboxes and radios 2.4:1; empty matrix cells 2.4:1 |
| 2.1.1 Keyboard | 6 | 6 | Table wrappers that could scroll but not take focus |
| 2.4.1 Bypass Blocks | 1 | 1 | No skip link (landmarks already met the criterion) |
| 2.4.3 Focus Order | 1 | 1 | Dialogs whose first field focuses itself dropped focus on the page when closed |
| 2.4.4 Link Purpose | 8 | 8 | "Open" and "Details" links and buttons |
| 2.4.7 Focus Visible | 2 | 2 | A hidden file input in the tab order; file buttons that did not show focus |
| 2.4.11 Focus Not Obscured | 5 | 5 | Settings side column and the opportunity apply bar on phones, the assignment matrix's sticky column, the panel's allocation card, the scoring footer |
| 2.5.2 Pointer Cancellation | 1 | 1 | Dialogs closed on the press outside |
| 2.5.3 Label in Name | 4 | 4 | Copy buttons named differently from their label; the awards list's View link |
| 2.5.8 Target Size | 1 | 1 | The reviewer's two visibility radios |
| 3.1.1 Language of Page | 3 | 3 | Emails, board docket PDF, send package PDF |
| 3.2.2 On Input | 1 | 1 | Arrowing through an assignee picker could open the invitation dialog unasked |
| 3.3.1 Error Identification | 6 | 6 | Field help and errors not tied to controls; application form errors; sign-in fields; scoring; an amount field; help ids that did not exist |
| 4.1.3 Status Messages | 2 | 2 | Banners after an action not reliably spoken; import and attach progress |
| **Total (product)** | **75** | **75** | |
| Demo-only boards and previews | 11 | 11 | Main landmarks, a checkbox name, scrolling tables, a cursor label and the email header mark's contrast |

Still open: the three partial items in the tables, all in generated PDFs (untagged, for 1.3.1 and 1.3.2; the language of three hashed PDF kinds, for 3.1.1).

## Known limits and plan

| Limit | Plan |
|---|---|
| **No screen-reader pass with real assistive technology.** Everything above is automated, scripted or read from code. | A pass with NVDA and Firefox, JAWS and Chrome, VoiceOver on macOS and iOS, and TalkBack, over the apply, review, award and payment flows; findings fixed and this report updated. |
| **PDFs are not tagged** (pdf-lib has no structure tree). | Keep offering the text: `answers.txt` in every send package, the panel screen for the docket. Add an HTML download of the board docket and the application snapshot, and evaluate a tagging step (for example a renderer that writes a structure tree) for agreements and letters. |
| **Award letters, agreements and snapshots have no PDF language**, because re-rendering a signed document must give the same bytes. | Version the renderer: documents rendered from the next version on carry their language; earlier ones re-verify with the version they were made with. |
| **Third-party pages** (Passport, Stripe, single sign-on, Google file picker, Userback, Composio) are not covered here. | Ask each vendor for its own conformance report; Passport's is kept with Passport. |
| **Font sizes in pixels** do not follow a browser's text-only size setting (page zoom works). | Move the type scale to `rem`. |
| **One theme.** There is no dark theme; with the system in dark mode the GMS stays light. | Not a WCAG requirement; a dark theme would be checked the same way before it ships. |
| **Demo-only boards and previews** (`/styleguide/`, `/preview/`) are fixed-width. | They are not shipped to people using the product; the real emails are fragments that wrap in any mail app. |

## Legal disclaimer

This report describes the GMS as of the date above, from the testing described. "VPAT" is a registered service mark of the Information Technology Industry Council (ITI). The GMS is open source: anyone may check these results by running the tests above, and report a problem through the contact above.
