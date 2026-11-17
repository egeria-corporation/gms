# Growth measures (operators only)

The growth plan names nine measures, one per side of the market and one per loop, each with a
90-day target. The GMS shows them to OpenGrants' operators at **`/operator/measures`**, each over
the last 30 days, with its target and whether it is met. The numbers come from the GMS's own
database. The one exception is organic visits, which come from Google Search Console, read through
Composio. There is no third-party tracker and no analytics beacon.

Code: `apps/api/src/services/measures.ts`, routes in `apps/api/src/routes/gms/measures.ts`,
TypeSpec in `api/measures.tsp`, the counts in `public.gms_operator_measures()` (migration
`0052_operator_measures.sql`, tested in `supabase/tests/database/52_operator_measures.test.sql`), the
Search Console connector in `packages/connectors/src/search-console.ts`, and the screen in
`apps/web/src/screens/operator/Measures.tsx`.

## Who sees it

- **Operators only.** The `OPERATORS` Wrangler secret on the API Worker lists them: user ids or
  email addresses, separated by commas. While it is unset or blank, `GALLERY_MODERATORS` is used. Set
  it as a secret (`wrangler secret put OPERATORS`), never as a `[vars]` entry, because `wrangler.toml`
  is public.
- **A signed-in person only.** Every `/gms/operator/*` route needs a session. Agents and API clients
  get `401 session_required`, and no MCP tool reads the measures. A funder or applicant admin who is
  not an operator gets `403 not_an_operator`, and the screen tells them so without showing any number.
- **An address never makes an operator through single sign-on.** A workspace's identity provider
  can assert any address (docs/sso.md), so an email entry in `OPERATORS` matches only a session that
  did not come through SAML. A user id always matches (`OPERATOR_EMAIL_MATCHES_SSO_SESSIONS`).

## Aggregate counts only

- `gms_operator_measures()` returns one JSON object of counts and the window, nothing else. It runs
  as the service role only (no grant to `authenticated` or `anon`). The API reads that answer
  strictly: every value must be a whole number, and lost deals are kept only under a known reason.
- No answer holds a person, an organization, an address, a page address or an id. A test checks
  this on every string the measures route returns.
- Search Console pages are **grouped by kind of page** (funder pages, call pages, award pages and so
  on), never listed by address, because a page's address names the funder (`/f/<handle>/o/<call>`).
- Deals lost are recorded by a **reason from a fixed list** and a day. There is no free text, so a
  record can never name an organization or a person.

## The nine measures

The window is the 30 days before now (`MEASURE_WINDOW_DAYS`). A workspace counts while it is active
or still onboarding, never when it is suspended or closed.

| # | Measure | Counted from | 90-day target |
|---|---|---|---|
| 1 | Funders with an open call | Funder workspaces with a published call (`opportunities.published_at`) that was open in the window: open now, or closed inside the window (ledger `opportunity.closed`) | 50 |
| 2 | Applicant workspaces active | Applicant workspaces whose members were last active in the window (`workspace_members.last_active_at`, written at most every 15 minutes) | 1,000 |
| 3 | New applicant workspaces per published call | Applicant workspaces made in the window ÷ calls first published in the window | 10 or more |
| 4 | Funders who joined from an applicant's link | `referral_joins` with source `package` and a funder joined in the window (E4: the link in the footer of a sent application package) | 5 |
| 5 | Funders with history imported and a call open within 14 days | Funder workspaces that published a call in the window within 14 days (`SWITCH_CALL_WITHIN_DAYS`) after committing a history import (`import_runs.committed_at`, targets `award_history`, `history_applications`, `history_reviews`, `history_reports`) | 25 |
| 6 | Share-kit uses per award, and clicks | Of the awards made in the window that are accepted or later, to an organization and not confidential, the share with at least one social post about them that did not fail (`social_posts`, either side) or a download from the kit (`share_kit_uses`, migration 0054: the carousel PDF downloaded, the press release copied or the portrait card saved, by a person on either side; a count of the award, the part and the day, never who). Clicks are the sum the platforms reported for award posts sent in the window (`social_posts.metrics.clicks`, from Zernio), and clicks per post among posts that reported any | 30% of awards |
| 7 | Organic visits to funder and call pages | Google Search Console: clicks from Google Search to `/f/…` pages (funder pages and their calls, funds and awards) over the last 30 days Search Console has final figures for | 3× the first week |
| 8 | Invited teammates who join | Of the teammate invitations made in the window (`invitations`), the share accepted | 40% |
| 9 | Deals lost, by stated reason | `lost_deals` with a lost day in the window, counted by reason | Tracked |

