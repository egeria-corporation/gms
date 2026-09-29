// SPDX-License-Identifier: AGPL-3.0-or-later
// E-01 board book PDF for a docket (H-05 `board_book`): items in discussion order with requested vs
// recommended amounts, review score summaries, per-criterion averages and anonymized reviewer excerpts
// ("Reviewer 1"). Staff only; everything is read under RLS.
import { sql } from '@gms/db';
import { formatInZone } from '@gms/domain';
import { renderPdf, type BoardRecommendation } from '@gms/pdf';
import { requireStaff } from '@/lib/auth';
import { fileSafe, isUuid, pdfBrand } from '@/lib/grantmaking-data';
import { rls } from '@/lib/server/db';
import { requireTenant } from '@/lib/tenant';

interface ItemRow {
  item_id: string;
  application_id: string;
  item_position: number;
  reference_number: string;
  application_title: string | null;
  organization_name: string | null;
  opportunity_title: string;
  requested_amount_cents: number | null;
  recommended_amount_cents: number | null;
  recommendation: string | null;
  review_count: number;
  average_score: number | null;
  max_score: number | null;
}

function excerpt(s: string, max = 320): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export async function GET(_req: Request, ctx: { params: Promise<{ docketId: string }> }) {
  const tenant = await requireTenant();
  const viewer = await requireStaff();
  const { docketId } = await ctx.params;
  if (!isUuid(docketId)) return new Response('Not found', { status: 404 });

  const data = await rls(async (trx) => {
    const docket = await trx.selectFrom('dockets').select(['id', 'name', 'meeting_at', 'created_at']).where('id', '=', docketId).where('workspace_id', '=', tenant.id).executeTakeFirst();
    if (!docket) return null;
    const items = (await sql<ItemRow>`select * from gms.board_docket_items(${docket.id}::uuid)`.execute(trx)).rows;
    const appIds = items.map((i) => i.application_id);
    const [criteria, comments] = appIds.length
      ? await Promise.all([
          trx
            .selectFrom('review_scores as s')
            .innerJoin('reviews as r', 'r.id', 's.review_id')
            .innerJoin('review_assignments as ra', 'ra.id', 'r.assignment_id')
            .innerJoin('rubric_criteria as c', 'c.id', 's.criterion_id')
            .select(['ra.application_id', 'c.id', 'c.label', 'c.position', 'c.scale_max', sql<number>`avg(s.score)::float8`.as('avg')])
            .where('ra.application_id', 'in', appIds)
            .where('r.status', '=', 'submitted')
            .groupBy(['ra.application_id', 'c.id', 'c.label', 'c.position', 'c.scale_max'])
            .orderBy('c.position')
            .execute(),
          trx
            .selectFrom('reviews as r')
            .innerJoin('review_assignments as ra', 'ra.id', 'r.assignment_id')
            .select(['ra.application_id', 'r.overall_comment', 'r.submitted_at'])
            .where('ra.application_id', 'in', appIds)
            .where('r.status', '=', 'submitted')
            .where('r.overall_comment', 'is not', null)
            .orderBy('r.submitted_at')
            .execute(),
        ])
      : [[], []];
    return { docket, items, criteria, comments };
  });
  if (!data) return new Response('Not found', { status: 404 });

  const recommendations: BoardRecommendation[] = data.items.map((it) => {
    const title = it.application_title ?? it.opportunity_title;
    const reviewerComments = data.comments
      .filter((c) => c.application_id === it.application_id && c.overall_comment?.trim())
      .slice(0, 4)
      .map((c, i) => ({ reviewer: `Reviewer ${i + 1}`, excerpt: excerpt(c.overall_comment ?? '') }));
    return {
      referenceNumber: it.reference_number,
      applicationTitle: title,
      organizationName: it.organization_name ?? 'Individual applicant',
      opportunityName: it.opportunity_title,
      summary: it.recommendation?.trim() || `${title}. Staff recommend funding this application.`,
      requestedCents: Number(it.requested_amount_cents ?? 0),
      recommendedCents: Number(it.recommended_amount_cents ?? 0),
      reviewScore: { average: Number(it.average_score ?? 0), max: 100, reviewerCount: Number(it.review_count ?? 0) },
      criteria: data.criteria
        .filter((c) => c.application_id === it.application_id)
        .map((c) => ({ name: c.label, average: Number(c.avg), max: Number(c.scale_max) })),
      reviewerComments,
      staffNote: null,
    };
  });

  const meetingIso = data.docket.meeting_at ?? data.docket.created_at;
  const meetingDate = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(meetingIso));
  const bytes = await renderPdf(
    'board_book',
    {
      meetingTitle: data.docket.name,
      meetingDate,
      meetingLocation: data.docket.meeting_at ? formatInZone(data.docket.meeting_at, tenant.timezone) : null,
      preparedBy: viewer.name,
      agenda: [
        { item: 'Call to order and quorum', presenter: 'Board chair' },
        ...recommendations.map((r, i) => ({ item: `Item ${i + 1}: ${r.organizationName} — ${r.applicationTitle}`, presenter: 'Program staff' })),
        { item: 'Votes and adjournment', presenter: 'Board chair' },
      ],
      recommendations,
      availableCents: null,
    },
    pdfBrand(tenant),
  );
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="board-book-${fileSafe(data.docket.name)}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
