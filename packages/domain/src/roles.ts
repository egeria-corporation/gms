// SPDX-License-Identifier: AGPL-3.0-or-later
// Workspace roles, applicant org roles, agent scopes, and risk tiers.

export const WORKSPACE_ROLES = ['owner', 'admin', 'program_officer', 'finance', 'reviewer', 'board', 'auditor'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  program_officer: 'Program officer',
  finance: 'Finance',
  reviewer: 'Reviewer',
  board: 'Board member',
  auditor: 'Auditor (read-only)',
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: 'Everything, including billing and deleting the workspace.',
  admin: 'Everything except transferring ownership.',
  program_officer: 'Programs, opportunities, forms, applications, review, awards and reports.',
  finance: 'Bank connections, payees, payment batches, approvals and reconciliation.',
  reviewer: 'Only the applications assigned to them, after a conflict-of-interest check.',
  board: 'Published dockets and voting.',
  auditor: 'Read-only access to everything, including the audit log.',
};

export const STAFF_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer', 'finance', 'auditor'];
export const PROGRAM_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer'];
export const FINANCE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'finance'];
export const FINANCE_READ_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'finance', 'auditor'];
export const ADMIN_ROLES: readonly WorkspaceRole[] = ['owner', 'admin'];
/** Roles that must use TOTP MFA. */
export const MFA_REQUIRED_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer', 'finance', 'auditor'];

export type OrgRole = 'org_admin' | 'collaborator';

export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3';
export const RISK_TIER_LABELS: Record<RiskTier, string> = {
  R0: 'Read',
  R1: 'Reversible change',
  R2: 'Consequential: a person confirms',
  R3: 'People only',
};

export const TIER_ORDER: Record<RiskTier, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };

export function maxTier(a: RiskTier, b: RiskTier): RiskTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

/** OAuth / PAT scopes. There is deliberately no scope that grants an R3 action. */
export const SCOPES = {
  'opportunities:read': { label: 'See published funding opportunities', audience: 'public' },
  'profile:read': { label: 'See your organization profile', audience: 'applicant' },
  'profile:write': { label: 'Update your organization profile', audience: 'applicant' },
  'applications:read': { label: 'See your applications and their status', audience: 'applicant' },
  'applications:write': { label: 'Start applications and save answers (drafts only)', audience: 'applicant' },
  'applications:submit': { label: 'Ask to submit applications (you always confirm first)', audience: 'applicant' },
  'reports:write': { label: 'Draft grant reports (you confirm before they are submitted)', audience: 'applicant' },
  'messages:read': { label: 'Read messages from the foundation', audience: 'applicant' },
  'messages:write': { label: 'Draft messages to the foundation', audience: 'applicant' },
  'pipeline:read': { label: 'Read the application pipeline', audience: 'staff' },
  'reviews:write': { label: 'Draft review assignments and scores', audience: 'staff' },
  'awards:draft': { label: 'Draft awards (a person finalizes them)', audience: 'staff' },
  'payments:read': { label: 'Read payment status', audience: 'staff' },
  'payments:propose': { label: 'Propose payment batches (a person approves them)', audience: 'staff' },
  'analytics:read': { label: 'Read analytics and run reports', audience: 'staff' },
  'messages:send': { label: 'Send messages (a person confirms bulk sends)', audience: 'staff' },
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];
export const APPLICANT_SCOPES = ALL_SCOPES.filter((s) => SCOPES[s].audience !== 'staff');
export const STAFF_SCOPES = ALL_SCOPES.filter((s) => SCOPES[s].audience !== 'applicant');

export function isScope(s: string): s is Scope {
  return s in SCOPES;
}

export function parseScopes(raw: string | readonly string[] | null | undefined): Scope[] {
  const list = typeof raw === 'string' ? raw.split(/[\s,]+/) : (raw ?? []);
  return [...new Set(list.map((s) => s.trim()).filter(isScope))];
}