The targets are the plan's, approved on 15 November 2026 (decision 8), in `MEASURE_TARGETS`.

### Measure 7: where organic visits come from

The brief asked for the front Worker's request logs first. The front Worker has Cloudflare
**Workers Logs** on (`[observability] enabled = true` in the generated `wrangler.toml`,
`scripts/build-front-worker.mjs`), but those logs live in Cloudflare, not in the GMS's database:

- reading them needs a Cloudflare API token and the Workers observability API, which would be a new
  secret and a new outbound path for the API Worker;
- they keep a few days only (shorter than the 30-day window and the first week's baseline);
- the front Worker does not log the referrer, so a search visit cannot be told from any other.

So measure 7 comes from **Google Search Console**: clicks from Google Search are organic visits by
definition. Search Console's final figures run about three days behind
(`SEARCH_CONSOLE_LAG_DAYS`), so its 30 days end three days ago. The target is three times the
clicks of the plan's first week, 16 to 22 November 2026 (`ORGANIC_BASELINE_WEEK_START`), compared
with the last 30 days' weekly average. Until Search Console has final figures for that week, the
target says it is not known yet.

When Search Console is not set up, not connected or has no property chosen, measure 7 says which,
and the other eight are shown as usual. A Search Console failure never stops the other measures.

## Deals lost

An operator records a deal lost with one of these reasons (`LOST_DEAL_REASONS`, kept equal to the
`lost_deals.reason` check by a test) and the day it was lost (today by default; never in the future
or over a year ago):

| Reason | Shown as |
|---|---|
| `forms` | Forms: branching, stages or co-editing |
| `reviews` | Reviews: conflict of interest, anonymized review or board packets |
| `reporting` | Reporting across applications, reviews and awards |
| `payments` | Payments or accounting sync |
| `procurement` | Procurement: single sign-on, accessibility report or security review |
| `languages` | Languages |
| `integrations` | An integration we don't have |
| `data_migration` | Moving their records over |
| `support` | Support or service guarantees |
| `went_elsewhere` | Chose another system |
| `timing` | Not the right time |
| `no_decision` | No decision |
| `other` | Something else |

The first five are the plan's parity gaps. The ledger records `operator.lost_deal_recorded` with
the reason and the day, and no workspace.

## Google Search Console

An operator connects Google Search Console on the measures screen, picks the property for the GMS's
own host, and sees clicks and impressions for the GMS's public pages by kind of page.

- **Through Composio, read only.** One auth config on the `google_search_console` toolkit with
  exactly `https://www.googleapis.com/auth/webmasters.readonly` (plus `openid email profile` if
  Composio adds them). Its id is the Wrangler secret `COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID` on the
  API Worker, next to the existing `COMPOSIO_API_KEY`. The section is hidden until both are set.
- **The narrowest scope, checked on every use.** A connection that holds the full `webmasters`
  scope (which can add and remove properties and sitemaps), or anything else, is deleted at Composio
  and refused. One that reports no scopes is not used.
- **One connection for the operators.** It lives on the Composio entity `gms-operators`
  (`SEARCH_CONSOLE_ENTITY`), which is not a UUID and so is never a workspace's entity. It is kept out
  of Settings › Connected apps, which no workspace can open for it.
- **Two tools only**, checked with Composio's tool search and schemas on 2026-11-17 (none was
  executed): `GOOGLE_SEARCH_CONSOLE_LIST_SITES` (no arguments) and
  `GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY` with `site_url`, `start_date`, `end_date`,
  `dimensions` (`["page"]`, or none for totals), `search_type: "web"`, `data_state: "final"`,
  `row_limit` and a `dimension_filter_groups` page filter (`includingRegex`).
