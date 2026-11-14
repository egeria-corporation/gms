# MCP server

The GMS serves a Model Context Protocol server at `https://gms.opengrants.io/mcp` (Streamable HTTP).
Agents are first-class users: every tool calls the same service function as the matching REST route,
with the same authorization check. An agent can do what its person can do in the UI, within the
scopes that person approved, and no more.

This page covers `packages/mcp`, the transport-independent core: the tool registry, the dispatcher,
the human gates, resources, prompts and the discovery documents. `apps/api` mounts it on `/mcp`.

## Authentication

- **Bearer tokens** from the GMS OAuth 2.1 server (`/oauth/authorize`, `/oauth/token`), ES256, JWKS
  at `/.well-known/jwks.json`.
- **Discovery**: an unauthenticated request to `/mcp` returns `401` with
  `WWW-Authenticate: Bearer resource_metadata="https://gms.opengrants.io/.well-known/oauth-protected-resource"`.
  That document (RFC 9728) names the authorization server and the supported scopes.
- **Dynamic client registration** at `POST /oauth/register`: public clients, PKCE S256 required,
  redirect URIs on the allow-list of known hosts plus `localhost`.
- **A token is bound to one user, one workspace and a set of scopes.** A user with several
  workspaces chooses one on the consent screen. The workspace's kind decides which tools exist:
  a funder workspace sees the funder tools, an applicant workspace the applicant tools. Calling a
  tool from the other side returns `wrong_side`.
- **Scopes**: each tool needs exactly one scope (tables below). `x:write` satisfies `x:read`.
- **Rate limit**: per token, 120 calls per minute by default (KV-backed). Over the limit returns
  `rate_limited` with `retryAfterSeconds`.
- **Ledger**: every call is recorded with `actor = user:<id>/client:<id>`.

## Human gates

Some actions need a person. When an agent calls a gated tool, nothing happens yet. The tool returns:

```json
{ "status": "pending_approval", "approvalId": "apr_…", "url": "https://gms.opengrants.io/approvals/apr_…" }
```

| Tool | Default | Can a token bypass it? |
|---|---|---|
| `commit_decisions` | Gated | With an explicit `approvals:bypass` grant |
| `submit_application` | Gated | With an explicit `approvals:bypass` grant |
| `send_communication` | Gated | With an explicit `approvals:bypass` grant |
| `decline_application` | Gated | With an explicit `approvals:bypass` grant |
| `release_tranche` | Gated | **Never** |
| `sign_agreement` | Gated | **Never** |
| `accept_award` | Gated | **Never** |
| `create_direct_award` | Gated | **Never** |
| `record_outside_submission` | Gated | **Never** |
| `record_outside_decision` | Gated | **Never** |
| `record_report_submission` | Gated | **Never** |

- Releasing money, signing an agreement and accepting an award always need a person, whatever the
  token grants and whatever the workspace configures. This is the stricter reading of the design
  note "Signing is a human gate: agents can prepare an agreement, never sign one."
- A workspace (Settings → MCP & human gates) or an API client (`api_clients.gated_tools`) can gate
  **more** tools. Overrides never remove a default gate.
- `decline_application` is gated in addition to the six tools the build spec lists, because a
  decline queues a letter to the applicant and acceptance item 11 expects an agent's decline to
  appear as pending approval.
- A person acting in the UI (a session with no OAuth client) is never gated: they are the approval.

### The approval flow

1. The agent calls a gated tool. The dispatcher checks side, scope and input first, so a call that
   could never run is refused instead of queued.
2. An approval request is stored (`pending`) with the tool, the validated input and who asked. The
   ledger records `approval.requested`; the `approval.requested` webhook fires.
3. The request appears in `/approvals`, on the funder dashboard and inline on affected rows.
4. A person in the same workspace who holds the tool's scope approves or rejects. API clients and
   agents cannot resolve approvals.
   - **Approve**: the original call runs exactly once, with the approver as the actor and the
     requesting agent recorded beside it. The request ends `executed` (with the result) or `failed`.
   - **Reject**: the request ends `rejected`. The call never runs.
5. The ledger records `approval.resolved`; the `approval.resolved` webhook fires.
6. The agent polls `get_approval { approvalId }` or listens for the webhook. A resolved request
   cannot be resolved again.

