// SPDX-License-Identifier: AGPL-3.0-only
// PA-03 Diligence: per grantee, IRS exempt status and OFAC screening; potential matches need a person's review
// (people-only); run checks; expenditure-responsibility / grants-to-individuals flags per award.
// ?state= (non-production): match · empty · error
import { formatDateOnly, formatInZone } from '@gms/domain';
import { Badge, Card, CardContent, EmptyState, ErrorState, PageHeader, Pagination, StatTile, StatusChip } from '@gms/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { UrlFilterSelect } from '@/components/console/finance/client-utils';
import { AwardFlags, ResolveScreeningDialog, RunChecksButton, type MatchView } from '@/components/console/finance/diligence';
import { AWARDS_READ, can, oneOf, paging, type SearchParams } from '@/components/console/finance/params';
import { NextLink } from '@/components/next-link';
import { requireStaff } from '@/lib/auth';
import { rls } from '@/lib/server/db';
import { forcedState } from '@/lib/site';
import { requireTenant } from '@/lib/tenant';

export const metadata: Metadata = { title: 'Diligence' };

const WRITE = ['owner', 'admin', 'program_officer', 'finance'] as const;
const FILTERS = ['needs_review', 'clear', 'not_checked', 'confirmed'] as const;

function toMatches(raw: unknown): MatchView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({ name: String(m.name ?? ''), score: Number(m.score ?? 0), programs: Array.isArray(m.programs) ? m.programs.map(String) : [], query: String(m.query ?? '') }));
}

