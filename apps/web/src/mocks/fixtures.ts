// SPDX-License-Identifier: AGPL-3.0-only
// Fixture workspaces and members for mock mode. Names, handles and accents mirror supabase/seed.sql.
import type { MeWorkspace, Workspace } from "../api/client.ts";

export const MOCK_USER = { userId: "10000000-0000-4000-8000-000000000001", email: "dana.ortiz@riverbendcf.example" };

export const FIXTURE_WORKSPACES: Workspace[] = [
  {
    id: "20000000-0000-7000-8000-000000000001",
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
    id: "20000000-0000-7000-8000-000000000002",
    handle: "cascade-county",
    kind: "funder",
    name: "Cascade County Health Department",
    sub: "Funder workspace · FY2027",
    brand: { accent: "#7A4F01", onAccent: "#FFFFFF" },
    member: { name: "Dana Ortiz", initials: "DO", title: "Reviewer" },
    unreadNotifications: 0,
    pendingApprovals: 0,
  },
  {
    id: "20000000-0000-7000-8000-000000000011",
    handle: "alder-creek",
    kind: "applicant",
    name: "Alder Creek Family Services",
    sub: "Applicant workspace",
    brand: { accent: "#1F6F8B", onAccent: "#FFFFFF" },
    member: { name: "Maria Santos", initials: "MS", title: "Executive Director" },
    unreadNotifications: 2,
    pendingApprovals: 0,
  },
  {
    id: "20000000-0000-7000-8000-000000000012",
    handle: "harbor-light",
    kind: "applicant",
    name: "Harbor Light Shelter",
    sub: "Applicant workspace",
    brand: { accent: "#1F6F8B", onAccent: "#FFFFFF" },
    member: { name: "Tomas Reyes", initials: "TR", title: "Director of Operations" },
    unreadNotifications: 0,
    pendingApprovals: 0,
  },
];

/** The demo person's memberships: one account, a funder workspace and an applicant workspace. */
export const MOCK_MEMBERSHIPS: MeWorkspace[] = [
  {
    id: FIXTURE_WORKSPACES[0]!.id,
    handle: "riverbend",
    name: FIXTURE_WORKSPACES[0]!.name,
    kind: "funder",
    role: "admin",
    requiresMfa: true,
  },
  {
    id: FIXTURE_WORKSPACES[2]!.id,
    handle: "alder-creek",
    name: FIXTURE_WORKSPACES[2]!.name,
    kind: "applicant",
    role: "admin",
    requiresMfa: true,
  },
  {
    id: FIXTURE_WORKSPACES[1]!.id,
    handle: "cascade-county",
    name: FIXTURE_WORKSPACES[1]!.name,
    kind: "funder",
    role: "reviewer",
    requiresMfa: false,
  },
];
