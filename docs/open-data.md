# Open data exports: 360Giving and CommonGrants

A funder can publish its grantmaking as open data: in the [360Giving Data Standard][std], which is
how awards reach GrantNav and Candid, and as CommonGrants v0.5.0 records any CommonGrants tool can
read. The panel is on **Reporting**, below the reports. Code: `apps/api/src/services/open-data.ts`
(the one rule and both formats), `apps/api/src/routes/gms/open-data.ts`, `api/open-data.tsp`,
`apps/web/src/screens/funder/OpenDataPanel.tsx`.

## What goes out

One rule picks the awards, and the downloads, the panel, the MCP tool and the public feed all use it.
An award is exported when all of these hold:

| Check | Left out as |
| --- | --- |
| Its status is accepted, active, suspended or completed (`OPEN_DATA_STATUSES`) | "Not accepted yet" (offers), "Cancelled" |
| It has a recipient organization in the GMS | "Awarded to an individual" (an award to a person, or to a workspace that declared itself an individual); "Recipient is not a linked organization" (a historical import that kept only a name, which may be a person's) |
| The funder has not kept it confidential | "Marked confidential" |
| It has an awarded amount | "No amount awarded" |

Awards are chosen by **award date** (`keyDates.awardDate`, else the day the award was created), for
a year (`?year=2027`) or a range (`?from=2027-01-01&to=2027-06-30`, inclusive); no range means all
years. Each award left out is counted under its first failing check, and the panel lists the awards
of the period with what happens to each. The panel and every export never show a person's name: an
award to an individual reads "An individual".

**Recipients.** A recipient is named with its Passport record only while it is verified with
Passport and shares its record with the funder (a live consent, the same rule as everywhere else
in the GMS). Then the export carries its Passport legal name, its EIN as
`US-EIN-12-3456789` ([org-id.guide][orgid]), its address and its website. Any other recipient
(self-declared, or verified but not sharing) goes out **by name only**: the workspace's own name,
under a local identifier `<prefix>-<workspace id>`, with no address and no tax number, even one it
declared itself (`EXPORT_SELF_DECLARED_RECIPIENT_EIN = false`). The EIN is an organization's public
tax number; no person's identifiers are ever exported.

**The funder** is named by its Passport legal name (else its self-declared legal name, else its
workspace name) and identified by its own EIN when it has one (Passport or self-declared: it is the
funder's own data), else by `<prefix>-<workspace id>`.

## Confidential awards

Staff (admins and program officers, signed in) tick **Confidential** beside an award in the panel,
or call `PUT /gms/open-data/awards/{id}/confidential` with `{ "confidential": true }`. The mark is
kept in the funder workspace's settings under **`settings.openData.excludedAwardIds`** (award UUIDs,
at most 5,000); there is no column for it, so no migration. If a later release adds a per-award flag,
the export should read both. Marking and clearing are recorded in the ledger
(`open_data.award_marked_confidential`, `open_data.award_unmarked_confidential`).

## 360Giving files

`GET /gms/open-data/360giving.json` and `GET /gms/open-data/360giving.csv` (admins, program
officers, finance and auditors; API clients need `analytics:read`).

- **JSON** is a 360Giving data package (`version` `1.4`, `title`, `description`, `modified`,
  `identifier`, `publisher`, `license`, `accessURL`, `downloadURL` when the feed is on, `grants`).
- **CSV** has one grant per row under the 360Giving spreadsheet titles, taken from the schema:
  `Identifier`, `Title`, `Description`, `Currency`, `Amount Awarded`, `Award Date`,
  `Planned Dates:Start Date`, `Planned Dates:End Date`, `Recipient Org:Identifier`,
  `Recipient Org:Name`, `Recipient Org:Street Address`, `Recipient Org:City`, `Recipient Org:County`,
  `Recipient Org:Postal Code`, `Recipient Org:Country`, `Recipient Org:Web Address`,
  `Funding Org:Identifier`, `Funding Org:Name`, `Grant Programme:Code`, `Grant Programme:Title`,
  `Last Modified`. A cell a spreadsheet would run as a formula starts with an apostrophe.
- Every grant has the ten required fields (Identifier, Title, Description, Currency, Amount Awarded,
  Award Date, Recipient Org:Identifier, Recipient Org:Name, Funding Org:Identifier, Funding
  Org:Name). Identifier is `<prefix>-<award id>`. The description is the award's description, else
  its title. Planned dates come from the period of performance; the grant programme from the award's
  program.
- A period with nothing to export answers 409 `nothing_to_export` (a 360Giving file needs at least
  one grant).

**The schema.** The export follows the 360Giving Data Standard schema 1.4.3. A copy of
`360-giving-schema.json` and `360-giving-package-schema.json` is in
`apps/api/test/fixtures/360giving/` with its licence note (CC BY 4.0, by 360Giving); the tests
validate every export against it with Ajv (JSON Schema 2020-12). The GMS never fetches it at run
time. When 360Giving publishes a new version, replace both files and the note, and run the tests.

**The prefix and drafts.** A funder registers as a 360Giving publisher ([registration][register])
and receives a prefix that starts `360G-`. An admin saves it in the panel (`PUT
/gms/open-data/settings` with `threeSixtyGivingPrefix`). Until then the export is a **draft**: its
identifiers start `DRAFT-<handle>-`, which 360Giving's checker will refuse, its title starts
"DRAFT:", its file name ends `-DRAFT`, the response carries `X-Open-Data-Draft: true`, and the panel
explains how to register.

## CommonGrants file

`GET /gms/open-data/commongrants.json` (same people):

```json
{ "commonGrants": "0.5.0", "generatedAt": "…", "range": { "from": null, "to": null },
  "opportunities": [OpportunityBase…], "awards": [AwardBase…] }
```

Opportunities are the funder's **published** ones, by publish date; awards are the ones the rule
exports, by award date. Every record is projected by `@gms/protocol` and validated with
`@common-grants/sdk` before it is returned; no field is added outside `customFields`, and
`AwardBase`, which has none, gets none. A recipient appears in `recipientOrganizations` (its
Passport organization id, name and EIN) only while it is verified and shares its record; otherwise
the award carries no recipient organization, because a CommonGrants organization reference is a
Passport organization.

## The public feed

`GET /gms/open-data/{handle}/360giving.json`, no token: every award the export would hold, all
years, as a 360Giving JSON package. It is **off by default**. An admin, signed in, switches on
"Publish my awards as open data" in the panel (`PUT /gms/open-data/settings` with
`publishFeed: true`); it needs a saved prefix (409 `prefix_required` otherwise), and the prefix
cannot be removed while the feed is on. Only then does the panel show the address to copy. Agents
and API clients cannot switch it on (403 `human_only`), and there is no MCP tool for it.

The feed is read-only and cached: `Cache-Control: public, max-age=300, s-maxage=900`, an `ETag`
(SHA-256 of the body) that answers 304 to `If-None-Match`, and `Access-Control-Allow-Origin: *`.
It answers 404 for an unknown or inactive funder, while the feed is off or has no prefix, and while
there is nothing to publish. The data is published under CC BY 4.0 (`OPEN_DATA_LICENSE`), which the
switch names. To list the feed in GrantNav, the funder gives the address to 360Giving (see
360Giving's guidance on submitting a data file; the file must be on the funder's authorised domain
or added by 360Giving's helpdesk).

## Agents

The MCP tool `open_data_summary` (`analytics:read`) returns the summary's counts for a year or
range: how many awards would be exported, how many are left out and why, how many go out by name
only, the CommonGrants record counts, and whether the export is a draft. It leaves out the
per-award list. Agents cannot change the prefix, the feed or the confidential marks.

## Constants

All in `apps/api/src/services/open-data.ts`: `OPEN_DATA_STATUSES`, `EXPORT_LIMIT` (5,000 awards per
export), `MAX_EXCLUDED`, `SCHEMA_VERSION`, `OPEN_DATA_LICENSE`, `REGISTER_URL`,
`EXPORT_SELF_DECLARED_RECIPIENT_EIN`, `SUMMARY_ROWS` (500 rows in the panel's list),
`PREFIX_PATTERN`.

[std]: https://standard.threesixtygiving.org/en/latest/technical/reference/
[orgid]: https://org-id.guide/list/US-EIN
[register]: https://www.360giving.org/publish/guidance/plan/register/
