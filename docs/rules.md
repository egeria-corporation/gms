# Eligibility rules (`packages/rules`)

A JSON DSL stored on the opportunity (`opportunities.eligibility_rules`).

```json
{ "all": [
  { "path": "org.orgType.code", "op": "in", "value": ["non_profit_with_501c3"], "label": "501(c)(3) nonprofit" },
  { "path": "org.customFields.verificationLevel.value", "op": "gte", "value": "L1", "order": ["L0","L1","L2","L3"] },
  { "path": "profile.financials.annualRevenue", "op": "lt", "value": 5000000, "missing": "unknown" },
  { "any": [
    { "path": "form.frm_a.fiscalSponsor", "op": "eq", "value": true },
    { "path": "org.status.value", "op": "eq", "value": "active" } ] }
] }
```

- **Sources**: `org.*` (cached `OrganizationBase`), `profile.*` (Passport profile, when consented),
  `form.<formId>.*` (responses), `applicant.type`.
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
