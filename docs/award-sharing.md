# Award sharing

v1.8.0. A funder can list the grants it awards on its public page, each award gets its own page and
share card, both sides get a share kit (ready-to-edit posts, the link, the card image and a badge),
and the grantee can put a "Funded by" badge on its website. Nothing is posted from the GMS.

## When an award is public

One rule decides everything public about an award: `isPubliclyListable` in
`apps/api/src/services/award-sharing.ts`. The grants-awarded pages, past awards on the funder page,
the sitemap, the share cards, the badge and the share kit all go through it. An award is public only
when all of these hold, checked in this order (the first that fails is the `reason` the share panel
shows):

| Check | `reason` when it fails |
|---|---|
| It is not confidential (the funder's switch, or its program's default for new awards). A row without the flag counts as confidential. | `confidential` |
| It went to an organization: not `recipient_individual`, and a recipient workspace that is an applicant and does not say it is an individual (`orgType: individual`, self-declared or from Passport). | `individual` |
| It is accepted, active or completed (`LISTABLE_STATUSES`: not offered, suspended or cancelled). | `not_accepted` |
| The funder's workspace is active. | `funder_unavailable` |
| The funder turned on **List awards on my public page** (`settings.awardSharing.listAwards`, off by default). | `listing_off` |
| The grantee did not choose **Don't list us publicly** (`awards.recipient_unlisted`). | `recipient_unlisted` |

Constants to relax, each in `award-sharing.ts`: `LISTABLE_STATUSES`, `AMOUNTS_SHOWN_BY_DEFAULT`
(true), `LIST_LIMIT` (1,000 awards read per funder), `BADGE_TTL_SECONDS` (3,600). The older
`settings.transparency` switch is retired in v1.9.0 and never lists anything.

What the public sees of a listed award: the recipient's own workspace name (never a Passport record it
shares only with its funders), the award title as its purpose, the program (or, without one, the
published opportunity it came from), the award year and date, and the amount unless the funder hides
amounts. Never the award's description, conditions, payments or anything about people.

## Who changes what

| Switch | Where | Who |
|---|---|---|
| List awards on my public page; Show award amounts | Settings › Public page › Grants awarded | Funder workspace admins |
| New awards in a program start confidential | Settings › Public page › Grants awarded | Funder admins and program officers |
| Keep this award confidential | The award screen › Share this award | Funder admins and program officers |
| Don't list us publicly | The grantee's grant screen › Share this award | Grantee admins |

Every change is a signed-in person's: agent and API-client tokens get `403 human_only`, and no MCP
tool makes these changes. Each change is written to the funder's ledger (`award.made_confidential`,
`award.confidential_removed`, `award.recipient_unlisted`, `award.recipient_listed`,
`workspace.award_listing_changed`, `program.awards_confidential_changed`). A program's default
applies to awards created after it is set (a database trigger on `awards`, so every path that
creates an award gets it); awards already made keep their setting.

## Public pages

- `/f/{handle}/awards`: the funder's listed grants, newest year first, grouped by program, with the
  recipient, purpose and amount. Not found while the funder does not list awards.
- `/f/{handle}/awards/{slug}`: one award. The slug is `{recipient-name}-{token}`, where the token is
  a random 12-character value (`awards.public_slug`). An award is found by its token alone, so a
  link or badge keeps working after the recipient renames itself.
- Page meta, share cards and schema.org data come from the front Worker (`apps/web/src/edge`): the
  awards page is an `ItemList`; an award page is a `MonetaryGrant` with its `funder` and the
  organization it funds as `fundedItem` (schema.org has no `recipient` for a grant), with `amount`
  only when shown. The card reads "{Funder} awarded {Recipient} a grant", with the amount if shown,
  the purpose and the year, and never a logo. A funder not linked to Passport gets "Not verified with
  OpenGrants Passport" on its cards.
- The sitemap names each funder's grants-awarded page (when it has a listed award) and every listed
  award page.
- Past awards on the funder page (`pastAwards`) follow the same rule, with a link to each award's
  page; while the funder hides amounts each amount is null and the table shows a dash (v1.9.0), and
  the page's nav links to "Grants awarded".

Data comes from `GET /gms/public/funders/{handle}/awards` and `…/awards/{slug}` (no token), cached at
the edge for 5 minutes like the other public pages.

## The "Funded by" badge

`/badge/{slug}.svg`, served by the front Worker from `GET /gms/public/badges/{slug}.svg` and kept for
an hour at the edge and in browsers. It reads "Funded by {Funder} · verified" only when the award is
public and the funder's workspace is linked to Passport; otherwise "Funded by {Funder}". Text only,
in the theme's navy and teal, with no script, links or images inside (`Content-Security-Policy:
default-src 'none'`). Anything that is not a public award, whether it does not exist, is
confidential, unlisted or not accepted yet, gets the same plain `404 Not found`. The badge links to
the award page through the snippet:

```html
<a href="https://gms.opengrants.io/f/riverbend/awards/alder-creek-family-services-1a2b3c4d5e6f"><img src="https://gms.opengrants.io/badge/alder-creek-family-services-1a2b3c4d5e6f.svg" alt="Funded by Riverbend Community Foundation, verified" width="300" height="20"></a>
```

Because of the caches, a badge can stay visible for up to an hour after an award is made confidential
or unlisted, and a public page for up to 5 minutes.

## The share kit

On the funder's award screen and the grantee's grant screen (desktop and phone), **Share this award**
says whether the award is public and why not, carries that side's switch, and while the award is
public offers:

- three posts, ready to edit in place: a LinkedIn post, a short post (at most 280 characters with the
  link) and a newsletter paragraph, worded for the funder or the grantee;
- the award page link, the card image (1200 × 627 PNG) and the badge with its snippet;
- a copy button for each.

The kit is built from the award's public fields only. Nothing is posted from here; posting through
connected accounts is the social posting feature's (`docs/social.md`, when it lands).

Agents read the kit with MCP `get_award_share_kit` (funder and grantee sides, `awards:read`); it
returns nothing for an award that is not public.

## Data (migration 0037)

- `awards.confidential boolean not null default false`
- `awards.recipient_unlisted boolean not null default false`
- `awards.public_slug text not null unique` (random, `gms.new_public_slug()`)
- `programs.awards_confidential boolean not null default false`, applied to new awards by the
  `awards_confidential_default` trigger
- `gms.confidential_from_open_data()`: copies the open-data "exclude from open data" choices
  (`workspaces.settings.openData.excludedAwardIds`) into `awards.confidential`; the migration runs it
  once, the service role can run it again.

The columns are read by signed-in users only through the existing member policies on `awards` and
`programs`; only the API writes them. The listing settings live in `workspaces.settings.awardSharing`
and are written only by `PUT /gms/award-sharing/settings` (a `PATCH /gms/workspaces/{id}` drops the key).

## For other features

- **Open data**: call `isPubliclyListable(award, { funder, recipient })` (or
  `awardIsPubliclyListable(ctx, awardId)`) for every exported award, and write the per-award
  exclusion through `setAwardConfidential` so it lands in `awards.confidential`.
- **Social posting**: prefill from `shareKit(ctx, awardId, "funder" | "grantee")`, which returns null
  for an award that is not public; never offer posting for such an award.

## Routes

See [api-surface.md](api-surface.md#award-sharing-v180) and `api/award-sharing.tsp`.
