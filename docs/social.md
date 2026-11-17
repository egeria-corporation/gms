# Social posting through Zernio

Funders announce open calls and awards on their own social accounts. Grantees share their award. A
reach report shows what each post did. Posting goes through [Zernio](https://zernio.com), a
posting API: the GMS calls it, and it hosts nothing for the GMS.

**Nothing posts without a person.** The composer shows the exact text, picture, accounts and time.
Only the person's click on **Post** (or **Schedule post**) on that preview sends it.

## What people see

- **Settings › Social accounts** (`/w/{handle}/settings/social`), in funder and applicant workspaces.
  - An admin connects LinkedIn, Facebook, Instagram, X, Bluesky or Threads. The workspace's Zernio
    profile is made on the first connection.
  - Zernio sends the browser back to this page. The GMS records the account only after it checks
    the return (see Connecting, below).
  - **Disconnect** removes the account at Zernio and here. An account disconnected at Zernio shows
    as disconnected here too.
- **Share on social media**, a card mounted on:
  - the opportunity's Publish step;
  - the funder's award screen;
  - the grantee's award screen.
- The card offers **Write a post** when:
  - the subject may be posted about;
  - an account is connected;
  - the person may post.
- **The composer** starts from the subject:
  - **An open or forecasted call** (published, with Public page on): its title, the funder, its
    deadline or opening date, the public page link with `utm_source=social`, and the call's share
    card (G1a's `/og/f/{handle}/o/{slug}.png`).
  - **An award:** C1's share kit, with the same link rule. An award is offered only when C1's
    `isPubliclyListable` says it is public. Until the integrator wires C1, no award is offered:
    `apps/api/src/services/social-award-share.ts` is a stub that says no.
- **In the composer**, the person:
  - edits the text;
  - picks accounts;
  - keeps or drops the share card;
  - sees the length on each chosen platform.

  Then **Preview** shows exactly what goes out, and **Post** sends it. Schedule takes a date and
  time with a time zone (IANA), at least five minutes and at most a year ahead.
- **Reach** lists each post:
  - its status: Sending, Scheduled, Published, Partly published or Failed, each an icon and a label;
  - each account, with a link to the post on the platform once it is out;
  - Zernio's counts: impressions, clicks and engagements, where Zernio reports them.

  Per call it also counts the applications started from a shared link.

Length limits (characters; X counts every link as 23, Bluesky counts what a reader sees as one):

| Platform | Limit | Note |
| --- | --- | --- |
| LinkedIn | 3,000 | A LinkedIn organization page is chosen on LinkedIn's own screen |
| Facebook | 63,206 | A Facebook page is chosen on Facebook's own screen |
| Instagram | 2,200 | Needs a picture: keep the share card |
| X | 280 | Zernio's name for it is `twitter` |
| Bluesky | 300 | |
| Threads | 500 | |

## "Meet our grantees" (v1.12.0)

On the funder's award screen, **Meet our grantees** opens the composer for the award's program: one
post introducing the program's grantees.

- It lists only the program's awards that award sharing's `isPubliclyListable` says may be public:
  never a confidential award, never one while the funder does not list awards, never one to an
  individual or not yet accepted, and never one whose grantee chose **Don't list us publicly**. At
  most ten, newest first (`MEET_GRANTEES_MAX`).
- A grantee's page is tagged (its `@handle` written beside its name) only when the grantee gave its
  page's link in its share-kit settings **and** agreed to be tagged ([award-sharing.md](award-sharing.md#share-kit-settings)).
- The person keeps or drops each grantee's line; the text is written again from the lines kept, and
  can be edited. The picture is the funder's grants-awarded card (`/og/f/{handle}/awards.png`); the
  link is the grants-awarded page with `utm_source=social`.
- Preview and the click on Post, as for every post. The post's subject is the program
  (`subject_type = 'program'`, migration 0048); the database checks the program is the funder's own.

`GET /gms/social/compose?subjectType=program&subjectId={program}` returns the draft with `grantees`
(each line, name and tag) and `parts` (the opening and closing lines). A grantee workspace has no
such draft (404).

## "Two weeks left" (v1.12.0)

- **The prompt.** The jobs Worker's `social-reminders` run (14:40 UTC daily, before the daily digest;
  `promptSocialReminders`) records one prompt (`social_reminder_prompts`) per open, published call
  with its public page on, whose deadline (`closeDate`) is 14 days away (`REMINDER_LEAD_DAYS`; a run
  missed by a day still catches it at 13, `REMINDER_WINDOW_DAYS`), in a workspace with a connected
  account. **Once per call**: a call never gets a second prompt, even if its deadline moves. It writes
  a record and the ledger line `social.reminder_prompted`; it never calls Zernio and never posts.
- **Who sees it.** The call's funder **admins**: in their notifications ("Post a reminder? Two weeks
  left: {call}", category `social_reminder`) and, if they chose a daily or weekly digest, as a line in
  it. It is hidden once dismissed, once the deadline has passed or the call is no longer open, and on
  a server where social posting is not set up.
- **What it does.** The notification opens the call's Publish step with the composer on the
  reminder ("Two weeks left to apply: {call}, from {funder}. Apply by {date}." and the link). The
  panel shows **Two weeks left** with **Post a reminder** and **Dismiss**. Posting is the person's
  click on Post after the preview, as always.
- **Dismiss** (`POST /gms/social/reminders/{id}/dismiss`): a funder admin, in person; the prompt is
  gone for the workspace and never comes back for that call. Ledger `social.reminder_dismissed`.

## Who may do what

| Action | Who | Agents and API clients |
| --- | --- | --- |
| Read accounts, drafts, posts and reach | Funder staff (`analytics:read`), applicant staff (`awards:read`) | Yes, with the scope. MCP: `list_social_posts` |
| Preview, post, schedule | A signed-in person who is an admin or editor (funder: admin, program officer; applicant: admin, editor) | Refused: 403 `human_only` |
| Connect, disconnect | A signed-in workspace admin | Refused: 403 `human_only` |
| Dismiss a "Two weeks left" prompt | A signed-in funder admin | Refused: 403 `human_only` |

There is no MCP tool that posts, schedules or connects an account. An agent may draft text through
the existing assistant tools and read the composer's starting draft (`GET /gms/social/compose`). It
can never send.

## How it holds

- **One Zernio profile per workspace.** `externalId` is the workspace id. A post names only that
  workspace's own connected accounts. The service checks this, and so does a trigger on
  `social_posts`. One Zernio account belongs to one workspace (a unique key).
- **Connecting.** The GMS seals a state into the address Zernio returns to (`gs`):
  - what it carries: workspace, person, platform, a nonce;
  - expiry: ten minutes;
  - signature: HMAC with a key derived from the Zernio key.

  On the way back the GMS checks:
  - that the state is unaltered;
  - that it was issued for this person, in this workspace, and has not expired;
  - that the returned `profileId` is this workspace's profile;
  - that Zernio lists the `accountId` under that profile, with that platform.

  Anything else is refused: 403 `connect_state_invalid` or 409 `account_not_listed`. The query
  string is never trusted alone.
- **Preview equals sent.** One function, `buildPostBody` in `packages/social`, builds the body. The
  preview returns the body and a token that names its SHA-256 (sealed, an hour). On Post the server
  builds the body again from the input and refuses it unless:
  - the token is this person's;
  - its digest is the same (409 `preview_changed`).
- **Once per post.** The composer makes one `Idempotency-Key` (a UUID) per logical post and sends
  it on every retry. The GMS passes it to Zernio:
  - The same key again returns the post already made.
  - If Zernio did not answer, the post stays Sending: posting again sends the same key, and Zernio
    returns the original.
  - The same key with other content is refused (409 `idempotency_key_reused`).
  - Zernio's 409 (the same content to the same account within a day) counts as sent. When the
    earlier post is this workspace's, the click is that post.
- **Webhook.** Zernio's events land at `POST /webhooks/zernio`:
  - `X-Zernio-Signature` is checked first: a lowercase hex HMAC-SHA256 of the raw body with
    `ZERNIO_WEBHOOK_SECRET`, compared in constant time.
  - A bad signature answers 401 and stores nothing.
  - A delivery is stored once in `inbound_events`, by its event id, keeping only its facts: type,
    profile, account and post ids.
  - A replay answers `duplicate`.
  - A delivery whose timestamp is more than a day old is refused (`REPLAY_WINDOW_MS`).
  - The body, as Zernio's docs give it (checked 2026-11-15): `{ id, event, post: { id, status,
    platforms: [{ platform, status, platformPostUrl }] }, profiles: [{ id, externalId }] }`. A
    platform entry without an account id is matched to the post's one account on that platform.
  - An event is routed by `profiles[].externalId` (the workspace id) and applied only to a workspace
    whose own Zernio profile it is (the listed profile id must be that workspace's when given); an
    event naming more than one of our workspaces is applied to none. It touches only that workspace's
    accounts and posts.
  - Events used: `account.connected`, `account.disconnected`, `post.scheduled`, `post.published`,
    `post.partial`, `post.failed` and `post.cancelled` (a scheduled post Zernio cancelled because its
    account was disconnected: it shows as not sent, with our own sentence). Others are acknowledged
    and dropped.
- **Counts.** Zernio's counts are read during the reach report:
  - at most ten Zernio calls per report;
  - kept for half an hour (`METRICS_TTL_MS`).

  A post still Sending, or Scheduled past its time, is read again too.
- **Hidden when not set up.** Without both `ZERNIO_API_KEY` and `ZERNIO_WEBHOOK_SECRET`, every
  `/gms/social` route and the webhook answer 404, whether or not the caller is signed in.
  `/gms/config` says `available.social: false`, and the web app shows no social control.
- **Status changes** go through `changeStatus` (guard, write, ledger). Ledger events:
  - `social.profile.created` and `social.connect.started`;
  - `social.account.connected` and `social.account.disconnected`;
  - `social.post.scheduled`, `social.post.published`, `social.post.partial`, `social.post.failed`,
    `social.post.sent` and `social.post.duplicate`.

  A person's post is recorded as theirs. A webhook's change is recorded as `system:zernio-webhook`.

## What is stored (migration 0038)

| Table | Columns |
| --- | --- |
| `social_profiles` | workspace, Zernio profile id |
| `social_accounts` | workspace, Zernio account id, platform, username, status, who connected it and when |
| `social_posts` | workspace, subject (opportunity or award) and its id, Idempotency-Key, SHA-256 of the body sent, Zernio post id, platforms, per-account status and link, schedule and time zone, a plain error sentence, counts (impressions, clicks, engagements), who sent it and when |

Never stored:

- a token or password;
- the text of a post (it lives at Zernio and on the platform);
- an inbox message;
- a follower list;
- Zernio's own error text.

Staff of the workspace read the rows (RLS, `gms.is_staff`). Every write goes through the API.

## Applications started from social

Shared links carry `utm_source=social`. The opportunity page remembers such a visit in that browser
tab only (`apps/web/src/lib/socialLanding.ts`, sessionStorage, per funder and opportunity), and an
application started there is started with `POST /common-grants/applications/start?utm_source=social`:
the source travels in the query string because the CommonGrants start body takes no other field.
Only `social` is recorded (`START_SOURCES` in `services/apply.ts`), as the `started` event's
`payload.utmSource`; the reach report counts the call's applications whose `started` event has it.
Nothing else about the visit is kept.

## Setting it up (the owner)

1. In Zernio, create an API key. Store it as a Wrangler secret on the API Worker:
   `wrangler secret put ZERNIO_API_KEY`.
2. In Zernio's dashboard, add a webhook endpoint:
   - **URL:** `{GMS_BASE_URL}/webhooks/zernio`, for example `https://gms.opengrants.io/webhooks/zernio`.
   - **Events:** `account.connected`, `account.disconnected`, `post.scheduled`, `post.published`,
     `post.partial`, `post.failed`, `post.cancelled`.
   - **Profiles:** all. Each workspace's profile is created on its first connection, so a list of
     profile ids would miss new ones.
