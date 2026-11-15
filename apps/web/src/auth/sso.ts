// SPDX-License-Identifier: AGPL-3.0-only
// Single sign-on (SAML) for funder workspaces (docs/sso.md): the settings port for workspace
// admins, the step a person takes after an SSO sign-in, and the small helpers the sign-in page
// shares. `createHttpSsoApi` calls the GMS Worker; `createMockSsoApi` (mocks/sso.ts) is the
// in-browser stand-in.
import { ApiError } from "../api/client.ts";

/** Where a domain is: the admin publishes the DNS record, OpenGrants connects the identity provider, then it is active. */
export type SsoDomainStage = "add_dns_record" | "waiting_for_provider" | "active";
export type DnsCheckResult = "matched" | "not_found" | "mismatch" | "error";

export interface SsoDomain {
  id: string;
  domain: string;
  status: "pending" | "active";
  stage: SsoDomainStage;
  /** People with an address on this domain must sign in through single sign-on. */
  required: boolean;
  dns: { recordType: "TXT"; recordName: string; recordValue: string; alsoAcceptedAt: string };
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckResult: DnsCheckResult | null;
  providerId: string | null;
  activatedAt: string | null;
  createdAt: string;
}

/** The values the workspace's IT team enters in their identity provider. */
export interface ServiceProviderInfo {
  entityId: string;
  metadataUrl: string;
  metadataDownloadUrl: string;
  acsUrl: string;
  nameIdFormat: string;
}

export interface SsoSettings {
  domains: SsoDomain[];
  /** True when every active domain requires single sign-on. */
  requireSso: boolean;
  /** Whether this session could turn the requirement on, and if not, what to do first. */
  canRequire: { ok: boolean; reason: string | null };
  serviceProvider: ServiceProviderInfo | null;
  session: { signedInThroughSso: boolean };
  maxDomains: number;
}

export interface SsoJoined {
  workspaceId: string;
  handle: string;
  name: string;
  role: string;
}

export interface SsoApi {
  settings(): Promise<SsoSettings>;
  addDomain(domain: string): Promise<SsoDomain>;
  checkDomain(id: string): Promise<{ domain: SsoDomain; check: { result: DnsCheckResult; checkedAt: string } }>;
  removeDomain(id: string): Promise<void>;
  setRequirement(require: boolean): Promise<{ requireSso: boolean; requiredDomains: string[] }>;
  /** After an SSO sign-in: join the workspaces this address already belongs to through its email-code account. */
  join(): Promise<{ joined: SsoJoined[] }>;
}

/** The domain of an email address, lowercase; null when it has none. */
export function emailDomain(email: string): string | null {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim());
  return m ? m[1]!.toLowerCase().replace(/\.$/, "") : null;
}

/** The error code the API put first, if any (`sso_required`, `sso_session_required`, …). */
export function ssoErrorCode(error: unknown): string | null {
  const errors = (error as { errors?: unknown[] } | null)?.errors;
  if (!Array.isArray(errors)) return null;
  const code = (errors[0] as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : null;
}

export const isSsoRequired = (error: unknown): boolean => ssoErrorCode(error) === "sso_required";

// The page to return to after the identity provider: the browser leaves the app, so it is kept for
// this tab only. A convenience: without storage the person lands on their first workspace.
const NEXT_KEY = "gms.sso.next";
export function rememberSsoNext(next: string | null): void {
  try {
    if (next) sessionStorage.setItem(NEXT_KEY, next);
    else sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // Storage can be unavailable (private mode).
  }
}
export function takeSsoNext(): string | null {
  try {
    const v = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return v;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------ HTTP

export interface HttpSsoOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  /** The funder workspace the settings calls act in (sent as `X-GMS-Workspace`). */
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

export function createHttpSsoApi(opts: HttpSsoOptions): SsoApi {
  async function call<T>(method: string, path: string, body?: unknown, workspace = true): Promise<T> {
    const token = await opts.token();
    const workspaceId = workspace ? opts.workspaceId() : null;
    if (workspace && !workspaceId) throw new ApiError(400, "Open a workspace first");
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return json.data as T;
  }
  const e = encodeURIComponent;
  return {
    settings: () => call("GET", "/gms/sso/settings"),
    addDomain: (domain) => call("POST", "/gms/sso/domains", { domain }),
    checkDomain: (id) => call("POST", `/gms/sso/domains/${e(id)}/check`, {}),
    removeDomain: async (id) => void (await call("DELETE", `/gms/sso/domains/${e(id)}`)),
    setRequirement: (require) => call("PUT", "/gms/sso/requirement", { require }),
    join: () => call("POST", "/gms/sso/join", {}, false),
  };
}
