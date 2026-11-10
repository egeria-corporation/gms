// SPDX-License-Identifier: AGPL-3.0-only
// Typed client for the Passport routes the GMS needs. `fetch` is injected so Workers, tests and the
// recorded-fixture mode share one code path. The client never sees bank or identity numbers:
// Passport returns the bank name and last four digits only.
import { PassportFeatureDisabledError, PassportUnavailableError, toPassportError } from "./errors.ts";
import type { OrgProfile } from "./profile.ts";
import type { FetchLike, TokenProvider } from "./tokens.ts";
import { GMS_AWARD_REGISTRY } from "./types.ts";
import type {
  LockerDocument,
  VerifiedRepresentative,
  CgAward,
  CgOrgChange,
  CgOrganization,
  CreateDisbursementRequest,
  Disbursement,
  Envelope,
  FunderAwardInput,
  FunderSource,
  PaginatedEnvelope,
  PassportEventType,
  PayeeCredential,
  WebhookSubscription,
} from "./types.ts";

export interface PassportClientOptions {
  baseUrl: string;
  tokens: TokenProvider;
  fetch?: FetchLike;
  /**
   * `POST/PATCH /passport/funders/{orgId}/awards` (GMS build prompt §14) is a pending Passport PR.
   * Leave this off until it is merged; the award methods then throw `PassportFeatureDisabledError`.
   */
  awardWrite?: boolean;
}

interface Call {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

const seg = encodeURIComponent;

export class PassportClient {
  private readonly base: string;
  private readonly tokens: TokenProvider;
  private readonly doFetch: FetchLike;
  private readonly awardWrite: boolean;

  constructor(o: PassportClientOptions) {
    this.base = o.baseUrl.replace(/\/+$/, "");
    this.tokens = o.tokens;
    this.doFetch = o.fetch ?? (fetch as FetchLike);
    this.awardWrite = o.awardWrite ?? false;
  }

  // --------------------------------------------------------------------------------- transport

