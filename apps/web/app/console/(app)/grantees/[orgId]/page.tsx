// SPDX-License-Identifier: AGPL-3.0-or-later
// C-08 Grantee detail (CRM): profile, relationship timeline (applications, decisions, awards, payments,
// reports, messages, site visits), diligence summary, contacts, internal notes, site visits, and the
// relationship profile editor (tags, owner, summary).
// Supported `?state=` values (non-production): empty (a brand-new relationship: no history), not-found.
import { sql } from '@gms/db';
import { APPLICATION_STATUS, formatDateOnly, formatInZone, type ApplicationStatus } from '@gms/domain';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionList,
  MoneyDisplay,
  NotFoundState,
  PageHeader,
  Section,
  StatTile,
  StatusChip,
} from '@gms/ui';
import { Banknote, ClipboardCheck, FileText, Gavel, HandCoins, Mail, MapPin, Send, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NoteComposer } from '@/components/console/grantmaking/applications/note-composer';
import { GranteeProfileEditor, SiteVisitDialog } from '@/components/console/grantmaking/grantees/grantee-forms';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { isUuid, teamMembers, type SearchParams } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Grantee' };

interface TimelineItem {
  key: string;
  at: string;
  /** DATE-only values are formatted without timezone shifts. */
  dateOnly?: boolean;
  icon: ReactNode;
  text: ReactNode;
  status?: ReactNode;
}

function notFoundView() {
  return (
    <div className="grid gap-4">
      <PageHeader title="Organization not found" linkComponent={NextLink} breadcrumbs={[{ label: 'Grantees', href: '/console/grantees' }, { label: 'Not found' }]} />
      <NotFoundState
        title="We couldn’t find that organization"
        description="It hasn’t applied to this workspace, or the link is wrong."
        action={
          <Button asChild size="sm">
            <Link href="/console/grantees">Back to grantees</Link>
          </Button>
        }
      />
    </div>
  );
}

const ic = 'size-4';

