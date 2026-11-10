# Runbook

For whoever operates an instance. Each procedure names what to look at first, then what to do.
Workspace-level actions go through the API so they are authorized and ledgered; direct SQL is for
reading, and for the few cases marked as such.

## Rotate the OAuth signing key

Access tokens are ES256 JWTs signed with `OAUTH_SIGNING_KEY_JWK` (`kid` = `OAUTH_KID`), valid for one hour; MCP and API clients fetch `/.well-known/jwks.json`.

1. `pnpm --filter @gms/api keygen`. Keep the new private JWK and `kid`.
2. Put the **old** public JWK (printed when it was generated, or copy it from the current JWKS) in
   `JWKS_EXTRA_PUBLIC_KEYS` as a JSON array, so tokens signed minutes ago still verify.
3. `wrangler secret put OAUTH_KID` and `OAUTH_SIGNING_KEY_JWK` with the new values; deploy the API.
4. Check `/.well-known/jwks.json` lists both keys.
5. Access tokens live one hour. After at least that long, clear
   `JWKS_EXTRA_PUBLIC_KEYS` and deploy again.

If the private key leaked: do steps 1 and 3 only, skip step 2, and expect every client to
re-authenticate. Refresh tokens are stored hashed and are not affected by the signing key.

## Rotate `CREDENTIALS_ENCRYPTION_KEY` or `WEBHOOK_SECRET_KEY`

There is no re-encryption job yet. Rotating `CREDENTIALS_ENCRYPTION_KEY` makes every stored Passport
client secret, applicant refresh token and connector token unreadable: funders must reconnect
Passport (Settings → Payments), applicants must reconnect (Organization → Connect Passport), and
Mercury tokens must be re-entered. Rotating `WEBHOOK_SECRET_KEY` requires every webhook
subscription to be recreated. Rotate these only on suspected exposure, and announce it first.

## Replay an outbound webhook

Symptoms: a subscriber says it missed an event.

1. `GET /gms/webhooks/{id}/deliveries` (workspace admin) shows each attempt, status code and the
   next attempt time. Deliveries retry with backoff for 24 hours, then stop.
2. To send a stopped delivery again, set it due (SQL, service role):
   `update webhook_deliveries set status = 'pending', next_attempt_at = now() where id = '<delivery id>';`
   The next `*/5` run of the jobs Worker sends it with a fresh timestamp and signature.
3. If every delivery to one subscriber fails with 401/403, its secret is out of step: delete the
   subscription and create it again; the new secret is shown once.

There is no replay endpoint yet; step 2 is the supported way until one exists.

## Replay an inbound webhook (Passport or Resend)

Every verified delivery is stored raw in `inbound_events` and deduplicated on
`(provider, external_id)`.

1. Find what failed: `select id, provider, type, received_at, error from inbound_events where processed_at is null or error is not null order by received_at desc limit 50;`
2. Fix the cause (usually a missing link or a deploy in progress).
3. Re-queue a Passport event: `update inbound_events set processed_at = null, error = null where id = '<id>';`
   then send `{ "kind": "passport_event", "inboundEventId": "<id>" }` to the `gms-events` queue
   (`wrangler queues producer send` or the dashboard). Processing is idempotent: a tranche already
   in the event's status is left alone. Resend events are processed when they arrive and are not
   queued; ask Resend to resend the webhook from its dashboard.
4. Messages that failed repeatedly are in `gms-events-dlq`. Read them there before purging.

A delivery rejected for a bad signature is not stored. Check `PASSPORT_WEBHOOK_SECRET` /
`RESEND_INBOUND_SECRET` against the sender's current secret.

## A tranche is stuck

Start with `GET /gms/tranches/{id}/readiness`: it lists the seven checks with a reason each.

