// SPDX-License-Identifier: AGPL-3.0-or-later
// Invitation acceptance (from the staff_invite email): requires sign-in, shows what you're joining, accepts
// via team.accept_invite, then redirects to the console (reviewers → /review, board → /board) (states: invalid).
import { createHash } from 'node:crypto';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type WorkspaceRole } from '@gms/domain';
import { Alert, Card, CardContent, CardDescription, CardHeader, PoweredByFooter } from '@gms/ui';
import type { Metadata } from 'next';
import { requireViewer } from '@/lib/auth';
import { BrandStyle } from '@/lib/brand-style';
import { rls } from '@/lib/server/db';
import { forcedState, one, poweredBy } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';
import { AcceptForm } from './accept-form';

export const metadata: Metadata = { title: 'Join the team', robots: { index: false } };

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const sp = await searchParams;
  const token = one(sp.token) ?? '';
  const viewer = await requireViewer(`/invite/accept?token=${encodeURIComponent(token)}`);
  const forced = forcedState(sp);
  // The invitee can read their own pending invitation under RLS (matched by email); look it up by token hash.
  const invitation =
    token.length >= 10 && forced !== 'invalid'
      ? await rls((trx) =>
          trx
            .selectFrom('invitations as i')
            .select(['i.role', 'i.expires_at', 'i.status', 'i.email'])
            .where('i.token_hash', '=', createHash('sha256').update(token).digest('hex'))
            .where('i.workspace_id', '=', tenant.id)
            .executeTakeFirst(),
        )
      : undefined;
  const valid = invitation && invitation.status === 'pending' && new Date(invitation.expires_at) > new Date();
  const role = invitation?.role as WorkspaceRole | undefined;
  return (
    <>
      <BrandStyle tenant={tenant} scope="branded" />
      <main id="main" className="mx-auto grid min-h-dvh w-full max-w-lg content-center gap-6 px-4 py-10">
        <Card>
          <CardHeader>
            <h1 className="font-heading text-2xl font-semibold leading-tight">
              {valid ? `Join ${tenant.brand.displayName}` : 'This invitation can’t be used'}
            </h1>
            <CardDescription>Signed in as {viewer.email}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {valid && role ? (
              <>
                <p>
                  You’ve been invited to the {tenant.brand.displayName} grants team as <strong>{ROLE_LABELS[role]}</strong>. {ROLE_DESCRIPTIONS[role]}
                </p>
                {['owner', 'admin', 'program_officer', 'finance', 'auditor'].includes(role) ? (
                  <p className="text-sm text-muted-foreground">Staff accounts use an authenticator app. We’ll help you set one up right after you join.</p>
                ) : null}
                <AcceptForm token={token} joinLabel={`Join as ${ROLE_LABELS[role].toLowerCase()}`} />
              </>
            ) : (
              <Alert variant="warning" title="Not valid, expired, or for a different email address">
                <p>
                  Invitations work once, for 14 days, and only for the email address they were sent to. You’re signed in as <strong>{viewer.email}</strong>.
                </p>
                <p className="mt-2">Ask the person who invited you to send a new invitation, or sign out and sign in with the invited address.</p>
                <form action="/auth/sign-out" method="post" className="mt-3">
                  <button type="submit" className="text-sm font-medium underline">
                    Sign out
                  </button>
                </form>
              </Alert>
            )}
          </CardContent>
        </Card>
        <PoweredByFooter {...poweredBy()} />
      </main>
    </>
  );
}
