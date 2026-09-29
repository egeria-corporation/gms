// SPDX-License-Identifier: AGPL-3.0-or-later
// Session + viewer for the current request. Sessions come from the AuthAdapter (Supabase Auth, or the
// TestAuthAdapter in GMS_AUTH_MODE=test); RLS claims come only from a verified session.
import 'server-only';
import { getRuntime } from '@gms/actions';
import type { CookieJar, Session } from '@gms/adapters';
import { ANON_CLAIMS, type RequestClaims } from '@gms/db';
import { MFA_REQUIRED_ROLES, type WorkspaceRole } from '@gms/domain';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getTenant, requestMeta } from './tenant';

export async function cookieJar(): Promise<CookieJar> {
  const c = await cookies();
  const secure = process.env.NODE_ENV === 'production' && !/localhost/.test(process.env.GMS_ROOT_DOMAIN ?? 'localhost');
  return {
    get: (name) => c.get(name)?.value,
    getAll: () => c.getAll().map((x) => ({ name: x.name, value: x.value })),
    set: (name, value, opts) => {
      try {
        c.set(name, value, { ...opts, secure: opts.secure ?? secure });
      } catch {
        /* read-only in Server Components; cookies are written in actions and route handlers */
      }
    },
    delete: (name) => {
      try {
        c.delete(name);
      } catch {
        /* read-only context */
      }
    },
  };
}

export const getSession = cache(async (): Promise<Session | null> => {
  // Read the request cookies first: that marks the route dynamic, so the auth adapter is never built during a
  // static prerender (where no request, and possibly no auth configuration, exists).
  const jar = await cookieJar();
  return getRuntime().adapters.auth.getSession(jar);
});

export interface Membership {
  workspaceId: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  mfaRequired: boolean;
}

export interface OrgMembership {
  orgId: string;
  legalName: string;
  role: 'org_admin' | 'collaborator';
  einVerified: boolean;
}

export interface Viewer {
  session: Session;
  userId: string;
  email: string;
  name: string;
  memberships: Membership[];
  orgs: OrgMembership[];
  /** Role in the current tenant (one role per membership). */
  role: WorkspaceRole | null;
  roles: WorkspaceRole[];
  isOperator: boolean;
  hasVerifiedFactor: boolean;
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await getSession();
  if (!session) return null;
  const db = getRuntime().db;
  const [profile, memberships, orgs, operator] = await Promise.all([
    db.selectFrom('profiles').select(['full_name', 'email']).where('id', '=', session.userId).executeTakeFirst(),
    db
      .selectFrom('workspace_members as m')
      .innerJoin('workspaces as w', 'w.id', 'm.workspace_id')
      .select(['m.workspace_id', 'w.slug', 'w.name', 'm.role', 'm.mfa_required'])
      .where('m.user_id', '=', session.userId)
      .where('m.status', '=', 'active')
      .execute(),
    db
      .selectFrom('applicant_org_members as m')
      .innerJoin('applicant_orgs as o', 'o.id', 'm.org_id')
      .select(['m.org_id', 'o.legal_name', 'm.role', 'o.ein_verified_at'])
      .where('m.user_id', '=', session.userId)
      .orderBy('o.legal_name')
      .execute(),
    db.selectFrom('platform_operators').select('user_id').where('user_id', '=', session.userId).executeTakeFirst(),
  ]);
  const tenant = await getTenant();
  const mine = memberships.find((m) => m.workspace_id === tenant?.id);
  const factors = await getRuntime().adapters.auth.listFactors(await cookieJar());
  return {
    session,
    userId: session.userId,
    email: session.email,
    name: profile?.full_name || session.email,
    memberships: memberships.map((m) => ({ workspaceId: m.workspace_id, slug: m.slug, name: m.name, role: m.role as WorkspaceRole, mfaRequired: m.mfa_required })),
    orgs: orgs.map((o) => ({ orgId: o.org_id, legalName: o.legal_name, role: o.role as 'org_admin' | 'collaborator', einVerified: Boolean(o.ein_verified_at) })),
    role: (mine?.role as WorkspaceRole | undefined) ?? null,
    roles: mine ? [mine.role as WorkspaceRole] : [],
    isOperator: Boolean(operator),
    hasVerifiedFactor: factors.some((f) => f.status === 'verified'),
  };
});

export async function claims(): Promise<RequestClaims> {
  const s = await getSession();
  return s ? { ...s.claims } : ANON_CLAIMS;
}

/** Redirects to sign-in when there is no session. */
export async function requireViewer(next?: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v) {
    const meta = await requestMeta();
    redirect(`/portal/sign-in?next=${encodeURIComponent(next ?? meta.pathname)}`);
  }
  return v;
}

const STAFF: readonly WorkspaceRole[] = ['owner', 'admin', 'program_officer', 'finance', 'auditor'];

/**
 * Staff console guard: a member with a staff role in this tenant. Staff roles must use TOTP MFA:
 * enroll first, then verify each session (aal2) before the console opens.
 */
export async function requireStaff(roles: readonly WorkspaceRole[] = STAFF): Promise<Viewer> {
  const meta = await requestMeta();
  const v = await requireViewer(meta.pathname);
  if (!v.role || !roles.includes(v.role)) redirect('/console/denied');
  const member = v.memberships.find((m) => m.role === v.role);
  const mfaNeeded = MFA_REQUIRED_ROLES.includes(v.role) && (member?.mfaRequired ?? true);
  if (mfaNeeded && v.session.aal !== 'aal2') {
    redirect(`/console/mfa?next=${encodeURIComponent(meta.pathname)}`);
  }
  return v;
}

export async function requireMember(roles: readonly WorkspaceRole[]): Promise<Viewer> {
  const meta = await requestMeta();
  const v = await requireViewer(meta.pathname);
  if (!v.role || !roles.includes(v.role)) redirect(roles.includes('reviewer') ? '/review/denied' : '/console/denied');
  return v;
}