- **The GMS's own pages only.** The property list offers only properties that cover the GMS's host:
  a domain property for it or a parent domain (`sc-domain:opengrants.io` covers
  `gms.opengrants.io`) or the URL-prefix property at its root (`https://gms.opengrants.io/`). The
  account's other sites are never shown. Every query is filtered to `^https://<GMS host>/`, built from
  `WEB_BASE_URL`.
- **Cached** for 15 minutes per Worker isolate (`SEARCH_CONSOLE_CACHE_MS`), two queries a load.
- The browser returns from the Google sign-in to `/operator/measures?connected=google_search_console`
  (`MEASURES_PAGE`, fixed by the server, never taken from the request).

### Setting it up

1. In Google Cloud, enable the Search Console API on the OAuth client Composio uses for this auth
   config, with the consent screen asking for `webmasters.readonly`.
2. In Composio, create an auth config on `google_search_console` with exactly that scope, and set
   its id as the API Worker secret `COMPOSIO_SEARCH_CONSOLE_AUTH_CONFIG_ID`.
3. In Search Console, the Google account that will connect must be an owner or a full or restricted
   user of a property that covers `gms.opengrants.io`.
4. Set `OPERATORS` on the API Worker. Then an operator opens `/operator/measures`, connects, and picks
   the property.

## Routes

| Route | Notes |
|---|---|
| `GET /gms/operator/me` | `{ operator }` for the signed-in person |
| `GET /gms/operator/measures` | The nine measures (counts only). 503 `measures_unavailable` without the database function |
| `POST /gms/operator/lost-deals` | `{ reason, lostOn? }`. 201 `{ recorded, reason, lostOn }`; 400 for an unknown reason or any other field; 422 `invalid_date` |
| `GET /gms/operator/search-console` | `{ available, connected, problem, site, sites }`; `sites` only those covering the GMS's host |
| `POST /gms/operator/search-console/connect` | `{ connected, connectUrl }`. 404 `search_console_unavailable` when not set up |
| `DELETE /gms/operator/search-console` | Disconnects at Composio and forgets the property |
| `PUT /gms/operator/search-console/site` | `{ siteUrl }`. 422 `site_not_gms`, `site_not_found` |
| `GET /gms/operator/search-console/report` | `{ site, range, totals, pages (by kind), organic, baselineWeek }`. 409 `search_console_site_required`, `search_console_reconnect`; 503 `search_console_unreachable` |

Every route is operators only (403 `not_an_operator`) and a session only (401 `session_required`).

## Data (migration 0052)

- `lost_deals`: `reason` (the fixed list), `lost_on`, `recorded_by` (the operator, never shown).
- `operator_settings`: one row (`id` is always true) with `search_console_site`. No credential:
  Composio holds the Google connection.
- `public.gms_operator_measures(p_now, p_window_days, p_switch_days)`: the counts, service role only.

RLS is on for both tables, with no policy and no grant for signed-in or anonymous roles. The
migration is additive: no existing row, table, function or policy changes.

## Share-kit downloads (migration 0054, v1.13.0)

- `share_kit_uses`: `award_id`, the award's own `workspace_id`, `kind` (`carousel`, `press_release`,
  `portrait`) and `used_on`, unique per award, kind and day. No person and no address. RLS on, no
  policy or grant for signed-in or anonymous roles; the API writes it for a person's session only.
- 0054 replaces `gms_operator_measures` with the same answer shape; only `awardsShared` changes (a
  post that did not fail, or a download).
