// SPDX-License-Identifier: AGPL-3.0-only
// The launch-preparation port: the install's payment switch, a person's sessions, program owners
// and outcome totals, the organization's representatives (read from Passport, never stored),
// interview scheduling, budget categories and their mapping, member activity, a funder's named
// contacts, and the Google Workspace export. `createHttpLaunchApi` calls the GMS Worker;
// `createMockLaunchApi` (mocks/launch.ts) implements the same interface in the browser, and
// test/launch-contract.test.ts holds both to the same assertions where the Worker has the route.
import { ApiError } from "./client.ts";

/** Install-wide switches the screens read. */
export interface AppConfig {
  /**
   * Whether payments can be sent through Passport from this install. When false, the GMS only
   * records payments the funder made elsewhere.
   */
  facilitatedPayments: boolean;
}

/** One signed-in session of the current person. */
export interface AccountSession {
  id: string;
  createdAt: string;
  lastActiveAt: string | null;
  /** A short description of the browser and device, when known. */
  device: string | null;
  /** The network address the session was last used from. Returned to its own person only. */
  ip: string | null;
  /** Second factor passed in this session. */
  mfa: boolean;
  current: boolean;
}

export interface ProgramOwner {
  userId: string;
  name: string;
}

export interface OutcomeTotal {
  key: string;
  label: string;
  total: number;
  unit: string | null;
}
export interface ProgramOutcomes {
  /** Accepted reports the totals were added up from. */
  reportsAccepted: number;
  totals: OutcomeTotal[];
}

export interface Representative {
  name: string;
  title: string | null;
  verified: boolean;
  verifiedAt: string | null;
}
/**
 * `ok`: the list is current. `not_shared`: the organization's consent does not cover
 * representatives. `not_linked`: no Passport record. `unknown`: Passport could not be reached.
 */
export interface Representatives {
  state: "ok" | "not_shared" | "not_linked" | "unknown";
  items: Representative[];
  manageUrl: string | null;
}

export interface InterviewState {
  proposed: { slots: string[]; note: string | null; location: string | null; at: string } | null;
  confirmed: { slot: string | null; at: string } | null;
}
export interface InterviewProposal {
  /** ISO date-times, one to ten. */
  slots: string[];
  note?: string;
  location?: string;
}

/** The funder's budget category on the left, the grantee's own ledger category on the right. */
export interface BudgetCategoryMapping {
  category: string;
  ownCategory: string;
}

export interface MemberActivity {
  userId: string;
  lastActiveAt: string | null;
  /** The firm a consultant works for, when recorded. */
  organization: string | null;
}

export interface FunderContact {
  name: string;
  title: string | null;
  email: string;
  phone: string | null;
  /** Shown on the public funder page as well as to applicants. */
  public: boolean;
}

/** One signature on an award's agreement. `ip` is null when this person may not see it. */
export interface SignatureRecord {
  party: "grantee" | "funder";
  version: number;
  ip: string | null;
  /** Whether this person's role may see the signer's network address at all. */
  ipVisible: boolean;
}

export type DriveExportKind = "agreement" | "award_letter";
export interface DriveExport {
  fileName: string;
  /** Where the file now is in Drive. */
  url: string;
}
export interface DirectoryPerson {
  name: string;
  email: string;
}

export interface LaunchApi {
  config(): Promise<AppConfig>;

  // ---- the signed-in person ----
  sessions(): Promise<AccountSession[]>;
  /** Ends another session of the same person. The current session is ended by signing out. */
  signOutSession(id: string): Promise<{ ended: boolean }>;

  // ---- programs (funder) ----
  /** Owner per program id; programs without one are absent. */
  programOwners(): Promise<Record<string, ProgramOwner>>;
  setProgramOwner(programId: string, userId: string | null): Promise<ProgramOwner | null>;
  programOutcomes(programId: string): Promise<ProgramOutcomes>;
  budgetCategories(programId: string): Promise<string[]>;
  putBudgetCategories(programId: string, categories: string[]): Promise<string[]>;

  // ---- the organization (applicant) ----
  representatives(): Promise<Representatives>;

  // ---- interviews ----
  /** Either side may read; `side` picks the route. */
  interview(applicationId: string, side: "funder" | "applicant"): Promise<InterviewState>;
  proposeInterview(applicationId: string, proposal: InterviewProposal): Promise<InterviewState>;
  confirmInterview(applicationId: string, slot: string): Promise<InterviewState>;

  // ---- a grant's budget (applicant) ----
  budgetMapping(awardId: string): Promise<BudgetCategoryMapping[]>;
  putBudgetMapping(awardId: string, mapping: BudgetCategoryMapping[]): Promise<BudgetCategoryMapping[]>;