| Status | What it means | What to do |
|---|---|---|
| `due` / `ready`, release disabled | A readiness check fails or is `unknown` | Fix what the check names. `unknown` means Passport could not be reached: see "Passport link recovery" |
| `held` | A hold with a reason: pending destination change, freeze window, level below L3, or a manual hold | Destination changes and freeze windows clear on their own when Passport sends `payee.destination.changed`. A manual hold clears with `POST /gms/tranches/{id}/release-hold` |
| `releasing` for more than a few minutes | The request to Passport was sent and no answer was recorded | Look the disbursement up in Passport by its idempotency key (`trn_<tranche id>`). If it exists, the tranche moves on with the next `disbursement.status.changed` event (replay it if it failed, see above). If Passport has no such disbursement, stop and report it: there is no supported way to move a tranche out of `releasing` by hand yet |
| `initiated` for days | Passport accepted it; settlement is pending or the webhook was missed | Check `inbound_events` for a failed `disbursement.status.changed` and replay it; compare with the disbursement's status in Passport |
| `failed` / `returned` | Passport refused, or the bank returned the payment | Read `passport_status` and the ledger for the tranche. A failed tranche goes back to `due` once the cause is fixed; a returned one needs the payee's destination corrected in Passport first |
| `settled` with `passport_status = unverified` | Recorded in resolve mode, and Passport could not match the destination's last four digits | Confirm the payment reference with finance. Nothing was sent by the GMS |

Never edit `tranches.status` in SQL: transitions run guard → write → ledger → webhook, and a
hand-edited row has no ledger entry and may be paid twice. To stop a payment, use
`POST /gms/tranches/{id}/hold` or `/cancel`.

The GMS never adds to `disbursedAmount`; the figure on an award is Passport's, cached. If it looks
stale, the hourly sync or any `disbursement.status.changed` event refreshes it.

## Passport link recovery

**Funder link** (`GET /gms/workspaces/{id}/passport/status`):
- `last_ok_at` old and readiness all `unknown`: Passport is unreachable or the client secret was
  rotated there. Check Passport's status first.
- Secret rotated or client deleted in Passport: a workspace admin disconnects
  (`DELETE /gms/workspaces/{id}/passport/link`) and connects again with the new client id and
  secret. Awards keep their `passport_award_id`; nothing is re-created.
- After `CREDENTIALS_ENCRYPTION_KEY` changed: every funder reconnects (see above).

**Applicant link** (Organization screen, or `POST /gms/me/organization/refresh`):
- `409 passport_consent_revoked`: the organization withdrew consent in Passport, or the refresh
  token was lost. The workspace keeps its cached record, marked stale; an applicant admin connects
  again ("Continue with Passport"). Applications already submitted keep the level stamped at submit.
- `503 passport_unavailable`: nothing changed; retry later.

**Award mirror**: an accepted award whose `passport_award_id` is empty failed to mirror. The hourly
`passport` job retries. It stays empty while `PASSPORT_AWARD_WRITE` is not `true`.

## Mail is not arriving

1. `RESEND_API_KEY` and `RESEND_FROM` set on both Workers? Without them nothing is sent and nothing fails.
2. Communications → send log (or `/gms/communications`) shows each send and the delivery events Resend reported.
3. Member notifications follow each person's preferences: a category with email off is never sent,
   and members on a daily or weekly digest get one email from the digest job
   (`notification.digest_sent` in the ledger records each one).
4. Sign-in codes are sent by Supabase Auth, not by the GMS: check the project's SMTP settings.

## The ledger

`ledger_events` is append-only: the table has no UPDATE or DELETE grant and a trigger refuses both.
The nightly job writes one JSONL file per day to `LEDGER_ARCHIVE` with a SHA-256 hash chain
(`ledger_archives` records each file's hash). To verify an archive, recompute the chain from the
previous day's hash; a mismatch means the file or the table changed after archiving.

## Export and restore a workspace

```bash
node --experimental-transform-types scripts/gms.ts export --workspace <handle> --out ./export
```

```bash
node --experimental-transform-types scripts/gms.ts import ./export --workspace <handle>
```

Import keeps ids, skips rows that already exist, and skips applications and awards whose applicant
workspace is not on the target instance (it prints how many). File bytes are not in the bundle:
the manifest lists each file with its hash and where it is stored.
