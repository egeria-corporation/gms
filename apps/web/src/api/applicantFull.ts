// SPDX-License-Identifier: AGPL-3.0-only
// The last part of the applicant port: workspace tokens, export and leaving; the Passport locker
// and the payout destination, both read live from Passport and never stored; funding alerts; the
// drafting assistant; and the extra public facts a funder page shows.
// `createHttpApplicantFullApi` calls the GMS Worker; `createMockApplicantFullApi`
// (mocks/applicantFull.ts) implements the same interface in the browser.
// test/applicantFull-contract.test.ts holds both to the same assertions.
import { ApiError } from "./client.ts";

/** A workspace API token. The secret is only ever present on the create response. */
export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
export interface NewApiToken extends ApiToken {
  clientId: string;
  clientSecret: string;
}

/** The scopes an applicant workspace's token may carry. Tokens never submit or sign. */
export const APPLICANT_TOKEN_SCOPES: { scope: string; label: string }[] = [
  { scope: "org:read", label: "Read the organization record" },
  { scope: "applications:read", label: "Read applications" },
  { scope: "applications:write", label: "Draft applications" },
  { scope: "awards:read", label: "Read grants and payments" },
  { scope: "requirements:read", label: "Read reports" },
  { scope: "requirements:write", label: "Draft reports" },
  { scope: "library:read", label: "Read the answer library" },
  { scope: "library:write", label: "Edit the answer library" },
  { scope: "discovery", label: "Find funding" },
];

/** A reference to a document in the organization's Passport locker. Never its bytes. */
export interface LockerDocument {
  id: string;
  kind: string;
  name: string;
  mimeType: string | null;
  sha256: string | null;
  source: string | null;
  uploadedAt: string | null;
  expiresAt: string | null;
  /** False when Passport holds no hash for it (a Drive reference), so it cannot be pinned. */
  attachable: boolean;
}
export interface Locker {
  /** `unavailable`: Passport could not be read just now, or the consent does not cover the locker. */
  state: "ok" | "unavailable";
  reason: string | null;
  items: LockerDocument[];
}

/** Where grant payments go, read live from Passport: a bank's name and the last four digits only. */
export interface PayoutDestination {
  state: "ok" | "none" | "not_linked" | "not_shared" | "unknown";
  bankName: string | null;
  last4: string | null;
  status: string | null;
  level: string | null;
  pendingChange: boolean;
  freezeUntil: string | null;
  manageUrl: string | null;
  reason: string | null;
}

export interface AssistStatus {
  enabled: boolean;
  quota: { used?: number; limit?: number; remaining?: number } | null;
}
export interface AdaptedDraft {
  /** A draft for the person to edit. Never saved by the assistant. */
  text: string;
  overLimit: boolean;
  answerVersion: number | null;
}

export interface FundingAlert {
  id: string;
  query: string;
  createdAt: string;
}

export interface PastAward {
  year: string;
  recipient: string;
  amountMinor: number;
  currency: string;
  purpose: string;
}
export interface PublicExtras {
  pastAwards: PastAward[];
  faq: { question: string; answer: string }[];
  contactEmail: string | null;
}
export interface PublicDocument {
  name: string;
  url: string;
  kind: string;
}

export interface ApplicantFullApi {
  // ---- workspace settings ----
  apiTokens(): Promise<ApiToken[]>;
  /** The secret is shown once, on this response. */
  createApiToken(input: { name: string; scopes: string[] }): Promise<NewApiToken>;
  revokeApiToken(id: string): Promise<ApiToken>;
  /** Everything the workspace entered, as CommonGrants JSON plus the GMS's own records. */
  exportWorkspace(): Promise<Record<string, unknown>>;
  leaveWorkspace(workspaceId: string): Promise<{ left: boolean }>;

  // ---- read live from Passport ----
  locker(): Promise<Locker>;
  payoutDestination(awardId: string): Promise<PayoutDestination>;

  // ---- funding alerts ----
  alerts(): Promise<FundingAlert[]>;
  createAlert(query: string): Promise<FundingAlert>;