export default async function GranteeDetailPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff()]);
  const { orgId } = await params;
  const forced = forcedState(await searchParams);
  if (forced === 'not-found' || !isUuid(orgId)) return notFoundView();
  const ws = tenant.id;
  const tz = tenant.timezone;
  const canEdit = Boolean(viewer.role && ['owner', 'admin', 'program_officer'].includes(viewer.role));
  const canNote = Boolean(viewer.role && ['owner', 'admin', 'program_officer', 'finance'].includes(viewer.role));

  const data = await rls(async (trx) => {
    const apps = await trx
      .selectFrom('applications as a')
      .innerJoin('opportunities as o', 'o.id', 'a.opportunity_id')
      .select(['a.id', 'a.reference_number', 'a.title', 'a.status', 'a.created_at', 'a.submitted_at', 'a.requested_amount_cents', 'a.currency', 'a.submitted_via', 'o.title as opp_title'])
      .where('a.workspace_id', '=', ws)
      .where('a.applicant_org_id', '=', orgId)
      .orderBy('a.created_at', 'desc')
      .execute();
    if (!apps.length) return null;
    const org = await trx.selectFrom('applicant_orgs').selectAll().where('id', '=', orgId).executeTakeFirst();
    if (!org) return null;
    const appIds = apps.map((a) => a.id);
    const [addresses, awards, decisions, contacts, notes, visits, diligence, screenings, profile, threads, team] = await Promise.all([
      trx.selectFrom('org_addresses').select(['id', 'kind', 'line1', 'line2', 'city', 'state', 'postal_code', 'county']).where('org_id', '=', orgId).orderBy('created_at').execute(),
      trx
        .selectFrom('awards')
        .select(['id', 'reference', 'title', 'amount_cents', 'currency', 'status', 'start_date', 'end_date', 'created_at', 'disbursed_cents', 'kind'])
        .where('workspace_id', '=', ws)
        .where('applicant_org_id', '=', orgId)
        .orderBy('created_at', 'desc')
        .execute(),
      trx.selectFrom('decisions').select(['id', 'application_id', 'outcome', 'recorded_at']).where('workspace_id', '=', ws).where('application_id', 'in', appIds).where('is_final', '=', true).execute(),
      trx
        .selectFrom('applicant_org_members as m')
        .innerJoin('profiles as p', 'p.id', 'm.user_id')
        .select(['m.id', 'm.role', 'm.title', 'p.full_name', 'p.email'])
        .where('m.org_id', '=', orgId)
        .orderBy('p.full_name')
        .execute(),
      trx
        .selectFrom('internal_notes as n')
        .leftJoin('profiles as p', 'p.id', 'n.author_id')
        .select(['n.id', 'n.body', 'n.created_at', 'p.full_name'])
        .where('n.workspace_id', '=', ws)
        .where('n.entity_type', '=', 'org')
        .where('n.entity_id', '=', orgId)
        .orderBy('n.created_at', 'desc')
        .execute(),
      trx
        .selectFrom('site_visits as v')
        .leftJoin('profiles as p', 'p.id', 'v.visited_by')
        .leftJoin('awards as aw', 'aw.id', 'v.award_id')
        .select(['v.id', 'v.visited_on', 'v.summary', 'v.follow_ups', 'p.full_name', 'aw.reference as award_ref'])
        .where('v.workspace_id', '=', ws)
        .where('v.applicant_org_id', '=', orgId)
        .orderBy('v.visited_on', 'desc')
        .execute(),
      trx.selectFrom('diligence_checks').select(['id', 'kind', 'status', 'checked_at', 'note']).where('workspace_id', '=', ws).where('applicant_org_id', '=', orgId).orderBy('checked_at', 'desc').limit(20).execute(),
      trx.selectFrom('sanctions_screenings').select(['id', 'status', 'best_score', 'query_name', 'created_at']).where('workspace_id', '=', ws).where('applicant_org_id', '=', orgId).orderBy('created_at', 'desc').limit(10).execute(),
      sql<{ tags: string[]; relationship_owner_id: string | null; summary: string | null }>`
        select tags, relationship_owner_id, summary from public.grantee_profiles
        where workspace_id = ${ws}::uuid and applicant_org_id = ${orgId}::uuid`.execute(trx),
      trx.selectFrom('threads').select(['id', 'application_id', 'subject']).where('workspace_id', '=', ws).where('application_id', 'in', appIds).execute(),
      teamMembers(trx, ws, ['owner', 'admin', 'program_officer', 'finance']),
    ]);
    const awardIds = awards.map((a) => a.id);
    const threadIds = threads.map((t) => t.id);
    const [payments, reports, messages] = await Promise.all([
      // Finance-readable only: program officers get no rows under RLS, which is fine.
      awardIds.length
        ? trx.selectFrom('payments').select(['id', 'award_id', 'amount_cents', 'currency', 'status', 'sent_at', 'created_at']).where('award_id', 'in', awardIds).orderBy('created_at', 'desc').execute()
        : Promise.resolve([]),
      awardIds.length
        ? trx
            .selectFrom('report_requirements as r')
            .leftJoin('report_submissions as s', 's.requirement_id', 'r.id')
            .select(['r.id', 'r.award_id', 'r.title', 'r.due_date', 'r.status', 's.id as submission_id', 's.submitted_at'])
            .where('r.award_id', 'in', awardIds)
            .orderBy('r.due_date', 'desc')
            .execute()
        : Promise.resolve([]),
      threadIds.length
        ? trx.selectFrom('messages').select(['id', 'thread_id', 'author_side', 'created_at']).where('thread_id', 'in', threadIds).orderBy('created_at', 'desc').limit(30).execute()
        : Promise.resolve([]),
    ]);
    return { apps, org, addresses, awards, decisions, contacts, notes, visits, diligence, screenings, profile: profile.rows[0] ?? null, threads, team, payments, reports, messages };
  });
  if (!data) return notFoundView();
  const { org } = data;
  const name = org.dba_name || org.legal_name;
  const fresh = forced === 'empty';

  const appRef = new Map(data.apps.map((a) => [a.id, a]));
  const awardRef = new Map(data.awards.map((a) => [a.id, a.reference]));
  const threadApp = new Map(data.threads.map((t) => [t.id, t.application_id]));
  const items: TimelineItem[] = fresh
    ? []
    : [
        ...data.apps.flatMap((a) => [
          { key: `ac-${a.id}`, at: a.created_at, icon: <FileText className={ic} aria-hidden="true" />, text: <>Started <AppLink id={a.id} label={`${a.reference_number} ${a.title ?? a.opp_title}`} /></> },
          ...(a.submitted_at
            ? [
                {
                  key: `as-${a.id}`,
                  at: a.submitted_at,
                  icon: <Send className={ic} aria-hidden="true" />,
                  text: (
                    <>
                      Submitted <AppLink id={a.id} label={a.reference_number} />
                      {a.submitted_via === 'agent' ? <Badge variant="agent" className="ml-1">Via agent</Badge> : null}
                    </>
                  ),
                },
              ]
            : []),
        ]),
        ...data.decisions.map((d) => ({
          key: `d-${d.id}`,
          at: d.recorded_at,
          icon: <Gavel className={ic} aria-hidden="true" />,
          text: <>Decision on <AppLink id={d.application_id} label={appRef.get(d.application_id)?.reference_number ?? 'application'} /></>,
          status: d.outcome === 'approve' ? <StatusChip kind="application" value="awarded" size="sm" label="Approved" /> : d.outcome === 'decline' ? <StatusChip kind="application" value="declined" size="sm" /> : <Badge variant="muted">Deferred</Badge>,
        })),
        ...data.awards.map((a) => ({
          key: `aw-${a.id}`,
          at: a.created_at,
          icon: <HandCoins className={ic} aria-hidden="true" />,
          text: (
            <>
              {a.kind === 'original' ? 'Award' : 'Amendment'} {a.reference} · <MoneyDisplay cents={Number(a.amount_cents)} currency={a.currency} />
            </>
          ),
          status: <StatusChip kind="award" value={a.status} size="sm" />,
        })),
        ...data.payments.map((p) => ({
          key: `p-${p.id}`,
          at: p.sent_at ?? p.created_at,
          icon: <Banknote className={ic} aria-hidden="true" />,
          text: (
            <>
              Payment <MoneyDisplay cents={Number(p.amount_cents)} currency={p.currency} /> on {awardRef.get(p.award_id) ?? 'an award'}
            </>
          ),
          status: <StatusChip kind="payment" value={p.status} size="sm" />,
        })),
        ...data.reports.map((r) => ({
          key: `r-${r.id}-${r.submission_id ?? 'due'}`,
          at: r.submitted_at ?? r.due_date,
          dateOnly: !r.submitted_at,
          icon: <ClipboardCheck className={ic} aria-hidden="true" />,
          text: (
            <>
              {r.submitted_at ? 'Report submitted' : 'Report due'}: {r.title} ({awardRef.get(r.award_id) ?? 'award'})
            </>
          ),
          status: <StatusChip kind="report" value={r.status} size="sm" />,
        })),
        ...data.messages.map((m) => {
          const appId = threadApp.get(m.thread_id);
          return {
            key: `m-${m.id}`,
            at: m.created_at,
            icon: <Mail className={ic} aria-hidden="true" />,
            text: (
              <>
                {m.author_side === 'staff' ? 'Message to the applicant' : 'Message from the applicant'}
                {appId ? (
                  <>
                    {' '}
                    on <AppLink id={appId} label={appRef.get(appId)?.reference_number ?? 'application'} tab="messages" />
                  </>
                ) : null}
              </>
            ),
          };
        }),
        ...data.visits.map((v) => ({
          key: `v-${v.id}`,
          at: v.visited_on,
          dateOnly: true,
          icon: <MapPin className={ic} aria-hidden="true" />,
          text: <>Site visit{v.full_name ? ` by ${v.full_name}` : ''}</>,
        })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const activeAwards = data.awards.filter((a) => a.status === 'active' && a.kind === 'original').length;
  const awarded = data.awards.filter((a) => a.kind === 'original' && ['active', 'completed'].includes(a.status)).reduce((s, a) => s + Number(a.amount_cents), 0);
  const latestIrs = data.diligence.find((d) => d.kind === 'irs_status') ?? data.diligence[0];
  const latestScreen = data.screenings[0];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const address = data.addresses[0];

  return (
    <div className="grid gap-4">
      <PageHeader
        linkComponent={NextLink}
        breadcrumbs={[{ label: 'Grantees', href: '/console/grantees' }, { label: name }]}
        title={name}
        description={[org.dba_name ? org.legal_name : null, org.ein ? `EIN ${org.ein}` : null, org.org_type.replace(/_/g, ' ')].filter(Boolean).join(' · ')}
        meta={
          <span className="flex flex-wrap gap-2">
            {org.ein_verified_at ? <Badge variant="success"><ShieldCheck aria-hidden="true" /> EIN verified</Badge> : <Badge variant="muted">EIN not verified</Badge>}
            {(data.profile?.tags ?? []).map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </span>
        }
        actions={canEdit ? <SiteVisitDialog orgId={org.id} today={today} awards={data.awards.map((a) => ({ id: a.id, label: `${a.reference} · ${a.title}` }))} /> : undefined}
      />

      <section aria-label="Relationship at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Applications" value={fresh ? 0 : data.apps.length} />
        <StatTile label="Active awards" value={fresh ? 0 : activeAwards} />
        <StatTile label="Total awarded" value={<MoneyDisplay cents={fresh ? 0 : awarded} short />} />
        <StatTile label="Site visits" value={fresh ? 0 : data.visits.length} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Section title="Relationship timeline" description="Applications, decisions, awards, payments, reports, messages and site visits, newest first.">
            {items.length ? (
              <ol className="grid gap-0 divide-y rounded-lg border bg-card text-sm">
                {items.slice(0, 80).map((it) => (
                  <li key={it.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">{it.icon}</span>
                    <span className="min-w-0 flex-1">{it.text}</span>
                    {it.status}
                    <time dateTime={it.at} className="w-40 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {it.dateOnly ? formatDateOnly(it.at) : formatInZone(it.at, tz)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No history with this organization yet.</p>
            )}
          </Section>

          <Section title="Applications" level={2}>
            {fresh || !data.apps.length ? (
              <p className="text-sm text-muted-foreground">No applications.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {data.apps.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <Link href={`/console/applications/${a.id}`} className="min-w-0 font-medium hover:underline">
                      <span className="font-mono text-xs text-muted-foreground">{a.reference_number}</span> {a.title ?? a.opp_title}
                    </Link>
                    <span className="flex items-center gap-2">
                      {a.requested_amount_cents !== null ? <MoneyDisplay cents={Number(a.requested_amount_cents)} currency={a.currency} className="text-xs" /> : null}
                      <StatusChip kind="application" value={a.status} size="sm" title={APPLICATION_STATUS[a.status as ApplicationStatus]?.description} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Awards" level={2}>
            {fresh || !data.awards.length ? (
              <p className="text-sm text-muted-foreground">No awards yet.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {data.awards.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{a.reference}</span> {a.title}
                      <span className="block text-xs text-muted-foreground">
                        {a.start_date ? `${formatDateOnly(a.start_date)} – ${formatDateOnly(a.end_date)}` : 'Dates not set'} · paid <MoneyDisplay cents={Number(a.disbursed_cents)} currency={a.currency} />
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <MoneyDisplay cents={Number(a.amount_cents)} currency={a.currency} />
                      <StatusChip kind="award" value={a.status} size="sm" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.reports.length && !fresh ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Reports: {data.reports.filter((r) => r.status === 'overdue').length} overdue,{' '}
                {data.reports.filter((r) => ['submitted', 'accepted'].includes(r.status)).length} submitted of {data.reports.length}.
              </p>
            ) : null}
          </Section>

          <Section title="Site visits" level={2}>
            {fresh || !data.visits.length ? (
              <p className="text-sm text-muted-foreground">No site visits recorded.{canEdit ? ' Use “Record a site visit” above.' : ''}</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {data.visits.map((v) => (
                  <li key={v.id} className="rounded-md border bg-card p-3">
                    <p className="mb-1 text-xs text-muted-foreground">
                      {formatDateOnly(v.visited_on)}
                      {v.full_name ? ` · ${v.full_name}` : ''}
                      {v.award_ref ? ` · ${v.award_ref}` : ''}
                    </p>
                    <p className="whitespace-pre-wrap">{v.summary}</p>
                    {v.follow_ups ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">Follow-ups: {v.follow_ups}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Internal notes" level={2}>
            <div className="grid gap-3">
              {canNote ? <NoteComposer entityType="org" entityId={org.id} /> : null}
              {data.notes.length && !fresh ? (
                <ul className="grid gap-2">
                  {data.notes.map((n) => (
                    <li key={n.id} className="rounded-md border bg-card p-3 text-sm">
                      <p className="mb-1 text-xs text-muted-foreground">
                        {n.full_name ?? 'Staff'} · {formatInZone(n.created_at, tz)}
                      </p>
                      <p className="whitespace-pre-wrap">{n.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
            </div>
          </Section>
        </div>

        <aside className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Relationship
              </CardTitle>
            </CardHeader>
            <CardContent>
              <GranteeProfileEditor
                orgId={org.id}
                tags={data.profile?.tags ?? []}
                ownerId={data.profile?.relationship_owner_id ?? null}
                summary={data.profile?.summary ?? null}
                team={data.team.map((m) => ({ id: m.userId, name: m.name, role: m.role }))}
                canEdit={canEdit}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Due diligence
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {latestIrs || latestScreen ? (
                <>
                  {latestIrs ? (
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span>{latestIrs.kind === 'irs_status' ? 'IRS exempt status' : latestIrs.kind.replace(/_/g, ' ')}</span>
                      <StatusChip kind="diligence" value={latestIrs.status} size="sm" />
                    </p>
                  ) : null}
                  {latestScreen ? (
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span>Sanctions screening</span>
                      <StatusChip kind="screening" value={latestScreen.status} size="sm" />
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">Last checked {formatInZone(latestIrs?.checked_at ?? latestScreen!.created_at, tz)}</p>
                </>
              ) : (
                <p className="text-muted-foreground">No checks run yet. Checks run automatically when an award is drafted.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Profile
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                layout="stacked"
                items={[
                  { term: 'Legal name', detail: org.legal_name },
                  { term: 'EIN', detail: org.ein },
                  { term: 'Mission', detail: org.mission ? <span className="whitespace-pre-wrap">{org.mission}</span> : null },
                  {
                    term: 'Website',
                    detail: org.website ? (
                      <a href={/^https?:\/\//.test(org.website) ? org.website : `https://${org.website}`} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                        {org.website}
                      </a>
                    ) : null,
                  },
                  { term: 'Counties served', detail: org.counties.length ? org.counties.join(', ') : null },
                  { term: 'Annual budget', detail: org.annual_budget_cents !== null ? <MoneyDisplay cents={Number(org.annual_budget_cents)} /> : null },
                  { term: 'Fiscal sponsor', detail: org.fiscal_sponsor_name ? `${org.fiscal_sponsor_name}${org.fiscal_sponsor_ein ? ` (EIN ${org.fiscal_sponsor_ein})` : ''}` : null },
                  { term: 'Address', detail: address ? [address.line1, address.line2, `${address.city}, ${address.state} ${address.postal_code}`].filter(Boolean).join(', ') : null },
                  { term: 'Phone', detail: org.phone },
                  { term: 'Email', detail: org.email },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Contacts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.contacts.length ? (
                <ul className="grid gap-2 text-sm">
                  {data.contacts.map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{c.full_name ?? c.email}</span>
                      {c.title ? <span className="text-muted-foreground"> · {c.title}</span> : null}
                      <span className="block text-xs text-muted-foreground">
                        {c.email} · {c.role === 'org_admin' ? 'Organization admin' : 'Collaborator'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No contacts on file.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function AppLink({ id, label, tab }: { id: string; label: string; tab?: string }) {
  return (
    <Link href={`/console/applications/${id}${tab ? `?tab=${tab}` : ''}`} className="font-medium hover:underline">
      {label}
    </Link>
  );
}
