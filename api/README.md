# OpenGrants GMS API document

TypeSpec source for the GMS API: the CommonGrants v0.5.0 protocol routes under `/common-grants/`,
the GMS routes under `/gms/`, and the OAuth, discovery, agent and webhook routes at the root.

| File | Contents |
|---|---|
| `main.tsp` | Service declaration (`GMS`), pinned to `CommonGrants.Versions.v0_5` |
| `models.tsp` | `GMS.Models`: enums, records and request bodies for the `/gms/` routes |
| `routes.tsp` | Auth schemes, the protocol routes (aliased from `CommonGrants.Routes.*`), `/gms/` routes by tag, infrastructure routes |
| `base/commongrants-v0.5.0.openapi.yaml` | The vendored CommonGrants v0.5.0 document `cg check spec` compares against. Do not edit. |

```
pnpm spec:compile   # tsp compile → tsp-output/@typespec/openapi3/openapi.GMS.yaml
pnpm spec:check     # cg check spec … --base base/commongrants-v0.5.0.openapi.yaml
```

Conventions:

- Protocol routes use the CommonGrants models and route interfaces unchanged. GMS data on a protocol
  record lives in `customFields` (`customFields.gms.value`, plus `verificationLevel` and
  `attestation` on applications). `AwardBase` has no `customFields` and is never given one.
- Protocol routes address records by UUID, as the protocol requires. `/gms/` routes accept the UUID
  or its human-prefixed form (`opp_`, `cmp_`, `frm_`, `app_`, `rev_`, `awd_`, `agr_`, `trn_`,
  `req_`, `sub_`).
- `/gms/` responses use the CommonGrants envelopes and error shape. A human-gated action called by
  an agent returns `202` with the approval request instead of running.
- No model here carries bank or identity data; payment models expose `bankName` and `last4` only.
- `tsp compile` crashes while printing diagnostics for long lines; run it with `--pretty false` to
  read the real error.
- `cg check spec` prints "Failed to merge allOf … No resolver found for key example" while it
  flattens schemas. That is noise from the checker; the result is the last line.
