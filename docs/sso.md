# Single sign-on (SAML 2.0) for funder workspaces

A funder workspace can let its staff sign in through the organization's own identity provider
(Okta, Google Workspace, JumpCloud or any other SAML 2.0 identity provider), and can require it for
people whose email address is on the organization's domain. It uses Supabase Auth's SAML 2.0
support, so there is no new vendor. The integration is generic SAML 2.0; nothing in it is specific
to one identity provider.

## Feasibility (checked 2026-11-15 against Supabase's own documentation)

Sources: the Supabase guide "Single Sign-On with SAML 2.0 for Projects"
(`supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml`), the Management API reference
(OpenAPI `api.supabase.com`, operation `v1-create-a-sso-provider`), the CLI reference for
`supabase sso`, the JWT fields reference (`/docs/guides/auth/jwt-fields`), and `@supabase/auth-js`
2.118.0, the version this repository pins. The pages were read from Supabase's published sources.

**Plan.** SAML 2.0 is offered on the Pro plan and above, and is **off by default** on every project:
it is switched on under Authentication → Providers → SAML 2.0 in the dashboard. Sign-ins through SSO
are billed as SSO monthly active users beyond the plan's quota (USD 0.015 each at the time of
writing). The repository does not record the hosted project's plan; the operator confirms it is Pro
or above and switches SAML 2.0 on before registering the first provider. Nothing else in this
project's setup stands in the way: the web app already uses `@supabase/supabase-js` with
`detectSessionInUrl`, and the API already verifies Supabase sessions and can read their claims.

**Adding a provider.** Only someone with write access to the Supabase project can register one.

- CLI (v1.46.4 or later):

  ```
  supabase sso add --type saml --remote=<project-ref> \
    --metadata-url 'https://idp.example.org/saml/metadata' \
    --domains example.org \
    [--attribute-mapping-file mapping.json] [--name-id-format <urn>]
  ```

  `--metadata-file path/to/metadata.xml` replaces `--metadata-url` for identity providers that only
  hand out a file (Google Workspace, and identity providers behind a VPN). `supabase sso list`,
  `show <provider-id>`, `update <provider-id>`, `remove <provider-id>` and `info` manage the rest.
- Management API: `POST https://api.supabase.com/v1/projects/{ref}/config/auth/sso/providers` with
  `Authorization: Bearer <personal access token or OAuth token with auth:write>` and a JSON body:

  ```json
  {
    "type": "saml",
    "metadata_url": "https://idp.example.org/saml/metadata",
    "domains": ["example.org"],
    "attribute_mapping": { "keys": { "email": { "name": "email" } } }
  }
  ```

  `type` is required and is `"saml"`; exactly one of `metadata_url` or `metadata_xml` (the document
  as a string) carries the metadata; `domains`, `attribute_mapping` and `name_id_format` are
  optional. The answer is `201` with `{ id, saml: { entity_id, metadata_url, metadata_xml,
  attribute_mapping, name_id_format }, domains: [{ domain, created_at, updated_at }], created_at,
  updated_at }`; `id` is the provider's UUID. `404` means SAML 2.0 is not switched on for the
  project; `401`, `403` and `429` are what they say. `GET` on the same path lists providers, and
  `GET`/`PUT`/`DELETE …/providers/{provider_id}` read, change and remove one. The identity
  provider's `EntityID` cannot change; a new one is a new provider.

**Starting a sign-in.** `supabase.auth.signInWithSSO({ domain, options: { redirectTo } })` posts to
`/auth/v1/sso` and resolves to `{ data: { url }, error: null }`, where `url` is the identity
provider's sign-in page; in a browser the client goes there itself unless `skipBrowserRedirect` is
set. A domain with no provider resolves to `{ data: null, error }` with HTTP 404 and error code
`sso_provider_not_found` ("No SSO provider assigned for this domain"); a provider that is switched
off gives `sso_provider_disabled`. `providerId` can be passed instead of `domain`. After the identity
provider, Supabase Auth's ACS endpoint redirects to `redirectTo` (which must be on the project's
redirect allow list) with the session, which `detectSessionInUrl` picks up. Identity-provider
initiated sign-in does not work with PKCE; a bookmark that opens our sign-in page does.

**What the session carries.** The access token is an ordinary Supabase session token
(`aud: "authenticated"`) with:

- `amr`: an array of `{ method, timestamp, provider? }`, most recent first. A SAML sign-in adds
  `{ "method": "sso/saml", "timestamp": …, "provider": "<provider uuid>" }`. With two-step
  verification on top, index 0 may be the TOTP entry instead, so the GMS looks for an `sso/saml`
  entry anywhere in the array, not at index 0.
- `app_metadata.provider`: `"sso:<provider uuid>"`, and `app_metadata.providers` lists it. The
  identity in `auth.identities` has `provider = 'sso:<provider uuid>'` and the `NameID` as its id.
- `user_metadata`: the mapped attributes, with `iss` holding the identity provider's `EntityID`
  and `custom_claims` holding mapped keys other than the standard ones.
- `email`: the address from the assertion. Assertions without an email address are refused.

**Accounts are not linked.** A person who signs in with an email code and later through SSO with
the same address has **two Supabase accounts** (Supabase never links an SSO identity to an existing
account, and email addresses are not unique across them). The GMS handles this explicitly: see
"Joining through single sign-on" below.

**Attribute mapping.** Optional. Without it Supabase Auth finds the email address itself, looking at
a short list of common attribute names in turn (among them `urn:oid:0.9.2342.19200300.100.1.3`,
`mail` and `email`), then a `NameID` in `emailAddress` format. Anything else is mapped with
`{ "keys": { "<claim>": { "name": "<attribute>" } } }`; a key may give `names` (tried in order),
`array: true` (keep every value) and `default`. The GMS needs only the email address, so the
operator script sends no mapping unless one is given.

**Service-provider values for the identity provider.** For a project at `https://<ref>.supabase.co`:

| Value | Address |
|---|---|
| EntityID and metadata URL | `https://<ref>.supabase.co/auth/v1/sso/saml/metadata` |
| Metadata file | the same address with `?download=true` |
| ACS (reply) URL | `https://<ref>.supabase.co/auth/v1/sso/saml/acs` |
| NameID format | `emailAddress` or `persistent` |

The GMS builds these from `SUPABASE_URL`, so the settings screen shows the values of whichever
project the deployment uses.

**Verdict: feasible.** SAML SSO works on this project's setup once the project is on Pro or above
and SAML 2.0 is switched on. The rest of this page describes what the GMS adds on top.
