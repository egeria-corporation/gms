# Opt-in digests (v1.9.0)

Three Monday emails a person chooses, per workspace. Each is **off until the person turns it on**,
goes out only when there is something new, and can be stopped from any email with one click.

| Digest | Who can turn it on | What it lists |
|---|---|---|
| **New matches** (`new_matches`) | Applicant workspaces: admin, editor, finance, viewer | Up to 10 new funding opportunities that fit the organization: open competitions on this GMS whose eligibility check says yes, then OpenGrants matches. Never one already sent to this person, saved in Discover, tracked as an outside application or applied to. |
| **Deadlines** (`deadlines`) | Applicant workspaces: admin, editor, finance, viewer | Deadlines in the next 21 days, as the calendar feed lists them: outside applications' letter of inquiry, full and internal deadlines, the current stage of built-in applications in progress, reports due to funders. A deadline the daily reminder emailed this person the same day is left out. |
| **This week's activity** (`funder_activity`) | Funder workspaces: admin, program officer, finance | Counts with links: applications submitted in the last 7 days, reviews not yet submitted that are due within 7 days or late, payments due or ready (or scheduled within 7 days), reports overdue. No applicant, title or answer is ever named. |

Consultants (including people invited to write one draft), reviewers, observers and auditors get
none of them. The roles are one constant, `DIGEST_ROLES` in `apps/api/src/services/content-digests.ts`.

## Where people choose

- **Notifications → Digest settings → What we email you**, for any of their workspaces (funder staff
  choose here).
- **Workspace settings → What we email you** in an applicant workspace (the same choices).
- A **one-time prompt**: "Get new matches every Monday" on Find funding, "Get this week's activity
  every Monday" on the funder dashboard. "Turn it on" or "Not now" puts it away for good (per person
  and workspace).
- Each digest that is on has **Preview next Monday's email**: the subject and text as they would be
  written now. Nothing is sent or recorded.

Turning a digest on or off is the person's own choice: `PUT /gms/digests` refuses agent and API-client
tokens (403 `person_required`), and no MCP tool changes it. Agents may read the settings and the
preview (`get_digest_preview`, scope `applications:read`).

## When they go out

The jobs Worker's one cron tick runs `content-digests` on **Mondays at 15:10 UTC**, five minutes
after the weekly event digest (`CONTENT_DIGEST_SCHEDULE`). For every membership with a digest on it:

1. skips it unless the membership is still live, its role still gets that digest and the person has
   an address (a person removed from the workspace stops getting it; the choice is deleted with the
   membership, so someone added back starts from off);
2. skips a digest already sent to this person this ISO week (`digest_sends`, unique per workspace,
   person, digest and week; Resend's idempotency key names the membership, digest and week);
3. builds it, and skips it when there is nothing new;
4. sends it and records the send (with the matches it named, so they are never sent again).

The event digests (`digest-daily`, `digest-weekly`) and the daily `outside-deadlines` reminders are
unchanged.

### OpenGrants

New matches read Discover the way the person would: `discoverCompetitions` and `openGrants(…, "match")`
under the person's own role, through the same authorization and the same 15-minute cache. One run
asks OpenGrants at most once per applicant workspace and at most `MAX_OPENGRANTS_CALLS_PER_RUN` (100)
times. When OpenGrants cannot be reached or answers with an error status (a 429 included), nothing more is asked of it in
that run; each person gets the part from this site with the line "We couldn't reach OpenGrants this
week…", or no email when that part is empty. Without a mission statement the email says how to get
OpenGrants matches. Without `OPENGRANTS_API_KEY` on the jobs Worker, matches come from this site only.

## Every email

- a plain-text and an HTML part, no images, no tracking pixels and no links but the GMS's own
  (an OpenGrants listing links to the person's Find funding screen);
- **one-click unsubscribe** for that digest alone: the body link opens
  `/digests/unsubscribe#token=…` in the web app, which turns it off as the page opens, no sign-in;
  the `List-Unsubscribe: <https://…/gms/digests/unsubscribe?token=…>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers let mail apps do the same with one POST
  (RFC 8058). Opening the header's address in a browser changes nothing: it redirects (303) to the page;
- the footer says why the person gets it and links to their settings.

The token is `v1.<membership id>.<digest>.<expiry>.<HMAC-SHA-256>`. The signing key is derived with
HKDF from `CREDENTIALS_ENCRYPTION_KEY` (label `content-digest-unsubscribe-v1`), so no new secret is
needed and the encryption key itself never signs. A link works for 90 days (`UNSUBSCRIBE_TTL_DAYS`);
a forged or altered one answers 400 `invalid_link`, an old one 410 `link_expired`. Rotating
`CREDENTIALS_ENCRYPTION_KEY` invalidates links already sent (people can still unsubscribe in the app).
Without `CREDENTIALS_ENCRYPTION_KEY`, a mailer or `RESEND_FROM`, no content digest is sent.

## Routes

| Route | Auth | What it does |
|---|---|---|
| `GET /gms/digests` | person or agent | The digests offered to the caller here, which are on, whether the prompt was dismissed, the next Monday. |
| `PUT /gms/digests` | the person only | `{ new_matches?, deadlines?, funder_activity?, promptDismissed?: true }`. 422 `digest_not_offered`. |
| `GET /gms/digests/preview?digest=` | person or agent | Next Monday's email for the caller, not sent. |
| `POST /gms/digests/unsubscribe` | none (the signed token) | Token in the query (mail apps) or `{ token }` (the web page). |
| `GET /gms/digests/unsubscribe` | none | 303 to the web page; changes nothing. |

## Data

Migration `0041_content_digests.sql`:

- `digest_subscriptions`: one row per membership that touched these settings (`member_id` unique,
  deleted with the membership), three booleans defaulting to false and `prompt_dismissed_at`. A
  trigger keeps the row on its membership's own workspace and person, and refuses new matches or
  deadlines in a funder workspace and funder activity in an applicant one.
- `digest_sends`: one row per workspace, person, digest and ISO week, with `item_keys` (`gms:<opportunity
  uuid>`, `og:<listing id>`) and the provider's message id.

Both have RLS on; the service role writes; a member reads only their own rows in a workspace they still
belong to (pgTAP `41_content_digests.test.sql`).

## Before turning it on for an installation

- Set `OPENGRANTS_API_KEY` (and `OPENGRANTS_API_URL` if not the default) on the **jobs** Worker too,
  for OpenGrants matches. Without it the emails list this site's opportunities only.
- `CREDENTIALS_ENCRYPTION_KEY`, `RESEND_API_KEY` and `RESEND_FROM` must be set on both Workers.
- Keep open and click tracking off for the sending domain in Resend: the GMS adds none, but Resend can
  add it per domain.
