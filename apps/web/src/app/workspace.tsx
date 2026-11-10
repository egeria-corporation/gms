// SPDX-License-Identifier: AGPL-3.0-only
// Workspace context: which workspace the URL names, its kind, brand and the signed-in member.
// Until the API client lands (phase 2) this reads the fixture workspaces that mirror supabase/seed.sql.
import { createContext, useContext, type ReactNode } from "react";
import { useParams } from "react-router";

export type WorkspaceKind = "funder" | "applicant";

export interface Workspace {
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

export const FIXTURE_WORKSPACES: Workspace[] = [
  {
    handle: "riverbend",
    kind: "funder",
    name: "Riverbend Community Foundation",
    sub: "Funder workspace · FY2027",
    brand: { accent: "#1F6F8B", onAccent: "#FFFFFF" },
    member: { name: "Dana Ortiz", initials: "DO", title: "Program officer" },
    unreadNotifications: 3,
    pendingApprovals: 1,
  },
  {
    handle: "cascade-county",
    kind: "funder",
    name: "Cascade County Health Department",
    sub: "Funder workspace · FY2027",
    brand: { accent: "#7A4F01", onAccent: "#FFFFFF" },
    member: { name: "Dana Ortiz", initials: "DO", title: "Grants office" },
    unreadNotifications: 0,
    pendingApprovals: 0,
  },
  {
    handle: "alder-creek",
    kind: "applicant",
    name: "Alder Creek Family Services",
    sub: "Applicant workspace",
    brand: { accent: "#1F6F8B", onAccent: "#FFFFFF" },
    member: { name: "Maria Santos", initials: "MS", title: "Executive Director" },
    unreadNotifications: 2,
    pendingApprovals: 0,
  },
];

const DEFAULT_BY_KIND: Record<WorkspaceKind, Workspace> = {
  funder: FIXTURE_WORKSPACES[0]!,
  applicant: FIXTURE_WORKSPACES[2]!,
};

const WorkspaceContext = createContext<Workspace | null>(null);

export function findWorkspace(handle: string | undefined): Workspace | undefined {
  return FIXTURE_WORKSPACES.find((w) => w.handle === handle);
}

/** Provides the workspace named by the `:ws` route param. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { ws } = useParams();
  return <WorkspaceContext.Provider value={findWorkspace(ws) ?? null}>{children}</WorkspaceContext.Provider>;
}

/** The current workspace; screens outside `/w/:ws` fall back to the member's default of that kind. */
export function useWorkspace(kind: WorkspaceKind): Workspace {
  const current = useContext(WorkspaceContext);
  return current && current.kind === kind ? current : DEFAULT_BY_KIND[kind];
}

export function useCurrentWorkspace(): Workspace | null {
  return useContext(WorkspaceContext);
}
