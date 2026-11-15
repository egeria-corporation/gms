// SPDX-License-Identifier: AGPL-3.0-only
// Single sign-on in mock mode. Two fixtures tell the story: Riverbend has added its domain and has
// not published the DNS record yet (pending), and Cascade County signs in through its identity
// provider and requires it for cascadecounty.example. Signing in by email code as someone at
// cascadecounty.example and opening that workspace shows "This workspace requires single sign-on";
// "Use single sign-on" with the same address signs in through the mock identity provider.
//
// Mock mode cannot register an identity provider (the operator's step), so no domain becomes
// active here and the requirement that the mock API enforces is the fixture's.
import { ApiError } from "../api/client.ts";
import type { SsoApi, SsoDomain, SsoSettings } from "../auth/sso.ts";
import { emailDomain } from "../auth/sso.ts";
import type { Session } from "../auth/types.ts";

/** The mock project's address: what `SUPABASE_URL` gives the real API. */
export const MOCK_SUPABASE_URL = "https://mockprojectrefabcdefg.supabase.co";
export const MOCK_SSO_PROVIDER = "c0c0c0c0-5555-4555-8555-c0c0c0c0c0c0";

/** Domains with an identity provider registered in the mock project (what `signInWithSSO` finds). */
export const MOCK_SSO_PROVIDERS: Readonly<Record<string, string>> = { "cascadecounty.example": MOCK_SSO_PROVIDER };

interface MockDomainRow extends SsoDomain {
  workspaceHandle: string;
}

const TOKEN_A = "rB7vQ2kLx9TzW4mN8pHc3sYd6fJg1aUe5oKi0lVbXqR";
const TOKEN_B = "cC4nM7tPq2wZ9xL1vB6kH3jS8dF5gA0eR4uY7iO2pTm";
const at = "2026-11-02T15:00:00.000Z";

function row(id: string, workspaceHandle: string, domain: string, token: string, active: boolean): MockDomainRow {
  return {
    id,
    workspaceHandle,
    domain,
    status: active ? "active" : "pending",
    stage: active ? "active" : "add_dns_record",
    required: active,
    dns: { recordType: "TXT", recordName: `_gms-verify.${domain}`, recordValue: `gms-verify=${token}`, alsoAcceptedAt: domain },
    verifiedAt: active ? at : null,
    lastCheckedAt: active ? at : null,
    lastCheckResult: active ? "matched" : null,
    providerId: active ? MOCK_SSO_PROVIDER : null,
    activatedAt: active ? at : null,
    createdAt: at,
  };
}

export const seedSsoDomains = (): MockDomainRow[] => [
  row("5d000000-0000-4000-8000-000000000001", "riverbend", "riverbendcf.example", TOKEN_A, false),
  row("5d000000-0000-4000-8000-000000000002", "cascade-county", "cascadecounty.example", TOKEN_B, true),
];

/** The fixture requirement the mock API enforces when a workspace opens (see the note at the top). */
const FIXTURE_REQUIRED = seedSsoDomains().filter((d) => d.required);

/** The mock API's version of the server's check: refuse a session that skipped a required SSO. */
export function assertMockSso(handle: string, session: Session | null): void {
  const domain = session ? emailDomain(session.email) : null;
  const rule = FIXTURE_REQUIRED.find((d) => d.workspaceHandle === handle && d.domain === domain);
  if (rule && session?.ssoProviderId !== rule.providerId) throw new ApiError(403, "This workspace requires single sign-on", [{ code: "sso_required" }]);
}

const strip = ({ workspaceHandle: _w, ...d }: MockDomainRow): SsoDomain => structuredClone(d);
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface MockSsoOptions {
  session: () => Promise<Session | null>;
  /** The handle of the workspace the screens are in. */
  workspaceHandle: () => string | null;
  rows?: MockDomainRow[];
  now?: () => Date;
}

