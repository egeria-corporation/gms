// SPDX-License-Identifier: AGPL-3.0-only
// H-05: board book for a docket meeting.

import { Text, View } from '@react-pdf/renderer';
import type { ResolvedBrand } from '../brand';
import { BrandedDocument, dateOnly, KeyValues, money, MUTED, Panel, s, Table } from '../components';

export interface BoardRecommendation {
  referenceNumber: string;
  applicationTitle: string;
  organizationName: string;
  opportunityName: string;
  summary: string;
  requestedCents: number;
  recommendedCents: number;
  reviewScore: { average: number; max: number; reviewerCount: number };
  criteria?: { name: string; average: number; max: number }[];
  /** Short excerpts; reviewer identities are usually anonymized ("Reviewer 2"). */
  reviewerComments: { reviewer: string; excerpt: string }[];
  staffNote?: string | null;
}

export interface BoardBookProps {
  meetingTitle: string;
  /** Date-only. */
  meetingDate: string;
  meetingLocation?: string | null;
  preparedBy: string;
  currency?: string;
  agenda: { time?: string | null; item: string; presenter?: string | null }[];
  recommendations: BoardRecommendation[];
  /** Budget available for this docket, if tracked. */
  availableCents?: number | null;
  confidentialityNote?: string | null;
}

