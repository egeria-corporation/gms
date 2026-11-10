# Payments

How the GMS pays a tranche, and how Passport as deployed differs from the v1 build prompt (§10.6, §10.7, §11.1, §11.6).
Code: `packages/passport-client` (the only code that talks to Passport) and `packages/payments` (scheduling, readiness, release, webhook effects, reconciliation).

The rules do not change: there is one money path, Passport. The GMS holds no destination, sets none, and never adds to `disbursedAmount`. Bank data in the GMS is a bank name and the last four digits.

## Flow

1. **Schedule.** `buildSchedule` turns a program's plan (percentages or fixed amounts, each with a condition: `onExecution`, `onReportAccepted`, `onDate`, `manual`) into tranches that sum exactly to the award. The tranche id (`trn_…`) is also its Passport `Idempotency-Key`.
2. **Due.** `evaluateDue` moves `scheduled` tranches to `due` when their condition is met. Nothing is due before the award is `active`.
3. **Readiness.** `evaluateReadiness` returns seven checks, each `{ key, state, label, reason, fixHref }` with state `pass`, `fail` or `unknown`. `unknown` means Passport could not be read; it never counts as a pass or a fail. Release is allowed only when all seven pass (`summary.releasable`).

   | Key | Passes when |
   |---|---|
   | `agreement` | Agreement executed, or the award carries `noAgreementRequired` |
   | `condition` | The tranche's own condition is met |
   | `funder_link` | The workspace's Passport client works and the funder has a funding bank with `canDebit` |
   | `payee_credential` | Credential is L3, destination `active`, no pending change, no freeze in force |
   | `award_headroom` | Passport's `awardedAmount − disbursedAmount` covers the tranche |
   | `no_duplicate` | No other tranche on the award for the same amount is `releasing`/`initiated` within 24 h, unless confirmed |
   | `recipient_standing` | Organization active; a level downgrade since submission fails only below L3 |

4. **Release (facilitated).** `releaseFacilitated` re-reads the Passport award and the credential, marks the tranche `releasing`, then calls `POST /passport/disbursements` with `Idempotency-Key: trn_…`. Passport's status maps onto the tranche (`pending`/`validated` → `releasing`, `initiated`, `settled`, `failed`, `returned`, `held`).
   - `409 credential_version_stale`: re-resolve the credential once and retry with the same key. A second stale answer holds the tranche with reason `credential_version_stale`.
   - Any other refusal: `releasing → failed → due`. No money moved.
   - No answer (network, 5xx): the tranche stays `releasing`. Calling again with the same key resumes it at Passport; it cannot pay twice.
5. **Resolve mode.** `recordExternal` posts `mode: "resolve"` with `external { reference, paidAt, destinationLast4 }` and settles the tranche. On `422` (for example the last four digits do not match the credential) the tranche is settled locally with `passport_status = unverified` and shown in Payments center.
6. **Webhooks.** `parsePassportWebhook` verifies the delivery, `handleOnce` dedupes on the event id, and the handlers in `events.ts` return what to change: tranche updates, recipient flags (pending destination change, level, active), awards whose `disbursedAmount` cache must be re-read, credentials to re-resolve, alerts.
7. **Hold banner.** `holdBanner` gives the three parts (what is blocked, why, what clears it) for the five causes: pending destination change, freeze window, level below L3, agreement not executed, Passport unavailable.
8. **Mercury reconciliation.** `proposeMatches` pairs outbound bank transactions with `due`/`ready` tranches: amount within one cent, same currency, counterparty name similarity ≥ 0.8 (Sørensen–Dice on normalized names). A person confirms; confirming calls `recordExternal`.

Every status change is returned as a `TrancheUpdate` with the `path` of statuses to pass through. `packages/workflow` applies them (guard → write → ledger → webhook); `packages/payments` writes nothing.

## Passport as deployed vs. the build prompt

Read from the `egeria-corporation/passport` source on 2026-11-10, not from the test deployment. The live behavior wins.

