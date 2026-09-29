// SPDX-License-Identifier: AGPL-3.0-or-later
// A-03 Opportunity detail (states: forecasted "Notify me"; open; closed) + JSON-LD MonetaryGrant.
import { NextLink } from '@/components/next-link';
import { formatDateOnly, formatInZone, formatMoney } from '@gms/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, DeadlineChip, DescriptionList, PageHeader, StatusChip } from '@gms/ui';
import { ClipboardCheck, FileText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fundingRange } from '@/components/public/opportunity-card';
import { NotifyMe } from '@/components/public/notify-me';
import { getSession } from '@/lib/auth';
import { JsonLd, monetaryGrantLd } from '@/lib/json-ld';
import { Markdown } from '@/lib/markdown';
import { competitionsFor, eligibilityRules, getOpportunity, type PublicOpportunity } from '@/lib/public-data';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requestMeta, requireTenant } from '@/lib/tenant';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tenant = await requireTenant();
  const o = await getOpportunity(tenant, (await params).slug);
  if (!o) return { title: 'Opportunity not found' };
  return {
    title: o.title,
    description: o.summary ?? undefined,
    alternates: { canonical: `/opportunities/${o.slug}`, types: { 'text/markdown': `/opportunities/${o.slug}.md` } },
    openGraph: { title: o.title, description: o.summary ?? undefined, type: 'website' },
  };
}

export default async function OpportunityPage({ params, searchParams }: Props) {
  const tenant = await requireTenant();
  const { slug } = await params;
  const o = await getOpportunity(tenant, slug);
  if (!o) notFound();
  const state = forcedState(await searchParams);
  const status = (state === 'forecasted' || state === 'open' || state === 'closed' ? state : o.status) as PublicOpportunity['status'];
  const [stages, rules, session, meta] = await Promise.all([competitionsFor(o.id), eligibilityRules(o.id), getSession(), requestMeta()]);
  const subscribed = session
    ? Boolean(await rls((trx) => trx.selectFrom('opportunity_subscriptions').select('id').where('opportunity_id', '=', o.id).where('user_id', '=', session.userId).executeTakeFirst()))
    : false;
  const openStage = stages.find((s) => s.stage_order === 1);
  const range = fundingRange(o);

  return (
    <article className="grid gap-8 pb-16">
      <JsonLd data={monetaryGrantLd(o, tenant)} nonce={meta.nonce} />
      <PageHeader
        density="spacious"
        breadcrumbs={[{ label: 'Opportunities', href: '/opportunities' }, { label: o.title }]}
        linkComponent={NextLink}
        title={o.title}
        description={o.summary}
        meta={
          <>
            <StatusChip kind="opportunity" value={status} />
            {o.closesAt && status !== 'closed' ? <DeadlineChip at={o.closesAt} timeZone={tenant.timezone} label="Closes" /> : null}
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-8">
          {status === 'forecasted' ? (
            <Alert variant="info" title="This opportunity isn’t open yet">
              Applications open {o.opensAt ? formatInZone(o.opensAt, tenant.timezone) : 'soon'}. You can check eligibility now and get an email when it opens.
            </Alert>
          ) : status === 'closed' ? (
            <Alert variant="warning" title="Applications are closed">
              This round closed {o.closesAt ? formatInZone(o.closesAt, tenant.timezone) : ''}. See{' '}
              <Link className="underline" href="/opportunities">
                other opportunities
              </Link>{' '}
              that are open now.
            </Alert>
          ) : null}

          {o.descriptionMd ? (
            <section aria-labelledby="about-heading" className="grid gap-3">
              <h2 id="about-heading" className="font-heading text-xl font-semibold">
                About this opportunity
              </h2>
              <Markdown source={o.descriptionMd} className="text-base" />
            </section>
          ) : null}
          {o.eligibilityMd ? (
            <section aria-labelledby="elig-heading" className="grid gap-3">
              <h2 id="elig-heading" className="font-heading text-xl font-semibold">
                Who can apply
              </h2>
              <Markdown source={o.eligibilityMd} className="text-base" />
            </section>
          ) : null}
          {stages.length > 1 ? (
            <section aria-labelledby="stages-heading" className="grid gap-3">
              <h2 id="stages-heading" className="font-heading text-xl font-semibold">
                How the process works
              </h2>
              <ol className="grid gap-3">
                {stages.map((s) => (
                  <li key={s.id} className="rounded-lg border bg-card p-4">
                    <p className="font-medium">
                      Step {s.stage_order}: {s.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {s.access === 'invite' ? 'By invitation only. ' : 'Open to everyone who is eligible. '}
                      {s.closes_at ? `Due ${formatInZone(s.closes_at, tenant.timezone)}.` : ''}
                    </p>
                    {s.description ? <p className="mt-1 text-sm">{s.description}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {o.guidelinesMd ? (
            <section aria-labelledby="guide-heading" className="grid gap-3">
              <h2 id="guide-heading" className="font-heading text-xl font-semibold">
                Guidelines
              </h2>
              <Markdown source={o.guidelinesMd} className="text-base" />
            </section>
          ) : null}
          {o.faq.length ? (
            <section aria-labelledby="faq-heading" className="grid gap-3">
              <h2 id="faq-heading" className="font-heading text-xl font-semibold">
                Questions people ask
              </h2>
              <div className="grid gap-2">
                {o.faq.map((f, i) => (
                  <details key={i} className="rounded-lg border bg-card p-4 [&[open]>summary]:mb-2">
                    <summary className="cursor-pointer font-medium">{f.q}</summary>
                    <Markdown source={f.a} />
                  </details>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="grid content-start gap-4" aria-label="Key facts and actions">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Key facts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                layout="stacked"
                items={[
                  { term: 'Award size', detail: range },
                  { term: 'Total available', detail: o.fundingTotalCents ? formatMoney(o.fundingTotalCents, o.currency, { compact: true }) : null },
                  { term: 'Expected awards', detail: o.expectedAwardCount ? `About ${o.expectedAwardCount}` : null },
                  { term: 'Opens', detail: o.opensAt ? formatInZone(o.opensAt, tenant.timezone) : null },
                  { term: 'Deadline', detail: openStage?.closes_at ? formatInZone(openStage.closes_at, tenant.timezone) : o.closesAt ? formatInZone(o.closesAt, tenant.timezone) : null },
                  { term: 'Decisions expected', detail: o.decisionExpectedOn ? formatDateOnly(o.decisionExpectedOn) : null },
                  { term: 'Program', detail: o.programName },
                ]}
              />
            </CardContent>
          </Card>
          <div className="grid gap-2">
            {status === 'open' ? (
              <Button asChild size="lg">
                <Link href={`/portal/apply/${o.slug}`}>
                  <FileText aria-hidden="true" /> Start an application
                </Link>
              </Button>
            ) : status === 'forecasted' ? (
              <NotifyMe opportunityId={o.id} signedIn={Boolean(session)} subscribed={subscribed} signInHref={`/portal/sign-in?next=/opportunities/${o.slug}`} />
            ) : null}
            {rules.length && status !== 'closed' ? (
              <Button asChild size="lg" variant="secondary">
                <Link href={`/opportunities/${o.slug}/eligibility`}>
                  <ClipboardCheck aria-hidden="true" /> Check if you’re eligible
                </Link>
              </Button>
            ) : null}
          </div>
          {o.contactEmail ? (
            <p className="text-sm text-muted-foreground">
              Questions about this opportunity? Email{' '}
              <a className="text-link underline" href={`mailto:${o.contactEmail}`}>
                {o.contactEmail}
              </a>
              .
            </p>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
