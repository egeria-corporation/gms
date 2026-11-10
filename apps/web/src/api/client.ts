// SPDX-License-Identifier: AGPL-3.0-only
// The API port the web app talks to. `createHttpApi` calls the GMS Worker with the typed client
// generated from the TypeSpec document (`pnpm --filter @gms/web gen:api`); `createMockApi`
// (mocks/api.ts) implements the same interface in the browser.
import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./schema.d.ts";
import type {
  CgCompetition,
  Checklist,
  Competition,
  CompetitionInput,
  CreateWorkspaceInput,
  EvaluateInput,
  Evaluation,
  FormInput,
  FormPatch,
  FormRecord,
  FormSummary,
  FunderPageData,
  Invitation,
  InvitationInput,
  Member,
  Opportunity,
  OpportunityInput,
  OpportunityPageData,
  OpportunityPreview,
  OpportunityStatus,
  PassportStatus,
  Program,
  ProgramInput,
  Rubric,
  RubricInput,
  Stage,
  WorkspaceRecord,
  WorkspaceWrite,
  Brand,
} from "./types.ts";
import type { JsonObject } from "@gms/forms";
import { createHttpFunderApi, type FunderApi } from "./funder.ts";
import { createHttpFunderMoneyApi, type FunderMoneyApi } from "./funderMoney.ts";

export type WorkspaceKind = "funder" | "applicant";

/** One membership of the signed-in person. */
export interface MeWorkspace {
  id: string;
  handle: string;
  name: string;
  kind: WorkspaceKind;
  role: string;
  /** This role must verify a second factor before the workspace opens. */
  requiresMfa: boolean;
}

export interface Me {
  userId: string;
  email: string;
  mfaVerified: boolean;
  workspaces: MeWorkspace[];
}

/** What the shells need to draw a workspace. */
export interface Workspace {
  id: string;
  handle: string;
  kind: WorkspaceKind;
  name: string;
  /** Line under the name in the rail, e.g. "Funder workspace · FY2027". */
  sub: string;
  /** Tenant accent; applied only where tenant-* classes and funder chips use it. */
  brand: { accent: string; onAccent: string };
  member: { name: string; initials: string; title: string };
  unreadNotifications: number;
  pendingApprovals: number;
}

export interface GmsApi extends FunderApi, FunderMoneyApi {
  me(): Promise<Me>;
  /** The workspace with this handle, if the caller is a member. Rejects with a 404 ApiError otherwise. */
  workspace(handle: string): Promise<Workspace>;

  // ---- public pages: no sign-in, published fields only ----
  publicFunder(handle: string): Promise<FunderPageData>;
  publicOpportunity(handle: string, slug: string): Promise<OpportunityPageData>;
  /** The CommonGrants competition, with the forms it pins. */
  publicCompetition(id: string): Promise<CgCompetition>;

  // ---- workspace setup ----
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceWrite>;
  workspaceRecord(id: string): Promise<WorkspaceRecord>;
  updateWorkspace(id: string, patch: { displayName?: string; brand?: Brand; settings?: Record<string, unknown> }): Promise<WorkspaceWrite>;
  listMembers(workspaceId: string): Promise<Member[]>;
  createInvitation(workspaceId: string, input: InvitationInput): Promise<Invitation>;
  passportStatus(workspaceId: string): Promise<PassportStatus>;
  linkPassport(workspaceId: string, input: { clientId: string; clientSecret: string }): Promise<PassportStatus>;
  unlinkPassport(workspaceId: string): Promise<{ linked: boolean }>;

  // ---- the routes below act in the workspace last opened with `workspace()` ----
  listPrograms(): Promise<Program[]>;
  createProgram(input: ProgramInput): Promise<Program>;
  updateProgram(id: string, patch: Partial<ProgramInput>): Promise<Program>;
  listRubrics(): Promise<Rubric[]>;
  createRubric(input: RubricInput): Promise<Rubric>;

  listOpportunities(filter?: { programId?: string; status?: OpportunityStatus }): Promise<Opportunity[]>;
  getOpportunity(id: string): Promise<Opportunity>;
  createOpportunity(input: OpportunityInput): Promise<Opportunity>;
  updateOpportunity(id: string, patch: Partial<OpportunityInput>): Promise<Opportunity>;
  publishOpportunity(id: string, status?: "forecasted" | "open"): Promise<Opportunity>;
  closeOpportunity(id: string): Promise<Opportunity>;
  previewOpportunity(id: string): Promise<OpportunityPreview>;

  listCompetitions(filter?: { opportunityId?: string }): Promise<Competition[]>;
  getCompetition(id: string): Promise<Competition>;
  createCompetition(input: CompetitionInput): Promise<Competition>;
  updateCompetition(id: string, patch: Partial<Omit<CompetitionInput, "opportunityId">>): Promise<Competition>;
  putStages(id: string, stages: Stage[]): Promise<Competition>;
  launchCheck(id: string): Promise<Checklist>;
  openCompetition(id: string): Promise<Competition>;
  closeCompetition(id: string): Promise<Competition>;