  private async send(call: Call, token: string): Promise<Response> {
    const url = new URL(this.base + call.path);
    for (const [k, v] of Object.entries(call.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    try {
      return await this.doFetch(url.toString(), {
        method: call.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(call.body === undefined ? {} : { "Content-Type": call.method === "PATCH" ? "application/merge-patch+json" : "application/json" }),
          ...call.headers,
        },
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
    } catch {
      throw new PassportUnavailableError("Passport could not be reached");
    }
  }

  private async request<T>(call: Call): Promise<{ body: T; res: Response }> {
    let res = await this.send(call, await this.tokens.getToken());
    if (res.status === 401) {
      // The cached token may have been revoked or rotated: fetch a new one and retry once.
      this.tokens.invalidate();
      res = await this.send(call, await this.tokens.getToken());
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw toPassportError(res.status, body);
    if (body === null) throw new PassportUnavailableError("Passport returned a body that is not JSON", res.status);
    return { body: body as T, res };
  }

  private async data<T>(call: Call): Promise<T> {
    return (await this.request<Envelope<T>>(call)).body.data;
  }

  // --------------------------------------------------------------------------------- funder

  /** The funder's funding banks. A facilitated payment needs one with `canDebit`. */
  async listFunderSources(funderOrgId: string): Promise<FunderSource[]> {
    return (await this.request<PaginatedEnvelope<FunderSource>>({ method: "GET", path: `/passport/funders/${seg(funderOrgId)}/sources` })).body.items;
  }

  /** Link the funder to a nonprofit so it receives `payee.*` events for it. */
  linkNonprofit(funderOrgId: string, nonprofitOrgId: string): Promise<unknown> {
    return this.data({ method: "POST", path: `/passport/funders/${seg(funderOrgId)}/links`, body: { nonprofitOrgId } });
  }

  createSubscription(url: string, events: PassportEventType[]): Promise<WebhookSubscription> {
    return this.data({ method: "POST", path: "/passport/subscriptions", body: { url, events } });
  }

  // --------------------------------------------------------------------------------- payee

  /** Resolve the current PayeeCredential. Every call is recorded on the nonprofit's ledger. */
  getPayeeCredential(orgId: string): Promise<PayeeCredential> {
    return this.data({ method: "GET", path: `/passport/payees/${seg(orgId)}` });
  }

  getPayeeCredentialByEin(ein: string): Promise<PayeeCredential> {
    // Passport's registry lookup. The EIN is a public registry identifier (CommonGrants `org:us:ein`).
    return this.data({ method: "GET", path: "/passport/payees", query: { registry: "org:us:ein", id: ein } });
  }

  // --------------------------------------------------------------------------------- CommonGrants: orgs

  getOrg(orgId: string, at?: string): Promise<CgOrganization> {
    return this.data({ method: "GET", path: `/common-grants/orgs/${seg(orgId)}`, query: { at } });
  }

  listOrgs(page = 1, pageSize = 100): Promise<PaginatedEnvelope<CgOrganization>> {
    return this.request<PaginatedEnvelope<CgOrganization>>({ method: "GET", path: "/common-grants/orgs", query: { page, pageSize } }).then((r) => r.body);
  }

  listOrgChanges(orgId: string, page = 1, pageSize = 100): Promise<PaginatedEnvelope<CgOrgChange>> {
    return this.request<PaginatedEnvelope<CgOrgChange>>({ method: "GET", path: `/common-grants/orgs/${seg(orgId)}/changes`, query: { page, pageSize } }).then((r) => r.body);
  }

  getOrgChange(orgId: string, changeId: string): Promise<CgOrgChange> {
    return this.data({ method: "GET", path: `/common-grants/orgs/${seg(orgId)}/changes/${seg(changeId)}` });
  }

  /** Propose a profile change. Passport stores it as `pending` for the nonprofit to review (202 + Location). */
  async proposeOrgChange(orgId: string, patch: Record<string, unknown>): Promise<{ change: CgOrgChange | null; location: string | null }> {
    const { body, res } = await this.request<Partial<Envelope<CgOrgChange>>>({ method: "POST", path: `/common-grants/orgs/${seg(orgId)}/changes`, body: patch });
    return { change: body.data ?? null, location: res.headers.get("Location") };
  }

  /**
   * The Common App profile beyond `OrganizationBase` (budget, fiscal year end, staff count, 990
   * figures): confirmed fields only, each with its provenance. Scope `org:read`, under the same
   * consent rule as `getOrg`. Fold `fields` with `profileToObject` for prefill and eligibility.
   */
  getOrgProfile(orgId: string): Promise<OrgProfile> {
    return this.data({ method: "GET", path: `/passport/orgs/${seg(orgId)}/profile` });
  }

  /**
   * References to the documents in the organization's Passport locker (scope `org:read`, same
   * consent rule as `getOrgProfile`). Passport withholds tax-identity and officer-proofing kinds
   * from consented clients, and never returns bytes or storage locations.
   */
  async listOrgDocuments(orgId: string): Promise<LockerDocument[]> {
    return (await this.request<PaginatedEnvelope<LockerDocument>>({ method: "GET", path: `/passport/orgs/${seg(orgId)}/documents` })).body.items ?? [];
  }

  /**
   * The organization's verified representatives (scope `org:read`, same consent rule as
   * `getOrgProfile`). Only people Passport has verified are listed.
   */
  async listVerifiedRepresentatives(orgId: string): Promise<VerifiedRepresentative[]> {
    return (await this.request<PaginatedEnvelope<VerifiedRepresentative>>({ method: "GET", path: `/passport/orgs/${seg(orgId)}/verified-representatives` })).body.items ?? [];
  }

  // --------------------------------------------------------------------------------- CommonGrants: awards

  getAward(awardId: string): Promise<CgAward> {
    return this.data({ method: "GET", path: `/common-grants/awards/${seg(awardId)}` });
  }

  /**
   * Find the Passport award mirrored from a GMS award. Passport returns the caller's id under
   * `identifiers.otherIds["org:opengrants:gms"]`; `identifiers.systemId` stays Passport's own.
   */
  async findAwardBySystemId(systemId: string, registry: string = GMS_AWARD_REGISTRY): Promise<CgAward | null> {
    const { body } = await this.request<PaginatedEnvelope<CgAward>>({ method: "GET", path: "/common-grants/awards", query: { systemId, registry } });
    return body.items[0] ?? null;
  }

  /**
   * Mirror a GMS award into Passport on acceptance (scope `award:write`; build prompt §10.6).
   * Posting the same `identifiers.systemId` again returns the award created the first time.
   * Passport refuses `recipientIndividual` (422) and a recipient it cannot resolve (422 `recipient_not_found`).
   */
  async createFunderAward(funderOrgId: string, award: FunderAwardInput): Promise<{ award: CgAward; created: boolean }> {
    if (!this.awardWrite) throw new PassportFeatureDisabledError("award:write");
    const { body, res } = await this.request<Envelope<CgAward>>({ method: "POST", path: `/passport/funders/${seg(funderOrgId)}/awards`, body: award });
    return { award: body.data, created: res.status === 201 };
  }

  /** Merge-patch an award. Lowering `awardedAmount` below what was disbursed is refused (409 `award_amount_below_disbursed`). */
  patchFunderAward(funderOrgId: string, awardId: string, patch: Partial<FunderAwardInput>): Promise<CgAward> {
    if (!this.awardWrite) throw new PassportFeatureDisabledError("award:write");
    return this.data({ method: "PATCH", path: `/passport/funders/${seg(funderOrgId)}/awards/${seg(awardId)}`, body: patch });
  }

  // --------------------------------------------------------------------------------- disbursements

  /**
   * Create a disbursement. `idempotencyKey` is the GMS tranche id (`trn_…`): repeating the same request
   * with the same key returns the same disbursement (`replayed`), never a second payment.
   */
  async createDisbursement(req: CreateDisbursementRequest, idempotencyKey: string): Promise<{ disbursement: Disbursement; replayed: boolean }> {
    const { body, res } = await this.request<Envelope<Disbursement>>({ method: "POST", path: "/passport/disbursements", body: req, headers: { "Idempotency-Key": idempotencyKey } });
    return { disbursement: body.data, replayed: res.headers.get("Idempotent-Replayed") === "true" };
  }

  getDisbursement(disbursementId: string): Promise<Disbursement> {
    return this.data({ method: "GET", path: `/passport/disbursements/${seg(disbursementId)}` });
  }

  /** Release a disbursement Passport put on hold (destination change in flight) after the funder reviewed it. */
  releaseHeldDisbursement(disbursementId: string): Promise<Disbursement> {
    return this.data({ method: "POST", path: `/passport/disbursements/${seg(disbursementId)}/release` });
  }

  cancelHeldDisbursement(disbursementId: string): Promise<Disbursement> {
    return this.data({ method: "POST", path: `/passport/disbursements/${seg(disbursementId)}/cancel` });
  }
}