| Topic | Build prompt | Passport today | Effect on the GMS |
|---|---|---|---|
| Provider | Moov | Stripe Connect (since 2026-11-03) | None: the GMS calls Passport routes only |
| `rail` | `auto`, `ach-credit-same-day`, `ach-credit-standard`, `instant-bank-credit` | `auto`, `standard`, `instant` (`auto` → `standard`) | `workspace.settings.defaultRail` must use the three live values |
| Funder capability check | `GET /passport/funders/{id}` returns `send-funds.ach` | No such route or capability. `GET /passport/funders/{orgId}/sources` lists funding banks with `canDebit` | Check 3 passes on a source with `canDebit` |
| Funder funding | Not described | ACH debit of the funder's linked bank, then transfer, then payout. Without a verified source Passport answers `409 funder_payments_setup_required` | Funder onboarding needs a "link a funding bank at Passport" step |
| Award mirror (§14) | `POST/PATCH /passport/funders/{orgId}/awards`, scope `award:write`, `?systemId=` lookup, `award.updated` event | **None of it exists.** Passport has no API that creates an award | The client methods sit behind `awardWrite: false`. Until the Passport PR merges, no award can be mirrored, so neither facilitated nor resolve payments can run against a real deployment |
| Disbursement body | `scheduledFor` allowed | Facilitated disbursements with `scheduledFor` are refused (`422 scheduling_not_supported`); unknown body fields are refused | The GMS never sends `scheduledFor`; it creates the disbursement on the payment date |
| `memo` | Free text | At most 140 characters | `memoFor` truncates the award title |
| Disbursement statuses | Not listed | `pending`, `validated`, `initiated`, `settled`, `failed`, `returned`, `held` | Mapped in `status.ts` |
| Pending destination change | The GMS blocks release | Passport also accepts the request and creates the disbursement `held` (`destination_change_in_flight`); the funder releases it with `POST /passport/disbursements/{id}/release` or cancels with `…/cancel` | The client exposes both. The tranche becomes `held` and keeps its disbursement id |
| Refusal codes | `credential_version_stale` | Also `payee_not_l3`, `organization_inactive`, `payee_kyb_not_verified`, `destination_not_active`, `credential_mismatch`, `award_amount_exceeded`, `recipient_mismatch`, `currency_mismatch`, `rail_unavailable_for_destination`, `funder_payments_setup_required`, `idempotency_key_reused` (422), `destination_last4_mismatch` (422), `paid_at_in_future` (422) | Surfaced as the refusal code and message |
| Idempotency | Key per tranche | A refused request stores nothing, so the key stays free. A key reused with a different body is `422 idempotency_key_reused`. A replay sets `Idempotent-Replayed: true` | The stale-credential retry reuses the key safely |
| Headroom | The GMS checks `awarded − disbursed` | Passport also refuses (`409 award_amount_exceeded`) and counts disbursements in flight, not only settled ones | The GMS check can pass and Passport still refuse; that is a normal refusal |
| Webhook signature | `X-Passport-Signature`, `X-Passport-Timestamp` | `X-Passport-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`, timestamp in unix seconds; also `X-Passport-Event`, `X-Passport-Delivery` | Verified with a 300 s tolerance |
| Webhook envelope | Not specified | `{ id, type, orgId, occurredAt, data }`; `orgId` is the organization the event is about | Dedupe on `id` |
| Webhook events | Five events | The same five; no org-change or award event | Org changes stay on the nightly poll |
| Payee events | Sent to the funder's subscription | Sent only to funders **linked** to the nonprofit (`POST /passport/funders/{orgId}/links`) | The GMS must create the link when an award is offered, or it receives no `payee.*` events for that grantee |
| Subscriptions | `POST /passport/subscriptions` | Same; only an organization's own OAuth client may call it; the secret is returned once | Store the secret with `encryptSecret` |
| Org profile | `GET /passport/orgs/{orgId}/profile` with `org:read` | The route exists for user sessions only; an OAuth token cannot call it | Prefill from profile fields (budget, fiscal year end, 990 figures) needs a Passport change. `OrganizationBase` prefill is unaffected |
| Access-token lifetime | Not specified | 15 minutes; refresh tokens rotate on every use | `refreshTokenTokens` hands each new refresh token to `onRotate` to be stored encrypted |
| Recipient standing | `status = active` from the credential | The credential has no status field; inactivity arrives as `payee.organization.inactive` or as a `409 organization_inactive` refusal | Check 7 reads the cached projection and the event flag |

## Open points

- The tranche machine in the build prompt has no `releasing → held` and no `held → releasing/initiated`. Both happen when Passport holds a disbursement for a destination change and the funder later releases it. `packages/workflow` needs these two transitions.
- Passport's hold reason is `destination_change_in_flight`; the GMS's own hold reason for the same cause is `pending_destination_change`. A tranche held by Passport carries Passport's reason in `hold_reason`, so the web layer must map both to the pending-destination-change banner.
- `packages/passport-client` does not depend on `@gms/workflow`; it declares `PassportLevel`, the same union as `VerificationLevel`.
- The fixtures under `packages/passport-client/test/fixtures` were written from Passport's source, not recorded from the test deployment. Re-record them once credentials for the test deployment are available. Nothing in these packages has run against a live Passport.