const score = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function BoardBook({ brand, p }: { brand: ResolvedBrand; p: BoardBookProps }) {
  const currency = p.currency ?? 'USD';
  const totalRequested = p.recommendations.reduce((a, r) => a + r.requestedCents, 0);
  const totalRecommended = p.recommendations.reduce((a, r) => a + r.recommendedCents, 0);
  return (
    <BrandedDocument
      brand={brand}
      meta={{ title: `${p.meetingTitle} — board book`, subject: `Board meeting ${dateOnly(p.meetingDate)}` }}
      headerMeta={`Board book · ${dateOnly(p.meetingDate)}`}
    >
      {/* Cover */}
      <View style={{ marginTop: 120 }}>
        <Text style={[s.small, { textTransform: 'uppercase', marginBottom: 6 }]}>{brand.displayName}</Text>
        <Text style={[s.title, { fontSize: 30 }]}>{p.meetingTitle}</Text>
        <Text style={[s.subtitle, { fontSize: 14 }]}>
          {dateOnly(p.meetingDate)}
          {p.meetingLocation ? ` · ${p.meetingLocation}` : ''}
        </Text>
        <View style={{ borderTopWidth: 2, borderTopColor: brand.primary, width: 80, marginBottom: 20 }} />
        <KeyValues
          rows={[
            { label: 'Recommendations', value: String(p.recommendations.length) },
            { label: 'Total recommended', value: money(totalRecommended, currency), numeric: true },
            { label: 'Prepared by', value: p.preparedBy },
          ]}
        />
        <Text style={[s.small, { marginTop: 24 }]}>
          {p.confidentialityNote ??
            'Confidential. Prepared for board members. Please do not share outside the board.'}
        </Text>
      </View>

      {/* Agenda */}
      <View break>
        <Text style={s.title}>Agenda</Text>
        <Table
          brand={brand}
          rows={p.agenda}
          columns={[
            { header: 'Time', width: '15%', cell: (r) => r.time ?? '' },
            { header: 'Item', width: '60%', cell: (r) => r.item },
            { header: 'Presenter', width: '25%', cell: (r) => r.presenter ?? '' },
          ]}
        />
        <Text style={s.h2} minPresenceAhead={48}>
          Docket
        </Text>
        <Table
          brand={brand}
          rows={p.recommendations}
          columns={[
            { header: '#', width: '6%', cell: (r) => String(p.recommendations.indexOf(r) + 1) },
            { header: 'Organization', width: '40%', cell: (r) => r.organizationName },
            {
              header: 'Score',
              width: '14%',
              numeric: true,
              cell: (r) => `${score(r.reviewScore.average)}/${r.reviewScore.max}`,
            },
            {
              header: 'Requested',
              width: '20%',
              numeric: true,
              cell: (r) => money(r.requestedCents, currency),
            },
            {
              header: 'Recommended',
              width: '20%',
              numeric: true,
              cell: (r) => money(r.recommendedCents, currency),
            },
          ]}
          footer={['', 'Total', '', money(totalRequested, currency), money(totalRecommended, currency)]}
        />
      </View>

      {/* One section per recommendation */}
      {p.recommendations.map((r, i) => (
        <View key={r.referenceNumber} break>
          <Text style={[s.small, { textTransform: 'uppercase' }]}>
            Item {i + 1} · {r.referenceNumber} · {r.opportunityName}
          </Text>
          <Text style={s.title}>{r.organizationName}</Text>
          <Text style={s.subtitle}>{r.applicationTitle}</Text>
          <KeyValues
            rows={[
              { label: 'Requested', value: money(r.requestedCents, currency), numeric: true },
              { label: 'Recommended', value: money(r.recommendedCents, currency), numeric: true },
              {
                label: 'Review score',
                value: `${score(r.reviewScore.average)} of ${r.reviewScore.max} (${r.reviewScore.reviewerCount} ${
                  r.reviewScore.reviewerCount === 1 ? 'reviewer' : 'reviewers'
                })`,
              },
            ]}
          />
          <Text style={s.h2} minPresenceAhead={48}>
            Summary
          </Text>
          <Text style={s.p}>{r.summary}</Text>
          {r.criteria?.length ? (
            <>
              <Text style={s.h2} minPresenceAhead={48}>
                Scores by criterion
              </Text>
              <Table
                brand={brand}
                rows={r.criteria}
                columns={[
                  { header: 'Criterion', width: '70%', cell: (c) => c.name },
                  {
                    header: 'Average',
                    width: '30%',
                    numeric: true,
                    cell: (c) => `${score(c.average)} / ${c.max}`,
                  },
                ]}
              />
            </>
          ) : null}
          {r.reviewerComments.length ? (
            <>
              <Text style={s.h2} minPresenceAhead={48}>
                Reviewer comments (excerpts)
              </Text>
              {r.reviewerComments.map((c, ci) => (
                <View key={ci} style={{ marginBottom: 6 }} wrap={false}>
                  <Text style={{ fontFamily: 'Helvetica-Oblique' }}>“{c.excerpt}”</Text>
                  <Text style={{ color: MUTED, fontSize: 9 }}>— {c.reviewer}</Text>
                </View>
              ))}
            </>
          ) : null}
          {r.staffNote ? (
            <Panel brand={brand}>
              <Text style={s.bold}>Staff note</Text>
              <Text>{r.staffNote}</Text>
            </Panel>
          ) : null}
        </View>
      ))}

      {/* Totals */}
      <View break>
        <Text style={s.title}>Totals</Text>
        <KeyValues
          rows={[
            { label: 'Recommendations', value: String(p.recommendations.length) },
            { label: 'Total requested', value: money(totalRequested, currency), numeric: true },
            { label: 'Total recommended', value: money(totalRecommended, currency), numeric: true },
            ...(p.availableCents != null
              ? [
                  { label: 'Budget available', value: money(p.availableCents, currency), numeric: true },
                  {
                    label: 'Remaining after approval',
                    value: money(p.availableCents - totalRecommended, currency),
                    numeric: true,
                  },
                ]
              : []),
          ]}
        />
        <Table
          brand={brand}
          rows={p.recommendations}
          columns={[
            { header: 'Reference', width: '20%', cell: (r) => r.referenceNumber },
            { header: 'Organization', width: '40%', cell: (r) => r.organizationName },
            {
              header: 'Recommended',
              width: '20%',
              numeric: true,
              cell: (r) => money(r.recommendedCents, currency),
            },
            {
              header: 'Share',
              width: '20%',
              numeric: true,
              cell: (r) =>
                totalRecommended ? `${((r.recommendedCents / totalRecommended) * 100).toFixed(1)}%` : '—',
            },
          ]}
          footer={['', 'Total', money(totalRecommended, currency), totalRecommended ? '100.0%' : '—']}
        />
      </View>
    </BrandedDocument>
  );
}
