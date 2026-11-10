// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  APPLICANT_CONSENT_SCOPES,
  CredentialVersionStaleError,
  GMS_AWARD_REGISTRY,
  PASSPORT_ORG_CLAIM,
  PassportApiError,
  PassportClient,
  PassportFeatureDisabledError,
  PassportUnavailableError,
  buildAuthorizeUrl,
  clientCredentialsTokens,
  createPkce,
  decryptSecret,
  encryptSecret,
  exchangeAuthorizationCode,
  fixtureFetch,
  gmsAwardIdOf,
  minorToMoney,
  moneyToMinor,
  profileSources,
  profileToObject,
  refreshTokenTokens,
  staticToken,
  type Fixture,
} from "../src/index.ts";
import { AWARD, ORG, loadFixture } from "./helpers.ts";

const BASE = "https://passport.test";
const tokenFixture = (n: number, extra: Record<string, unknown> = {}): Fixture => ({
  method: "POST",
  path: "/oauth/token",
  status: 200,
  body: { access_token: `at-${n}`, token_type: "Bearer", expires_in: 900, ...extra },
});

describe("token management", () => {
  it("caches a client-credentials token and renews it inside the expiry skew", async () => {
    let now = new Date("2027-05-24T16:00:00Z");
    const fx = fixtureFetch([tokenFixture(1), tokenFixture(2)]);
    const tokens = clientCredentialsTokens({ baseUrl: BASE, clientId: "cli", clientSecret: "s3cret", scopes: ["payee:read"], fetch: fx.fetch, now: () => now });
    expect(await tokens.getToken()).toBe("at-1");
    expect(await tokens.getToken()).toBe("at-1");
    expect(fx.calls).toHaveLength(1);
    expect(fx.calls[0]!.headers.authorization).toBe(`Basic ${btoa("cli:s3cret")}`);
    expect(fx.calls[0]!.body).toBe("grant_type=client_credentials&scope=payee%3Aread");
    now = new Date(now.getTime() + 845_000); // 55 s before expiry: inside the 60 s skew
    expect(await tokens.getToken()).toBe("at-2");
  });

  it("shares one request between concurrent callers", async () => {
    const fx = fixtureFetch([tokenFixture(1)]);
    const tokens = clientCredentialsTokens({ baseUrl: BASE, clientId: "cli", clientSecret: "x", fetch: fx.fetch });
    await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);
    expect(fx.calls).toHaveLength(1);
  });

  it("hands the rotated refresh token to onRotate and uses it next time", async () => {
    let now = new Date("2027-05-24T16:00:00Z");
    const rotated: string[] = [];
    const fx = fixtureFetch([tokenFixture(1, { refresh_token: "rt-2" }), tokenFixture(2, { refresh_token: "rt-3" })]);
    const tokens = refreshTokenTokens({ baseUrl: BASE, clientId: "gms", clientSecret: "x", refreshToken: "rt-1", onRotate: (t) => void rotated.push(t), fetch: fx.fetch, now: () => now });
    await tokens.getToken();
    now = new Date(now.getTime() + 900_000);
    await tokens.getToken();
    expect(rotated).toEqual(["rt-2", "rt-3"]);
    expect(fx.calls[1]!.body).toBe("grant_type=refresh_token&refresh_token=rt-2");
  });

  it("reports a refused client as an auth error and an outage as unavailable", async () => {
    const refused = fixtureFetch([{ method: "POST", path: "/oauth/token", status: 401, body: { error: "invalid_client" } }]);
    await expect(clientCredentialsTokens({ baseUrl: BASE, clientId: "c", clientSecret: "x", fetch: refused.fetch }).getToken()).rejects.toMatchObject({ name: "PassportAuthError", oauthError: "invalid_client" });
    const down = () => Promise.reject(new Error("connect failed"));
    await expect(clientCredentialsTokens({ baseUrl: BASE, clientId: "c", clientSecret: "x", fetch: down }).getToken()).rejects.toBeInstanceOf(PassportUnavailableError);
  });
});