## Tools

### Funder tools

| Tool | Scope | Gate | What it does |
|---|---|---|---|
| `list_programs` | `programs:read` | — | List the workspace's programs with budget and fiscal year. |
| `get_program` | `programs:read` | — | Get one program, including its defaults (rubric, templates, requirement and reminder plans). |
| `list_opportunities` | `opportunities:read` | — | List opportunities, optionally by status or program. |
| `get_opportunity` | `opportunities:read` | — | Get one opportunity with its CommonGrants projection and eligibility rules. |
| `create_opportunity` | `opportunities:write` | — | Create a draft opportunity in a program. |
| `update_opportunity` | `opportunities:write` | — | Update fields of an opportunity. Published opportunities re-validate their CommonGrants projection. |
| `publish_opportunity` | `opportunities:write` | — | Publish an opportunity: validates the projection, renders the public page and adds the sitemap entry. |
| `list_competitions` | `competitions:read` | — | List competitions, optionally for one opportunity. |
| `get_competition` | `competitions:read` | — | Get one competition with its stages, pinned forms and launch-check result. |
| `create_competition` | `competitions:write` | — | Create a draft competition under an opportunity. One stage is the common case. |
| `quick_setup_competition` | `competitions:write`, `competitions:read`, `forms:write`, `reviews:write` | — | Fill the gaps that keep an opportunity from taking applications: a one-stage competition on the opportunity's dates, a starter application form (published and pinned) and a starter rubric. Reuses what it made before and never overwrites stages the funder set; held when the workspace gates any action inside it. Opening stays `open_competition`. |
| `set_stage_forms` | `competitions:write` | — | Pin form versions to a stage. On an open competition, pass migrate to re-validate in-progress responses. |
| `set_rubric` | `competitions:write` | — | Set the rubric used to score a stage. |
| `list_forms` | `forms:read` | — | List forms in the workspace, or the shared library. |
| `get_form` | `forms:read` | — | Get a form version: JSON Schema, UI schema and CommonGrants mappings. |
| `create_form` | `forms:write` | — | Create a draft form from a JSON Schema (2020-12 subset) and a UI schema. |
| `update_form` | `forms:write` | — | Update the draft version of a form. Published versions are immutable; this creates the next draft. |
| `set_prefill_mapping` | `forms:write` | — | Set how fields prefill from the applicant's Passport record (mappingFromCommonGrants) and project back (mappingToCommonGrants). |
| `list_applications` | `applications:read` | — | List applications in the funder's inbox with filters for stage, status, eligibility and Passport level. |
| `get_application` | `applications:read` | — | Get one application: form responses with provenance, eligibility results, Passport level and attestation. |
| `run_eligibility` | `applications:read` | — | Evaluate the opportunity's eligibility rules against an application. Unknown never declines. |
| `advance_application` | `applications:write` | — | Advance an application to a stage whose entryFrom includes its current stage. |
| `request_revision` | `applications:write` | — | Return an application to the applicant with a revision request. |
| `decline_application` | `applications:write` | Approval | Decline an application and queue the decline letter. |
| `tag_application` | `applications:write` | — | Add or remove tags on an application. |
| `list_review_assignments` | `reviews:read` | — | List review assignments by competition, stage, reviewer or status. |
| `assign_reviewer` | `reviews:write` | — | Assign a reviewer to an application for a stage. Refused when a conflict of interest is on record. |
| `get_scores` | `reviews:read` | — | Get submitted reviews and scores for an application. |
| `rank_applications` | `reviews:read` | — | Rank a competition stage: mean, median, spread and reviewer count per application. |
| `propose_decision` | `decisions:write` | — | Propose (not commit) decisions for applications. Proposals appear in the panel view. |
| `commit_decisions` | `decisions:write` | Approval | Commit proposed decisions: creates awards in offered, queues letters. Refused when the program would be over-allocated. |
| `list_awards` | `awards:read` | — | List awards by status, program or recipient. |
| `get_award` | `awards:read` | — | Get one award: lifecycle status, funding (disbursed amount is read from Passport), dates and conditions. |
| `create_award_from_application` | `awards:write` | — | Create an award in offered from an accepted application. |
| `amend_award` | `awards:write` | — | Record an amendment (extension, reallocation, scope or supplemental). Amount and period changes are mirrored to Passport. |
| `close_award` | `awards:write` | — | Complete or cancel an award. |
| `generate_agreement` | `agreements:write` | — | Render a draft grant agreement for an award from a template. |
| `send_agreement` | `agreements:write` | — | Send a draft agreement to the grantee for signature. |
| `get_agreement_status` | `awards:read` | — | Get an agreement's status, signatures and document hash. |
| `list_tranches` | `payments:read` | — | List scheduled payments (tranches) by award or status. |
| `check_payment_readiness` | `payments:read` | — | Run the live readiness checks for a tranche; each line has a pass, fail or unknown state and a reason. |
| `release_tranche` | `payments:release` | Always a person | Release a ready tranche through Passport (facilitated). Always requires a person. |
| `record_external_payment` | `payments:release` | — | Record a tranche the funder paid outside the GMS (resolve mode). Posts the reference to Passport. |
| `list_requirements` | `requirements:read` | — | List what grantees owe: reports, documents, milestones. |
| `review_submission` | `requirements:read` | — | Get a submission for review, with its form responses and provenance. |
| `accept_submission` | `requirements:write` | — | Accept a submission. A linked onReportAccepted tranche becomes due. |
| `return_submission` | `requirements:write` | — | Return a submission to the grantee with a note. |
| `send_reminders` | `requirements:write` | — | Send the reminder for requirements now, to grantees that share their record with this funder. At most one by hand per requirement per 24 hours. |
| `list_grantees` | `grantees:read` | — | List the funder's grantee directory. |
| `get_grantee` | `grantees:read` | — | Get one grantee: cached Passport projection, level, relationship notes, awards. |
| `get_passport_status` | `grantees:read` | — | Get a grantee's Passport status: level, payee status (bank name and last4 only), pending destination change, freeze. Shown only while the grantee shares its record with this funder. |
| `list_pending_org_changes` | `grantees:read` | — | List organization changes received from Passport that await a decision. |
| `accept_org_change` | `grantees:write` | — | Accept a pending organization change into the grantee record. Eligibility re-runs on open applications. |
| `portfolio_summary` | `analytics:read` | — | Portfolio totals: awarded, disbursed, active awards, by program. |
| `cycle_metrics` | `analytics:read` | — | Cycle metrics for a competition: counts by stage, time in stage, approval rate. |
| `export_990pf_grant_list` | `analytics:read` | — | Export the 990-PF Part XV grant list for a tax year. |
| `draft_letter` | `assist` | — | Draft a letter from a template. The draft is never sent by this tool. |
| `summarize_application` | `assist` | — | Summarize an application. Applicant text is quoted and labeled applicant-supplied. |
| `compare_to_rubric` | `assist` | — | Compare an application to a rubric, criterion by criterion. A draft for a human reviewer, never a score. |
| `send_communication` | `communications:write` | Approval | Send a templated email to applicants or grantees through Resend. |
| `get_approval` | any | — | Get the status of an approval request created by a gated tool: pending, approved, rejected, executed (with the result) or failed. |