  // ---- assistant: drafts only ----
  assistStatus(): Promise<AssistStatus>;
  adaptAnswer(answerId: string, input: { question: string; maxWords?: number }): Promise<AdaptedDraft>;

  // ---- public funder pages ----
  publicExtras(handle: string): Promise<PublicExtras>;
  publicDocuments(handle: string, slug: string): Promise<PublicDocument[]>;
}

/** Plain-language account of a payout destination state: what the person sees and can do. */
export function describeDestination(d: PayoutDestination): { title: string; detail: string; tone: "ok" | "warn" | "neu" | "info" } {
  switch (d.state) {
    case "ok":
      return d.pendingChange
        ? { title: "A destination change is pending", detail: d.freezeUntil ? `Payments are paused until the change clears on ${d.freezeUntil.slice(0, 10)}.` : "Payments are paused until Passport finishes checking the change.", tone: "warn" }
        : { title: "Payee active", detail: "Payments go to the destination your organization verified in Passport.", tone: "ok" };
    case "none":
      return { title: "No payout destination yet", detail: "Add and verify a bank account in Passport before a payment can be released.", tone: "warn" };
    case "not_linked":
      return { title: "Passport is not connected", detail: "Connect this workspace to your Passport record to see where payments go.", tone: "neu" };
    case "not_shared":
      return { title: "Not shared with the GMS", detail: "Your Passport consent does not let the GMS read payee details. The destination is safe in Passport; open it there to see or change it.", tone: "info" };
    default:
      return { title: "Passport can't be reached", detail: "The destination can't be shown right now. Nothing has changed; try again shortly.", tone: "neu" };
  }
}

// ------------------------------------------------------------------------------------ HTTP

export interface HttpApplicantFullOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

const ALERT_PREFIX = "alert:";

interface RawAward {
  recipient: string | null;
  title: string;
  awardedAmount: { amount: string; currency: string } | null;
  year: number;
}
const toPastAward = (a: RawAward): PastAward => ({ year: String(a.year), recipient: a.recipient ?? "Recipient not named", amountMinor: Math.round(Number(a.awardedAmount?.amount ?? 0) * 100), currency: a.awardedAmount?.currency ?? "USD", purpose: a.title });
const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** Published FAQ entries, whichever key names the funder's page used. */
export function toFaq(raw: unknown): PublicExtras["faq"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ question: str(x.question) || str(x.q), answer: str(x.answer) || str(x.a) }))
    .filter((f) => f.question && f.answer);
}
export function toDocuments(raw: unknown): PublicDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ name: str(x.name) || str(x.title), url: str(x.url), kind: str(x.kind) || "document" }))
    .filter((d) => d.name && /^https:\/\//.test(d.url));
}