  listForms(): Promise<FormSummary[]>;
  listFormLibrary(): Promise<FormSummary[]>;
  /** The latest version unless `version` is given. */
  getForm(id: string, version?: number): Promise<FormRecord>;
  createForm(input: FormInput): Promise<FormRecord>;
  /** Edits the current draft version. Rejects with a 409 when the latest version is published. */
  updateForm(id: string, patch: FormPatch): Promise<FormRecord>;
  /** Starts the next draft from the latest published version. */
  createFormVersion(id: string): Promise<FormRecord>;
  publishForm(id: string): Promise<FormRecord>;
  testFillForm(id: string, opts?: { version?: number; seed?: number }): Promise<{ response: JsonObject }>;

  evaluateEligibility(input: EvaluateInput): Promise<Evaluation>;
}

/** An error answered by the API in the CommonGrants error shape (`{ status, message, errors }`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: unknown[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Envelope<T> {
  status: number;
  message: string;
  data: T;
}

/** Unwraps a CommonGrants success envelope or throws the CommonGrants error as an ApiError. */
export function unwrap<T>(result: { data?: Envelope<T> | undefined; error?: unknown; response: Response }): T {
  if (result.data && result.response.ok) return result.data.data;
  const e = (result.error ?? {}) as { message?: string; errors?: unknown[] };
  throw new ApiError(result.response.status, e.message ?? `Request failed (${result.response.status})`, e.errors ?? []);
}

export interface HttpApiOptions {
  baseUrl: string;
  /** Returns the current bearer token, or null when signed out. */
  token: () => Promise<string | null>;
  /** Display name for the signed-in person (the API does not hold profile names). */
  identity: () => Promise<{ email: string }>;
  fetch?: typeof fetch;
}

const DEFAULT_BRAND = { accent: "#1F6F8B", onAccent: "#FFFFFF" };

