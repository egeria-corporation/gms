// SPDX-License-Identifier: AGPL-3.0-or-later
// B-04 Applicant dashboard (states: new user; multiple orgs).
import { formatInZone, relativeTime } from '@gms/domain';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, DeadlineChip, EmptyState, PageHeader, StatusChip } from '@gms/ui';
import { Bot, Building2, FilePlus2, MessageSquareWarning } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth';
import { myApplications, myPendingApprovals, myReports } from '@/lib/portal-data';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'My applications' };

export default async function PortalHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireViewer()]);
  const state = forcedState(await searchParams);
  const [apps, approvals, reports] = await Promise.all([myApplications(tenant.id), myPendingApprovals(viewer.userId, tenant.id), myReports(tenant.id)]);
  const orgs = state === 'new-user' ? [] : viewer.orgs;
  const firstName = viewer.name.split(' ')[0];

  return (
    <div className="grid gap-8 pb-12">
      <PageHeader
        density="spacious"
        title={`Welcome${orgs.length ? ` back, ${firstName}` : ''}`}
        description={orgs.length ? 'Here’s where your applications and grants stand.' : 'Let’s get you set up so you can apply.'}
        actions={
          <Button asChild size="lg">
            <Link href="/opportunities">
              <FilePlus2 aria-hidden="true" /> Find funding
            </Link>
          </Button>
        }
      />

      {!orgs.length ? (
        <Card className="border-brand-200 bg-brand-50">
          <CardHeader>
            <CardTitle as="h2" className="font-heading text-xl">
              First, tell us about your organization
            </CardTitle>
            <CardDescription className="text-foreground/80">
              It takes about three minutes. If you’re a 501(c)(3), enter your EIN and we’ll fill in what we can. Applying as a fiscally sponsored project? That works too.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild size="lg">
              <Link href="/portal/org/new">
                <Building2 aria-hidden="true" /> Set up my organization
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ) : orgs.length > 1 ? (
        <p className="text-sm text-muted-foreground">
          You belong to {orgs.length} organizations: {orgs.map((o) => o.legalName).join(', ')}. Applications from all of them are listed here.
        </p>
      ) : null}

      {approvals.length ? (
        <section aria-labelledby="approvals-h" className="grid gap-3">
          <h2 id="approvals-h" className="flex items-center gap-2 font-heading text-xl font-semibold">
            <Bot aria-hidden="true" className="size-5" /> Waiting for your confirmation
          </h2>
          <ul className="grid gap-3">
            {approvals.map((a) => {
              const p = a.preview as { title?: string; summary?: string };
              return (
                <li key={a.id}>
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip kind="agentAction" value="awaiting_confirmation" />
                        <span className="text-sm text-muted-foreground">Expires {relativeTime(a.expires_at)}</span>
                      </div>
                      <CardTitle as="h3" className="text-base">
                        {p.title ?? a.action_id}
                      </CardTitle>
                      <CardDescription>
                        {a.requester_name} asked to do this for you. Nothing happens until you confirm.
                      </CardDescription>
                    </CardHeader>
                    <CardFooter>
                      <Button asChild>
                        <Link href={`/portal/confirm/${a.id}`}>Review and decide</Link>
                      </Button>
                    </CardFooter>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="apps-h" className="grid gap-3">
        <h2 id="apps-h" className="font-heading text-xl font-semibold">
          Applications
        </h2>
        {apps.length && state !== 'new-user' ? (
          <ul className="grid gap-3">
            {apps.map((a) => (
              <li key={a.id}>
                <Card className="relative">
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip kind="application" value={a.status} />
                      {a.info_requested_at ? (
                        <Badge variant="warning">
                          <MessageSquareWarning aria-hidden="true" /> Information requested
                        </Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">{a.reference_number}</span>
                    </div>
                    <CardTitle as="h3" className="text-lg">
                      <Link className="after:absolute after:inset-0" href={a.status === 'in_progress' ? `/portal/applications/${a.id}/form` : `/portal/applications/${a.id}`}>
                        {a.title ?? a.opportunity_title}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      {a.opportunity_title} · {a.stage_name}
                      {a.org_name ? ` · ${a.org_name}` : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                    {a.status === 'in_progress' && a.closes_at ? <DeadlineChip at={a.closes_at} timeZone={tenant.timezone} label="Due" /> : null}
                    {a.submitted_at ? <span className="text-muted-foreground">Submitted {formatInZone(a.submitted_at, tenant.timezone)}</span> : <span className="text-muted-foreground">Last saved {relativeTime(a.last_modified_at)}</span>}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No applications yet"
            description="When you start one, it shows up here. Your work saves as you go, so you can come back anytime."
            action={
              <Button asChild>
                <Link href="/opportunities">Browse opportunities</Link>
              </Button>
            }
          />
        )}
      </section>

      {reports.length ? (
        <section aria-labelledby="reports-h" className="grid gap-3">
          <h2 id="reports-h" className="font-heading text-xl font-semibold">
            Grant reports
          </h2>
          <ul className="grid gap-2">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
                <div className="grid">
                  <Link className="font-medium text-link underline underline-offset-2" href={`/portal/grants/${r.award_id}/reports/${r.id}`}>
                    {r.title}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {r.award_title} · {r.reference}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip kind="report" value={r.status} />
                  <DeadlineChip at={`${r.due_date}T23:59:00`} timeZone={tenant.timezone} label="Due" hideExact />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state === 'error' ? <Alert variant="danger" title="We couldn’t load everything">Refresh the page. If it keeps happening, email us.</Alert> : null}
    </div>
  );
}
