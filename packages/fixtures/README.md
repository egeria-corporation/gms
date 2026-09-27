# @gms/fixtures: demo data (`pnpm seed`)

Deterministic, **entirely fictional** demo data for GMS. No real organizations or people; every email uses the
reserved `.example` TLD, every EIN uses the never-issued `00-` prefix, and the region (Alder, Bramble and
Cinder Counties) is invented.

```bash
pnpm seed               # full demo data set (~4 s on the embedded Postgres)
pnpm seed --minimal     # only the Halcyon workspace, Helen Ortiz (owner, with TOTP) and its brand
pnpm seed --reset       # drop + re-create the LOCAL database, migrate, then seed
pnpm seed --force       # demo data already there? reset the local database and seed again
GMS_SEED_NOW=2026-12-01 pnpm seed --reset   # reproduce a run for a given "today"
```

- The CLI migrates the database first (forward-only, idempotent). If the `halcyon` workspace already exists it
  prints a message and exits 0 unless `--force` (or `--reset`) is given. `--reset`/`--force` refuse non-local
  database URLs (anything other than `localhost`, `127.0.0.1`, `::1`).
- `GMS_AUTH_MODE` defaults to `test` for the seed. People are created in `auth.users` (the TestAuthAdapter's
  `ensureUser` finds them), so everyone can sign in with a magic link (read it in `/dev/mail`).
- **Reproducible:** all generated data comes from a seeded PRNG (mulberry32, one named stream per section) and a
  fixed anchor: `GMS_SEED_NOW` (a date means 12:00 UTC that day), else today at 12:00 UTC. Row ids are
  name-derived UUIDs (`sid()` in `src/ids.ts`, v5 layout over SHA-1), so they are identical on every run.
  Not reproducible by design: agent tokens/keys, fake-Mercury object ids, and the timestamps of the few rows the
  action executor writes "now" (workspace creation, branding, agent credentials, the six approval requests).
  Diligence screenings run through the executor too, then are back-dated to their award.

## How it is built