export function initialsOf(name: string): string {
  const parts = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

const ROLE_TITLES: Record<string, string> = {
  admin: "Admin",
  program_officer: "Program officer",
  finance: "Finance",
  reviewer: "Reviewer",
  external_reviewer: "External reviewer",
  observer: "Observer",
  auditor: "Auditor",
  editor: "Editor",
  viewer: "Viewer",
  consultant: "Consultant",
};
export const roleTitle = (role: string) => ROLE_TITLES[role] ?? role;

export function createHttpApi(opts: HttpApiOptions): GmsApi & { http: Client<paths> } {
  let workspaceId: string | null = null;
  const http = createClient<paths>({ baseUrl: opts.baseUrl, fetch: opts.fetch ?? ((input) => fetch(input)) });
  http.use({
    async onRequest({ request }) {
      const token = await opts.token();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      // A session bearer names its workspace per request; API clients and agents carry it in the token.
      if (workspaceId) request.headers.set("X-GMS-Workspace", workspaceId);
      return request;
    },
  });

  const me = async (): Promise<Me> => {
    const data: components["schemas"]["Models.Me"] = unwrap(await http.GET("/gms/me"));
    return {
      userId: data.userId,
      // The session holds the address; the API echoes it when the token carries one.
      email: data.email ?? (await opts.identity()).email,
      mfaVerified: data.mfaVerified,
      workspaces: data.workspaces.map((w) => ({ id: w.id, handle: w.handle, name: w.name, kind: w.kind, role: w.role, requiresMfa: w.requiresMfa })),
    };
  };

  // Routes whose spec models do not yet match what the Worker answers (see types.ts) go through
  // this call, typed by the shapes in types.ts. test/contract.test.ts holds them to the real Worker.
  async function call<T>(method: string, path: string, body?: unknown, list?: false): Promise<T>;
  async function call<T>(method: string, path: string, body: unknown, list: true): Promise<T[]>;
  async function call<T>(method: string, path: string, body?: unknown, list = false): Promise<T | T[]> {
    const token = await opts.token();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; items?: T[]; message?: string; errors?: unknown[] };
    if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
    return list ? (json.items ?? []) : (json.data as T);
  }
  const get = <T>(path: string) => call<T>("GET", path);
  const all = <T>(path: string) => call<T>("GET", path, undefined, true);
  const q = (params: Record<string, string | number | undefined>) => {
    const pairs = Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined);
    return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
  };
  const e = encodeURIComponent;

  return {
    http,
    ...createHttpFunderApi({ baseUrl: opts.baseUrl, fetch: opts.fetch, token: opts.token, workspaceId: () => workspaceId, fail: (status, message, errors) => new ApiError(status, message, errors) }),
    ...createHttpFunderMoneyApi({ baseUrl: opts.baseUrl, fetch: opts.fetch, token: opts.token, workspaceId: () => workspaceId, fail: (status, message, errors) => new ApiError(status, message, errors) }),
    me,
    publicFunder: (handle) => get(`/gms/public/funders/${e(handle)}`),
    publicOpportunity: (handle, slug) => get(`/gms/public/funders/${e(handle)}/opportunities/${e(slug)}`),
    publicCompetition: (id) => get(`/common-grants/competitions/${e(id)}`),

    createWorkspace: (input) => call("POST", "/gms/workspaces", input),
    workspaceRecord: (id) => get(`/gms/workspaces/${e(id)}`),
    updateWorkspace: (id, patch) => call("PATCH", `/gms/workspaces/${e(id)}`, patch),
    // The Worker answers the member list under `data`; the spec describes a paginated `items`. Read either.
    listMembers: async (id) => {
      const token = await opts.token();
      const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}/gms/workspaces/${e(id)}/members`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspaceId ? { "X-GMS-Workspace": workspaceId } : {}) } });
      const json = (await res.json().catch(() => ({}))) as { data?: Member[]; items?: Member[]; message?: string; errors?: unknown[] };
      if (!res.ok) throw new ApiError(res.status, json.message ?? `Request failed (${res.status})`, json.errors ?? []);
      return json.items ?? json.data ?? [];
    },
    createInvitation: (id, input) => call("POST", `/gms/workspaces/${e(id)}/invitations`, input),
    passportStatus: (id) => get(`/gms/workspaces/${e(id)}/passport/status`),
    linkPassport: (id, input) => call("POST", `/gms/workspaces/${e(id)}/passport/link`, input),
    unlinkPassport: (id) => call("DELETE", `/gms/workspaces/${e(id)}/passport/link`),

    listPrograms: () => all("/gms/programs?pageSize=100"),
    createProgram: (input) => call("POST", "/gms/programs", input),
    updateProgram: (id, patch) => call("PATCH", `/gms/programs/${e(id)}`, patch),
    listRubrics: () => all("/gms/rubrics"),
    createRubric: (input) => call("POST", "/gms/rubrics", input),

    listOpportunities: (filter = {}) => all(`/gms/opportunities${q({ pageSize: 100, ...filter })}`),
    getOpportunity: (id) => get(`/gms/opportunities/${e(id)}`),
    createOpportunity: (input) => call("POST", "/gms/opportunities", input),
    updateOpportunity: (id, patch) => call("PATCH", `/gms/opportunities/${e(id)}`, patch),
    publishOpportunity: (id, status) => call("POST", `/gms/opportunities/${e(id)}/publish`, status ? { status } : {}),
    closeOpportunity: (id) => call("POST", `/gms/opportunities/${e(id)}/close`, {}),
    previewOpportunity: (id) => call("POST", `/gms/opportunities/${e(id)}/preview`, {}),

    listCompetitions: (filter = {}) => all(`/gms/competitions${q(filter)}`),
    getCompetition: (id) => get(`/gms/competitions/${e(id)}`),
    createCompetition: (input) => call("POST", "/gms/competitions", input),
    updateCompetition: (id, patch) => call("PATCH", `/gms/competitions/${e(id)}`, patch),
    putStages: (id, stages) => call("PUT", `/gms/competitions/${e(id)}/stages`, { stages }),
    launchCheck: (id) => call("POST", `/gms/competitions/${e(id)}/launch-check`, {}),
    openCompetition: (id) => call("POST", `/gms/competitions/${e(id)}/open`, {}),
    closeCompetition: (id) => call("POST", `/gms/competitions/${e(id)}/close`, {}),

    listForms: () => all("/gms/forms?pageSize=100"),
    listFormLibrary: () => all("/gms/forms/library?pageSize=100"),
    getForm: (id, version) => get(`/gms/forms/${e(id)}${q({ version })}`),
    createForm: (input) => call("POST", "/gms/forms", input),
    updateForm: (id, patch) => call("PATCH", `/gms/forms/${e(id)}`, patch),
    createFormVersion: (id) => call("POST", `/gms/forms/${e(id)}/versions`, {}),
    publishForm: (id) => call("POST", `/gms/forms/${e(id)}/publish`, {}),
    testFillForm: (id, o = {}) => call("POST", `/gms/forms/${e(id)}/test-fill`, o),

    evaluateEligibility: (input) => call("POST", "/gms/eligibility/evaluate", input),

    async workspace(handle) {
      const [profile, who] = await Promise.all([me(), opts.identity()]);
      const membership = profile.workspaces.find((w) => w.handle === handle);
      if (!membership) throw new ApiError(404, "Workspace not found");
      workspaceId = membership.id;
      const ws: components["schemas"]["Models.Workspace"] = unwrap(
        await http.GET("/gms/workspaces/{id}", { params: { path: { id: membership.id } } }),
      );
      return {
        id: ws.id,
        handle: ws.handle,
        kind: ws.kind,
        name: ws.displayName,
        sub: ws.kind === "funder" ? "Funder workspace" : "Applicant workspace",
        brand: { accent: ws.brand?.accent ?? DEFAULT_BRAND.accent, onAccent: ws.brand?.onAccent ?? DEFAULT_BRAND.onAccent },
        member: { name: who.email, initials: initialsOf(who.email), title: roleTitle(membership.role) },
        // Counts arrive with the notifications and approvals routes (phases 2 and 5).
        unreadNotifications: 0,
        pendingApprovals: 0,
      };
    },
  };
}
