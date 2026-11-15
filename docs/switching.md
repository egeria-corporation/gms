# Switching to the GMS

Funders searching for another grants system should find an honest page that says what moves over
and how, and offers a free, human-run migration. About a quarter of funders were actively looking
for a new system in 2024, and most keep one for about five years
([PEAK Grantmaking](https://peakgrantmaking.org/insights/make-technology-transformational)).

## The pages

| Path | Screen | What it shows |
|---|---|---|
| `/switch` | `apps/web/src/screens/public/Switch.tsx` | Every system plus spreadsheets, one line each; the PEAK source; common questions; the request form |
| `/switch/{system}` | `apps/web/src/screens/public/SwitchSystem.tsx` | What that system exports and how (with sources), what comes over, what stays behind and why, the four steps, how the GMS differs, the list price where one is published, questions, and the request form |

Systems: `good-grants`, `submittable`, `surveymonkey-apply`, `foundant`, `zengine`, `fluxx`,
`smartsimple`, `cybergrants`, `openwater`, and `spreadsheets` (spreadsheets, Airtable or GrantHub).
An unknown system answers Page not found.

All text lives in `apps/web/src/content/switch.ts`, one entry per system. Rules for that file:

- **Only researched facts.** Every fact comes from the research of 15 November 2026, and every
  system entry lists its sources (the page links each one, opening the owner's own page). A test
  fails if a system has no source.
- **Date stamp.** Each page says "facts as of November 2026" at the top, and the footer of every
  page says: "Product names are trademarks of their owners. Facts as of November 2026; tell us if
  something changed." Change `FACTS_AS_OF` when the research is redone.
- **Prices.** A list price appears only where the research gives one (Good Grants, Foundant GLM,
  Fluxx, OpenWater), always labelled "list price as published, as of November 2026", beside ours:
  free, with unlimited seats.
- **Tone.** Factual and respectful. Say what each system exports and how it moves over; where we
  differ, say so plainly (free, unlimited seats, open source under AGPL-3.0, CommonGrants,
  applicants track every grant). No "better than", no disparagement, and product names as text,
  never logos. A test checks the content for comparative words.

To update a fact: change the entry, its source, and `FACTS_AS_OF` if the research date moved.

### What stays behind

Bank routing and account numbers, Social Security numbers, dates of birth and government ID
numbers are dropped automatically by the importers and never stored; past payments are recorded as
paid elsewhere and nothing moves money. The pages say why: the GMS never holds bank or identity
data, and funders who pay through OpenGrants do it with OpenGrants Passport. (In the web sources
the wording avoids the exact phrases `pnpm gate:sensitive` looks for.)

### The import wizard

Step two sends people to the import wizard inside their workspace, `/w/{workspace}/import`. The
path is one constant, `IMPORT_WIZARD_SEGMENT` in `content/switch.ts`. The page names it as text, not
a link: a visitor has no workspace yet, so the call to action is "Start free" (`/signin?as=funder`).

### Page metadata

`seoFor(entry)` in `content/switch.ts` gives each page's title, description and Open Graph text
(and `seoFor(null)` the index's). The screens set the `<title>`; the front worker serves the meta
tags to crawlers.

## Request a free migration

The form on every switch page asks for: name, work email, organization, current system (the list
above, plus "Something else"), approximate number of programs and of past awards (ranges), when
they hope to move, and an optional note of up to 2,000 characters.

1. When the form is shown, the page asks `GET /gms/migration-requests/form` for a form token.
2. **Preview** (`POST /gms/migration-requests/preview`) shows exactly what will be sent: the email
   to OpenGrants (to, reply-to, subject and the full text) and the confirmation the person will get.
   Nothing is sent or counted. Any edit clears the preview, so what is sent is what was last shown.
3. **Send** (`POST /gms/migration-requests`) emails the request to `CONSULTING_REQUEST_TO`
   (default `hello@agents.opengrants.io`, the consulting request's setting) with reply-to set to
   the person, through notify and Resend, then sends the person a confirmation: a person at
   OpenGrants will reply, and migration help can start right away.

Templates: `migrationRequestEmail` and `migrationConfirmationEmail` in
`packages/notify/src/migration.ts`. The confirmation carries no free text from the form, only the
system chosen from the list and a link to our own page, so the form cannot be used to send someone
else a message. If only the confirmation fails, the send still answers `sent: true` with
`confirmationSent: false`.

### Numbers removed from the note

Before the preview and the send, `stripSensitiveNumbers` removes, and replaces with
"[number removed]":

- a number of five or more digits (spaces, dashes, dots or slashes allowed) up to 24 characters
  after a bank or identity word (routing, account, acct, IBAN, SSN, Social Security, tax ID,
  taxpayer, government ID, driver's licence, birth, born, DOB…); "Passport" is not one of the words
  because it is also our product's name;
- three, two and four digits with the same separator (the shape of a Social Security number);
- eight or more digits in a row, or grouped by single spaces or dashes (bank account and routing
  numbers, card numbers), except an ISO date.

It errs on the side of removing: a long phone number written with dashes goes too. The form says
so under the note, and the preview shows the note as it will be sent with a count of what was
removed. The web mock mirrors these rules; `apps/web/test/switch-contract.test.ts` holds it to the
API.

### Human only

- No MCP tool.
- No token is needed: anonymous visitors may send. A person's own session is accepted (and must
  verify); an API client's or an agent's token, or any other `Authorization`, is refused with 403
  `person_only` on all three routes. The web client never sends a token on these calls.
- The routes are not in the API's open CORS list, so a browser can call them only from the web
  app's origin.

### Protection for an anonymous form

| Check | Answer |
|---|---|
| The hidden `website` field is filled | 422 `not_sent` (the message gives the address to write to) |
| No form token, a token this server did not sign, or one older than 24 hours | 422 `form_expired`; the page fetches a new token |
| Sent less than 3 seconds after the form was shown | 422 `too_fast` |
| More than 3 sends a day from one email address (any letter case) | 429 `too_many_requests_for_email` |
| More than 20 sends a day from one network (IPv4 address, or IPv6 /64) | 429 `too_many_requests` |
| No mail configured (`RESEND_API_KEY`, `RESEND_FROM`) | 503 `mail_not_configured` |
| The email to OpenGrants fails | 502 `mail_failed`; the counts are given back |

The limits are `MIGRATION_REQUEST_LIMITS` in `apps/api/src/services/migration-request.ts`, one
constant to relax. Counts live in the `RATE_LIMIT` KV namespace per UTC day, under the SHA-256 of
the email address (never the address) and the network key; KV has no atomic increment, so two sends
at the same moment can count as one: a brake, not a quota.

The form token is `<issued time>.<nonce>.<HMAC-SHA-256>`, signed with a key derived (HKDF, its own
label) from the OAuth signing key, so there is no new secret, and it can never be read as an access
token. Rotating the OAuth key makes open forms ask for a new token.

### What is kept

Nothing in the database: no table, no ledger row (there is no workspace). The email to OpenGrants
is the record. The log has one line per send, `migration_request.sent`, with a request id, the
system and whether the confirmation went, never the address or the note.

### Settings

| Setting | Use |
|---|---|
| `CONSULTING_REQUEST_TO` | Where requests go; default `hello@agents.opengrants.io` |
| `RESEND_API_KEY`, `RESEND_FROM` | Sending; without them the send answers 503 |
| `RATE_LIMIT` (KV) | The daily counts; without it one isolate's memory is used |
| `OAUTH_SIGNING_KEY_JWK` | Already required; the form token key is derived from it |
| `TRUSTED_PROXY` | Only behind your own proxy: trust `X-Forwarded-For` for the network count |

## Tests

- `packages/notify/test/migration.test.ts`: the two emails and the number removal.
- `apps/api/test/migration-request.test.ts`: preview equals sent, the confirmation, the
  CONSULTING_REQUEST_TO override, input refusals, number removal, the log line, the hidden field,
  the form token and its times, the daily limits, mail failures, tokens refused, sessions, no MCP
  tool. `contract-migration-request.test.ts` validates the answers against the OpenAPI document.
- `apps/web/test/switch.test.tsx`: every page renders with its sources and the date stamp, no
  system lacks a source, prices only where researched, the form, axe.
- `apps/web/test/switch-contract.test.ts`: the web client against the API in-process and the mock,
  same assertions.
- `apps/web/e2e/flow21-switch-request.spec.ts`: open `/switch/submittable`, fill, preview, send.
