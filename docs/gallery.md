# The template gallery

A public gallery of ready-to-use application forms, rubrics, report forms, email templates and
program kits (an application form, a rubric, a report form and emails together). Anyone can browse
and preview it at `/templates`; a funder copies an item into its own workspace in one step. Funders
can share their own forms, rubrics and email templates back, after a moderator reviews them.
Everything in the gallery is shared under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
and the pages say so.

Added with migration `0036_template_gallery`.

## What a visitor sees

- **`/templates`**: every approved item, most used first, with its kind, summary, tags, author and
  uses count. Filters: kind, one tag (field of work, grant size or audience) and words. Filters live
  in the address (`?kind=rubric&tag=Health&q=report`), so a filtered view can be shared.
- **`/templates/{slug}`**: a read-only preview of the content: each form drawn by the form renderer
  in print mode (the same renderer applicants use), the rubric's criteria with scale, weight and
  scoring guidance, and each email's subject and text. Beside it: kind, what it includes, version,
  published date, uses, tags, the licence, and **Use this template**.
- **The author line** is the sharing workspace's display name, with "Verified by Passport" only when
  that workspace is linked to a Passport organization, and "Not verified" otherwise. The starter
  items read "OpenGrants starter library".

No sign-in is needed to browse or preview. The API serves the pages' data at `GET /gms/gallery` and
`GET /gms/gallery/{slug}` (no token, `Cache-Control: public, max-age=60`). Nothing else of the
gallery is public: the tables have no anonymous access at all (see Privacy).

## Use this template

- **Signed out**: the button sends the visitor to sign in or sign up
  (`/signin?next=/templates/{slug}?use=1`) and back; the copy dialog then opens by itself.
- **Signed in with a funder workspace** where the person is an admin or a program officer: the
  dialog asks which workspace (when there is more than one) and copies. The result links to each
  new record: a form opens in the form builder, a rubric is chosen on a competition stage, an email
  template is in Communications.
- **Any other role in a funder workspace**: the page says the role cannot add templates.
- **Only applicant workspaces**: no button. An applicant workspace has no forms, rubrics or email
  templates of its own, so there is nothing to copy into; the page links to funder setup instead.

A copy (`POST /gms/workspaces/{workspaceId}/gallery/items/{slug}/copy`) runs through the same
create paths as the screens, so every rule holds:

- each form becomes a new **draft** form (`createForm`, with the definition checks), version 1;
- the rubric becomes a new rubric of the workspace (`createRubric`, checked against the rubric
  input schema);
- each email becomes a new email template (`createTemplate`). A name the workspace already uses gets
  "(from the gallery)", so a copy never becomes a new version of the workspace's own template.

Every permission is checked before the first record is made (`forms:write`, `reviews:write`,
`communications:write` with an admin or program officer role, as the kind needs), so a copy is never
left half done. The copies are the workspace's own: later changes to the gallery item never reach
them, and editing them never reaches the gallery. The item's uses count goes up by one, and the
ledger records `gallery.copied` in the workspace.

## Sharing to the gallery

A funder workspace **admin**, signed in (no API token, no agent), shares from the record's own
screen:

- a **form**: "Share to the gallery" in the form builder. The gallery takes the latest published
  version (a draft form with no published version is refused: `409 form_not_published`). Forms used
  for applications and letters of intent become application forms; report forms become report forms;
  other purposes are refused;
- a **rubric**: on a competition's Rubrics card;
- an **email template**: in Communications, beside a saved email template. Letters and agreements
  stay with the workspace.

The dialog previews exactly what will be shared before anything is sent
(`POST /gms/workspaces/{workspaceId}/gallery/preview`, saves nothing):

- **Contact details are taken out.** A field's default value (or example) and any help text
  (a field's description, a control's help or placeholder, a criterion's description or scoring
  guidance) that holds an email address, a phone number or a web address is dropped whole. In all
  other text (titles, labels, instructions, email subject and body) each one is replaced:
  `[email address]`, `[phone number]`, `[web address]`. Web addresses on the funder's own site (the
  website on its organization record, and its subdomains) stay. Email addresses always go.
- **The organization's names become "[Your organization]"**: the workspace's display name, legal
  name and Passport name, whole words in any case. The person can add more names (a program's, a
  person's, a town's) and update the preview.
