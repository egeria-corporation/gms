# Award sharing

v1.9.0. A funder can list the grants it awards on its public page, each award gets its own page and
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
returns nothing for an award that is not public. Since v1.12.0 it carries the extras below (the
press release, the federal statement, the carousel's pages and alt text, the portrait card's words,
the pages to tag). Agents cannot change federal funding or the share-kit settings.

## The kit, plus (v1.12.0)

While the award is public, **Share this award** also offers (both sides unless said otherwise):

- **A portrait card**, 1080 × 1350 PNG (4:5, the portrait size Instagram and LinkedIn show in full),
  with both organizations' names, the program, the purpose and the year. It is drawn in the browser
  with the share card's renderer (`apps/web/src/edge/og/portrait.ts`, the same fonts and theme
  colours) when the person asks for it. **The amount is off by default**: "Show the amount on the
  card" adds it, and it cannot be added while the funder hides amounts. No logo of either
  organization, as on the share cards (decision below).
- **A carousel PDF**, 6 to 10 pages of 1080 × 1350, built with pdf-lib in `packages/documents`
  (`renderCarouselPdf`): the announcement, what the grant funds, the grantee, the amount (only when
  shown), the funder (its standard description, else its public mission), the federal share (only
  with the statement), thanks, and where to read more. Each page's **alt text** is listed beside the
  download and can be copied: pdf-lib cannot tag a PDF, so the alt text goes where the person posts
  it. Downloaded from `GET /gms/awards/{id}/sharing/carousel.pdf` (funder) or
  `/gms/my/awards/{id}/sharing/carousel.pdf` (grantee); 409 `not_public` for an award that is not public.
- **Downloads are counted, and only counted** (v1.13.0): a person's carousel download, and the press
  release copied or the portrait card saved (`POST /gms/awards/{id}/sharing/uses`,
  `POST /gms/my/awards/{id}/sharing/uses`, `{ kind: "press_release" | "portrait" }`, a person's
  session only), are recorded in `share_kit_uses` as the award, the part and the day, at most once a
  day each, never who. They count as kit uses in the operators' measure 6 (`docs/measures.md`).
  Agents' and API clients' reads are not uses.
- **A press release** to edit: headline, "FOR IMMEDIATE RELEASE", the announcement, the credit
  line, a bracketed quote to fill in, the federal statement when there is one, "About {Funder}" (the
  funder's **standard description**, else its public mission, else a bracketed placeholder), "About
  {Grantee}" (a placeholder) and a media contact placeholder. The credit is the funder's choice of
  **"funded by"** (the default) or **"supported by"**; "sponsored" is not a choice anywhere (a grant
  is not a sponsorship), and the database refuses any other value.
- **The page to tag**: the funder's page in the grantee's kit, and the grantee's page in the
  funder's kit, each only when that side gave its link **and** agreed to be tagged.
- **The statement of the federal share**, below.

The kit's words are in the request's language (`email` catalog, `kit.*`); the three v1.9.0 posts are
still English.

### Share-kit settings

**Share-kit settings** (a dialog in the panel, either side) hold the workspace's own:

| Setting | Who | Notes |
|---|---|---|
| Social page link | Workspace admins, in person | An organization's https page on LinkedIn (company, school or showcase pages, never a person's profile), Facebook, Instagram, X, Bluesky or Threads; stored rebuilt from what was read (`socialPageOf`). The handle to tag is read from it (`@name`). |
| Consent to be tagged | Workspace admins, in person | Needs a link. A new link clears it: consent is given again for the new page. Without it the page is never tagged. |
| Credit wording (funder) | Funder admins, in person | `funded_by` (default) or `supported_by`. |
| Standard description (funder) | Funder admins, in person | At most 1,500 characters; "About {Funder}" in the press release and carousel. |

`GET /gms/share-kit/profile` (any staff member who reads awards) and `PUT /gms/share-kit/profile`
(admins; agent and API-client tokens get 403 `human_only`; 422 `page_url_invalid`,
`consent_needs_page`, `funder_only_setting`). Each change is ledgered as
`workspace.share_kit_changed` (the link and the choices, never the description's text).

### The federal share statement

A funder admin or program officer marks an award **federally funded** on the award screen, with
the **federal amount** (USD), the **federal share of the project's total costs** (percent, above 0,
at most 100, two decimals) and, optionally, the **federal agency** as the statement should name it
(`PUT /gms/awards/{id}/federal-funding`, a person only; ledger `award.federal_funding_changed`).
Unmarking clears the numbers. The grantee sees what was entered and cannot change it.