#### Outside applications, writing faster and keeping awards (v1.5.0 to v1.7.0)

Outside applications are the applicant's own records of applications to any funder. These tools
call the same services as `/gms/outside-*`, `/gms/vault`, `/gms/funding-summary` and
`/gms/my/awarded-funding`. Drafts save nothing: accepted text is saved with `put_outside_answer`.
There is no consulting-request tool and no vault upload tool, and no tool moves money.

| Tool | Scope | Gate | What it does |
|---|---|---|---|
| `list_outside_applications` | `applications:read` | — | List the workspace's outside applications. |
| `get_outside_application` | `applications:read` | — | One outside application with its questions, latest answers, documents, tasks, AI use note, required documents and go/no-go. |
| `create_outside_application` | `applications:write` | — | Track an application to any funder. |
| `add_outside_questions` | `applications:write` | — | Add a funder's questions from pasted text (deterministic parse). |
| `put_outside_answer` | `applications:write` | — | Save an answer as a new version, marked as the agent's. |
| `set_outside_stage` | `applications:write` | — | Plain stage moves. |
| `record_outside_submission` | `applications:write` | Always a person | Record a submission made elsewhere, with an as-submitted PDF. |
| `record_outside_decision` | `applications:write` | Always a person | Record the funder's decision. |
| `draft_outside_answer` | `assist` | — | Draft an answer from the library and profile facts; returns text only, saves nothing. |
| `read_funder_guidelines` | `assist` | — | Read pasted guidelines into proposed questions, deadlines and required documents; saves nothing. |
| `library_for_question` | `library:read` | — | The library for one question, with the variant that best fits its limit. |
| `verify_answer` | `library:write` | — | Mark a library answer as verified. |
| `list_vault_documents` | `org:read` | — | List the document vault with expiry (never read by the assistant). |
| `use_vault_document` | `applications:write` | — | Attach a vault document to a required document. |
| `decide_go_no_go` | `applications:write` | — | Record the scorecard and move the application (go or no-go). |
| `comment_on_question` | `applications:write` | — | Comment on a question in the team's internal thread. |
| `create_milestones` | `applications:write` | — | Create milestone tasks with due dates. |
| `get_outside_award` | `applications:read` | — | An outside award: amounts by year, period, award letter, obligations, payments received. |
| `add_obligation` | `applications:write` | — | Add a report, expected payment, payment received (amount and date only) or condition, once or as a series. |
| `set_obligation_status` | `applications:write` | — | Move an obligation (due, done, received, missed, or back). |
| `record_report_submission` | `applications:write` | Always a person | Record a report submitted to the funder, with an as-submitted PDF. |
| `close_out_award` | `applications:write` | — | Close out an award once every obligation is done or received. |
| `get_funding_summary` | `applications:read` | — | Applications by fiscal year, win rate, asked and awarded. |
| `alert_on_next_cycle` | `discovery` | — | A funding alert on the program name, through the GMS's own alerts. |