export default async function DiligencePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [tenant, viewer] = await Promise.all([requireTenant(), requireStaff(AWARDS_READ)]);
  const sp = await searchParams;
  const forced = forcedState(sp);
  const { page, pageSize, offset } = paging(sp);
  const filter = oneOf(sp, 'status', FILTERS);
  const header = (
    <PageHeader
      title="Diligence"
      description="IRS exempt status and OFAC sanctions screening for every grantee. A possible match blocks payments until a person reviews it."
    />
  );
  if (forced === 'error') {
    return (
      <div className="grid gap-6">
        {header}
        <ErrorState title="We couldn’t load diligence results" description="Refresh to try again." />
      </div>
    );
  }
  const d = await rls(async (trx) => {
    const orgs = await trx
      .selectFrom('applicant_orgs as o')
      .select(['o.id', 'o.legal_name', 'o.dba_name', 'o.ein', 'o.org_type', 'o.fiscal_sponsor_name'])
      .where((eb) => eb.exists(eb.selectFrom('awards as a').select('a.id').whereRef('a.applicant_org_id', '=', 'o.id').where('a.workspace_id', '=', tenant.id).where('a.kind', '=', 'original').where('a.status', '!=', 'cancelled')))
      .orderBy('o.legal_name')
      .limit(2000)
      .execute();
    const ids = orgs.map((o) => o.id);
    const [screens, irs, awards] = ids.length
      ? await Promise.all([
          trx
            .selectFrom('sanctions_screenings as s')
            .leftJoin('profiles as u', 'u.id', 's.reviewed_by')
            .select(['s.id', 's.applicant_org_id', 's.status', 's.best_score', 's.matches', 's.created_at', 's.reviewed_at', 's.review_note', 'u.full_name as reviewer'])
            .where('s.workspace_id', '=', tenant.id)
            .where('s.applicant_org_id', 'in', ids)
            .distinctOn('s.applicant_org_id')
            .orderBy('s.applicant_org_id')
            .orderBy('s.created_at', 'desc')
            .execute(),
          trx
            .selectFrom('diligence_checks as c')
            .select(['c.applicant_org_id', 'c.status', 'c.result', 'c.checked_at'])
            .where('c.workspace_id', '=', tenant.id)
            .where('c.kind', '=', 'irs_status')
            .where('c.applicant_org_id', 'in', ids)
            .distinctOn('c.applicant_org_id')
            .orderBy('c.applicant_org_id')
            .orderBy('c.checked_at', 'desc')
            .execute(),
          trx
            .selectFrom('awards')
            .select(['id', 'reference', 'status', 'applicant_org_id', 'expenditure_responsibility', 'grant_to_individual'])
            .where('workspace_id', '=', tenant.id)
            .where('kind', '=', 'original')
            .where('applicant_org_id', 'in', ids)
            .orderBy('reference')
            .execute(),
        ])
      : [[], [], []];
    return { orgs, screens, irs, awards };
  });

  const rows = d.orgs.map((o, idx) => {
    let screen = d.screens.find((s) => s.applicant_org_id === o.id) ?? null;
    if (forced === 'match' && idx === 0) {
      screen = {
        id: screen?.id ?? '',
        applicant_org_id: o.id,
        status: 'potential_match',
        best_score: screen && screen.status === 'potential_match' ? screen.best_score : 0.62,
        matches: screen && screen.status === 'potential_match' ? screen.matches : [{ name: `${o.legal_name.toUpperCase()} TRADING LLC`, score: 0.62, programs: ['SDGT'], query: o.legal_name }],
        created_at: screen?.created_at ?? new Date().toISOString(),
        reviewed_at: null,
        review_note: null,
        reviewer: null,
      };
    }
    const irs = d.irs.find((c) => c.applicant_org_id === o.id) ?? null;
    const needsReview = screen?.status === 'potential_match' || irs?.status === 'review' || irs?.status === 'fail';
    return { o, screen, irs, needsReview, awards: d.awards.filter((a) => a.applicant_org_id === o.id) };
  });
  const filtered =
    forced === 'empty'
      ? []
      : rows.filter((r) =>
          !filter
            ? true
            : filter === 'needs_review'
              ? r.needsReview
              : filter === 'not_checked'
                ? !r.screen && !r.irs
                : filter === 'confirmed'
                  ? r.screen?.status === 'confirmed_match'
                  : !r.needsReview && Boolean(r.screen) && r.screen?.status !== 'confirmed_match',
        );
  // Matches needing review first.
  filtered.sort((a, b) => Number(b.screen?.status === 'potential_match') - Number(a.screen?.status === 'potential_match') || Number(b.needsReview) - Number(a.needsReview));
  const pageRows = filtered.slice(offset, offset + pageSize);
  const writer = can(viewer.role, WRITE);
  const counts = {
    review: rows.filter((r) => r.screen?.status === 'potential_match').length,
    irs: rows.filter((r) => r.irs && r.irs.status !== 'pass').length,
    unchecked: rows.filter((r) => !r.screen && !r.irs).length,
  };
  const href = (p: number) => {
    const qs = new URLSearchParams();
    if (filter) qs.set('status', filter);
    if (pageSize !== 25) qs.set('size', String(pageSize));
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return `/console/diligence${s ? `?${s}` : ''}`;
  };

  return (
    <div className="grid gap-6">
      {header}
      <section aria-label="Diligence summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Sanctions matches to review" value={counts.review} action={
            <Link className="text-link underline" href="/console/diligence?status=needs_review">
              Show matches to review
            </Link>
          } />
        <StatTile label="IRS status needs attention" value={counts.irs} />
        <StatTile label="Never checked" value={counts.unchecked} action={
            <Link className="text-link underline" href="/console/diligence?status=not_checked">
              Show grantees never checked
            </Link>
          } />
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <UrlFilterSelect
          param="status"
          label="Show"
          value={filter}
          allLabel="All grantees"
          options={[
            { value: 'needs_review', label: 'Needs review' },
            { value: 'clear', label: 'Clear' },
            { value: 'confirmed', label: 'Confirmed match' },
            { value: 'not_checked', label: 'Not checked' },
          ]}
        />
      </div>
      {pageRows.length ? (
        <ul className="grid gap-3" aria-label="Grantees">
          {pageRows.map(({ o, screen, irs, awards }) => {
            const irsRecord = (irs?.result ?? {}) as { record?: { name?: string; status?: string } | null; checkedAgainst?: string };
            return (
              <li key={o.id}>
                <Card className={screen?.status === 'potential_match' ? 'border-status-warning-border' : undefined}>
                  <CardContent className="grid gap-4 pt-5 lg:grid-cols-[1.2fr_1fr_1fr_1.2fr]">
                    <div className="grid content-start gap-1">
                      <h2 className="font-medium">{o.legal_name}</h2>
                      <p className="text-xs text-muted-foreground">
                        {o.ein ? `EIN ${o.ein}` : 'No EIN'}
                        {o.dba_name ? ` · DBA ${o.dba_name}` : ''}
                        {o.org_type === 'fiscally_sponsored' && o.fiscal_sponsor_name ? ` · Fiscal sponsor: ${o.fiscal_sponsor_name}` : ''}
                      </p>
                      {writer ? <RunChecksButton orgId={o.id} name={o.legal_name} /> : null}
                    </div>
                    <div className="grid content-start gap-1">
                      <h3 className="text-xs font-medium text-muted-foreground">IRS exempt status</h3>
                      {irs ? (
                        <>
                          <StatusChip kind="diligence" value={irs.status} size="sm" label={irs.status === 'pass' ? 'In good standing' : irs.status === 'fail' ? 'Not in good standing' : 'Needs review'} />
                          <span className="text-xs text-muted-foreground">
                            {irsRecord.record?.name ? `${irsRecord.record.name}${irsRecord.checkedAgainst === 'fiscal_sponsor' ? ' (fiscal sponsor)' : ''} · ` : irs.status === 'review' ? 'No IRS record found · ' : ''}
                            checked {formatDateOnly(irs.checked_at)}
                          </span>
                        </>
                      ) : (
                        <Badge variant="muted">Not checked</Badge>
                      )}
                    </div>
                    <div className="grid content-start gap-1">
                      <h3 className="text-xs font-medium text-muted-foreground">OFAC screening</h3>
                      {screen ? (
                        <>
                          <StatusChip kind="screening" value={screen.status} size="sm" />
                          <span className="text-xs text-muted-foreground">
                            {screen.status === 'potential_match' ? `Best match ${Math.round(Number(screen.best_score) * 100)}% · ` : ''}
                            screened {formatDateOnly(screen.created_at)}
                          </span>
                          {screen.reviewed_at ? (
                            <span className="text-xs text-muted-foreground">
                              Reviewed by {screen.reviewer ?? 'a teammate'} {formatInZone(screen.reviewed_at, tenant.timezone, { dateOnly: true })}
                              {screen.review_note ? `: “${screen.review_note}”` : ''}
                            </span>
                          ) : null}
                          {screen.status === 'potential_match' && writer ? (
                            <div className="pt-1">
                              <ResolveScreeningDialog screeningId={screen.id || null} orgName={o.legal_name} matches={toMatches(screen.matches)} screenedAt={screen.created_at} timeZone={tenant.timezone} />
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <Badge variant="muted">Not screened</Badge>
                      )}
                    </div>
                    <div className="grid content-start gap-2">
                      <h3 className="text-xs font-medium text-muted-foreground">Awards</h3>
                      {awards.map((a) => (
                        <div key={a.id} className="grid gap-1 rounded-md border p-2">
                          <span className="flex items-center gap-2 text-sm">
                            <Link href={`/console/awards/${a.id}`} className="font-medium hover:underline">
                              {a.reference}
                            </Link>
                            <StatusChip kind="award" value={a.status} size="sm" />
                          </span>
                          <AwardFlags awardId={a.id} reference={a.reference} expenditureResponsibility={a.expenditure_responsibility} grantToIndividual={a.grant_to_individual} canWrite={writer} />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title={filter ? 'No grantees match' : 'No grantees yet'} description={filter ? 'Try a different filter.' : 'Organizations appear here once they have an award.'} />
      )}
      {filtered.length > pageSize ? <Pagination page={page} pageCount={Math.ceil(filtered.length / pageSize)} getHref={href} linkComponent={NextLink} total={filtered.length} pageSize={pageSize} itemLabel="grantees" /> : null}
    </div>
  );
}
