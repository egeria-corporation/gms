# Funds (v1.9.0)

Community foundations, fiscal sponsors and intermediaries run many funds from one office, each with
its own advisors, budget and public face. One GMS workspace holds all of them.

## The model

- A **fund** belongs to one funder workspace: a name, a public address (`slug`), a short
  description (up to 500 characters), an optional brand (a colour from the theme palette, `teal`,
  `blue`, `mint`, `navy` or `gray`, and an https logo link) and its own **budget per fiscal year**.
- **Programs belong to one fund** (`programs.fund_id`, required on every new or edited program).
  Opportunities, competitions, applications, decisions, awards and everything under an award
  (agreements, schedules, payments, requirements, reports, amendments) belong to the fund of
  their program. There is no fund column on them.
- Every funder workspace has a **Default fund** (slug `default`). Migration 0039 made one for every
  existing funder workspace and moved every existing program into it; a funder workspace made later
  gets one when it is created, and a program that names no fund lands in it. Public pages never
  name the default fund.
- A fund's budget is shown beside its programs' budgets for the same fiscal year and currency:
  `totals[] = { fiscalYear, budgetMinor, programsMinor, programCount, availableMinor, over }`.
  Programs with no fiscal year or no budget are not counted. Money stays in integer minor units.

## Fund advisors

- An admin invites **"Advisor for {fund}"** from Settings → Funds: an ordinary invitation with an
  existing role, `program_officer` or `reviewer` (no new role), and a membership scope
  `{ "fundIds": [fundId] }`. `POST /gms/funds/{id}/advisors` is a person's action (signed in, admin);
  it changes who sees what, so there is no MCP tool for it.
- **Who is scoped**: a member of a funder workspace whose scope names `fundIds`, unless they are an
  admin. Admins, members without `fundIds` and workspace API clients see every fund. A `fundIds`
  that is not a list scopes the member to nothing, never to everything.
- **What a fund advisor sees**: their funds, those funds' programs and everything under them, on
  every route and MCP tool. Any other record answers 404 (never 403, so ids cannot be probed);
  lists leave other funds out; totals, analytics, calendars and the activity feed count only their
  funds; anything that would put a record outside their funds is refused (404 naming the parent,
  or 422 `fund_required` when no program is named). Workspace-wide records that hold no fund's
  data (the form library, rubrics, templates, members) stay readable. Imports, the Passport
  change inbox, webhook deliveries and unmatched bank transactions are closed to them. An
  approval request their agent files must name records of their funds.

## How it is enforced

The rule lives in the one authorization path. `authorize()` (`apps/api/src/services/context.ts`)
calls `fundScopeOf(ws)`; for a fund advisor it puts the request's context behind a fund view
(`apps/api/src/services/fund-scope.ts`) before any service reads anything:

- **Every table is classified** (`RULES`, typed over every table name, so a new table does not
  compile until it is classified): `open` (no fund data), `parent` (the row belongs to the fund of
  the record one column names: `programs.fund_id`, `opportunities.program_id`,
  `competitions.opportunity_id`, `applications.opportunity_id`, `awards.program_id`,
  `tranches.award_id`, …), `check` (decided per row: a subject, a thread, an award or an
  application) or `closed`.
- Reads return only rows in scope (pushed into the query as an `IN` filter of at most
  `PUSH_DOWN_MAX` ids, else filtered after reading); updates and deletes touch only rows in scope;
  an insert or update that would leave the scope is refused.
- The ledger (activity, notifications) reads only events about records in scope, from the most
  recent 5,000.
- The direct-award store, which writes in one database transaction past the repositories, is
  held to the same rule; so is the MCP approval store.

Row-level security mirrors it for a user-scoped key: `gms.is_staff()` is false for a fund advisor,
and `gms.fund_scope_has()` lets them read their funds and those funds' programs.

The proof is `apps/api/test/redteam-funds.test.ts`: a program officer scoped to one fund calls every
workspace route in the compiled OpenAPI document and every MCP tool with the other fund's program,
opportunity, competition, application, decision, award, agreement, requirement, payment, task and
thread. Every one answers 403 or 404, nothing of the other fund (its names or its amounts) appears
in any answer, nothing of it changes, and no approval request names it.

## Screens

- **Settings → Funds** (`/w/{handle}/settings/funds`): each fund with its address, its budget by
  fiscal year beside its programs' and its advisors. Admins create and edit funds, set budgets and
  invite advisors; everyone else reads.
- **The fund switcher** in the funder rail (when there is more than one fund, or the person is a
  fund advisor): "All funds" or one fund. It narrows the dashboard, the programs list and the
  awards list in this browser; it never widens what the API allows.
- **Programs**: a Fund picker on create and edit, a Fund column when there are several funds.
- **Public**: `/f/{handle}/{fundSlug}` lists one fund's open and forecasted calls
  (`GET /gms/public/funders/{handle}/funds/{slug}`, published fields only, never a budget or an
  advisor). The funder page shows funds as sections when more than one fund has open calls, and an
  opportunity page says "{Fund} · A fund of {Funder}", once the public funder and opportunity data
  carry `funds` and `opportunity.fund` (see the v1.9.0 integration); until then they show
  what they show today.

## API

| Route | Who | Notes |
|---|---|---|
| `GET /gms/funds` | `programs:read` | `{ items: Fund[], scoped }`, the default fund first |
| `POST /gms/funds` | admin | `{ name, slug?, description?, brand? }`; 409 when the address is taken; reserved words (`o`, `awards`, `embed`, …) are refused |
| `GET /gms/funds/{id}` | `programs:read` | The fund, its totals and its advisors |
| `PATCH /gms/funds/{id}` | admin | Changing the address changes the public link (ledgered with both) |
| `PUT /gms/funds/{id}/budgets` | admin | `{ budgets: [{ fiscalYear, amountMinor, currency? }] }`, one per year, both values on the ledger |
| `POST /gms/funds/{id}/advisors` | admin, signed in | `{ email, role: "program_officer" \| "reviewer" }` → an invitation with `scope.fundIds` |
| `POST/PATCH /gms/programs` | `programs:write` | `fundId` (the default fund when a new program names none; a fund advisor with several funds must name one) |
| `GET /gms/public/funders/{handle}/funds/{slug}` | none | The fund page's data |
| MCP `list_funds` | `programs:read` | The funds the caller sees |