export function createMockSsoApi(opts: MockSsoOptions): SsoApi & { rows: MockDomainRow[] } {
  const rows = opts.rows ?? seedSsoDomains();
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  const mine = () => {
    const handle = opts.workspaceHandle();
    if (!handle) throw new ApiError(400, "Open a workspace first");
    return { handle, list: rows.filter((r) => r.workspaceHandle === handle) };
  };
  const find = (id: string) => {
    const { handle } = mine();
    const r = rows.find((x) => x.id === id && x.workspaceHandle === handle);
    if (!r) throw new ApiError(404, "Domain not found");
    return r;
  };
  const canRequire = (list: MockDomainRow[], session: Session | null): SsoSettings["canRequire"] => {
    const active = list.filter((r) => r.status === "active");
    if (!active.length) return { ok: false, reason: "Single sign-on can be required once one of your domains is active." };
    if (!active.some((r) => r.providerId && session?.ssoProviderId === r.providerId)) return { ok: false, reason: "Sign in with single sign-on first, so you know it works before you require it." };
    return { ok: true, reason: null };
  };
  const base = MOCK_SUPABASE_URL;
  return {
    rows,
    async settings() {
      const session = await opts.session();
      const { list } = mine();
      const active = list.filter((r) => r.status === "active");
      return {
        domains: list.map(strip),
        requireSso: active.length > 0 && active.every((r) => r.required),
        canRequire: canRequire(list, session),
        serviceProvider: { entityId: `${base}/auth/v1/sso/saml/metadata`, metadataUrl: `${base}/auth/v1/sso/saml/metadata`, metadataDownloadUrl: `${base}/auth/v1/sso/saml/metadata?download=true`, acsUrl: `${base}/auth/v1/sso/saml/acs`, nameIdFormat: "emailAddress or persistent" },
        session: { signedInThroughSso: !!session?.ssoProviderId },
        maxDomains: 10,
      };
    },
    async addDomain(input) {
      const { handle, list } = mine();
      const domain = input.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
      if (!DOMAIN_RE.test(domain)) throw new ApiError(422, "That is not a valid domain", [{ code: "invalid_domain", field: "domain", detail: "Enter a domain like example.org" }]);
      if (list.some((r) => r.domain === domain)) throw new ApiError(409, `${domain} is already on this workspace's list`, [{ code: "domain_exists" }]);
      if (rows.some((r) => r.domain === domain && r.status === "active")) throw new ApiError(409, `${domain} already signs in to another workspace. Ask OpenGrants for help if it is yours`, [{ code: "domain_in_use" }]);
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b % 64]).join("").slice(0, 43);
      const r = { ...row(crypto.randomUUID(), handle, domain, token, false), createdAt: now() };
      rows.push(r);
      return strip(r);
    },
    async checkDomain(id) {
      const r = find(id);
      // Mock mode publishes no DNS records: a pending domain's record is never found.
      if (!r.verifiedAt) Object.assign(r, { lastCheckedAt: now(), lastCheckResult: "not_found" });
      return { domain: strip(r), check: { result: r.verifiedAt ? "matched" : "not_found", checkedAt: r.lastCheckedAt ?? now() } };
    },
    async removeDomain(id) {
      const r = find(id);
      rows.splice(rows.indexOf(r), 1);
    },
    async setRequirement(require) {
      const session = await opts.session();
      const { list } = mine();
      if (require) {
        const check = canRequire(list, session);
        if (!check.ok) throw new ApiError(409, check.reason!, [{ code: list.some((r) => r.status === "active") ? "sso_session_required" : "no_active_domain" }]);
        for (const r of list) if (r.status === "active") r.required = true;
      } else for (const r of list) r.required = false;
      return { requireSso: require, requiredDomains: list.filter((r) => r.required).map((r) => r.domain) };
    },
    async join() {
      const session = await opts.session();
      if (!session?.ssoProviderId) throw new ApiError(409, "Sign in with single sign-on first", [{ code: "sso_session_required" }]);
      // The fixture memberships already include every mock workspace.
      return { joined: [] };
    },
  };
}
