// SPDX-License-Identifier: AGPL-3.0-only
// The API port the web app talks to. `createHttpApi` calls the GMS Worker with the typed client
// generated from the TypeSpec document (`pnpm --filter @gms/web gen:api`); `createMockApi`
// (mocks/api.ts) implements the same interface in the browser.
import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./schema.d.ts";

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

export interface GmsApi {
  me(): Promise<Me>;
  /** The workspace with this handle, if the caller is a member. Rejects with a 404 ApiError otherwise. */
  workspace(handle: string): Promise<Workspace>;
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

  // `/gms/me` is served by the Worker but is not in the TypeSpec document yet, so it is typed here.
  const me = async (): Promise<Me> => {
    const token = await opts.token();
    const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}/gms/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = (await res.json().catch(() => ({}))) as Partial<
      Envelope<Omit<Me, "workspaces"> & { workspaces: Array<Omit<MeWorkspace, "handle"> & { handle?: string }> }>
    > & {
      message?: string;
      errors?: unknown[];
    };
    if (!res.ok || !body.data) throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`, body.errors ?? []);
    return { ...body.data, workspaces: body.data.workspaces.map((w) => ({ ...w, handle: w.handle ?? w.id })) };
  };

  return {
    http,
    me,
    async workspace(handle) {
      const [profile, who] = await Promise.all([me(), opts.identity()]);
      const membership = profile.workspaces.find((w) => w.handle === handle || w.id === handle);
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
