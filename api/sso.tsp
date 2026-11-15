import "@typespec/http";
import "@common-grants/core";
import "./models.tsp";
import "./routes.tsp";

using TypeSpec.Http;
using CommonGrants.Responses;
using GMS.Models;
using GMS.Auth;
using GMS.Errors;
using GMS.HttpResponses;

// Single sign-on (SAML 2.0) for funder workspaces (docs/sso.md). A workspace lists the email
// domains its staff sign in with through the organization's identity provider, proves each with a
// DNS TXT record and may require single sign-on for people on an active domain. The identity
// provider is registered in Supabase Auth by the operator; a domain is pending until then.
// Changing these settings is for a signed-in admin only, never an agent or API client.

namespace GMS.Models {
  /** Where a domain is: the admin publishes the DNS record, OpenGrants connects the identity provider, then it is active. */
  union SsoDomainStage {
    add_dns_record: "add_dns_record",
    waiting_for_provider: "waiting_for_provider",
    active: "active",
  }

  union DnsCheckResult {
    matched: "matched",
    not_found: "not_found",
    mismatch: "mismatch",
    error: "error",
  }

  /** The DNS TXT record that proves the domain: `gms-verify=<token>` at `_gms-verify.<domain>` (or at the domain itself). */
  model SsoDnsRecord {
    recordType: "TXT";
    recordName: string;
    recordValue: string;
    alsoAcceptedAt: string;
  }

  model SsoDomain {
    id: CommonGrants.Types.uuid;
    domain: string;
    status: "pending" | "active";
    stage: SsoDomainStage;

    /** People with an address on this domain must sign in through single sign-on. */
    required: boolean;

    dns: SsoDnsRecord;
    verifiedAt: utcDateTime | null;
    lastCheckedAt: utcDateTime | null;
    lastCheckResult: DnsCheckResult | null;

    /** The Supabase Auth SSO provider id, once the operator registered one. */
    providerId: CommonGrants.Types.uuid | null;

    activatedAt: utcDateTime | null;
    createdAt: utcDateTime;
  }

  /** The values the workspace's IT team enters in their identity provider, built from the server's Supabase address. */
  model SsoServiceProvider {
    entityId: url;
    metadataUrl: url;
    metadataDownloadUrl: url;
    acsUrl: url;
    nameIdFormat: string;
  }

  model SsoRequirementCheck {
    ok: boolean;
    reason: string | null;
  }

  model SsoSettings {
    domains: SsoDomain[];

    /** True when every active domain requires single sign-on. */
    requireSso: boolean;

    /** Whether this session could turn the requirement on, and if not, what to do first. */
    canRequire: SsoRequirementCheck;

    /** Null when the server has no SUPABASE_URL. */
    serviceProvider: SsoServiceProvider | null;

    session: {
      signedInThroughSso: boolean;
    };

    maxDomains: int32;
  }

  model SsoDomainInput {
    /** The email domain, like example.org. Normalized to lowercase ASCII. */
    @maxLength(260) domain: string;
  }

  model SsoDomainCheck {
    domain: SsoDomain;
    check: {
      result: DnsCheckResult;
      checkedAt: utcDateTime;
    };
  }

  model SsoDomainRemoved {
    removed: true;
    domain: string;
    wasActive: boolean;
  }

  model SsoRequirementInput {
    require: boolean;
  }

  model SsoRequirement {
    requireSso: boolean;
    requiredDomains: string[];
  }

  model SsoJoinedWorkspace {
    workspaceId: CommonGrants.Types.uuid;
    handle: string;
    name: string;
    role: string;
  }

  model SsoJoin {
    joined: SsoJoinedWorkspace[];
  }
}

namespace GMS.Routes.Custom {
  @tag("Single sign-on")
  namespace Sso {
    /** The workspace's single sign-on settings: domains, the requirement, whether this session could turn it on, and the service-provider values. Funder admins; API clients need `workspace:admin`. */
    @get @route("/sso/settings") @useAuth(GmsOAuth<["workspace:admin"]> | UserSession)
    op getSsoSettings(): OkT<SsoSettings> | AuthErrors;

    /** Add an email domain. It is pending until its DNS record is checked and the operator connects the identity provider. 409 `domain_exists`, `domain_in_use` (active for another workspace) or `too_many_domains`; 422 `invalid_domain`. A signed-in admin only (403 `human_only`). */
    @post @route("/sso/domains") @useAuth(UserSession)
    op addSsoDomain(@body body: SsoDomainInput): CreatedT<SsoDomain> | BadRequest | AuthErrors | Conflict | Unprocessable;

    /** Look up the domain's TXT record now (DNS over HTTPS against Cloudflare's resolver). A match records the proof; a check within ten seconds of the last answers with its result. */
    @post @route("/sso/domains/{id}/check") @useAuth(UserSession)
    op checkSsoDomain(@path id: CommonGrants.Types.uuid): OkT<SsoDomainCheck> | AuthErrors | NotFound;

    /** Remove a domain. Removing an active one ends its requirement; the operator removes its identity provider. */
    @delete @route("/sso/domains/{id}") @useAuth(UserSession)
    op removeSsoDomain(@path id: CommonGrants.Types.uuid): OkT<SsoDomainRemoved> | AuthErrors | NotFound;

    /** Require single sign-on for every active domain, or stop requiring it. Turning it on needs an active domain and an admin signed in through single sign-on now (409 `no_active_domain`, `sso_session_required`). Turning it off is always allowed. */
    @put @route("/sso/requirement") @useAuth(UserSession)
    op setSsoRequirement(@body body: SsoRequirementInput): OkT<SsoRequirement> | BadRequest | AuthErrors | Conflict;

    /** After an SSO sign-in (no workspace): join each workspace whose active domain matches the address and whose identity provider the session came through, with the role the person's email-code account holds there. 409 `sso_session_required` for any other sign-in. */
    @post @route("/sso/join") @useAuth(UserSession)
    op joinThroughSso(): OkT<SsoJoin> | AuthErrors | Conflict;
  }
}