export function createHttpApplicantFullApi(opts: HttpApplicantFullOptions): ApplicantFullApi {
  async function call<T>(method: string, path: string, body?: unknown, anonymous = false): Promise<T> {
    const token = anonymous ? null : await opts.token();
    const workspaceId = anonymous ? null : opts.workspaceId();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; items?: unknown; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return (json.data ?? json.items) as T;
  }
  const get = <T>(path: string) => call<T>("GET", path);
  const e = encodeURIComponent;
  const token = (c: ApiToken): ApiToken => ({ id: c.id, name: c.name, scopes: c.scopes ?? [], createdAt: c.createdAt, lastUsedAt: c.lastUsedAt ?? null, revokedAt: c.revokedAt ?? null });

  type Saved = { id: string; source: string; externalId: string; title: string; createdAt?: string };
  const toAlert = (s: Saved): FundingAlert => ({ id: s.id, query: s.title, createdAt: s.createdAt ?? "" });

  return {
    apiTokens: async () => ((await get<ApiToken[] | null>("/gms/api-clients")) ?? []).map(token),
    createApiToken: async (input) => {
      const c = await call<NewApiToken>("POST", "/gms/api-clients", input);
      return { ...token(c), clientId: c.clientId, clientSecret: c.clientSecret };
    },
    revokeApiToken: async (id) => token(await call<ApiToken>("DELETE", `/gms/api-clients/${e(id)}`)),
    exportWorkspace: async () => {
      const r = await call<{ bundle?: Record<string, unknown>; counts?: unknown }>("POST", "/gms/exports/bundle?inline=true", {});
      const files = r.bundle ?? {};
      return { commonGrants: files["commongrants.json"], gms: files["gms.json"], attachments: files["attachments/manifest.json"] ?? [], counts: r.counts ?? null };
    },
    leaveWorkspace: async (workspaceId) => {
      const r = await call<{ left?: boolean } | null>("DELETE", `/gms/workspaces/${e(workspaceId)}/members/me`);
      return { left: r?.left ?? true };
    },

    locker: async () => {
      try {
        return { state: "ok", reason: null, items: (await get<LockerDocument[] | null>("/gms/me/documents")) ?? [] };
      } catch (err) {
        // Passport unreachable, the consent revoked, or a Passport that does not list the locker yet.
        if (err instanceof ApiError && [404, 409, 502, 503].includes(err.status)) return { state: "unavailable", reason: err.message, items: [] };
        throw err;
      }
    },
    payoutDestination: (awardId) => get(`/gms/my/awards/${e(awardId)}/payout-destination`),

    // An alert is registered with OpenGrants and remembered as a saved listing, so it is listed here.
    alerts: async () => ((await get<Saved[] | null>("/gms/discover/saved")) ?? []).filter((s) => s.externalId.startsWith(ALERT_PREFIX)).map(toAlert),
    createAlert: async (query) => {
      await call("POST", "/gms/discover/opengrants/alerts", { query });
      return toAlert(await call<Saved>("POST", "/gms/discover/saved", { source: "opengrants", externalId: `${ALERT_PREFIX}${query.toLowerCase()}`, title: query }));
    },

    assistStatus: async () => {
      try {
        return await get<AssistStatus>("/gms/assist/status");
      } catch (err) {
        // A token without the `assist` scope, or an install without the assistant: simply off.
        if (err instanceof ApiError && [403, 404].includes(err.status)) return { enabled: false, quota: null };
        throw err;
      }
    },
    adaptAnswer: async (answerId, input) => {
      const r = await call<{ output: { text?: string; adapted?: string; overLimit?: boolean }; answerVersion?: number }>("POST", `/gms/my/answers/${e(answerId)}/adapt`, {
        question: input.question,
        ...(input.maxWords ? { limits: { maxWords: input.maxWords } } : {}),
      });
      return { text: r.output.text ?? r.output.adapted ?? "", overLimit: !!r.output.overLimit, answerVersion: r.answerVersion ?? null };
    },

    // Past awards appear only when the funder has turned transparency on; the questions are the
    // ones its open opportunities publish.
    publicExtras: async (handle) => {
      type Card = { slug: string; status: string };
      const page = await call<{ funder?: { contactEmail?: string | null }; opportunities?: Card[]; pastAwards?: RawAward[] | null }>("GET", `/gms/public/funders/${e(handle)}`, undefined, true);
      const open = (page.opportunities ?? []).filter((o) => o.status === "open").slice(0, 3);
      const pages = await Promise.all(open.map((o) => call<{ opportunity?: { faq?: unknown[] } }>("GET", `/gms/public/funders/${e(handle)}/opportunities/${e(o.slug)}`, undefined, true).catch(() => null)));
      const seen = new Set<string>();
      const faq = pages.flatMap((p) => toFaq(p?.opportunity?.faq)).filter((f) => !seen.has(f.question) && !!seen.add(f.question));
      return { pastAwards: (page.pastAwards ?? []).map(toPastAward), faq, contactEmail: page.funder?.contactEmail ?? null };
    },
    publicDocuments: async (handle, slug) => {
      const page = await call<{ opportunity?: { documents?: unknown[] } }>("GET", `/gms/public/funders/${e(handle)}/opportunities/${e(slug)}`, undefined, true);
      return toDocuments(page.opportunity?.documents);
    },
  };
}
