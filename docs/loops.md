# Funder loops

How funders hear of the OpenGrants Grant Management System from the people already on it, and what
the GMS counts about it. Four pieces, all in v1.12.0 (E4):

1. **Invite a peer funder** (loop 1): a funder admin invites another funder by email.
2. **For funders** (loop 2, applicant demand pulls in funders): the send-to-funder package's footer
   links to `/for-funders?ref=<token>`.
3. **Intermediaries**: a workspace that runs several funds gets a co-branded onboarding link and can
   be listed in the partner directory at `/partners`.
4. **The reusable profile, made visible**: applicants see that their organization profile is reused
   by every funder they apply to here.

Code: `apps/api/src/services/peer-invites.ts`, `for-funders.ts`, `partners.ts`, `referrals.ts`,
`reusable-profile.ts`, routes in `apps/api/src/routes/gms/loops.ts`, TypeSpec in `api/loops.tsp`,
the email in `packages/notify/src/loops.ts`, migration `0047_funder_loops.sql`. Screens:
`screens/public/ForFunders.tsx`, `Partners.tsx`, `PartnersModeration.tsx`, `Join.tsx`,
`loopsParts.tsx`; `screens/funder/InviteFunder.tsx`, `PartnerSettings.tsx`;
`screens/applicant/YourProfilePanel.tsx`.

## 1. Invite a peer funder

Settings → **Invite a funder** (`/w/{handle}/settings/invite-funders`).

- A funder **admin**, signed in, types the peer's address and an optional note (up to 500
  characters, plain words: a note with a link or an email address is refused, `note_has_link`).
- **Preview first.** `POST /gms/peer-invitations/preview` returns exactly the email that would go
  out: From (the admin's account name on the GMS's sending address), To, Reply-To (the admin's
  sign-in address), subject, text and HTML, with the invitation's link token and a digest. Nothing is
  sent or counted.
- **Send.** `POST /gms/peer-invitations` with the same input, the token and the digest; a send that
  differs from the preview is refused (`409 preview_changed`).
- **One email, no reminders.** One invitation per address per workspace, ever (`409
  already_invited`). There is no reminder job and no tracking pixel; the email has one link.
- **At most five a week** per workspace (`PEER_INVITES_PER_WEEK`; over any seven days, and held per
  calendar week in Postgres by unique places, so parallel sends cannot pass it). `429
  too_many_peer_invites`.
- **Human only.** Agent and API-client tokens get `403 human_only`; no MCP tool sends one. Who may
  send is checked before the body is read. An API client with `workspace:admin` may read the list
  (`GET /gms/peer-invitations`).
- **The email's language** follows the sender (the language they read the preview in): the note is
  in their words.
- **The link** opens `/for-funders?invite=<token>`: "{inviter} at {funder} invited you", then
  funder setup's first step in place (below). A funder workspace made from it is counted for the
  invitation, by its id; the list shows each invitation masked (`p…@northwind.example`), Sent or
  Joined, and how many workspaces joined from it.

Stored (`peer_invitations`): the masked address, a SHA-256 of the workspace id and the address (to
refuse a second invitation), a SHA-256 of the link token, the week and place, status
(`sending` → `sent` → `joined`), sent date, how many joined and when first. Never the address in
full, the token or the note. A send still `sending` after 15 minutes (the Worker stopped before the
email went out) is cleared when the same address is invited again. Status moves go through `changeStatus` (guard → write → ledger).

## 2. For funders

