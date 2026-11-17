# Syndication: open-call feeds, Philanthropy News Digest, the OpenGrants index

Where a published call goes besides its own page (`/f/{handle}/o/{slug}`). Everything shared is
what that page already shows, and every link back to it says where it came from (`utm_source`), so
the funder sees which channel brought applicants. On the opportunity's **Publish** step the
**Share this call** panel holds it all (`apps/web/src/screens/funder/SyndicationPanel.tsx`); the
rules live in one service, `apps/api/src/services/syndication.ts`.

| Channel | How it works | Who acts |
|---|---|---|
| Open-call feeds (JSON, CSV, RSS) | Public feeds newsletters and partners read | Nobody: on by default, the funder may take a call out |
| Philanthropy News Digest (Candid) | One email to PND's RFP address, previewed first | A person who edits calls, once per call |
| OpenGrants index | A feed of CommonGrants records for OpenGrants to pull | Nobody: `publish.openGrantsIndex`, on by default |

## Open-call feeds

```
GET /gms/public/feeds/opportunities.json   JSON Feed 1.1 (application/feed+json)
GET /gms/public/feeds/opportunities.csv    CSV (text/csv)
GET /gms/public/feeds/opportunities.rss    RSS 2.0 (application/rss+xml)
```

On gms.opengrants.io the front Worker forwards `/gms/` to the API, so these are
`https://gms.opengrants.io/gms/public/feeds/opportunities.rss` and so on. No token, any origin.

**Which calls.** Published, open or forecasted, with the public page on, under an active funder,
and not taken out of the feeds (`publish.feeds: false`; absent means on). Newest first, at most
`FEED_MAX_ITEMS` (500). Closed, draft and unlisted calls never appear.

