# Accounting: QuickBooks Online sync

Funders want grant payments in their books without retyping them. The GMS writes each payment it has
recorded to the funder's QuickBooks Online as one expense, once. This is **record-keeping, not a money
path**:

- nothing in it pays, schedules or moves money; Passport stays the only money path;
- no bank details are read, stored, logged or sent (no routing or account numbers, no tax numbers);
- no GMS code here sets a payout destination or adds to `Award.funding.disbursedAmount`.

It reads payments the GMS already recorded (paid elsewhere, or disbursed through Passport and mirrored)
and writes the matching expense. It never changes or deletes anything in QuickBooks after that.

## Who does what

| Step | Who | Where |
|---|---|---|
| Connect or disconnect QuickBooks | a workspace admin, signed in | Settings › Accounting (`POST`/`DELETE /gms/connectors/quickbooks`) |
| Set the mapping, turn the sync on or off | admins and finance staff, signed in | Settings › Accounting (`PUT /gms/accounting/settings`) |
| Choose a grantee's vendor | admins and finance staff, signed in | Settings › Accounting (`PUT /gms/accounting/vendors`) |
| Mark an entry fixed, try one again | admins and finance staff, signed in | the reconciliation view |
| Read the setting and the reconciliation view | admins and finance staff, and their agents (`payments:read`) | `GET /gms/accounting`, `GET /gms/accounting/entries`, MCP `get_accounting_sync` |
| Write the expenses | the jobs Worker, every 15 minutes | `accounting-sync` |

Every write refuses agent and API-client tokens (403), before the body is read. There is no MCP tool
that connects, maps, turns the sync on or writes to the books.

## The mapping, set once

- **Expense account**: the QuickBooks expense account grants post to (types Expense and Other Expense).
- **Paid from**: the bank account in QuickBooks' chart of accounts the payments leave from (type Bank).
  The GMS keeps QuickBooks' id for it ("35") and its name, never the bank's own number. A name read from
  QuickBooks has any run of five or more digits cut to "•••" and its last four before it is shown or
  stored, so an account named after its number never reaches the GMS whole.
- **Programs**: nothing, a class, or a location (QuickBooks "Department") per program.
- **Vendors**: each grantee is a vendor. The GMS uses the vendor chosen for it; else QuickBooks' only
  active vendor whose display name is exactly the organization's name (Passport's legal name while the
  organization shares its record with the funder, else its workspace name); else, if the funder chose
  "Create a vendor with the organization's name only", a new vendor with `display_name` and
  `company_name` and nothing else (no address, contact, tax or bank field). With "Wait until I choose
  the vendor", the payment waits as "Not in QuickBooks: choose this grantee's vendor".
- **Currency**: the company's home currency (USD unless set). A payment in another currency is not sent.

The sync is **off until a person turns it on**. Turning it on records the moment (`sync_from`); only
payments recorded from then on are sent. Disconnecting QuickBooks turns the sync off; it stays off until
a person turns it on again.

## The entry: an expense, not a bill payment

Each payment becomes one QuickBooks **Purchase** with `PaymentType: "Cash"`, which is what QuickBooks'
own Expense form writes for a payment from a bank account:

```json
{
  "PaymentType": "Cash",
  "AccountRef": { "value": "<paid from>" },
  "EntityRef": { "value": "<vendor>" },
  "TxnDate": "2027-04-16",
  "TotalAmt": 25000,
  "DocNumber": "GMS-<16 hex of the payment id>",
  "PrivateNote": "Grant payment 1: <award> (<program>). Recorded by OpenGrants GMS.",
  "Line": [{ "Amount": 25000, "DetailType": "AccountBasedExpenseLineDetail", "Description": "<the memo>",
             "AccountBasedExpenseLineDetail": { "AccountRef": { "value": "<expense account>" }, "ClassRef": { "value": "<class>" } } }]
}
```

(A location goes in `DepartmentRef` on the expense instead of `ClassRef` on the line.)

Why an expense: the payment was already made, and an expense records exactly that in one entry. A
**bill payment** needs a bill to pay first: two entries, an Accounts Payable bill open in between, and a
bill that QuickBooks' own bill pay could pay a second time. A **check** (`PaymentType: "Check"`) can be
queued in QuickBooks to print. Neither is used.

The date is the date the funder recorded for a payment made elsewhere (`external.paidAt`), or the day
Passport settled a payment it disbursed (the ledger's `tranche.settle`). The memo names the payment, the
award and the program, in the language of the person who turned the sync on; never the funder's payment
reference or the last four digits of the account it was paid to.

## Once per payment

The jobs Worker claims a payment in `accounting_entries` (unique per workspace and payment) before it
calls QuickBooks, so a second run or a second Worker never writes it twice. The entry carries the GMS's
own reference (`DocNumber`, unique per workspace). If a run stops between QuickBooks taking the entry
and the GMS keeping its id, the entry stays `posting`; fifteen minutes later the next run looks it up in
QuickBooks by that reference and keeps the id it finds instead of writing a second one.

Up to 20 payments per workspace per run. QuickBooks refusing an entry, or not answering, is tried three
times in all, then waits for a person ("Try again"). A payment waiting for a vendor is tried again once
its vendor is chosen.

## Edits and voids: "needs attention"

On every run, each posted entry is compared with its payment. When the payment was changed (amount,
currency, or the date of a payment made elsewhere), voided (returned or cancelled), or removed after it
was posted, the entry becomes **needs attention** with what changed. The GMS never changes the books:
the funder fixes QuickBooks, then marks the entry "fixed" (`handled`); a later change is raised again.

## The reconciliation view

Settings › Accounting lists the payments recorded in the GMS (settled and returned, newest first, up to
200) next to their QuickBooks entries: the status (icon and words), the reason, the reference and the
QuickBooks id. "Compare with QuickBooks" reads the shown entries back (at most 25) and says whether each
matches, differs or is missing. Nothing read from QuickBooks is written into the GMS. Settled payments
in the Payments center and on an award's Payments page show "In QuickBooks" (or "Sending to QuickBooks",
"QuickBooks: needs attention", "Not in QuickBooks"), to admins and finance staff, where the server has
QuickBooks set up.

