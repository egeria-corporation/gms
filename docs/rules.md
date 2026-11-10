# Eligibility rules (`packages/rules`)

A JSON DSL stored on the opportunity (`opportunities.eligibility_rules`).

```json
{ "all": [
  { "path": "profile.commonApp.irs.subsection", "op": "in", "value": ["03"], "missing": "unknown", "label": "Tax-exempt under 501(c)(3)" },
  { "path": "org.addresses.primary.stateOrProvince", "op": "in", "value": ["OR", "WA"], "label": "Located in Oregon or Washington" },
  { "path": "org.customFields.verificationLevel.value", "op": "gte", "value": "L1", "order": ["L0","L1","L2","L3"] },
  { "path": "profile.commonApp.financials.totalRevenue", "op": "lt", "value": 5000000, "missing": "unknown" },
  { "any": [
    { "path": "form.frm_a.fiscalSponsor", "op": "eq", "value": true },
    { "path": "org.status.value", "op": "eq", "value": "active" } ] }
] }
```

- **Sources**: `org.*` (cached `OrganizationBase`), `profile.*` (Passport profile, when consented),
  `form.<formId>.*` (responses), `applicant.type`.
- **Organization vocabulary**: rules read the data as Passport serves it, and store Passport's codes.
  The editor shows the readable label; the stored value is the code.

  | Fact | Path | Stored value |
  |---|---|---|
  | IRS tax-exempt status | `profile.commonApp.irs.subsection` | two-digit 501(c) subsection, e.g. `"03"` for 501(c)(3) |
  | State | `org.addresses.primary.stateOrProvince` | two-letter code, e.g. `"OR"` |
  | Passport level | `org.customFields.verificationLevel.value` | `L0`–`L3`, compared with `order` |
  | Active | `org.status.value` | `"active"` |
  | Total revenue | `profile.commonApp.financials.totalRevenue` | number, US dollars |
  | Annual budget | `profile.commonApp.financials.budget` | number, US dollars |
  | Staff count | `profile.commonApp.staffCount` | number |
  | EIN | `org.identifiers.org:us:ein.id` | nine digits |
  | Organization type | `org.orgType.code` | a PCS code (`^[A-Z]{2}[0-9]{6}$`); Passport sets it only when the organization has one |

  `profile.*` is Passport's Common App profile: its field pointers (`/commonApp/irs/subsection`)
  folded into an object. Passport serves a consented client confirmed values only, so a profile rule
  should carry `"missing": "unknown"`. CommonGrants applicant types (`non_profit_with_501c3`, …)
  describe an opportunity (`acceptedApplicantTypes`); they are not values of `org.orgType.code`.
  The same paths without the `org.` prefix are the form builder's prefill list (`PREFILL_PATHS`).
- **Operators**: `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `exists`, `matches`.
  `in`/`nin` on an array-valued field match when any member is listed. `gt`…`lte` compare numbers,
  strings (ISO dates sort correctly), or positions in `order` for ordinal scales.
- **Missing values**: `missing` is `"unknown"` (default), `"fail"` or `"pass"`. An absent source
  (profile not consented) is missing. Values that cannot be compared are `unknown`, never `fail`.
- **Groups** use three-valued logic. `all`: any fail → fail, else any unknown → unknown, else pass.
  `any`: any pass → pass, else any unknown → unknown, else fail.
- **Explain**: each rule may carry a `label` and an `explain` template with `{{label}}`, `{{path}}`,
  `{{actual}}`, `{{value}}`, `{{outcome}}`; a plain-language default is generated otherwise.

## API

- `parseRules(json)` validates untrusted input and returns every error with its location.
- `evaluate(rules, { org, profile, form, applicant })` returns
  `{ eligible: true | false | "unknown", results: [{ rule, label, outcome, actual, explain }] }`,
  one result per leaf rule in document order.
- `mayAutoDecline(e)` is true only for a definite `false`. **`unknown` never auto-declines**; it flags
  the application for a human (`needsHumanReview`).

Rules run at submit, on demand (`POST /gms/eligibility/evaluate`) and when a pending org change is
accepted.