**The kit adds the statement only when both the amount and the percentage are entered.** A
percentage is never guessed or worked out from other figures (not from the award amount, and not
the remainder): with one number the panel says what is missing and the kit has no statement.
The statement appears in the kit (to copy), in the press release and on its own carousel page.
The statement shows the federal amount even while the funder hides award amounts on its public
pages: the funder entered it for this statement, which the rule requires to carry it.

**The rule.** HHS's appropriations have carried the "Stevens Amendment" since 1989. HHS's guidance
(Administration for Children and Families, "Stevens Amendment",
<https://www.hhs.gov/guidance/document/stevens-amendment>, issued August 10, 2014, read 2026-11-17)
says:

> When issuing statements, press releases, publications, requests for proposal, bid solicitations
> and other documents --such as tool-kits, resource guides, websites, and presentations (hereafter
> "statements") -- describing the projects or programs funded in whole or in part with HHS federal
> funds, the recipient must clearly state: 1. the percentage and dollar amount of the total costs
> of the project or program funded by non-governmental sources. 2. the percentage and dollar amount
> of the total costs of the program or project funded with federal money

and gives this acknowledgement for an award with no other non-governmental funding:

> "This [project/publication/program/website, etc.] [is/was] supported by the Administration for
> Children and Families (ACF) of the United States (U.S.) Department of Health and Human Services
> (HHS) as part of a financial assistance award totaling $XX with 100 percent funded by ACF/HHS. The
> contents are those of the author(s) and do not necessarily represent the official views of, nor an
> endorsement, by ACF/HHS, or the U.S. Government."

The HHS Grants Policy Statement (Version 2.0, effective October 1, 2025,
<https://www.hhs.gov/grants-contracts/grants/grants-policies-regulations/grants-policy-statement/index.html>)
carries the requirement in Appendix D, Administrative and National Policy Requirements, and is
incorporated in every Notice of Award it applies to.

**The wording the kit uses** (`kit.federal.statement.*` in the `email` catalog), modelled on HHS's:

- with the agency: "This project is supported by {agency} as part of a financial assistance award
  totaling {amount}, with {percent} percent of the project's total costs funded by {agency}. The
  contents are those of the authors and do not necessarily represent the official views of, nor an
  endorsement by, {agency} or the U.S. Government."
- without it: "This project is supported with federal funds as part of a financial assistance award
  totaling {amount}, with {percent} percent of the project's total costs funded with federal money.
  The contents are those of the authors and do not necessarily represent the official views of, nor
  an endorsement by, the U.S. Government."

What the GMS does not do: it does not state the **non-governmental** share, because the funder does
not enter it and the remainder of the costs is not necessarily non-governmental (state or local
money is governmental). The panel tells the person to add that amount and percentage when other
funders pay part of the costs. HHS asks that changes to the acknowledgement be coordinated with
the awarding agency, and that a press release about the outcome of HHS-supported activities be
shared with the agency in advance; the press release is a draft for the person to edit and send.

## Data (migration 0048)

- `awards.federally_funded boolean not null default false`, `federal_amount numeric(14,2)` (> 0),
  `federal_percent numeric(5,2)` (> 0 and ≤ 100), `federal_source text` (1–200); the numbers only
  while the award is marked (a check).
- `share_kit_profiles`: one row per workspace (`page_url`, `tag_consent` with `consented_at` and
  `consented_by`, `credit_wording` in `funded_by`/`supported_by`, `standard_description`); consent
  needs a link (a check). Read by the workspace's staff (RLS, `gms.is_staff`); written by the API only.
- `social_reminder_prompts` and the `program` social subject: see [social.md](social.md).

Existing awards read as not federally funded; nothing is re-written.

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
  for an award that is not public; never offer posting for such an award. "Meet our grantees" lists
  a program's awards through `meetOurGrantees(ctx, programId)`, which applies the same rule.

## Routes

See [api-surface.md](api-surface.md#award-sharing-v180), `api/award-sharing.tsp` and (v1.12.0)
`api/award-kit.tsp`.

## Decisions (v1.12.0)

- The portrait card carries no logo of either organization, as the 1200 × 627 card and the badge do:
  a logo is an image the GMS would have to fetch, check and redraw, and the names are what the card
  is for. It keeps the OpenGrants mark and the site's address, as the share card does.
- The portrait card is drawn in the browser, on request, with the share card's renderer, not served
  by the front Worker: it is a download for the person, never a public address, so a hidden amount
  can stay hidden.
- The carousel's alt text lives in the kit, not in the PDF: pdf-lib cannot write a structure tree.
- The federal statement needs both numbers and never states the non-governmental share (see above).
  The one constant to relax is in `federalStatement` (`services/award-sharing.ts`).
- Consent to be tagged is per workspace, not per award, and a new link needs it again.