- The list of what was taken out says where and what kind of detail it was, never the value.

The person then writes a title and a short summary (both cleaned the same way), picks tags from the
fixed vocabularies, and agrees to share under CC BY 4.0. `POST /gms/workspaces/{workspaceId}/gallery/submissions`
stores the cleaned snapshot as a pending submission. One submission of the same record waits at a
time (`409 already_submitted`).

**Forms → Shared to the gallery** lists what the workspace shared: waiting for review, published
(with its address), declined (with the moderator's reason) or withdrawn. An admin can withdraw a
pending or a published item at any time; a published item leaves the gallery at once. Copies others
already made stay theirs.

## Moderation

Operators listed in the setting **`GALLERY_MODERATORS`** (comma-separated user ids or email
addresses; a variable, not a secret) review submissions at `/gallery/moderation` (linked from the
gallery for them). Each card shows the summary, tags, the author and its verification, what was
taken out, and a preview of the content. A moderator:

- **approves**: the snapshot becomes a public gallery item, version 1, at an address made from the
  title (`/templates/{slug}`), attributed to the sharing workspace;
- **declines with a reason** (3 to 2,000 characters) the author reads beside the submission.

Without the setting nobody moderates and nothing new is published. Moderation needs a signed-in
person; the API answers `403 not_a_moderator` to anyone else.

The moves run through `@gms/workflow` (`packages/workflow/src/gallery.ts`): guard, write (only if
the status is still the one read), ledger. Statuses: `pending → approved | rejected` (a moderator),
`pending | approved → withdrawn` (the author). The ledger events go to the author's workspace:
`gallery.submitted`, `gallery.item_approved`, `gallery.item_declined`, `gallery.item_withdrawn`.
No webhook is sent.

## Agents

Agents get the reads only: the funder-side MCP tools `search_gallery` (kind, tag, words) and
`get_gallery_item` (by slug), with `forms:read`. There is no tool to copy, share, withdraw or
moderate; sharing and moderating are refused to any token over REST too (`403 human_only`,
`person_required`).

## The starter library

Nine items ship with every install, in the migration itself, so the hosted site starts with them:

| Slug | Kind |
|---|---|
| `common-application` | Application form |
| `general-operating-support` | Application form |
| `small-capacity-building` | Application form |
| `five-criterion-rubric` | Rubric (need and fit, approach, capacity, budget, community impact, 1 to 5 with guidance) |
| `interim-report` | Report form |
| `final-report` | Report form |
| `award-letter-email` | Email template |
| `decline-email` | Email template |
| `small-grants-program-kit` | Program kit: the common application, the rubric, the final report, the award and decline emails |

The content is written in `apps/api/src/services/gallery-starters.ts` and generated into the
migration and into the mock-mode fixture by `node --experimental-strip-types apps/api/scripts/gallery-starters.ts`;
a test fails if either drifts, and checks that every starter form passes the form builder's checks,
every rubric the rubric schema, and every email renders with the merge fields the GMS fills in. Once
0036 is applied on a database, a change to the starters needs a new migration as well.
`supabase/seed.sql` adds demo rows only: one item a funder published, one submission waiting for
review and one declined with a reason.

## Privacy and data

- `gallery_items`: what the gallery publishes (`status` `approved` or `withdrawn`), its snapshot,
  tags, author workspace (null for the starter library), licence (always `CC-BY-4.0`, a check),
  uses count and version.
- `gallery_submissions`: what a funder workspace shared (funder workspaces only, a trigger), the
  record it came from and that record's version (never shown publicly), the cleaned snapshot, what
  was stripped (paths and kinds, no values), and the moderator's decision.
- RLS on both, no anonymous grants. Signed-in members read their own workspace's submissions and
  items (staff only); everyone else reads approved items through the API. Every write goes through
  the API's service role.
- A snapshot is a copy taken when the item was shared; it never links to the author's live record.
- No bank or identity data, no money.

## For integrators

The public pages' title, description and social preview for `/templates/{slug}`, for the front
worker to serve: title `"{title} — Template gallery — OpenGrants GMS"`,
description the item's summary, `og:type` `website`, `og:url` the page address, and `og:title` /
`og:description` the same as title and description.
