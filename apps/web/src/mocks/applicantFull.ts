// SPDX-License-Identifier: AGPL-3.0-only
// In-browser implementation of the last part of the applicant port (api/applicantFull.ts). It
// follows the Worker's rules: a token's secret is shown once and never carries submit or sign
// rights, the last admin cannot leave, and bank facts are a name and four digits at most.
import {
  APPLICANT_TOKEN_SCOPES,
  type AdaptedDraft,
  type ApiToken,
  type ApplicantFullApi,
  type AssistStatus,
  type FundingAlert,
  type Locker,
  type PayoutDestination,
  type PublicDocument,
  type PublicExtras,
} from "../api/applicantFull.ts";
import { ApiError } from "../api/client.ts";
import type { Session } from "../auth/types.ts";
import { APPLICANT_IDS, seedApplicantStore, type ApplicantStore } from "./applicant.ts";

const I = APPLICANT_IDS;
const clone = <T>(v: T): T => structuredClone(v);

export const FULL_IDS = {
  tokenBoard: "15000000-0000-7000-8000-000000000001",
  tokenBooks: "15000000-0000-7000-8000-000000000002",
  docLetter: "16000000-0000-7000-8000-000000000001",
  docFinancials: "16000000-0000-7000-8000-000000000002",
  docInsurance: "16000000-0000-7000-8000-000000000003",
  docBoardList: "16000000-0000-7000-8000-000000000004",
  alertHealth: "17000000-0000-7000-8000-000000000001",
} as const;
const F = FULL_IDS;

export interface FullStore {
  tokens: ApiToken[];
  locker: Locker;
  destination: PayoutDestination;
  alerts: FundingAlert[];
  assist: AssistStatus;
  /** Workspaces the signed-in person has left. */
  left: string[];
  extras: Record<string, PublicExtras>;
  documents: Record<string, PublicDocument[]>;
}

