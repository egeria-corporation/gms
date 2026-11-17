# Reviews

How applications are reviewed: assignment, conflicts of interest, scoring, blind mode, the panel,
and (since v1.8.0) the competition's conflict-of-interest policy, anonymized review and the board
docket. The service layer is `apps/api/src/services/reviews.ts` and
`apps/api/src/services/review-privacy.ts`; the math is `packages/review`. Routes: `docs/api-surface.md`
and `api/review.tsp`.

## Assignment and per-application conflicts (since v1.0)

- Program staff assign reviewers by hand or automatically (capacity, expertise tags). A reviewer is
  never assigned to an applicant they have a declared conflict with, or whose Passport record has
  their email domain (shared mailbox providers never match).
- Before an application opens for scoring, the reviewer declares whether they have a conflict on it.
  Declaring one recuses them; the application never opens. A reviewer can recuse at any time.
- Blind mode: a reviewer sees other reviewers' scores only when the stage allows it (`reviewMode`:
  never before the panel, after submitting their own, or always) or the panel is open.

## The conflict-of-interest policy (v1.8.0)

Every competition has a conflict-of-interest policy. Until the funder writes its own, it is a
plain-language default (`DEFAULT_COI_POLICY` in `packages/review/src/coi.ts`).

- **On for new competitions, off for live panels.** `competitions.coi_policy_required` says whether
  reviewers must sign. Competitions created after migration 0033 start with it on. Competitions that
  already existed when 0033 ran start with it off, so a panel that was reviewing keeps reviewing
  without interruption; the funder turns it on in Review assignment → Conflict-of-interest policy
  ("Reviewers sign this policy before applications open for them"), and from then on each reviewer
  signs before their applications in that competition open again. `PUT
  /gms/competitions/{id}/coi-policy` takes `{ required }` (with or without a new text); changing it
  needs a signed-in person (`403 human_only` for an agent or API client) and is ledgered
  `competition.coi_policy_required_set`. While it is off, the signing rules below do not apply in that
  competition; declared conflicts already on record still feed the assignment exclusion.
- **Signing.** Each reviewer signs the policy once per competition: they read it, type their name
  and tick that they agree; the time is recorded. Until they sign, nothing in that competition opens
  for them: the assignment list shows each assignment as waiting for their signature (no title, no
  review), and every other read answers `409 coi_policy_unsigned` "Sign the conflict-of-interest
  policy first", or 404 for the application itself, on every route (REST, CommonGrants, MCP).
  Recusing stays open. Staff who review alongside reviewers sign too before they score.
- **People only.** A reviewer signs in person, signed in. An agent acting for them, or an API
  client, is refused (`403 person_required`), and no MCP tool signs.
- **Versions.** Changing the policy makes a new version. A signature counts for the version signed
  (`RESIGN_WHEN_POLICY_CHANGES`), so reviewers sign again before more applications open. Signing
  names the version the reviewer read; if the policy changed meanwhile the signature is refused
  (`409 policy_changed`). Policy versions and signatures are never edited (database triggers).
- **Declared conflicts.** When signing, a reviewer may list organizations they have a conflict with
  (name and, optionally, website). These are matched to the funder's applicants by normalized name
  or website and feed the existing exclusion: the reviewer is not assigned to them, by hand or
  automatically, and any assignment they already hold on one in this competition is recused
  ("Declared when signing the conflict-of-interest policy"). The reviewer is never told whether a
  declared organization applied, and the recused assignment leaves their own list.
- **The conflicts register.** Program staff, observers and auditors see, per competition: who signed
  which version and when (and who has not), the organizations each declared with the applicants they
  matched, and every recusal with its reason. It downloads as CSV (`conflicts-register.csv`); values
  a spreadsheet would run as a formula are neutralized.

Storage: `coi_policies` and `coi_signatures` (migration 0033), readable by staff, by the workspace's
reviewers (a policy; an external reviewer only for their competitions) and by the reviewer who
signed (a signature). Every write goes through the API.

## Anonymized review (v1.8.0)

A per-stage setting, off by default: Reviews → Review assignment → Review settings, or
`PUT /gms/competitions/{id}/review-settings`. Stored with the stage in `competitions.stages`
(`anonymized: true`), like the rubric, review mode and panel settings.

A reviewer (internal or external) whose assignment is in an anonymized stage, or whose application's
current stage is anonymized, does not see:

- the applicant organization's name, EIN, website, address or contacts (the application shows as
  "Applicant A-1042", a short code stable per application: its place in the competition by when it
  was started);
- fields the form marks `identifying` (the form builder's per-field flag, `options.identifying` or
  `fieldMeta`), and fields whose widget always carries identity: Passport fields, addresses, phone
  numbers, signatures, and email fields;
- attachment file names: a file reference keeps its document, under a neutral name ("Attachment
  1.pdf");
- the organization's names, website, email domain or EIN anywhere in free text, including the title
  and other reviewers' narratives and comments: they read "[applicant]".

Staff always see everything. Redaction happens in the service layer, so every route a reviewer can
reach gives the same view: the inbox list (search and sort read the redacted title), application
detail, the CommonGrants application, form response and search routes, assignments, reviews, MCP
tools and resources, and the assistant's context (it is built from the same detail). Routes that
were already closed to reviewers stay closed: the ranking, the panel summary and notes, the budget
and attachments, threads. Thread messages are no longer mailed to reviewers, who cannot open threads.
In-app notifications carry event types and ids, never names. `apps/api/test/review-parity.test.ts`
has one test per route.

Turning anonymized review off shows reviewers who applied from then on; turning it on cannot take
back what a reviewer has already seen.

## The board docket (v1.8.0)

Panel → Board docket. One PDF for the decision meeting, for a stage or a picked set of applications
(`POST /gms/competitions/{id}/dockets`, at most 200):

- a cover page (competition, opportunity, stage, date, totals requested and recommended);
- a summary table: applicant, request, recommended amount, average score, recommendation;
- one page per application: a short summary taken from its own answers (never a field marked
  identifying, personal or hidden from reviewers), the budget total, scores by criterion (mean, 0 to
  100), the reviewers' recommendations, and the reviewers' comments marked for the panel, with
  reviewers named "Reviewer 1", "Reviewer 2"; and the recommendation (the panel's proposal until
  committed).

Comments a reviewer marked for program staff only are left out unless the person ticks "Include
comments reviewers marked for program staff only". The docket carries no bank or identity data, and
any run of digits shaped like a tax, bank or personal identity number in printed text is removed.
It is for program staff (`DOCKET_ROLES`: admin, program officer), kept in the EXPORTS bucket under
`exports/{workspaceId}/dockets/{competitionId}/{docketId}.pdf`, and downloaded by its route with the
same credentials; it is never public. Without an EXPORTS bucket the server answers `503
exports_unavailable`.

## MCP

`get_coi_policy` and `get_conflicts_register` read through the same services. There is no tool to
sign a policy (a person signs) or to change a stage's review settings (it changes what reviewers see).