### Applicant tools

| Tool | Scope | Gate | What it does |
|---|---|---|---|
| `get_my_organization` | `org:read` | — | Get the workspace's organization as cached from Passport (CommonGrants OrganizationBase). |
| `get_passport_readiness` | `org:read` | — | Get the organization's Passport level and readiness: identity, documents, payee (bank name and last4 only). |
| `find_competitions` | `discovery` | — | Find competitions open on the GMS, each with an eligibility preview for this organization. |
| `check_eligibility` | `discovery` | — | Dry-run a competition's eligibility rules against this organization, with an explanation per rule. |
| `search_opengrants` | `discovery` | — | Search the OpenGrants index for grants and funders. |
| `match_opengrants` | `discovery` | — | Match this organization's profile against the OpenGrants index. |
| `create_funding_alert` | `discovery` | — | Create an OpenGrants funding alert for a saved search. |
| `list_applications` | `applications:read` | — | List this workspace's applications across funders. |
| `get_application` | `applications:read` | — | Get one application: forms, responses with provenance, validation errors and status. |
| `start_application` | `applications:write` | — | Start an application to a competition. Fields mapped from Passport arrive prefilled and marked. |
| `fill_form_response` | `applications:write` | — | Merge values into a form response. Validation errors are returned, not fatal until submit. Values are marked as entered by this agent. |
| `attach_document` | `applications:write` | — | Attach a document to a file field of a form response. |
| `insert_answer` | `applications:write` | — | Insert an answer-library entry into a field. Provenance is recorded as library. |
| `validate_application` | `applications:read` | — | Validate every required form of the current stage and dry-run eligibility, without submitting. |
| `submit_application` | `applications:submit` | Approval | Submit an application: validates, runs eligibility, stamps the Passport level and attestation, locks responses. |
| `withdraw_application` | `applications:write` | — | Withdraw an application that has not reached a decision. |
| `list_awards` | `awards:read` | — | List awards made to this workspace. |
| `get_award` | `awards:read` | — | Get one award with its payment schedule and requirements. |
| `accept_award` | `awards:write` | Always a person | Accept an award offer. Always requires a person. |
| `sign_agreement` | `agreements:write` | Always a person | Sign a grant agreement. Always requires a person: the signature records their typed name, time, IP and the document hash. |
| `request_amendment` | `awards:write` | — | Request an amendment to an award. |
| `list_requirements` | `requirements:read` | — | List what this workspace owes funders: reports, documents, milestones. |
| `draft_submission` | `requirements:write` | — | Create or update the draft submission for a requirement. Prefills from the application, the prior report and Passport. |
| `submit_requirement` | `requirements:write` | — | Submit the draft submission for a requirement. |
| `share_submission_with_funder` | `requirements:write` | — | Share an accepted submission with another funder workspace. Records a consent. |
| `list_answers` | `library:read` | — | List the answer library. |
| `save_answer` | `library:write` | — | Save a new answer, or a new version of an existing one. |
| `adapt_answer` | `assist` | — | Draft an adaptation of a library answer to a question and its limits. Returns a draft; saves nothing. |
| `list_messages` | `messages:read` | — | List message threads with funders, or the messages of one thread. |
| `reply` | `messages:write` | — | Reply in a thread shared with a funder. |
| `get_approval` | any | — | Get the status of an approval request created by a gated tool: pending, approved, rejected, executed (with the result) or failed. |

