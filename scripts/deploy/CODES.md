# Result codes

Every `pnpm gms deploy <step>` run ends with exactly one JSON line on stdout:

```json
{"step":"migrate","code":"needs_confirmation","message":"…","data":{…},"next":"migrate"}
```

Progress for a person goes to stderr. Read only the last stdout line. (`pnpm` itself may print a
`$ node …` banner above it; use `pnpm -s gms …` to silence that.) `data` never holds a secret.

| Code | Exit | Meaning | What the agent does |
|---|---|---|---|
| `ok` | 0 | The step did what it set out to do (or, with `--dry-run`, reports what it would do: `data.dryRun` is true). | Continue with `next`. |
| `skipped` | 0 | The real state already matches; nothing was changed. | Continue with `next`. |
| `needs_login` | 3 | A required login is missing or expired (Cloudflare or Supabase). The message says the exact command. | Ask the person to sign in, then re-run the same step. |
| `needs_input` | 3 | A choice, flag, file or earlier step is missing, or the person must do something (for example add DNS records, switch to a release tag). | Read the message, get the answer from the person, re-run. |
| `needs_confirmation` | 3 | The step would create, change or spend something. `message` and `data.plan` say what, in plain words. Nothing has been changed. | Ask the person. If they agree, re-run the same step with `--yes`. |
| `plan_limit` | 3 | The provider will not allow it on this plan (for example a third free Supabase project). | Offer the options in the message: free a project, upgrade, or `--adopt <ref>`. |
| `error` | 1 | Something failed or a check did not pass. The message says what and whether it is safe to re-run. | Report it plainly; re-run the step once the cause is fixed (steps resume). |

## Rules every step follows

- **Idempotent.** It checks real state first and does only what is missing. A second run is `skipped`.
- **Confirmation.** Steps that create, change or spend return `needs_confirmation` unless run with `--yes`. `init` only writes local files and does not ask. `verify` asks only before it sends the sign-in code.
- **`--dry-run`** changes nothing, anywhere, and takes precedence over `--yes`.
- **Secrets** are never printed, logged or written under `deploy/`. The one place keys are written is the file named by `--recovery-file`, outside the repository, mode 0600.

## Flags by step

| Step | Flags |
|---|---|
| `init` | `--name`, `--host` (or leave out for workers.dev), `--region`, `--org`, `--email`, `--passport on/off`, `--passport-url`, `--resend on/off`, `--workers-subdomain` |
| `supabase` | `--adopt <ref>`, `--org <slug or id>` |
| `migrate` | `--allow-existing-tables` (needed, with `--yes`, for a database that is not a fresh GMS one) |
| `cloudflare` | `--adopt-existing` (use Workers, buckets, queues or KV that this tool did not create) |
| `secrets` | `--recovery-file <absolute path outside the repo>` (required), `--rotate NAME[,NAME]` (replace named secrets; Supabase values refresh without touching the encryption keys), `--rotate-keys` (also required to replace `CREDENTIALS_ENCRYPTION_KEY` or `WEBHOOK_SECRET_KEY`) |
| `email` | `--domain <sending domain>` (required the first time), `--from <address>` |
| `deploy` | `--force` redeploys the version already recorded; `--replace-dns` (needed, with `--yes`, when the custom domain is already in use or cannot be checked) |
| `upgrade` | `--to vX.Y.Z` (required) |
| any | `--yes`, `--dry-run` |
