// SPDX-License-Identifier: AGPL-3.0-only
// The GMS scope vocabulary (build spec §9) and what each workspace role may do. A signed-in person
// gets the scopes of their role; a token gets the intersection of what it asked for, what its
// client is allowed, and (for delegated tokens) what the consenting person's role allows.

export const SCOPES = [
  "workspace:admin",
  "programs:read",
  "programs:write",
  "opportunities:read",
  "opportunities:write",
  "competitions:read",
  "competitions:write",
  "forms:read",
  "forms:write",
  "applications:read",
  "applications:write",
  "applications:submit",
  "reviews:read",
  "reviews:write",
  "decisions:write",
  "awards:read",
  "awards:write",
  "agreements:write",
  "payments:read",
  "payments:release",
  "requirements:read",
  "requirements:write",
  "grantees:read",
  "grantees:write",
  "messages:read",
  "messages:write",
  "communications:write",
  "analytics:read",
  "discovery",
  "library:read",
  "library:write",
  "org:read",
  "assist",
] as const;
export type Scope = (typeof SCOPES)[number];

/** What a dynamically registered client may ever ask for. Workspace administration stays with people and workspace API clients. */
export const DYNAMIC_CLIENT_SCOPES: string[] = SCOPES.filter((s) => s !== "workspace:admin");

/** Granted only by an explicit admin choice; lets a client skip human gates on MCP tools (§10.9). */
export const APPROVALS_BYPASS_SCOPE = "approvals:bypass";

export const isScope = (s: string): s is Scope => (SCOPES as readonly string[]).includes(s);

export function parseScopeString(raw: string | null | undefined): string[] {
  return raw ? [...new Set(raw.split(/\s+/).filter(Boolean))] : [];
}

export const WORKSPACE_CLAIM = "https://gms.opengrants.io/workspace_id";
export const ORG_ID_CLAIM = "https://commongrants.org/org_id";

export type WorkspaceKind = "funder" | "applicant";
export const FUNDER_ROLES = ["admin", "program_officer", "finance", "reviewer", "external_reviewer", "observer", "auditor"] as const;
export const APPLICANT_ROLES = ["admin", "editor", "finance", "viewer", "consultant"] as const;
export type FunderRole = (typeof FUNDER_ROLES)[number];
export type ApplicantRole = (typeof APPLICANT_ROLES)[number];

const READ_ALL_FUNDER: Scope[] = [
  "programs:read",
  "opportunities:read",
  "competitions:read",
  "forms:read",
  "applications:read",
  "reviews:read",
  "awards:read",
  "payments:read",
  "requirements:read",
  "grantees:read",
  "messages:read",
  "analytics:read",
  "org:read",
];

const FUNDER_ROLE_SCOPES: Record<FunderRole, readonly Scope[]> = {
  admin: SCOPES.filter((s) => s !== "applications:submit" && s !== "library:read" && s !== "library:write" && s !== "discovery"),
  program_officer: [
    ...READ_ALL_FUNDER,
    "programs:write",
    "opportunities:write",
    "competitions:write",
    "forms:write",
    "applications:write",
    "reviews:write",
    "decisions:write",
    "awards:write",
    "agreements:write",
    "requirements:write",
    "grantees:write",
    "messages:write",
    "communications:write",
    "assist",
  ],
  // Finance releases money but does not decide who gets it.
  finance: [...READ_ALL_FUNDER, "payments:release", "requirements:write", "messages:write"],
  reviewer: ["applications:read", "reviews:read", "reviews:write", "forms:read", "competitions:read", "opportunities:read", "messages:read", "assist"],
  // Row-level restrictions (assigned applications, masked fields) come from the membership `scope` column.
  external_reviewer: ["applications:read", "reviews:read", "reviews:write", "forms:read"],
  observer: READ_ALL_FUNDER,
  auditor: READ_ALL_FUNDER,
};

const READ_ALL_APPLICANT: Scope[] = ["applications:read", "awards:read", "requirements:read", "messages:read", "library:read", "org:read", "discovery", "forms:read", "opportunities:read", "competitions:read"];

const APPLICANT_ROLE_SCOPES: Record<ApplicantRole, readonly Scope[]> = {
  admin: [...READ_ALL_APPLICANT, "workspace:admin", "applications:write", "applications:submit", "awards:write", "agreements:write", "requirements:write", "messages:write", "library:write", "payments:read", "assist"],
  editor: [...READ_ALL_APPLICANT, "applications:write", "requirements:write", "messages:write", "library:write", "assist"],
  finance: [...READ_ALL_APPLICANT, "payments:read", "requirements:write", "messages:write"],
  viewer: READ_ALL_APPLICANT,
  consultant: ["applications:read", "applications:write", "library:read", "forms:read", "messages:read", "assist"],
};

export function scopesForRole(kind: WorkspaceKind, role: string): readonly Scope[] {
  const table: Record<string, readonly Scope[]> = kind === "funder" ? FUNDER_ROLE_SCOPES : APPLICANT_ROLE_SCOPES;
  return table[role] ?? [];
}

/** TOTP MFA is required for funder admin and finance, and for applicant admin (build spec §4). */
export function roleRequiresMfa(kind: WorkspaceKind, role: string): boolean {
  return kind === "funder" ? role === "admin" || role === "finance" : role === "admin";
}

/** Roles that may read the workspace ledger. */
export const LEDGER_ROLES: readonly string[] = ["admin", "auditor"];

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "workspace:admin": "Manage workspace settings, members, integrations and exports",
  "programs:read": "Read programs",
  "programs:write": "Create and edit programs",
  "opportunities:read": "Read opportunities, including drafts",
  "opportunities:write": "Create, edit and publish opportunities",
  "competitions:read": "Read competitions and stages",
  "competitions:write": "Create, edit, open and close competitions",
  "forms:read": "Read forms",
  "forms:write": "Create, edit and publish forms",
  "applications:read": "Read applications",
  "applications:write": "Edit applications: fill forms, tag, assign, advance, request revisions",
  "applications:submit": "Submit applications (asks a person to approve when used by an agent)",
  "reviews:read": "Read review assignments and scores",
  "reviews:write": "Assign reviewers and score applications",
  "decisions:write": "Propose and commit decisions (commit asks a person to approve when used by an agent)",
  "awards:read": "Read awards",
  "awards:write": "Manage the award lifecycle and amendments",
  "agreements:write": "Prepare and send agreements (signing is always done by a person)",
  "payments:read": "Read payment schedules, readiness and status. Bank name and last four digits only",
  "payments:release": "Release tranches through Passport (asks a person to approve when used by an agent)",
  "requirements:read": "Read requirements and submitted reports",
  "requirements:write": "Create requirements; draft, submit and review reports",
  "grantees:read": "Read the grantee directory",
  "grantees:write": "Edit grantee notes and propose organization changes",
  "messages:read": "Read message threads and tasks",
  "messages:write": "Post messages and manage tasks",
  "communications:write": "Send templated letters and email (asks a person to approve when used by an agent)",
  "analytics:read": "Read portfolio and cycle analytics",
  discovery: "Search for funding with your organization's context",
  "library:read": "Read the answer library",
  "library:write": "Save and edit answers in the library",
  "org:read": "Read the organization profile as cached from Passport",
  assist: "Use the drafting assistant",
};

/** MCP tools that return `pending_approval` unless the token carries `approvals:bypass` (§10.9). */
// One list: the dispatcher in `@gms/mcp` enforces it, and the consent screen and agent docs show it.
export { DEFAULT_GATED_TOOLS } from "@gms/mcp";
