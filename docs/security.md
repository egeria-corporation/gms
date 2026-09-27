# Security

GMS handles applicants' personal information, foundations' financial data, and instructions that lead to real payments. This document summarizes the threat model and the controls that address it. See `docs/rls-coverage.md` for the generated row-level-security coverage report.

## Reporting a vulnerability

Please email **security@egeria.example** (replace with the project's security contact before launch) with a description, reproduction steps and the affected version (shown in every page footer). Don't open a public issue. We aim to acknowledge reports within two business days and to publish an advisory with the fix.

## Threat model (summary)

| Asset | Threats | Primary controls |
|---|---|---|
| Applicant data (answers, attachments, demographics) | Cross-tenant or cross-applicant reads; reviewers seeing blind fields; PII leakage | Postgres RLS on every table (tested as a role × table matrix); reviewers read only through `gms.reviewer_submission()` which masks blind fields; demographics in a separate table with no row-level staff access (aggregates with n < 5 suppression only) |
| Money movement | Forged approvals, self-approval, agents approving payments, duplicate sends, paying unverified payees | Maker-checker enforced in SQL (batch creator can't approve, second approver must differ, approvals need an `aal2` claim) and in the action layer; people-only R3 actions with a fresh TOTP step-up; `request-send-money` means a person also approves in Mercury; payee-ready and hold gates as triggers; idempotency key = payment id; payment ceiling trigger (Σ payments ≤ award + approved amendments) |
| Bank details | Storage or exfiltration of account numbers | GMS never receives them: grantees onboard on Mercury's recipient-invite page; only the last four digits of the foundation's own accounts are stored |
| Credentials & secrets | Leaked API tokens, Mercury tokens, webhook secrets | SecretStore (Supabase Vault, or AES-256-GCM with `GMS_ENCRYPTION_KEY`); tokens are stored hashed (SHA-256) and shown once; secrets never reach the browser or logs |
| Agent access | Prompt-injected agents taking consequential actions; scope creep | One action registry with risk tiers: R2 actions from agents become approval requests confirmed inside GMS; R3 actions are refused for agents and no scope grants them; applicant text is labeled "untrusted applicant-supplied content" in agent tools; per-client rate limits and kill switches |
| Audit trail | Tampering, misattribution | Append-only `audit_log` (trigger); every action writes its audit row in the same transaction; `append_audit` validates that human entries name the caller and agent entries act for the caller |
| Webhooks | Forged events, replays | Mercury `Mercury-Signature` HMAC-SHA256 verification with a 5-minute window; event-id de-duplication (`rail_events` unique key); Svix verification for email events; outbound webhooks signed with HMAC-SHA256 |
| Files | Malware, path traversal, oversized uploads | Type/size allowlists, private buckets, short-lived signed URLs, scan gate (ClamAV when configured; files marked "not scanned" otherwise), safe storage keys |

## Row-level security approach

- Requests run in a transaction that sets `role = gms_authenticated` (or `gms_anon`) and `request.jwt.claims` from a **verified** session or token — the same mechanism PostgREST uses, so policies call `gms.uid()` / `gms.jwt()`.
- GMS uses dedicated roles instead of Supabase's `anon`/`authenticated`, and revokes every privilege from those roles on GMS tables, so the Supabase Data API can never read or write GMS data even if left enabled.
- Workers, webhooks and the setup wizard use a service connection **only through the action executor with a system actor**, so their writes are audited too.
- Guard triggers enforce column-level rules RLS can't express (applicants can't change status except in allowed transitions; scan results and EIN verification are service-only; cross-workspace references are rejected).
- `pnpm test:db` runs the RLS matrix (every table × 14 principals × select/insert/update/delete), invariant tests, and a coverage test that fails when a new table lacks RLS or a matrix entry.

## Application security controls

- **Authentication:** magic links (single use, 15 minutes, rate limited per email and IP, no account enumeration); TOTP MFA required for staff; step-up (fresh TOTP within 15 minutes) for people-only actions.
- **Headers:** CSP with per-request nonces and `strict-dynamic`; `frame-ancestors 'self'` (and `X-Frame-Options: SAMEORIGIN`) so only GMS itself can frame its pages, for PDF previews; the embed route can be framed anywhere; HSTS in production; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy`.
- **CSRF:** Next.js server actions check the origin; machine endpoints use bearer tokens, not cookies.
- **Input/output:** zod validation for every action; Ajv for form answers on every save and at submit; React escaping; rich text is Markdown rendered to elements or sanitized with DOMPurify (`SafeHtml`) — `dangerouslySetInnerHTML` is lint-banned elsewhere; CSV exports neutralize formula injection.
- **Rate limits:** sign-in, public APIs, MCP and A2A (per client/key and per IP), with `RateLimit` and `Retry-After` headers.
- **Privacy:** applicants can download their data and request deletion; demographics are segregated; retention settings per workspace; dev mail capture ensures non-production environments never email real people.

## Known gaps and accepted risks

- `style-src 'unsafe-inline'` is allowed because Radix and Recharts set inline style attributes (styles cannot execute script; scripts remain nonce-bound).
- Security-definer helpers `gms_private.enqueue_event`, `store_idempotency` and `next_reference` can be called by the request roles with arbitrary arguments. Only the server holds database credentials, so this requires server compromise; a future change can bind them to the executor's transaction context.
- Supabase's OAuth 2.1 server does not support Client ID Metadata Documents yet; GMS's built-in authorization server does (see `docs/agents.md`).
- ClamAV scanning is optional; without it, `SCAN_REQUIRED` controls whether reviewers can open unscanned files.

## Dependency audit

`pnpm audit` runs in CI (report-only). The latest results and any accepted advisories are recorded in `REPORT.md` at release time.