  // ---- people ----
  memberActivity(workspaceId: string): Promise<MemberActivity[]>;
  /** The funder's own contact list (funder settings). */
  contacts(): Promise<FunderContact[]>;
  putContacts(contacts: FunderContact[]): Promise<FunderContact[]>;
  /** The contacts a funder lists for organizations that have applied to it. */
  funderContacts(funderHandle: string): Promise<FunderContact[]>;
  /** The contacts a funder shows on its public page. No sign-in needed. */
  publicContacts(funderHandle: string): Promise<FunderContact[]>;

  // ---- agreements (funder) ----
  signatures(awardId: string): Promise<SignatureRecord[]>;

  // ---- Google Workspace (funder) ----
  exportToDrive(kind: DriveExportKind, id: string, folderId: string): Promise<DriveExport>;
  directorySuggest(query: string): Promise<DirectoryPerson[]>;
}

// ------------------------------------------------------------------------------------ HTTP

export interface HttpLaunchOptions {
  baseUrl: string;
  token: () => Promise<string | null>;
  workspaceId: () => string | null;
  fetch?: typeof fetch;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const stringsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

const toContact = (raw: unknown): FunderContact | null => {
  const c = rec(raw);
  const name = str(c.name);
  const email = str(c.email);
  return name && email ? { name, title: str(c.title), email, phone: str(c.phone), public: c.public === true } : null;
};
const contactsOf = (raw: unknown): FunderContact[] => (Array.isArray(raw) ? raw.map(toContact).filter((c): c is FunderContact => c !== null) : []);

export function createHttpLaunchApi(opts: HttpLaunchOptions): LaunchApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await opts.token();
    const workspaceId = opts.workspaceId();
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
  /** A route this Worker does not serve yet answers 404 or 501: the screen shows its empty state. */
  async function optional<T>(load: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await load();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) return fallback;
      throw err;
    }
  }
  const ownerOf = (p: Record<string, unknown>): ProgramOwner | null => {
    const o = rec(p.owner);
    const userId = str(o.userId) ?? str(p.ownerUserId);
    return userId ? { userId, name: str(o.name) ?? str(p.ownerName) ?? "Team member" } : null;
  };
  const interviewOf = (raw: unknown): InterviewState => {
    const i = rec(rec(raw).interview ?? raw);
    return { proposed: (i.proposed as InterviewState["proposed"]) ?? null, confirmed: (i.confirmed as InterviewState["confirmed"]) ?? null };
  };

  return {
    config: () => optional(async () => ({ facilitatedPayments: rec(await get<unknown>("/gms/config")).facilitatedPayments === true }), { facilitatedPayments: false }),

    sessions: () =>
      optional(
        async () =>
          (await get<Record<string, unknown>[]>("/gms/me/sessions")).map((s) => ({
            id: String(s.id),
            createdAt: String(s.createdAt),
            lastActiveAt: str(s.lastActiveAt) ?? str(s.refreshedAt),
            device: str(s.device) ?? str(s.userAgent),
            ip: str(s.ip),
            mfa: s.mfa === true || s.aal === "aal2",
            current: s.current === true,
          })),
        [],
      ),
    signOutSession: async (id) => {
      await call<unknown>("DELETE", `/gms/me/sessions/${e(id)}`);
      return { ended: true };
    },

    programOwners: async () => {
      const programs = await get<Record<string, unknown>[]>("/gms/programs?pageSize=100");
      const out: Record<string, ProgramOwner> = {};
      for (const p of programs ?? []) {
        const owner = ownerOf(p);
        if (owner) out[String(p.id)] = owner;
      }
      return out;
    },
    setProgramOwner: async (programId, userId) => ownerOf(await call<Record<string, unknown>>("PATCH", `/gms/programs/${e(programId)}`, { ownerUserId: userId })),
    programOutcomes: (programId) =>
      optional(
        async () => {
          const r = rec(await get<unknown>(`/gms/programs/${e(programId)}/rollup`));
          const o = rec(r.outcomes);
          const totals = Array.isArray(o.totals) ? o.totals : [];
          return {
            reportsAccepted: Number(o.reportsAccepted ?? r.reportsAccepted ?? 0),
            totals: totals.map((t) => rec(t)).map((t) => ({ key: String(t.key), label: str(t.label) ?? String(t.key), total: Number(t.total ?? 0), unit: str(t.unit) })),
          };
        },
        { reportsAccepted: 0, totals: [] },
      ),
    budgetCategories: (programId) => optional(async () => stringsOf(rec(await get<unknown>(`/gms/programs/${e(programId)}/budget-categories`)).categories), []),
    putBudgetCategories: async (programId, categories) => stringsOf(rec(await call<unknown>("PUT", `/gms/programs/${e(programId)}/budget-categories`, { categories })).categories),

    representatives: () =>
      optional(
        async () => {
          const r = rec(await get<unknown>("/gms/me/representatives"));
          const items = Array.isArray(r.items) ? r.items : [];
          const state = str(r.state);
          return {
            state: state === "ok" || state === "not_shared" || state === "not_linked" ? state : "unknown",
            items: items.map((x) => rec(x)).map((x) => ({ name: String(x.name ?? ""), title: str(x.title) ?? str(x.role), verified: x.verified === true, verifiedAt: str(x.verifiedAt) })),
            manageUrl: str(r.manageUrl),
          };
        },
        { state: "not_shared" as const, items: [], manageUrl: null },
      ),

    interview: async (applicationId, side) => interviewOf(await get<unknown>(side === "funder" ? `/gms/applications/${e(applicationId)}/follow-ups` : `/gms/my/applications/${e(applicationId)}/follow-ups`)),
    proposeInterview: async (applicationId, proposal) => interviewOf(await call<unknown>("POST", `/gms/applications/${e(applicationId)}/interview`, proposal)),
    confirmInterview: async (applicationId, slot) => interviewOf(await call<unknown>("POST", `/gms/my/applications/${e(applicationId)}/interview/confirm`, { slot })),

    budgetMapping: (awardId) =>
      optional(async () => {
        const raw = await get<unknown>(`/gms/my/awards/${e(awardId)}/budget-mapping`);
        const list = Array.isArray(raw) ? raw : (rec(raw).mapping as unknown[] | undefined) ?? [];
        return list.map((m) => rec(m)).map((m) => ({ category: String(m.category), ownCategory: String(m.ownCategory ?? "") }));
      }, []),
    putBudgetMapping: async (awardId, mapping) => {
      const raw = await call<unknown>("PUT", `/gms/my/awards/${e(awardId)}/budget-mapping`, { mapping });
      const list = Array.isArray(raw) ? raw : (rec(raw).mapping as unknown[] | undefined) ?? mapping;
      return list.map((m) => rec(m)).map((m) => ({ category: String(m.category), ownCategory: String(m.ownCategory ?? "") }));
    },

    memberActivity: async (workspaceId) => {
      const raw = await call<unknown>("GET", `/gms/workspaces/${e(workspaceId)}/members`);
      const list = Array.isArray(raw) ? raw : [];
      return list.map((m) => rec(m)).map((m) => ({ userId: String(m.userId), lastActiveAt: str(m.lastActiveAt), organization: str(m.organization) ?? str(rec(m.scope).organization) }));
    },
    contacts: () => optional(async () => contactsOf(await get<unknown>("/gms/contacts")), []),
    putContacts: async (contacts) => contactsOf(await call<unknown>("PUT", "/gms/contacts", { contacts })),
    funderContacts: (funderHandle) =>
      optional(async () => {
        const raw = await get<unknown>("/gms/my/funders/detail");
        const mine = (Array.isArray(raw) ? raw : []).map((f) => rec(f)).find((f) => f.handle === funderHandle);
        return contactsOf(mine?.contacts);
      }, []),
    publicContacts: (funderHandle) =>
      optional(async () => {
        const page = rec(await get<unknown>(`/gms/public/funders/${e(funderHandle)}`));
        return contactsOf(rec(page.funder).contacts ?? page.contacts).filter((c) => c.public);
      }, []),

    signatures: (awardId) =>
      optional(async () => {
        const raw = await get<unknown>(`/gms/awards/${e(awardId)}/signatures`);
        return (Array.isArray(raw) ? raw : []).map((r) => rec(r)).map((r) => ({ party: r.party === "funder" ? ("funder" as const) : ("grantee" as const), version: Number(r.version ?? 1), ip: str(r.ip), ipVisible: r.ipVisible === true }));
      }, []),

    exportToDrive: async (kind, id, folderId) => {
      const r = rec(await call<unknown>("POST", "/gms/connectors/google_workspace/export", { documentKind: kind === "award_letter" ? "letter" : "agreement", subjectId: id, folderId }));
      return { fileName: str(r.fileName) ?? "Exported file", url: str(r.url) ?? "" };
    },
    directorySuggest: (query) =>
      optional(async () => {
        const raw = await get<unknown>(`/gms/directory/suggest?q=${e(query)}`);
        const list = Array.isArray(raw) ? raw : (rec(raw).items as unknown[] | undefined) ?? [];
        return list
          .map((p) => rec(p))
          .map((p) => ({ name: String(p.name ?? p.email ?? ""), email: String(p.email ?? "") }))
          .filter((p) => p.email);
      }, []),
  };
}
