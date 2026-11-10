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
`releasing → failed → due`; `initiated → failed | returned`; `settled → returned` (an ACH return after settlement); `record_external` moves `due|ready →
settled` with `mode = resolve`; `cancel` from scheduled, due, ready, held or failed. `release` is
funder-only and needs a passed readiness check and an idempotency key.

Passport can park a disbursement itself while a destination change is in flight, after the GMS has
released it. `passport_hold` moves `releasing → held` and keeps the Passport disbursement id;
`resume_release` (`held → releasing`) and `passport_released` (`held → initiated`) follow Passport's
release of that hold. Both need the disbursement id, so a hold the GMS placed before release (no
disbursement yet) can only go back to `due` through `release_hold`.

## Requirement and submission

Requirement: `scheduled → due → overdue`; `due|overdue → submitted → under_review → accepted |
returned (→ due)`; `waive` from any state but accepted. Submission: `draft → submitted → under_review
→ accepted | returned (→ draft)`.

## Cross-machine effects (`effects.ts`)

- `executeAgreement`: executes the agreement, activates an `accepted` award, and marks scheduled
  `onExecution` tranches due.
- `acceptRequirement`: accepts the requirement and marks its `releases_tranche_id` tranche due.

Dependent transitions run through the same ports, so they are ledgered and announced too.

## How the API drives the award path

The services in `apps/api/src/services` (`decisions.ts`, `awards.ts`, `agreements.ts`) are the only
callers of these machines for awards:

1. `commitDecisions`: `recommend` (when needed) then `accept` on the application; the award is
   created in `offered` with its schedule and requirements from the program's `defaults`
   (`awardPeriod`, `schedule`, `requirements`, `agreementTemplateId`, `noAgreementRequired`,
   `reminderPlan`), and an agreement `draft`.
2. `sendAgreement`: `send` with the SHA-256 of the rendered document.
3. `acceptOffer` (recipient admin, a person): `accept_offer`, then the Passport mirror.
4. `signAgreement` (recipient admin, a person): `sign`; the award must be `accepted`.
5. `countersignAgreement` (funder staff, a person): `countersign`, then `executeAgreement`.

Machine patches that have no column (`accepted_at`, `suspend_reason`, `cancel_reason`,
`void_reason`) are kept in the ledger entry of the transition, not on the row.

