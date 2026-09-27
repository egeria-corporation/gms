# APIs

GMS exposes three machine interfaces. All of them run through the same action registry and executor as the UI, so validation, permissions, row-level security, audit and approvals are identical wherever a request comes from.

| Interface | Base path | For |
|---|---|---|
| CommonGrants | `/common-grants` | Interoperable grant data (opportunities, forms, applications, awards) |
| Platform API | `/api/v1` | Integrations and agents that want the full GMS surface |
| Webhooks | outbound, configured per workspace | Event notifications to your systems |

Agent protocols (MCP, A2A, OAuth) are described in [agents.md](agents.md).

## Authentication

Public reads (published opportunities, public awards, forms) need no credentials. Everything else takes `Authorization: Bearer <token>`:

| Prefix | Credential | How to get it |
|---|---|---|
| `gms_pat_` | Personal access token (acts for you) | Portal → Account → Connected agents, or Console → Settings → API |
| `gms_sk_` | Workspace API key (acts for the key's owner) | Console → Settings → API (admins) |
| `gms_ak_` | Foundation agent-account key | Console → Settings → Agents |
| `gms_oat_` | OAuth access token (1 hour, bound to one resource) | The OAuth flow in [agents.md](agents.md) |

Tokens are shown once and stored as SHA-256 hashes. Every bearer credential is treated as an **agent acting for a person**: the token's scopes and the person's role both apply, actions that need confirmation return `202` with an approval request, and people-only actions (payment approvals, role changes, bank connections) are refused.

## CommonGrants

GMS implements the [CommonGrants](https://commongrants.org) protocol. The OpenAPI document is at `/common-grants/openapi.json`.

| Method | Path | Conformance | Auth |
|---|---|---|---|
| GET | `/common-grants/opportunities` | required | — |
| GET | `/common-grants/opportunities/{oppId}` | required | — |
| POST | `/common-grants/opportunities/search` | optional | — |
| GET | `/common-grants/forms`, `/forms/{formId}` | experimental | — |
| GET | `/common-grants/competitions`, `/competitions/{compId}` | experimental (list is a GMS extension) | — |
| GET | `/common-grants/awards`, `/awards/{awdId}`; POST `/awards/search` | experimental | — |
| POST | `/common-grants/applications/start` | experimental | bearer or session |
| GET | `/common-grants/applications/{appId}` | experimental | bearer or session |
| GET/PUT | `/common-grants/applications/{appId}/forms/{formId}` | experimental | bearer or session |
| PUT | `/common-grants/applications/{appId}/submit` | experimental | bearer or session |
| POST | `/common-grants/applications/search` | experimental | bearer or session (staff) |

GMS-specific fields travel in `customFields` (for example `gms.referenceNumber`, `gms.competitionId`). Money uses CommonGrants `{ amount: "12500.00", currency: "USD" }`; internally GMS stores integer cents.

## Platform API `/api/v1`

- **OpenAPI 3.1:** `/api/v1/openapi.json` — one operation per agent-callable action (`POST /api/v1/actions/{actionId}`) plus REST aliases.
- **Arazzo 1.0 workflows:** `/api/v1/workflows.arazzo.yaml` — for example "find an opportunity → check eligibility → start → save answers → request submission".

REST aliases:

| Method | Path |
|---|---|
| GET | `/opportunities`, `/opportunities/{opportunityId}`, `/opportunities/{opportunityId}/form` |
| POST | `/opportunities/{opportunityId}/eligibility` |
| GET / POST | `/applications` |
| GET | `/applications/{applicationId}`, `/applications/{applicationId}/form` |
| PATCH | `/applications/{applicationId}/forms/{formId}` |
| POST | `/applications/{applicationId}/validate`, `/attachments`, `/submit` |
| GET | `/awards`, `/payments`, `/reports`, `/approval-requests`, `/approval-requests/{id}`, `/exports/{exportId}` |
| POST | `/payments/batches`, `/reports/{requirementId}/submit`, `/exports` |
| PUT | `/reports/{requirementId}` |

Conventions:

- **Errors** are RFC 9457 `application/problem+json` with a stable `code` (`validation_failed`, `forbidden`, `not_found`, `conflict`, `human_only`, `approval_required`, `rate_limited`, …).
- **Idempotency:** send `Idempotency-Key` on writes; a replay returns the original result.
- **Concurrency:** reads return `ETag`; send `If-Match` on updates to avoid overwriting someone else's change (`412` on mismatch).
- **Rate limits:** `RateLimit` and `RateLimit-Policy` headers; `429` with `Retry-After`. Defaults: 60 requests/minute per agent and person, 30/minute per IP for anonymous callers.
- **Approvals:** an action that needs a person's confirmation returns `202 Accepted` with `Location: /api/v1/approval-requests/{id}` and a `confirmUrl` the person opens in GMS. Poll the approval request for the outcome.
- **Money** is integer cents in `/api/v1` (`amountCents`).

## Webhooks

Configure endpoints in **Console → Settings → Webhooks**. Each delivery is a `POST` with a JSON body and these headers:

| Header | Meaning |
|---|---|
| `gms-event` | Event type, e.g. `application.submitted` |
| `gms-event-id` | Stable id of the event (deduplicate on this) |
| `gms-delivery` | Id of this delivery attempt |
| `gms-timestamp` | Unix seconds when signed |
| `gms-signature` | `v1=` + hex HMAC-SHA256 of `{timestamp}.{body}` with the endpoint's signing secret |

Verify the signature with a constant-time comparison and reject timestamps older than five minutes. Failed deliveries retry with exponential backoff; you can see and redeliver them in the console.

Event types include `opportunity.published|opened|closed|updated`, `application.started|submitted|status_changed|info_requested|extension_granted`, `review.assigned|submitted|recused`, `award.created|amended|held|released`, `payment.batch_proposed|first_approval|approved|requested|sent|failed|reconciled`, `report.due|overdue|submitted|accepted|revisions_requested`, `approval.requested` and `message.sent`.

Inbound webhooks: `/webhooks/mercury` (verifies `Mercury-Signature`) and `/webhooks/email` (Svix signatures).