describe("PassportClient", () => {
  const client = (fixtures: Fixture[], awardWrite = false) => {
    const fx = fixtureFetch(fixtures);
    return { fx, c: new PassportClient({ baseUrl: BASE, tokens: staticToken("at"), fetch: fx.fetch, awardWrite }) };
  };

  it("resolves a payee credential that carries a bank name and last four digits only", async () => {
    const { c, fx } = client([loadFixture("payee-alder-creek")]);
    const cred = await c.getPayeeCredential(ORG);
    expect(cred.level).toBe("L3");
    expect(cred.payoutDestination).toMatchObject({ bankName: "River City Credit Union", last4: "4821", status: "active" });
    expect(fx.calls[0]!.headers.authorization).toBe("Bearer at");
  });

  it("reads award headroom from the CommonGrants award", async () => {
    const { c } = client([loadFixture("award-mobile-health")]);
    const award = await c.getAward(AWARD);
    expect(moneyToMinor(award.funding?.awardedAmount)).toBe(15_000_000);
    expect(moneyToMinor(award.funding?.disbursedAmount)).toBe(0);
  });

  it("sends the Idempotency-Key and reports a replay", async () => {
    const created = loadFixture("disbursement-created");
    const { c, fx } = client([created, { ...created, status: 201, headers: { "Idempotent-Replayed": "true" } }]);
    const req = { awardId: AWARD, recipientOrgId: ORG, credentialId: "pc_01JALDERCREEK0000000000000", credentialVersion: 4, amount: minorToMoney(7_500_000), mode: "facilitated" as const };
    const first = await c.createDisbursement(req, "trn_0001");
    const second = await c.createDisbursement(req, "trn_0001");
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.disbursement.id).toBe(first.disbursement.id);
    expect(fx.calls.map((x) => x.headers["idempotency-key"])).toEqual(["trn_0001", "trn_0001"]);
    expect(fx.calls[0]!.body).toMatchObject({ amount: { amount: "75000.00", currency: "USD" } });
  });

  it("maps Passport errors: stale credential, refusal codes, outage", async () => {
    const err = (status: number, code: string): Fixture => ({ method: "POST", path: "/passport/disbursements", status, body: { status, message: code, errors: [{ code }, { code: "check_failed", field: "credential.version" }] } });
    const req = { awardId: AWARD, recipientOrgId: ORG, credentialId: "pc_x", credentialVersion: 3, amount: minorToMoney(100), mode: "facilitated" as const };
    await expect(client([err(409, "credential_version_stale")]).c.createDisbursement(req, "k")).rejects.toBeInstanceOf(CredentialVersionStaleError);
    const refusal = await client([err(409, "payee_not_l3")]).c.createDisbursement(req, "k").catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(PassportApiError);
    expect(refusal).toMatchObject({ status: 409, code: "payee_not_l3", details: [{ code: "check_failed", field: "credential.version" }] });
    await expect(client([err(503, "payments_unavailable")]).c.createDisbursement(req, "k")).rejects.toBeInstanceOf(PassportUnavailableError);
  });

  it("fetches a new token once after a 401", async () => {
    const ok = loadFixture("payee-alder-creek");
    const fx = fixtureFetch([{ ...ok, status: 401, body: { status: 401, message: "Unauthorized", errors: [{ code: "invalid_token" }] } }, ok]);
    let invalidated = 0;
    const c = new PassportClient({ baseUrl: BASE, fetch: fx.fetch, tokens: { getToken: () => Promise.resolve(`at-${invalidated}`), invalidate: () => void invalidated++ } });
    await c.getPayeeCredential(ORG);
    expect(invalidated).toBe(1);
    expect(fx.calls.map((x) => x.headers.authorization)).toEqual(["Bearer at-0", "Bearer at-1"]);
  });

  it("keeps the award mirror behind its flag", async () => {
    const input = { title: "T", funding: { awardedAmount: minorToMoney(100) }, recipientOrganizations: { primary: { id: ORG } } };
    await expect(client([]).c.createFunderAward("f", input)).rejects.toBeInstanceOf(PassportFeatureDisabledError);
    const { c, fx } = client([{ method: "PATCH", path: "/passport/funders/f/awards/a", status: 200, body: { status: 200, message: "Success", data: { id: "a" } } }], true);
    await c.patchFunderAward("f", "a", { title: "New title" });
    expect(fx.calls[0]!.headers["content-type"]).toBe("application/merge-patch+json");
  });

  it("mirrors an award and reads the GMS id back from otherIds", async () => {
    const FUNDER = "0193a1c0-0000-7000-8000-0000000000f1";
    const created = loadFixture("award-created");
    const { c, fx } = client([created, { method: "GET", path: "/common-grants/awards", status: 200, body: { status: 200, message: "Success", items: [(created.body as { data: unknown }).data], paginationInfo: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 } } }], true);
    const gmsId = "awd_0193b000-0000-7000-8000-000000000001";
    const { award, created: isNew } = await c.createFunderAward(FUNDER, {
      title: "Mobile Health Navigation for Rural Families",
      funding: { awardedAmount: minorToMoney(15_000_000), requestedAmount: minorToMoney(15_000_000) },
      recipientOrganizations: { primary: { id: ORG } },
      identifiers: { systemId: { registry: { code: GMS_AWARD_REGISTRY }, id: gmsId } },
    });
    expect(isNew).toBe(true);
    expect(gmsAwardIdOf(award)).toBe(gmsId);
    expect(award.identifiers?.systemId?.id).toBe(AWARD);
    expect((await c.findAwardBySystemId(gmsId))?.id).toBe(AWARD);
    expect(fx.calls[1]!.path).toBe(`/common-grants/awards?systemId=${gmsId}&registry=${encodeURIComponent(GMS_AWARD_REGISTRY)}`);
  });

  it("reads the organization as CommonGrants serves it, with the Passport level in customFields", async () => {
    const { c } = client([loadFixture("org-alder-creek")]);
    const org = await c.getOrg(ORG);
    expect(org).toMatchObject({ name: "Alder Creek Family Services", orgType: { code: "EA000000" }, identifiers: { "org:us:ein": { id: "001234567" } } });
    expect((org.customFields as Record<string, { value: string }>).verificationLevel!.value).toBe("L3");
  });

  it("lists references without bytes or storage locations", async () => {
    const { c, fx } = client([loadFixture("documents-alder-creek")]);
    const docs = await c.listOrgDocuments(ORG);
    expect(docs.map((d) => d.kind)).toEqual(["determination_letter", "audit", "other"]);
    expect(docs[2]!.sha256).toBeNull();
    expect(fx.calls.at(-1)!.path).toBe(`/passport/orgs/${ORG}/documents`);
    expect(JSON.stringify(docs)).not.toMatch(/storage|path/i);
  });

  it("reads the Common App profile and folds its fields for prefill and rules", async () => {
    const { c } = client([loadFixture("profile-alder-creek")]);
    const profile = await c.getOrgProfile(ORG);
    expect(profile.level).toBe("L3");
    expect(profileToObject(profile.fields)).toEqual({ name: "Alder Creek Family Services", commonApp: { irs: { subsection: "03" }, financials: { budget: 2_400_000, totalRevenue: 2_310_000 }, fiscalYearEnd: "06-30", staffCount: 18 } });
    expect(profileSources(profile.fields)["/commonApp/financials/totalRevenue"]).toBe("irs_990");
  });

  it("returns the Location of a proposed org change", async () => {
    const { c } = client([{ method: "POST", path: `/common-grants/orgs/${ORG}/changes`, status: 202, headers: { Location: `/common-grants/orgs/${ORG}/changes/chg_1` }, body: { status: 202, message: "Accepted", data: { id: "chg_1", status: "pending" } } }]);
    expect(await c.proposeOrgChange(ORG, { name: "Alder Creek Family Services, Inc." })).toEqual({ change: { id: "chg_1", status: "pending" }, location: `/common-grants/orgs/${ORG}/changes/chg_1` });
  });

  it("answers 501 for a request with no fixture", async () => {
    await expect(client([]).c.getDisbursement("dsb_none")).rejects.toMatchObject({ status: 501 });
  });
});