export function seedFullStore(store: ApplicantStore): FullStore {
  return {
    tokens: [
      { id: F.tokenBoard, name: "Board dashboard sync", scopes: ["awards:read", "requirements:read"], createdAt: "2027-01-09T17:00:00Z", lastUsedAt: "2027-04-19T15:20:00Z", revokedAt: null },
      { id: F.tokenBooks, name: "Bookkeeping bridge", scopes: ["awards:read"], createdAt: "2027-03-02T17:00:00Z", lastUsedAt: "2027-04-20T13:10:00Z", revokedAt: null },
    ],
    locker: {
      state: "ok",
      reason: null,
      items: [
        { id: F.docLetter, kind: "determination_letter", name: "IRS determination letter.pdf", mimeType: "application/pdf", sha256: "3f9a51c0d2e4b6a8c1d3e5f7a9b0c2d4e6f8a0b1c3d5e7f9a1b2c3d4e5f6c21e", source: "upload", uploadedAt: "2026-11-04T18:00:00Z", expiresAt: null, attachable: true },
        { id: F.docFinancials, kind: "audited_financials", name: "FY2026 audited financials.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sha256: "8b10e2c4a6d8f0b1c3e5a7d9f1b2c4e6a8d0f2b3c5e7a9d1f3b4c6e8a0d277d4", source: "upload", uploadedAt: "2027-02-11T18:00:00Z", expiresAt: null, attachable: true },
        { id: F.docInsurance, kind: "insurance_certificate", name: "Certificate of insurance 2027.pdf", mimeType: "application/pdf", sha256: "c41e7a9b0d2f4a6c8e0b1d3f5a7c9e1b2d4f6a8c0e1b3d5f7a9c0e2b4d69ab2", source: "upload", uploadedAt: "2027-01-05T18:00:00Z", expiresAt: "2027-12-31T00:00:00Z", attachable: true },
        { id: F.docBoardList, kind: "board_list", name: "Board roster (Drive)", mimeType: null, sha256: null, source: "google_drive", uploadedAt: "2027-01-20T18:00:00Z", expiresAt: null, attachable: false },
      ],
    },
    destination: { state: "ok", bankName: "River City Credit Union", last4: "4821", status: "active", level: "L3", pendingChange: false, freezeUntil: null, manageUrl: store.organization.editUrl ?? null, reason: null },
    alerts: [{ id: F.alertHealth, query: "rural health navigation", createdAt: "2027-03-14T16:00:00Z" }],
    assist: { enabled: false, quota: null },
    left: [],
    extras: {
      riverbend: {
        pastAwards: [
          { year: "2026", recipient: "Harbor Light Shelter", amountMinor: 12000000, currency: "USD", purpose: "Shelter-based health navigation" },
          { year: "2026", recipient: "Copper Valley Clinic", amountMinor: 9500000, currency: "USD", purpose: "Telehealth rooms in three rural clinics" },
          { year: "2025", recipient: "Northgate Housing Trust", amountMinor: 8000000, currency: "USD", purpose: "Resident services coordinator" },
          { year: "2025", recipient: "Lakeside Senior Center", amountMinor: 4000000, currency: "USD", purpose: "Transportation to medical appointments" },
        ],
        faq: [
          { question: "Do we need a Passport record to apply?", answer: "Yes. Applications start from your organization's Passport record, so legal name, tax status and documents arrive already filled in. Creating one is free." },
          { question: "Can a fiscally sponsored project apply?", answer: "Yes, through its fiscal sponsor's Passport record. Name the project in the application title." },
          { question: "How are payments made?", answer: "Through OpenGrants Passport, to the destination your organization has verified there. The foundation never sees or stores your bank details." },
        ],
        contactEmail: "grants@riverbendcf.example",
      },
      "cascade-county": {
        pastAwards: [{ year: "2026", recipient: "Alder Creek Family Services", amountMinor: 4000000, currency: "USD", purpose: "Clinic capacity in Alder Creek" }],
        faq: [{ question: "Who can apply?", answer: "Nonprofits and public agencies that provide health services in Cascade County." }],
        contactEmail: "grants@cascadecounty.example",
      },
    },
    documents: {
      "riverbend/community-health-2027": [
        { name: "Program guidelines 2027.pdf", url: "https://riverbendcf.example/guidelines-2027.pdf", kind: "guidelines" },
        { name: "Budget template.xlsx", url: "https://riverbendcf.example/budget-template.xlsx", kind: "template" },
      ],
    },
  };
}

export interface MockApplicantFullOptions {
  session: () => Promise<Session | null>;
  store?: ApplicantStore;
  full?: FullStore;
  now?: () => Date;
}

const ALLOWED = new Set(APPLICANT_TOKEN_SCOPES.map((s) => s.scope));

export function createMockApplicantFullApi(opts: MockApplicantFullOptions): ApplicantFullApi {
  const store = opts.store ?? seedApplicantStore();
  const full = opts.full ?? seedFullStore(store);
  const now = () => (opts.now ?? (() => new Date()))().toISOString();
  let n = 0;
  const id = (prefix: string) => `${prefix}000000-0000-7000-8000-${String(900000000000 + ++n)}`;
  const me = async () => {
    const s = await opts.session();
    if (!s) throw new ApiError(401, "Sign in to continue");
    return s;
  };
  const admin = async () => {
    const s = await me();
    const m = store.members.find((x) => x.userId === s.userId);
    if (m && m.role !== "admin") throw new ApiError(403, "Only an admin can do this");
    return s;
  };

  return {
    apiTokens: async () => (await admin(), clone(full.tokens.filter((t) => !t.revokedAt))),
    async createApiToken(input) {
      await admin();
      const refused = input.scopes.filter((s) => !ALLOWED.has(s));
      if (refused.length) throw new ApiError(422, `An applicant workspace's token cannot carry: ${refused.join(", ")}. Tokens never submit or sign`);
      if (!input.name.trim()) throw new ApiError(422, "Name the token", [{ field: "/name", message: "Name the token" }]);
      const token: ApiToken = { id: id("15"), name: input.name.trim(), scopes: [...new Set(input.scopes)], createdAt: now(), lastUsedAt: null, revokedAt: null };
      full.tokens.unshift(token);
      return { ...clone(token), clientId: token.id, clientSecret: `mock-secret-${n}` };
    },
    async revokeApiToken(tokenId) {
      await admin();
      const token = full.tokens.find((t) => t.id === tokenId);
      if (!token) throw new ApiError(404, "API client not found");
      token.revokedAt = now();
      return clone(token);
    },
    async exportWorkspace() {
      await admin();
      return {
        commonGrants: { protocol: "CommonGrants v0.5.0", applications: store.applications.map((a) => ({ id: a.uuid, title: a.title })), awards: store.awards.map((a) => ({ id: a.id, title: a.title })), orgs: [{ passportOrgId: I.org, name: store.organization.displayName }] },
        gms: { exportedAt: now(), workspace: { id: I.workspace, handle: store.organization.handle, kind: "applicant" }, answers: store.answers.length },
      };
    },
    async leaveWorkspace(workspaceId) {
      const s = await me();
      const admins = store.members.filter((m) => m.role === "admin");
      if (admins.length === 1 && admins[0]!.userId === s.userId) throw new ApiError(409, "You are the only admin. Make someone else an admin before you leave");
      store.members = store.members.filter((m) => m.userId !== s.userId);
      full.left.push(workspaceId);
      return { left: true };
    },

    locker: async () => (await me(), clone(full.locker)),
    async payoutDestination(awardId) {
      await me();
      const bare = awardId.replace(/^awd_/, "").replace(/^01J2Q7$/, I.awardHealth);
      if (!store.awards.some((a) => a.id === `awd_${bare}`)) throw new ApiError(404, "Award not found");
      return clone(full.destination);
    },

    alerts: async () => (await me(), clone(full.alerts)),
    async createAlert(query) {
      await me();
      const q = query.trim();
      if (!q) throw new ApiError(422, "Say what the alert should watch for", [{ field: "/query", message: "Say what the alert should watch for" }]);
      const existing = full.alerts.find((a) => a.query.toLowerCase() === q.toLowerCase());
      if (existing) return clone(existing);
      const alert: FundingAlert = { id: id("17"), query: q, createdAt: now() };
      full.alerts.unshift(alert);
      return clone(alert);
    },

    assistStatus: async () => (await me(), clone(full.assist)),
    async adaptAnswer(answerId, input): Promise<AdaptedDraft> {
      await me();
      if (!full.assist.enabled) throw new ApiError(404, "The assistant is not switched on for this workspace");
      const answer = store.answers.find((a) => a.id === answerId);
      if (!answer) throw new ApiError(404, "Answer not found");
      const words = answer.body.split(/\s+/).filter(Boolean);
      const max = input.maxWords ?? words.length;
      const q = full.assist.quota;
      if (q && q.limit !== undefined && (q.used ?? 0) >= q.limit) throw new ApiError(429, `This workspace has used its ${q.limit} assistant drafts for the month.`);
      if (q) full.assist.quota = { ...q, used: (q.used ?? 0) + 1, ...(q.limit !== undefined ? { remaining: Math.max(0, q.limit - (q.used ?? 0) - 1) } : {}) };
      return { text: words.slice(0, max).join(" "), overLimit: false, answerVersion: answer.version };
    },

    publicExtras: async (handle) => clone(full.extras[handle] ?? { pastAwards: [], faq: [], contactEmail: null }),
    publicDocuments: async (handle, slug) => clone(full.documents[`${handle}/${slug}`] ?? []),
  };
}

/** The store behind a services object's mock, so tests can stage states (assistant on, a pending change). */
const stores = new WeakMap<ApplicantStore, FullStore>();
export function fullStoreFor(store: ApplicantStore): FullStore {
  let full = stores.get(store);
  if (!full) {
    full = seedFullStore(store);
    stores.set(store, full);
  }
  return full;
}