3. Choose the endpoint's signing secret (Zernio never generates one: you set it on the endpoint) and
   store the same value as `wrangler secret put ZERNIO_WEBHOOK_SECRET`.
4. Deploy the API (it holds migration 0038) and the web app. Once both secrets are set,
   `/gms/config` reports `available.social: true`.

Neither secret is ever logged. Rotating the API key ends any connection link or preview in flight:
the person starts again.

## Routes

- `GET /gms/social`: the settings.
- `POST /gms/social/connect` (`{ platform }`): start connecting.
- `POST /gms/social/connect/callback`: record the account.
- `DELETE /gms/social/accounts/{id}`: disconnect.
- `GET /gms/social/compose?subjectType=&subjectId=`: the composer's starting draft.
- `POST /gms/social/posts/preview`: the exact post and a token.
- `POST /gms/social/posts` (with an `Idempotency-Key` header): post or schedule.
- `GET /gms/social/posts?subjectType=&subjectId=`: the reach report.
- `POST /webhooks/zernio`: Zernio's events.
- `POST /gms/social/reminders/{id}/dismiss` (v1.12.0): dismiss a call's "Two weeks left" prompt.

The TypeSpec is in `api/social.tsp` and (v1.12.0) `api/award-kit.tsp`.

## What is stored (migration 0048)

- `social_reminder_prompts`: workspace, call, the deadline it was made for, when, and who dismissed it
  and when. One per call (unique). Read by the workspace's staff; written by the API and the jobs Worker.
- `social_posts.subject_type` takes `program`.

## Code

| Where | What |
| --- | --- |
| `packages/social` | The port, the HTTP client, the fake Zernio, the platforms and limits, the body builder, the webhook check and sealed tokens |
| `apps/api/src/services/social.ts` | The rules and the authorization |
| `apps/api/src/routes/gms/social.ts`, `apps/api/src/routes/zernio-webhook.ts` | The routes |
| `apps/web/src/screens/shared/SettingsSocial.tsx`, `apps/web/src/components/{SocialPanel,PostComposer,ReachPanel}.tsx` | The screens |
| `apps/web/src/mocks/social.ts` | Mock mode, against the fake through the real client |

Tests:

- `packages/social/test`;
- `apps/api/test/social.test.ts` and `contract-social.test.ts`;
- `apps/web/test/social.test.tsx`;
- `apps/web/e2e/flow23-social-post.spec.ts`;
- `supabase/tests/database/14_social_posting.test.sql`.
