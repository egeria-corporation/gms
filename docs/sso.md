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

## OpenID Connect (checked 2026-11-17 against Supabase's own documentation and source)

**Finding: Supabase Auth's enterprise single sign-on is SAML 2.0 only, so the GMS does not offer
OIDC single sign-on.** An organization connects its identity provider through SAML 2.0, which
Okta, Google Workspace, JumpCloud, OneLogin, Ping Identity, Keycloak, Authentik and most others
offer as a standard application type.

Sources, read on 2026-11-17:

- "Enterprise Single Sign-On" (`supabase.com/docs/guides/auth/enterprise-sso`): "Supabase Auth
  supports building enterprise applications that require Single Sign-On (SSO) authentication with
  SAML 2.0." Its only guide is the SAML 2.0 one (`/enterprise-sso/auth-sso-saml`).
- The Management API's "Create a sso provider" (`/docs/reference/api/v1-create-a-sso-provider`): the
  provider it returns has a `saml` object and nothing for OIDC.
- The JWT claims reference (`/docs/guides/auth/jwt-fields`): the `amr.method` values are `oauth`,
  `password`, `otp`, `totp`, `recovery`, `invite`, `sso/saml`, `magiclink`, `email/signup`,
  `email_change`, `token_refresh` and `anonymous`. `sso/saml` is the only single sign-on method.

Supabase does have three OIDC features. None of them is single sign-on for a workspace's own
identity provider under this page's rules:

1. **Custom OAuth/OIDC providers** (`/docs/guides/auth/custom-oauth-providers`): a project-wide
   `custom:<name>` sign-in provider (issuer, client id and secret), started with
   `signInWithOAuth({ provider: "custom:<name>" })`, like "Sign in with Google". It breaks three of
   the rules below:
   - **Domain.** A custom provider has no list of email domains, and `signInWithSSO({ domain })` does
     not route to it, so it cannot be tied to a domain the workspace proved through DNS.
   - **Which identity provider.** An OAuth sign-in is recorded in `amr` as `{ method: "oauth" }`
     with no provider. Supabase Auth's own source (`internal/models/sessions.go`,
     `CalculateAALAndAMR`, in `github.com/supabase/auth`) fills in `amr.provider` only for `sso/saml`.
     So a session cannot show that it came through the workspace's identity provider, and the
     requirement and the lockout rule cannot be enforced.
   - **Accounts kept apart.** "Identity Linking" (`/docs/guides/auth/auth-identity-linking`): "When a
     new user signs in with OAuth, Supabase Auth will attempt to look for an existing user that uses
     the same email address. If a match is found, the new identity is linked to the user." Only
     SAML SSO users are left out of linking. An organization's identity provider can assert any
     address, so a custom provider registered for one workspace would let that organization's IT
     sign in as any existing account with a verified address, including another funder's admin or an
     OpenGrants operator.
2. **Third-party auth with a custom OIDC issuer** (`/docs/guides/auth/third-party/custom-oidc`): the
   project accepts another issuer's own JWTs (with a `role` claim) instead of Supabase sessions. That
   replaces Supabase Auth rather than signing in to it. The GMS's sessions, two-step verification and
   rules all read Supabase sessions.
3. **OAuth 2.1 server** (`/docs/guides/auth/oauth-server`): it makes the Supabase project an OpenID
   Connect identity provider for other applications. That is the opposite direction.

**What this means for operators.** Never add a custom OAuth/OIDC provider to the GMS's Supabase
project for a workspace. Automatic linking would let that provider's administrators take over
accounts. The GMS never counts an OAuth sign-in as single sign-on: only an `amr` entry `sso/saml`
with a provider id does (`ssoProvidersOf` in `apps/api/src/auth/session.ts`, tested in
`apps/api/test/sso.test.ts`, "never counts an OIDC sign-in"). If Supabase later adds OIDC to
enterprise SSO, with domains, `amr` provider ids and no automatic linking, add it next to SAML
under the same rules.

## What a workspace admin does

Settings → Security · Single sign-on (`/w/<handle>/settings/security`, admins of funder workspaces):

1. **Add the email domain** (`example.org`), up to ten. It is **pending**.
2. **Prove the domain** with a DNS TXT record: `gms-verify=<token>` at `_gms-verify.<domain>` (a
   record with the same value on the domain itself also works, for DNS hosts without underscore
   names), then **Check DNS record**. The GMS looks the record up through DNS over HTTPS against
   Cloudflare's resolver (`cloudflare-dns.com`, the 1.1.1.1 service), the same pattern Passport uses
   for organization domains. A check within ten seconds of the last one answers with its result.