describe("secrets at rest", () => {
  // 32-byte AES test key: the bytes 0..31, base64url (allow-listed in .gitleaks.toml).
  const KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

  it("round-trips and never repeats a ciphertext", async () => {
    const a = await encryptSecret("refresh-token-value", KEY);
    const b = await encryptSecret("refresh-token-value", KEY);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(await decryptSecret(a, KEY)).toBe("refresh-token-value");
  });

  it("rejects a wrong-size key and a tampered ciphertext", async () => {
    await expect(encryptSecret("x", "c2hvcnQ")).rejects.toThrow(/32 bytes/);
    const ct = await encryptSecret("x", KEY);
    await expect(decryptSecret(ct.slice(0, -2) + (ct.endsWith("AA") ? "BB" : "AA"), KEY)).rejects.toThrow();
  });
});

describe("money", () => {
  it("converts between minor units and decimal strings", () => {
    expect(minorToMoney(7_500_000)).toEqual({ amount: "75000.00", currency: "USD" });
    expect(minorToMoney(5)).toEqual({ amount: "0.05", currency: "USD" });
    expect(moneyToMinor({ amount: "150000.5", currency: "USD" })).toBe(15_000_050);
    expect(moneyToMinor({ amount: "1e3", currency: "USD" })).toBeNull();
    expect(moneyToMinor(undefined)).toBeNull();
  });
});