`/for-funders` (public). The package footer (C4's send-to-funder package: the email, `answers.txt`
and the PDF) ends with the applicant workspace's link, `https://<host>/for-funders?ref=<token>`. The
token is the workspace's package link (`referral_links`, kind `package`), made on first use, and
opens a public page that grants nothing. The PDF prints a shorter line ("OpenGrants GMS, free for
funders · <host>/for-funders?ref=…") so it fits beside the page number in both languages.

- With `ref`, the page names the applicant's **region** (its Passport record's state or province, or
  the self-declared address's region; US states by name) and **"N organizations in {region} already
  keep their applications here"**.
- **The count is aggregate only.** It is given only when N ≥ 10 (`REGION_COUNT_FLOOR`); below that
  the API returns `null` and the page says organizations there keep their applications here, with no
  number. No organization is ever named, the applicant included.
- **Who counts:** an active applicant workspace in the same region (country and region) that keeps
  at least one application here, on the GMS or one it tracks itself
  (`COUNT_ONLY_WITH_AN_APPLICATION`; set it to false to count every applicant workspace). The count
  undercounts rather than overcounts and is cached ten minutes per Worker isolate.
- **"Receive applications here, free"** opens funder setup's first step in place, and a funder
  workspace made there is counted for the package link (a measure of the plan).
- An unknown or turned-off token reads as no token: the page is the generic one.

## 3. Intermediaries

A funder workspace that runs **two or more funds besides its default fund** (`MIN_NAMED_FUNDS`; C3's
funds) is an intermediary. Settings → **Partners** (`/w/{handle}/settings/partners`); below two
funds the page says so and links to Settings → Funds.

### The co-branded onboarding link

- An admin, in person, makes the link (`/join/<token>`), replaces it (the old one stops at once) or
  turns it off. The page names the intermediary and its funds (never the default fund) and shows a
  **logo the intermediary uploads**: PNG, JPEG or WebP (never SVG), up to 256 KB, checked by its
  first bytes, stored in the GMS's file storage and served by
  `GET /gms/public/join/{token}/logo` with `nosniff` and a sandboxing CSP. The logo must have **alt
  text**, required by the API and the database. Colours come only from the theme: the
  intermediary's brand colours are not used.
- **Grantees** go on into the normal applicant sign-up (`/onboarding/applicant`, which returns to
  the link's page to be counted, or is counted from the dashboard's profile panel when the person
  went through Passport). **Affiliated funders** set up a funder workspace on the page itself.
- The settings show how many workspaces joined from the link, never which.

### The partner directory

- An admin asks to be listed with the **region** they work in (`PUT /gms/partner-settings/listing`).
  Nothing is public until an **operator approves** it at `/partners/moderation`, or declines it with
  a reason the intermediary reads.
- `/partners` lists approved intermediaries that still run enough funds: name, region, number of
  funds, how verified (Verified by Passport, or Not verified), and a link to their public page.
- **Withdraw at any time** (`POST /gms/partner-settings/listing/withdraw`): a listed workspace leaves
  `/partners` at once; a pending request leaves the queue. After withdrawing or a decline it can ask
  again.
- **Moderators** are the operators in the Wrangler secret **`DIRECTORY_MODERATORS`**
  (comma-separated user ids or email addresses), or in `GALLERY_MODERATORS` while it is not set.
  Unset both, and nobody moderates. Moderating is a signed-in person's act; no agent reaches it.
- Statuses: `pending` → `approved` or `rejected`; `pending`/`approved` → `withdrawn`;
  `withdrawn`/`rejected` → `pending`. Each move is guard → write → ledger, on the intermediary's
  ledger.

## 4. The reusable profile

A panel on the applicant dashboard (desktop and phone) and at the top of the application editor:
"Your organization profile is reused by every funder you apply to here".

- `GET /gms/reusable-profile` returns the organization facts **a funder sees** when the organization
  applies, and nothing else: legal name, EIN, organization type, address, email, website and mission,
  from the Passport record or the self-declared profile (the same record a funder gets in the
  application under a live consent). Not the representatives, the payout destination or the Common
  App financials.
- **Verified through Passport** or **Self-declared, not verified**, each as icon and label.
- **Edit** links to Passport for a Passport record, or to the workspace's settings for a
  self-declared profile; **Verify with Passport** links to the Passport connection when the server
  offers it.
- In the apply flow, a field filled from the profile reads **From your profile (verified)** (from a
  Passport record) or **From your profile** (self-declared). Funders and reviewers still read "From
  Passport" and "Self-reported".

## Counting joins

`POST /gms/referrals/claim {workspaceId, source, token}` counts a workspace the person just made
for the link they came from: a person only, for a workspace they admin, made within the hour
(`REFERRAL_CLAIM_WINDOW_MS`), a funder workspace for invitations and package links, either kind for
onboarding links, and never a workspace of someone in the link's own workspace. Each workspace is
counted once (`referral_joins.joined_workspace_id` is unique). The join names the invitation or link
by id; who joined is never shown to the source. A refusal never blocks setup.

The page that sent the person keeps the link in `localStorage` (`gms.referral`, for one hour) so it
survives the sign-in; nothing else is stored in the browser.

### Measures for the operator

Read with the service role (no person reads `referral_joins`):

```sql
-- Workspaces made from each kind of link, by month.
select source, joined_kind, date_trunc('month', created_at) as month, count(*)
from public.referral_joins group by 1, 2, 3 order by 3, 1, 2;

-- Peer invitations sent and joined, by week.
select week_start, count(*) as sent, count(*) filter (where status = 'joined') as joined
from public.peer_invitations where status <> 'sending' group by 1 order by 1;
```

## Owner setup

- **`DIRECTORY_MODERATORS`** (API Worker secret, by name; never a `[vars]` entry, so moderators'
  addresses are not published in `wrangler.toml`): who moderates the partner directory. Optional:
  `GALLERY_MODERATORS` is used while it is not set.
- Apply migration `0047_funder_loops.sql`.
- Invitations need outbound mail (`RESEND_FROM` and the Resend key) like every other email; without
  it the preview answers `503 mail_not_configured`.