**Filters** (any other parameter, such as a newsletter's `utm_campaign`, is ignored; a bad value is 400):

| Parameter | Matches |
|---|---|
| `funder` | The funder's handle, as in `/f/{handle}` |
| `region` | A US state or territory by code or name (`OR`, `oregon`), or any other region as written. A state matches its name in the call's title, description or eligibility labels, or its code in an eligibility label ("Based in OR or WA"); a longer state name that holds it ("West Virginia" for "Virginia") does not count. The values behind the eligibility rules are never read: the page does not show them. |
| `category` | A fund's name or slug. The GMS has no topic tags; a fund other than the funder's default is the one category its pages name ("{Fund} · A fund of {Funder}"). |
| `closingWithin` | 1 to 365: calls whose deadline (`keyDates.closeDate`) is today or within that many days |

**Fields** (each item; the JSON feed puts them under `_gms`, beside JSON Feed's own `id`, `url`,
`title`, `content_text`, `date_published`, `authors` and `tags`): `id`, `title`, `description`,
`status`, `acceptingApplications`, `funder` (name, handle, page), `category` (name, slug, page, or
null), `funding` and `keyDates` (CommonGrants `OppFunding` and `OppTimeline`, as on the page),
`opens`, `closes`, `acceptedApplicantTypes`, `eligibility` (the rule labels), `publishedAt`, and
`link`, the public page with `utm_source=feed`. Each item is built from the same data as the page:
`feedItemOf(opportunityPage(…))` equals the feed's item (apps/api/test/syndication.test.ts), so a
field the page does not show cannot reach a feed. No custom fields, rule values, draft
competitions, settings or EIN.

**CSV columns** (stable English names, like an API's fields): `id, title, funder, funder_handle,
status, accepting_applications, opens, closes, min_award, max_award, total_available, currency,
applicant_types, eligibility, category, published_at, link, description`. Every cell is
formula-safe: one that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading
apostrophe (`@gms/importers` `csvCell`).

**RSS**: RSS 2.0 with `atom:link rel="self"`; each item has `title`, `link`, `guid`
(`urn:uuid:{id}`, not a permalink), `pubDate`, `description` and the fund as `category`. Characters
XML 1.0 does not allow are dropped and the rest escaped; the test parses it with a strict XML parser.

**Caching**: `Cache-Control: public, max-age=300, s-maxage=900` and a SHA-256 `ETag`; a matching
`If-None-Match` answers 304. The body carries no clock time, so an unchanged feed keeps its ETag.

The channel's title and description are in English (`syndication.feed.*` in the `email` catalog):
feeds are machine interfaces, like the API.

## Philanthropy News Digest

**What Candid says** (research 2026-11-17, Candid's own page
https://philanthropynewsdigest.org/rfps, the same text on its search pages):

> Philanthropy News Digest publishes Requests for Proposals (RFPs) and notices of awards as a free
> service for U.S.-based nonprofit and grantmaking organizations.
>
> To have your RFP considered for publication, please email pndrfp@candid.org with a Word
> document, text-only file, or link to a Web site explaining the program scope, grantee
> qualifications, application instructions, and deadlines. We require notice of funding
> opportunities four weeks in advance of their deadline.

Candid's weekly RFP Bulletin footer words the same rule as "RFPs must be received at least four
weeks before the earliest deadline date". So PND takes RFPs **by email**, not through a web form;
the fields are program scope, grantee qualifications, application instructions and deadlines; the
listing is free; and it must arrive four weeks before the earliest deadline. No fee and no form
were found. (This session's network could not open philanthropynewsdigest.org directly; the page
was read through a search service's copy. Check it again before relying on a change.)

**What the GMS does.** Under *Philanthropy News Digest* in Share this call:

1. The panel shows the date by which to send: four weeks (`PND.leadDays`, 28 days) before the
   earliest deadline still ahead, which is the call's closing date or the closing date of a stage of
   its public competitions (a letter of intent due first counts). A call without a deadline can go
   any time.
2. **Preview the email to PND** shows exactly what would be sent: to `pndrfp@candid.org`, from the
   funder's name on the GMS sending address (`RESEND_FROM`), replies to the funder's public contact
   address (Settings › Public page), else to the person's own address, subject "RFP for
   Philanthropy News Digest: {title} ({funder})", and PND's fields filled from the public page:
   Funder, Opportunity, Program scope (description and funding), Grantee qualifications (applicant
   types and eligibility labels), Application instructions (the page, with `utm_source=pnd`),
   Deadlines (every dated key date), Full RFP (the link) and Contact. The email is in English, as
   PND publishes.
3. **Send to PND** sends it through Resend if it is still exactly the preview (a digest ties the
   two; 409 `preview_changed` otherwise), with idempotency key `pnd:{opportunityId}`.

Rules:

- **A person only.** Admins and program officers, signed in. Agent and API-client tokens get 403
  `human_only` on both the preview and the send; no MCP tool sends. Nothing is sent without the
  preview and the click.
- **Once per call.** `syndication_sends` (migration 0045) has a unique (opportunity, target): a
  second send is 409 `pnd_already_sent`, also when two clicks race. A failed send (502
  `mail_failed`) removes its claim, so the person can try again; a claim left by a send that never
  finished is taken over after 15 minutes, and Resend's idempotency key keeps that from sending
  twice.
- **Not too late, not closed, not unlisted.** 409 `pnd_too_late` after the send-by date,
  `pnd_call_closed` for a closed call, `pnd_not_listed` without a live public page; 422
  `pnd_no_reply_to` when there is no address for replies; 503 `mail_not_configured` without Resend.
- **What is kept.** Who sent it, when, PND's address, the reply-to masked (`g…@example.org`), the
  SHA-256 of the email and Resend's message id. No email body. Ledger: `opportunity.syndicated`
  with the target, the masked reply-to and the digest.

The GMS never fills in or scripts a web form; should PND move to one, the panel would show the
fields ready to copy and a button that opens the form.

## The OpenGrants index

Calls carry `publish.openGrantsIndex` (on by default; *Publish targets › OpenGrants index* in the
builder).

**Research (2026-11-17, read-only, with the API key the session's proxy adds):**

- OpenGrants' OpenAPI document (https://ops.opengrants.io/openapi.json, v1.2.0) lists only reads:
  `GET /grants-api`, `/contracts-api`, `/funders-api`, each by id, and `POST /match-grants-api`
  (matching a profile). There is no publish, ingest or submit endpoint.
- https://ops.opengrants.io/llms-full.txt documents the same endpoints, an RSS feed and a sitemap
  of OpenGrants' own listings, and webhooks that OpenGrants sends out (`grant.created`, …). Nothing
  takes a listing in.
- The hosted MCP server's tools search, match, check eligibility, and save grants, alerts and a
  profile to the user's own account. None publishes a listing.
- No call hosted on gms.opengrants.io is in OpenGrants: none of the 2,674 most recently added open
  and forecasted listings (created 2025-11-18 to 2026-11-14) has a gms.opengrants.io
  `listing_url`, and searches for "gms.opengrants.io", "opengrants" and "CommonGrants" find
  nothing. OpenGrants' records name the funder's own page in `listing_url`; there is no source field.

So the GMS pushes nothing (no jobs queue, no secret), and the builder's help text "Pulled by the
OpenGrants importer from the CommonGrants feed" describes a pull that does not happen yet. The
Share this call panel says so (`OPENGRANTS_PULLS_FEED = false`).

**What OpenGrants must pull** (for the owner to hand to the OpenGrants team):

| | |
|---|---|
| Feed | `GET https://gms.opengrants.io/gms/public/feeds/opengrants.json` (no token, any origin) |
| Filter (done by the GMS) | Published calls with `publish.openGrantsIndex` and the public page on, under an active funder, open, forecasted or closed. Use this feed, not `/common-grants/opportunities`, which lists every published call whatever the funder chose. |
| Shape | The CommonGrants v0.5.0 list envelope: `{ status, message, items: OpportunityBase[], paginationInfo }`, each record validated with `@common-grants/sdk`. Oldest change first. |
| Paging | `page` (from 1), `pageSize` (1 to 100, default 100); `paginationInfo.totalItems` |
| Incremental | `modifiedSince=<ISO 8601>`: records whose `lastModifiedAt` is later |
| Cadence | Daily full pull (OpenGrants refreshes daily), and hourly incremental pulls with `modifiedSince` if wanted. Send `If-None-Match` with the last `ETag`; an unchanged page answers 304. Cached five minutes (fifteen at the edge). |
| Removals | A record a full pull no longer lists was taken out of the index, had its page turned off, or its funder was deactivated: remove it. `status.value: "closed"` means archive. |
| Identity | `id` (UUID) and `identifiers.systemId` (registry `org:opengrants:gms`) are stable; dedupe on them. |

Field mapping to an OpenGrants grant record:

| OpenGrants | CommonGrants record |
|---|---|
| `title` | `title` |
| `description` | `description` |
| `status` | `status.value` (`open`, `forecasted`, `closed`) |
| `amount_min`, `amount_max` | `funding.minAwardAmount.amount`, `funding.maxAwardAmount.amount` (strings, with `currency`) |
| `deadline_date` | `keyDates.closeDate.date` (absent: rolling) |
| `funder_name` | `funders.primary.name` for a funder linked to Passport; otherwise the name on the funder's page, `/f/{customFields.gms.value.funderHandle}` |
| `listing_url` | `source` (the call's public page; add `?utm_source=opengrants` if OpenGrants wants its clicks counted, once the GMS counts that source) |
| `geography`, `categories` | Not fields of the record. The eligibility labels and the fund are on the page at `source`, and in the open-call JSON feed's `_gms.eligibility` and `_gms.category` for the same `id`. |

When OpenGrants pulls the feed, set `OPENGRANTS_PULLS_FEED` to true and the panel says the call
appears in OpenGrants search.

## Measures

Links from a feed carry `utm_source=feed`; the link in a PND submission carries `utm_source=pnd`.
The public opportunity page remembers such a landing in the browser tab only (sessionStorage,
`apps/web/src/lib/socialLanding.ts`), and the application start sends it on
`/common-grants/applications/start?utm_source=…`, which records it on the application's `started`
event (`START_SOURCES` in `apps/api/src/services/apply.ts`: `social`, `feed`, `pnd`). The panel
counts the applications to the call started from each. No tracker, no cookie, no page-view log: a
visit that does not start an application is not counted.

## API and MCP

| Route | Who |
|---|---|
| `GET /gms/public/feeds/opportunities.{json,csv,rss}` | Anyone |
| `GET /gms/public/feeds/opengrants.json` | Anyone |
| `GET /gms/opportunities/{id}/syndication` | `opportunities:read`: the panel |
| `PUT /gms/opportunities/{id}/syndication/feeds` `{ feeds }` | `opportunities:write`: take the call out of the feeds or back |
| `POST /gms/opportunities/{id}/syndication/pnd/preview` | A person, admin or program officer |
| `POST /gms/opportunities/{id}/syndication/pnd` `{ digest }` | A person, admin or program officer |

TypeSpec: `api/syndication.tsp`. MCP: `get_opportunity_syndication` (`opportunities:read`) returns
what the panel's GET returns; no tool sends to PND or changes the feeds.

## Setup

Nothing new: the PND email uses the Resend sender already configured (`RESEND_FROM`). No secret, no
Composio connection, no jobs entry. Migration 0045 adds `syndication_sends`.