`send_communication` is not in the build spec's tool list but is on its gate list, so it is declared
as a funder tool.

Errors use one shape: `{ code, message, issues? }` with `code` one of `unknown_tool`, `wrong_side`,
`insufficient_scope`, `invalid_input`, `rate_limited`, `not_found`, `forbidden`, `conflict`,
`service_error`. Unexpected failures return `service_error` with no internal detail.

## Resources

| URI | Content | Scope (funder / applicant) |
|---|---|---|
| `gms://opportunity/{id}` | CommonGrants `OpportunityDetails` | `opportunities:read` / published only |
| `gms://competition/{id}` | CommonGrants `CompetitionBase`, stages in `customFields.gms.stages` | `competitions:read` / published only |
| `gms://form/{id}` | CommonGrants `FormBase`: JSON Schema, UI schema, mappings | `forms:read` / published only |
| `gms://application/{id}` | CommonGrants `ApplicationBase` with form responses | `applications:read` |
| `gms://award/{id}` | CommonGrants `AwardBase`; disbursed amount is the cached Passport value | `awards:read` |
| `gms://org/{id}` | CommonGrants `OrganizationBase` as cached from Passport | `grantees:read` / `org:read` |

## Prompts

| Prompt | Side | Purpose |
|---|---|---|
| `triage-cohort` | Funder | Screen a stage's submissions, tag them, propose declines for approval |
| `write-decline-letter` | Funder | Draft a decline letter for a person to edit and send |
| `prepare-report` | Applicant | Build a prefilled draft report for a requirement |
| `fill-application-from-passport` | Applicant | Start and fill an application; a person submits |

## For implementers

- `ServiceLayer` (`packages/mcp/src/service.ts`) is derived from the tool declarations: one method
  per tool, `(actor, input) => Promise<unknown>`. REST routes call the same methods with the same
  `Actor`. Throw `ServiceError` for expected failures.
- Ports: `ApprovalStore` (`transition` must be an atomic compare-and-set on status), `LedgerPort`,
  `KvPort` (rate limit), `EventPort` (webhooks), `ResourceReader`. In-memory versions are exported
  for tests.
- `protectedResourceMetadata()` and `llmsToolSections()` build the discovery documents from the
  registry, so `/llms.txt` cannot drift from the tools.

## Assistant tools

`draft_letter`, `summarize_application`, `compare_to_rubric` (funder), and `adapt_answer`,
`draft_outside_answer` and `read_funder_guidelines` (applicant) call the same services as
`/gms/assist/*` and the outside application routes. They return drafts and save nothing. With the assistant
off (`ASSISTANT_ENABLED` not `true`, or no model key) `summarize_application`, `compare_to_rubric`
and `adapt_answer` answer `not_found`, and `draft_letter` returns the template rendered as is.
`compare_to_rubric` without a `rubricId` uses the rubric of the stage the application is in. Calls
count against the workspace's monthly quota (`ASSISTANT_MONTHLY_QUOTA`, 100 on the hosted site) like
calls from the web app; a draft that took a second model call to fit its limit counts twice.