3. **Give the IT team the service-provider values** shown on the page (built from the server's
   `SUPABASE_URL`, never typed in): the Entity ID, the metadata URL and its download, the ACS URL and
   the NameID format, or **Download these values** as a text file. The IT team creates a SAML 2.0
   application in their identity provider (Okta, Google Workspace, JumpCloud or any other) and sends
   back its metadata URL or file.
4. **OpenGrants connects the identity provider** (the operator steps below). The domain becomes
   **active**, shown with a check mark and "Active".
5. Optionally, **require single sign-on for people with these email addresses**. Turning it on needs
   an active domain and an admin who is signed in through single sign-on right now (for an admin
   whose own address is on an active domain, through that domain's identity provider), so the person
   who turns it on is never the one it locks out. Only active domains are required; turning it off is
   always allowed.

Changing any of this is for a signed-in admin only: an agent or API client gets 403 `human_only`,
and there is no MCP tool. An API client with `workspace:admin` may read the settings.

## Signing in

The sign-in page has **Use single sign-on**: the person types their work email, the GMS calls
`signInWithSSO({ domain })` and the browser goes to the organization's sign-in page, then back to
`/signin` signed in (the page they were going to is kept for that tab). A domain with no identity
provider gets "Single sign-on is not set up for <domain>. Sign in with an email code instead, or ask
your IT team." The email-code and Passport sign-ins are unchanged.

An identity-provider-initiated sign-in (a tile in the identity provider's app list) does not work
with Supabase's PKCE flow; point the tile at `https://<gms host>/signin` instead (a "bookmark app").

**Joining through single sign-on.** Supabase gives an SSO sign-in its own account, separate from
the email-code account with the same address. Right after an SSO sign-in the web app calls
`POST /gms/sso/join`: for each workspace whose **active** domain matches the address and whose
registered identity provider is the one the session came through, the SSO account gets the role
that person's email-code account already holds there (matched on the account's own email, never on
an invited address), with the same scope and expiry, ledgered as `member.joined_through_sso`.
Nobody gets a role nobody held: an address that is not a member needs an invitation, as before.
(`SSO_JOIN_FROM_EXISTING_MEMBERSHIP` in `apps/api/src/services/sso.ts` switches this off.)

Single sign-on does not replace the GMS's own two-step verification for admin and finance roles.

## An identity provider speaks only for its own domains

A SAML identity provider can assert any email address: nothing in SAML stops one organization's
identity provider from saying its user is `director@another-funder.org`. Parts of the GMS act on a
session's address (workspace, draft, guest reviewer and award invitations, joining through single
sign-on, the email entries of `GALLERY_MODERATORS` and `DIRECTORY_MODERATORS`), so
the GMS accepts a single sign-on session only where its provider was registered for
the address's domain:

- **Centrally.** `assertSsoEmailBound` (`apps/api/src/services/sso.ts`), called for every session the
  API accepts (`personSession` in `apps/api/src/auth/middleware.ts`, used by `requireUser`,
  `authenticate` and the migration-request form): a session with an `sso/saml` entry in `amr` is
  accepted only when its address's domain is an **active** `workspace_sso_domains` row whose
  `provider_id` is one of the session's providers. Otherwise every route answers 403
  `sso_domain_mismatch`, "Your organization's single sign-on cannot sign you in with this email
  address. Sign in with a code sent to your email instead" (in the person's language), and the
  sign-in page offers to sign out. A pending domain, a removed one, an address on no registered
  domain and a session with no address are all refused. Email-code and Passport sessions, API
  clients and agents' tokens are untouched.
- **At each email check, as well.** An email entry in `GALLERY_MODERATORS` or `DIRECTORY_MODERATORS`
  never matches a session that came through single sign-on, even the right domain's
  (`MODERATOR_EMAIL_MATCHES_SSO_SESSIONS`, false); a user id always matches. Sign in with Passport
  never finds, adopts or links an account Supabase made through single sign-on (`is_sso_user`) by
  its address: the identity port refuses it (`account_mismatch`).
- `apps/api/test/redteam-sso-email.test.ts` tries each place with provider A's session asserting an
  address on provider B's domain, and the right-domain session.

**Register no SAML provider before v1.13.0 is deployed.** Until then a registered provider could
assert an address it was not registered for.

## Enforcement

One function, `assertSsoSatisfied` (`apps/api/src/services/sso.ts`), called by the auth middleware
for every signed-in person's request that names a workspace, and by the agent-consent decision:

- when the workspace has an **active, required** domain equal to the domain of the session's email
  address, the session must carry an `amr` entry `sso/saml` whose `provider` is that domain's
  registered provider; otherwise 403 `sso_required`, "This workspace requires single sign-on". The
  web app sends the person to the single sign-on step with that message.
- members with addresses on other domains, the same person's other workspaces, and pending or
  unrequired domains are untouched. Subdomains are not included: `staff.example.org` is its own domain.
- API clients (client credentials) and agents' existing tokens are not sessions and are unaffected;
  they stay bound to their scopes. Connecting a **new** agent to a workspace that requires single
  sign-on needs a session that came through it.

## Operator steps

Prerequisite, once per Supabase project: the project is on the Pro plan or above, and SAML 2.0 is
switched on (dashboard → Authentication → Providers → SAML 2.0). The project's redirect allow list
already holds `https://<gms host>/signin`, which email links use.

1. Wait until the workspace shows the domain as "DNS record found. Waiting for your identity
   provider to be connected" (`verified_at` is set).
2. Get the identity provider's metadata URL (or file) from the workspace's IT team.
3. Dry run, then apply, with a personal access token in `SUPABASE_ACCESS_TOKEN` (Supabase dashboard,
   Account, Access Tokens). The token is read from the environment and never printed:

   ```
   node scripts/sso/register-provider.mjs --project-ref <ref> --domain example.org \
     --metadata-url https://idp.example.org/saml/metadata --workspace <workspace id>
   node scripts/sso/register-provider.mjs ... --apply
   ```

   The dry run prints the exact `POST https://api.supabase.com/v1/projects/<ref>/config/auth/sso/providers`
   request with the token left out and sends nothing. `--metadata-file idp.xml` replaces
   `--metadata-url`; `--attribute-mapping-file mapping.json` adds a mapping (not needed for email).
   A file holding a private key is refused.
4. `--apply` prints the provider id and the SQL to run in the Supabase SQL editor:

   ```sql
   select gms.activate_sso_domain('<workspace id>', 'example.org', '<provider id>');
   ```

   It refuses a domain without DNS proof, one already active, and one active for another workspace,
   and writes `sso_domain.activated` to the ledger as `system:operator`.

**Replacing or removing a provider.** `supabase sso remove <provider id> --remote=<ref>` (or `DELETE`
on the Management API), then `select gms.deactivate_sso_domain('<workspace id>', 'example.org');`,
which returns the domain to pending and lifts its requirement. Register the new provider and
activate again.

**Lockout recovery.** If a workspace requires single sign-on and its identity provider is down (or
misconfigured) so that no admin can get in, an admin whose address is on another domain can turn
the requirement off. Otherwise the operator runs, with the support ticket as the reason:

```sql
select gms.lift_sso_requirement('<workspace id>', 'Identity provider outage, ticket 1234');
```

It stops requiring single sign-on on every domain of that workspace and records
`sso.requirement_lifted` with the reason. Email-code sign-in works again at once; the admins turn the
requirement back on once single sign-on works.

## Data

Migration 0035 adds `workspace_sso_domains` (workspace, domain, status `pending`/`active`,
`require_sso`, `provider_id`, the DNS challenge and its last result). A domain is active for one
workspace at most (partial unique index) and pending for any number, so nobody can block a domain by
adding it first. Members read their workspace's rows; signed-in users write nothing directly; the
API writes after its checks, and only the operator functions set a domain active. Rows belong to
funder workspaces only.

## Routes

| Route | Who | Notes |
|---|---|---|
| `GET /gms/sso/settings` | funder admins; API clients with `workspace:admin` | `{ domains, requireSso, canRequire: { ok, reason }, serviceProvider, session: { signedInThroughSso }, maxDomains }` |
| `POST /gms/sso/domains` | a signed-in admin | `{ domain }`. 409 `domain_exists`, `domain_in_use`, `too_many_domains`; 422 `invalid_domain` |
| `POST /gms/sso/domains/{id}/check` | a signed-in admin | `{ domain, check: { result, checkedAt } }`; `result` is `matched`, `not_found`, `mismatch` or `error` |
| `DELETE /gms/sso/domains/{id}` | a signed-in admin | `{ removed, domain, wasActive }` |
| `PUT /gms/sso/requirement` | a signed-in admin | `{ require }`. 409 `no_active_domain`, `sso_session_required` |
| `POST /gms/sso/join` | the signed-in person, no workspace | `{ joined: [{ workspaceId, handle, name, role }] }`. 409 `sso_session_required` for any other sign-in |
