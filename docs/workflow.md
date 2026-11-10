# Workflow (`packages/workflow`)

Every status change runs through one function per machine: **guard → write → ledger → webhook**,
through injected ports (`{ write, ledger, emit }`). No route writes a status column directly. A refused
transition touches no port and returns `{ ok: false, code, reason }` with a human-readable reason.

```ts
const result = await trancheMachine.transition(tranche, "release", actor, ctx, ports);
```

`check(from, action, actor, ctx)` answers "may this happen?" without side effects; `actionsFrom(status)`
lists the structurally possible actions for UI menus and MCP tool hints.

Actors are `applicant`, `funder`, `system` or `passport`; `actor.id` is the ledger actor string.

## Application

| Action | From | To | Who | Guard |
|---|---|---|---|---|
| `submit` | draft, revision_requested | submitted | applicant | stage open, required forms complete |
| `screen` | submitted | screening | funder, system | |
| `start_review` | submitted, screening | under_review | funder | |
| `recommend` | under_review, interview | recommended | funder | |
| `accept` | recommended, waitlisted | accepted | funder | committed decision |
| `decline` | submitted, screening, under_review, interview, recommended, waitlisted | declined | funder | committed decision |
| `waitlist` | recommended | waitlisted | funder | committed decision |
| `request_revision` | submitted, screening, under_review | revision_requested | funder | note |
| `schedule_interview` | screening, under_review | interview | funder | |
| `resume_review` | interview | under_review | funder | |
| `withdraw` | any non-terminal | withdrawn | applicant | |

CommonGrants projection (`applicationCgStatus`): draft → `inProgress`, submitted → `submitted`,
accepted → `accepted`, declined → `rejected`; everything else is `custom` with a camelCase
`customValue` (`underReview`, `revisionRequested`, …).

**Stages** are a separate dimension. `planAdvance` / `advanceStage` move `application.stage` along
`competition.stages`: funder only, target stage's `entryFrom` must include the current stage, and the
application must be submitted and non-terminal. A stage with `requiresSubmission` resets status to
`draft`, locks the prior stage's responses and creates the new stage's responses as `notStarted`.

## Award

`offered → accepted → active → completed | cancelled`, `active ↔ suspended`. `activate` requires an
executed agreement or the `noAgreementRequired` condition. `accept_offer` is the recipient's;
`awardEffects("accepted").mirrorToPassport` tells the caller to create the Passport award.
`awardCgStatus`: offered/accepted/active/suspended → `awarded`, completed → `completed`,
cancelled → `cancelled`, with the GMS status in `customValue`.

## Agreement

`draft → sent → signed_by_grantee → countersigned → executed`; `void` from any state before
`executed`. Voiding an executed agreement is refused (`voidRefusal` gives the "issue an amendment"
message). `sign` and `countersign` require a signature record: typed name, attestation, IP, time and a
document SHA-256 equal to the one that was sent.

## Tranche

`scheduled → due → ready → releasing → initiated → settled`; `due|ready → held → due`;
`releasing → failed → due`; `initiated → failed | returned`; `record_external` moves `due|ready →
settled` with `mode = resolve`; `cancel` from scheduled, due, ready, held or failed. `release` is
funder-only and needs a passed readiness check and an idempotency key.

## Requirement and submission

Requirement: `scheduled → due → overdue`; `due|overdue → submitted → under_review → accepted |
returned (→ due)`; `waive` from any state but accepted. Submission: `draft → submitted → under_review
→ accepted | returned (→ draft)`.

## Cross-machine effects (`effects.ts`)

- `executeAgreement`: executes the agreement, activates an `accepted` award, and marks scheduled
  `onExecution` tranches due.
- `acceptRequirement`: accepts the requirement and marks its `releases_tranche_id` tranche due.

Dependent transitions run through the same ports, so they are ledgered and announced too.
