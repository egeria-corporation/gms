import "@typespec/http";
import "@typespec/versioning";
import "@common-grants/core";
import "./routes.tsp";
import "./outside.tsp";

using TypeSpec.Http;

/** OpenGrants GMS API.
 *
 * Implements the CommonGrants v0.5.0 protocol routes for opportunities, competitions, forms,
 * applications, awards and organizations under `/common-grants/`, GMS-specific routes (programs,
 * reviews, decisions, agreements, payment schedules, requirements, grantees, integrations) under
 * `/gms/`, and the OAuth 2.1, discovery, agent and webhook infrastructure routes at the root.
 *
 * Successful `/common-grants/` and `/gms/` responses use the CommonGrants envelopes
 * (`{status, message, data}` and `{status, message, items, paginationInfo}`); errors use the
 * CommonGrants error shape (`{status, message, errors}`). Infrastructure routes follow their own
 * standards (RFC 6749 / RFC 7517 / RFC 7591 / RFC 8414 / RFC 9728).
 *
 * Identifiers: `/common-grants/` routes use the record's UUID, as the protocol requires; `/gms/`
 * routes accept and return the human-prefixed form (`opp_`, `cmp_`, `frm_`, `app_`, `rev_`, `awd_`,
 * `agr_`, `trn_`, `req_`, `sub_`), which is the same UUID behind a prefix.
 *
 * The GMS never accepts or returns bank credentials or personal identity data. Organizations and
 * money live in OpenGrants Passport; the GMS shows `bankName` and `last4` from the PayeeCredential
 * only, and every payment goes through Passport.
 */
@service(#{ title: "OpenGrants GMS API" })
@server("https://gms.opengrants.io", "Production")
@Versioning.useDependency(CommonGrants.Versions.v0_5)
namespace GMS;