describe("profileToObject", () => {
  it("ignores unsafe and malformed pointers and never replaces a branch with a leaf", () => {
    const out = profileToObject([
      { path: "/commonApp/financials/totalRevenue", value: 5 },
      { path: "/commonApp/financials", value: "oops" },
      { path: "/__proto__/polluted", value: true },
      { path: "no-slash", value: 1 },
      { path: "/a~1b/c~0d", value: "escaped" },
    ]);
    expect(out).toEqual({ commonApp: { financials: { totalRevenue: 5 } }, "a/b": { "c~d": "escaped" } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("applicant consent", () => {
  const jwt = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;

  it("builds the authorization URL with PKCE and the consent scopes", async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(buildAuthorizeUrl({ baseUrl: `${BASE}/`, clientId: "gms", redirectUri: "https://gms.test/gms/passport/consent/callback", state: "st", codeChallenge: challenge }));
    expect(url.origin + url.pathname).toBe(`${BASE}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", client_id: "gms", scope: APPLICANT_CONSENT_SCOPES.join(" "), state: "st", code_challenge: challenge, code_challenge_method: "S256" });
  });

  it("exchanges the code and reads the consented organization from the token", async () => {
    const fx = fixtureFetch([{ method: "POST", path: "/oauth/token", status: 200, body: { access_token: jwt({ [PASSPORT_ORG_CLAIM]: ORG }), refresh_token: "rt-1", expires_in: 600, scope: "org:read org.changes:read" } }]);
    const tokens = await exchangeAuthorizationCode({ baseUrl: BASE, clientId: "gms", clientSecret: "s", code: "c", codeVerifier: "v", redirectUri: "https://gms.test/cb", fetch: fx.fetch });
    expect(tokens).toMatchObject({ orgId: ORG, refreshToken: "rt-1", scopes: ["org:read", "org.changes:read"] });
    expect(String(fx.calls[0]!.body)).toContain("grant_type=authorization_code");
    expect(String(fx.calls[0]!.body)).toContain("code_verifier=v");
  });

  it("reports a refused code as an auth error", async () => {
    const fx = fixtureFetch([{ method: "POST", path: "/oauth/token", status: 400, body: { error: "invalid_grant", error_description: "Code expired" } }]);
    await expect(exchangeAuthorizationCode({ baseUrl: BASE, clientId: "gms", clientSecret: "s", code: "c", codeVerifier: "v", redirectUri: "https://gms.test/cb", fetch: fx.fetch })).rejects.toMatchObject({ name: "PassportAuthError", oauthError: "invalid_grant" });
  });
});