| Status | Shown as | Meaning |
|---|---|---|
| `posted`, `handled` | In QuickBooks | the expense is there (handled: fixed by a person after a change) |
| `posting`, `waiting` | Sending to QuickBooks | claimed, or recorded since the sync was on and not sent yet |
| `needs_attention` | Needs attention | changed, voided or removed after posting |
| `failed` | Not in QuickBooks | with why: vendor to choose, vendor refused, currency, refused, unreachable |
| `not_synced` | Not sent | recorded before the sync was on, or while it was off |

## Composio

- Toolkit `quickbooks`, one auth config whose id is the Wrangler secret
  `COMPOSIO_QUICKBOOKS_AUTH_CONFIG_ID` (API Worker and jobs Worker, with `COMPOSIO_API_KEY`). Without it
  the Accounting screen says QuickBooks is not set up and nothing is offered.
- Scope `com.intuit.quickbooks.accounting` only (plus `openid`, `profile`, `email` if Composio adds
  them). Intuit has no narrower scope for writing an entry. A connection holding
  `com.intuit.quickbooks.payment`, any Payroll scope, `phone`, `address` or any other scope is deleted at
  Composio and refused (`APP_SCOPE_RULES.quickbooks` in `packages/connectors/src/apps.ts`, one place to
  relax). One that reports no scopes is not used.
- Entity = the funder workspace id; Composio holds the Intuit token and the company (realm) id.
- Tools executed, nothing else (`QUICKBOOKS_TOOLS` in `packages/connectors/src/quickbooks.ts`):

| Tool | Used for | Arguments |
|---|---|---|
| `QUICKBOOKS_QUERY_ACCOUNTS` | expense and bank accounts | `query`: `SELECT * FROM Account WHERE Active = true AND AccountType IN (...)`, paged |
| `QUICKBOOKS_QUERY_VENDORS` | vendors; a vendor by exact name | `query` |
| `QUICKBOOKS_CREATE_VENDOR` | a vendor with the organization's name | `display_name`, `company_name` only |
| `QUICKBOOKS_QUERY_ENTITIES` | active classes; one expense by its reference | `query`: `SELECT * FROM Class ...` or `SELECT * FROM Purchase WHERE DocNumber = '...'` |
| `QUICKBOOKS_LIST_DEPARTMENTS` | locations | `query` |
| `QUICKBOOKS_CREATE_PURCHASE` | the expense | as above |
| `QUICKBOOKS_GET_PURCHASE` | "Compare with QuickBooks" | `purchase_id` |

Slugs and argument names were checked with Composio's `COMPOSIO_SEARCH_TOOLS` and
`COMPOSIO_GET_TOOL_SCHEMAS` on 2026-11-17 (no tool was executed). `QUICKBOOKS_GET_COMPANY_INFO` is not
used: the company record carries the employer's tax number.

QuickBooks answers every query with whole records (projections are not supported), so an account's own
number field, balances and a vendor's tax, bank and contact fields do reach the Worker. They are dropped
where the answer is parsed (`refOf`, `vendorOf`, `expenseOf`), before anything else sees them, and are
never logged, stored or returned.

## Data

Migration `0051_accounting.sql`: `accounting_links` (one per workspace and provider: the mapping as
QuickBooks ids and names, the vendor rule, the currency, the switch and `sync_from`) and
`accounting_entries` (one per payment: status and reason, QuickBooks id, the GMS reference, what was
posted, attempts, what changed). RLS: admins and finance staff read their workspace's rows; the service
role writes. A fund advisor never reads either (`CLOSED` in `apps/api/src/services/fund-scope.ts`).

## Owner setup

1. In Composio, create an auth config on the `quickbooks` toolkit on your own Intuit developer app, with
   the scope `com.intuit.quickbooks.accounting` only, and the callback to the web origin
   (`{WEB_BASE_URL}/w/<handle>/settings/accounting`).
2. Set `COMPOSIO_QUICKBOOKS_AUTH_CONFIG_ID` (and `COMPOSIO_API_KEY`, if not already set) as Wrangler
   secrets on the API Worker and the jobs Worker.
3. Run migration `0051_accounting.sql` before deploying the API.

## Not verified

Nothing here has run against Composio or QuickBooks: the connector is tested against a fake Composio
and the service against a fixture. Not checked live: how Composio reports Intuit's granted scopes
(`state.val.scope` or `requested_scopes`; if neither, the connection is not used); that Composio's
`QUICKBOOKS_CREATE_PURCHASE` returns the new Purchase's `Id` at `data.Id` or `data.Purchase.Id`; QuickBooks'
query escaping of a quote in a vendor name (`\'`); that a company without multicurrency takes an expense
with no `CurrencyRef`.