The seed uses the action executor wherever it is cheap, so those rows carry a genuine audit trail:
`setup.create_workspace` (system actor), `workspace.update`, `brand.update` (as each owner, under RLS; the theme
engine auto-fixes Sunbeam's low-contrast yellow), `agents.create_token` (as Maya), `agents.create_account`
(as Helen, with step-up), `reports.save` (Maya's agent), six R2 requests from agents that become approval
requests, and `diligence.run` for every grantee. Bulk history (≈1,000 applications, snapshots, reviews, awards,
payments) is written with batched service inserts, with historical audit entries (human, agent and system
actors) at their real times. All database invariants still apply: the payment ceiling, the payee-ready gate,
maker-checker on `payment_approvals` (always `aal2`, never the batch creator), immutable published form
versions and append-only snapshots/history/signatures. Signature hashes equal their agreement's document hash:
each agreement is a small placeholder PDF (`src/pdf.ts`) stored under `.gms/storage/agreements/` whose
SHA-256 is recorded.

## What you get

| Tenant | What's there |
|---|---|
| **Halcyon Ridge Foundation** (`halcyon`) | Teal `#0F5E5A` / marigold `#E0A526`, Source Serif 4, `America/Los_Angeles`. Programs: Youth Arts Fund, Neighborhood Food Security, Capacity Building Grants (FY2025–FY2027 budgets). 6 opportunities: **Youth Arts Fund 2027** (flagship: LOI Nov 3 → Dec 5, 2026 5 pm PT; invite-only full proposal due Feb 13, 2027 5 pm PT; status follows the anchor: forecasted / open / closed), **Neighborhood Food Security Rapid Response 2027** (always open: anchor −30 d → +45 d), Capacity Building Mini-Grants 2027 (open while the flagship is forecasted, otherwise forecasted), Neighborhood Food Security Grants 2026 (closed), Youth Arts Fund 2025 (archived), Capacity Building Grants 2027 (draft). |
| **Marigold Street Fund** (`marigold`) | Terracotta `#B4532A` / slate blue `#3F5B8C`, Figtree. One program, one open opportunity, 6 applications, 2 awards (agreements sent / signed), manual payment rail. |
| **Sunbeam Test Fund** (`sunbeam`) | Primary `#F2D74B` (fails contrast; stored with the theme engine's warning and adjusted tokens). One open opportunity, no applications. |

Volume (Halcyon): 142 flagship LOIs (in progress 24 · submitted 38 · under review 40 · invited 18 · declined 12 ·
withdrawn 5 · ineligible 5); 800 applications in the 2025–2026 cycles (370 + 430); 25 + 8 on the open
opportunities; 850 immutable submission snapshots with receipts; 12 reviewers, ~400 assignments with COI
declarations, ~380 reviews and ~1,500 rubric scores (weights total 100%); 38 active awards + 4 completed, an
approved amendment and supplement; 64 payments in every status (scheduled, in batch, awaiting approval, awaiting
bank approval, sent, failed, held, reconciled, exception, cancelled) across 8 batches; 45 bank transactions and 3
open reconciliation exceptions; 25 report requirements in every status; 6 pending agent approval requests; 2
board dockets (one in session today, with votes); threads, notifications, email templates, notification rules;
IRS/OFAC fixtures and a screening for every grantee (Cedar Hollow Food Pantry is a `potential_match`).

Organizations: the named ones (Eastside Youth Music Collective `00-0000001`; Lumen Literacy Project, fiscally
sponsored by Commons Fiscal Partners `00-0000002`; Cedar Hollow Food Pantry `00-0000003`; Old Mill Arts Guild
`00-0000009`, IRS-revoked), 120 generated organizations (EINs `00-0000100`–`00-0000219`; the first 30 match the IRS
fixtures and are verified) and 320 "alumni" organizations that only appear in past cycles (needed to reach ~800
historical applications at one application per organization per cycle). Each has an `org_admin` user
(`<firstname>@<org-slug>.example`).

Maya Chen (`maya@eastside-youth-music.example`, org admin of Eastside, EIN verified): a 2025 award
(`HRFA-2025-00001`, $25,000, countersigned agreement, ready payee, one reconciled and one **sent** payment, an
upcoming Year 2 interim report drafted by her agent), an in-progress flagship LOI drafted by her Grant Writer
Assistant, and **no application on the always-open opportunity** (E2E creates one).

Agents:

- **Grant Writer Assistant** (Maya's `pat_client` + personal access token with applicant scopes). Pending: submit
  her Year 2 interim report; submit her flagship LOI.
- **Ops Assistant** (`agent_account` owned by Jordan Ellis; scopes `pipeline:read payments:read payments:propose
  analytics:read awards:draft`; tool allowlist; 30 requests/min; API key). Pending: move 3 LOIs to review, request
  info, invite 2 applicants to the full proposal, put an award on hold.
- **Halcyon Intake Agent** (`a2a_peer`), with a few A2A tasks.

The PAT and the API key are printed once by `pnpm seed` and written to **`.gms/dev-tokens.json`** (gitignored).
They are hashed exactly like `packages/actions/src/modules/platform.ts` does, because those actions created them.

Payments for the E2E: batch **"October grant payments"** (`SEED_IDS.batchAwaitingApprovalId`) was created by
Priya Natarajan, is awaiting approval, and totals $35,000, under the $50,000 second-approval threshold, so
Marcus Webb alone can approve it (with TOTP step-up).

## People and DEV-ONLY TOTP secrets

**These secrets are for local development and tests only.** They are derived from each email
(`demoTotpSecret(email)` = base32 of SHA-256 of `gms-demo-totp:v1:<email>`), exported as `DEMO_TOTP_SECRETS`, and
only ever seeded in test auth mode (`GMS_AUTH_MODE=test`). Compute a code with `totpNow(secret)` (re-exported from
this package) or any authenticator app.

| Name | Workspace | Role | Email | TOTP secret (DEV-ONLY) |
|---|---|---|---|---|
| Helen Ortiz | halcyon | owner | `helen@halcyonridge.example` | `LACS5ER2JC5ONOD25P2YPZVX273AKVXV` |
| Jordan Ellis | halcyon | program_officer | `jordan@halcyonridge.example` | `VMW6MIY6IMAMAHLXTRUJ3F4GWH65HTAW` |
| Priya Natarajan | halcyon | finance | `priya@halcyonridge.example` | `4XCTJVUOQQUIGSORKLNVG3BYOPQZXW2V` |
| Marcus Webb | halcyon | finance | `marcus@halcyonridge.example` | `ZSUD4ZBCKQFJWKEMK5IJLGWVINODODLE` |
| Nora Bishop | halcyon | auditor | `nora@halcyonridge.example` | `6GUCISCX7Q3N62PW5PBI76GEML4ATVG4` |
| Ruth Alvarez | halcyon | board | `ruth@halcyonridge.example` | `RPBIAKLJDJ7KVL5G2EI42QNJV44ZREAH` |
| Dennis Achterberg | halcyon | board | `dennis@halcyonridge.example` | `72LSKPWKHD5QOKVGGVBES74OJWVPBK62` |
| Mei Lindqvist | halcyon | board | `mei@halcyonridge.example` | `5UOQ4MDQE3OBBU3J5ZO6PQOJLBBNWSOS` |
| Dr. Samuel Okafor | halcyon | reviewer | `samuel.okafor@reviewers.example` | `7JRYGV4W4UHAXSF3KRGTNW3MID5TMKM4` |
| Lena Marsh | halcyon | reviewer | `lena.marsh@reviewers.example` | `PGWZPF6SOT6ERMJOR2WFAV72ZW6O2I4R` |
| Tomas Ibarra | halcyon | reviewer | `tomas.ibarra@reviewers.example` | `HT54E57RTVINOFFIZOPINLMDCU2T6HJU` |
| Priscilla Hwang | halcyon | reviewer | `priscilla.hwang@reviewers.example` | `OK5TBNAEAYUVMXKECJ22CKACMUWOB4HV` |
| Owen Castellanos | halcyon | reviewer | `owen.castellanos@reviewers.example` | `5QPA3K7VPDRGMPHJRMF6CXWWWUQLIMFS` |
| Beatrice Nwosu | halcyon | reviewer | `beatrice.nwosu@reviewers.example` | `Y44KMVYYXDAXH6TG4KAXQP6Q3VZLR3MV` |
| Farid Haddad | halcyon | reviewer | `farid.haddad@reviewers.example` | `VSEZVHYWYF7L7Y2TKEJPUDACQWCWHB5U` |
| Colette Durand | halcyon | reviewer | `colette.durand@reviewers.example` | `G4FGWSEKVFCMMFS454F5MYZKEJOGQDM7` |
| Jun Takahashi | halcyon | reviewer | `jun.takahashi@reviewers.example` | `I2LGOSOV54SIWEOPQQDQOS33WVQAJPON` |
| Rosalind Kerr | halcyon | reviewer | `rosalind.kerr@reviewers.example` | `ALJO4PSDTDYQQBBMTDAQOQVLEPVHBW44` |
| Mateo Villanueva | halcyon | reviewer | `mateo.villanueva@reviewers.example` | `5OU4F6XNTV2JSRIKABC42VYJV2ND4C5N` |
| Harriet Osei | halcyon | reviewer | `harriet.osei@reviewers.example` | `H6COLRWWJFOJ5NYUHYYOUCWGCNB62EVZ` |
| Rosa Delgado | marigold | owner | `rosa@marigoldstreet.example` | `KUUCLI5TYABFS7IO5IRANC6NVELQEVVK` |
| Kwame Mensah | marigold | program_officer | `kwame@marigoldstreet.example` | `63FTBKBZZD2EPQ44KNQ7LYJ2LVJ5KRLM` |
| Ines Farrow | marigold | finance | `ines@marigoldstreet.example` | `R7T4R6ZF5AWA6F373UMLPIHEWTLKJ2B5` |
| Sam Rivera | sunbeam | owner | `sam@sunbeamtest.example` | `2CJ6DZ6ES2RIYNCMF4SYCLYWX55NOUSN` |

Applicant-only people (magic link, no TOTP): Maya Chen (`maya@eastside-youth-music.example`), Theo Vance
(`theo@lumen-literacy.example`), Ada Brennan (`ada@cedar-hollow-pantry.example`), plus one org admin per
generated organization.

## Using it from tests

```ts
import { DEMO_TOTP_SECRETS, DEMO_USERS, SEED_IDS, seed, totpNow } from '@gms/fixtures';

const code = totpNow(DEMO_TOTP_SECRETS['marcus@halcyonridge.example']!);
SEED_IDS.alwaysOpen.slug;            // 'neighborhood-food-security-rapid-response-2027'
SEED_IDS.flagship.slug;              // 'youth-arts-fund-2027'
SEED_IDS.maya.orgId;                 // Eastside Youth Music Collective
SEED_IDS.batchAwaitingApprovalId;    // Priya's batch for Marcus to approve
```

`seed({ runtime, now, documents, minimal })` accepts a runtime (e.g. `createRuntime({ db })` on a
`createTestDatabase()` database) and returns the counts, the dev tokens and the pending approval ids.

## Known quirks

- When the anchor is before November 3, 2026 the flagship is *forecasted*, yet it still has 142 LOIs (dated in
  the weeks before the anchor) so the review and pipeline screens have data. After the LOI deadline the flagship
  is *closed* and Capacity Building Mini-Grants is *forecasted*, so Halcyon then has a single open opportunity
  (the always-open one).
- Historical cycles (2024–2026) use fixed calendar dates; payment, report and approval dates are relative to the
  anchor. Anchors far from late 2026 give odd combinations (e.g. year-two installments before a grant starts).
