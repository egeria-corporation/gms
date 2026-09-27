// SPDX-License-Identifier: AGPL-3.0-only
// H-03: application packet. Answers arrive pre-flattened so the renderer stays form-agnostic.

import { Text, View } from '@react-pdf/renderer';
import type { ResolvedBrand } from '../brand';
import { BrandedDocument, dateTime, KeyValues, money, MUTED, Panel, RULE, s, Table } from '../components';

export interface PacketAnswer {
  section: string;
  label: string;
  /** Display-ready value; newlines are kept. Empty means "No answer". */
  value: string;
}

export interface PacketAttachment {
  name: string;
  section?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
}

export interface EligibilityResult {
  rule: string;
  result: 'pass' | 'fail' | 'review';
  detail?: string | null;
}

export interface ApplicationPacketProps {
  opportunityName: string;
  applicationTitle: string;
  referenceNumber: string;
  statusLabel?: string | null;
  submittedAt: string | null;
  timeZone: string;
  requestedAmountCents?: number | null;
  currency?: string;
  organization: {
    name: string;
    legalName?: string | null;
    ein?: string | null;
    address?: string[];
    website?: string | null;
    mission?: string | null;
    annualBudgetCents?: number | null;
    contactName?: string | null;
    contactEmail?: string | null;
  };
  answers: PacketAnswer[];
  attachments: PacketAttachment[];
  eligibility: EligibilityResult[];
  generatedAt: string;
}

const RESULT_LABEL: Record<EligibilityResult['result'], string> = {
  pass: 'Passed',
  fail: 'Did not pass',
  review: 'Needs review',
};

function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function groupBySection(answers: PacketAnswer[]): { section: string; items: PacketAnswer[] }[] {
  const out: { section: string; items: PacketAnswer[] }[] = [];
  for (const a of answers) {
    const last = out[out.length - 1];
    if (last && last.section === a.section) last.items.push(a);
    else out.push({ section: a.section, items: [a] });
  }
  return out;
}

export function ApplicationPacket({ brand, p }: { brand: ResolvedBrand; p: ApplicationPacketProps }) {
  const currency = p.currency ?? 'USD';
  const org = p.organization;
  return (
    <BrandedDocument
      brand={brand}
      meta={{ title: `Application ${p.referenceNumber}: ${p.applicationTitle}`, subject: p.opportunityName }}
      headerMeta={`Application · ${p.referenceNumber}`}
    >
      {/* Cover page */}
      <View style={{ marginTop: 80 }}>
        <Text style={[s.small, { textTransform: 'uppercase', marginBottom: 6 }]}>{p.opportunityName}</Text>
        <Text style={[s.title, { fontSize: 28 }]}>{p.applicationTitle}</Text>
        <Text style={[s.subtitle, { fontSize: 14 }]}>{org.name}</Text>
        <View style={{ borderTopWidth: 2, borderTopColor: brand.primary, width: 80, marginBottom: 20 }} />
        <KeyValues
          rows={[
            { label: 'Reference number', value: p.referenceNumber },
            ...(p.statusLabel ? [{ label: 'Status', value: p.statusLabel }] : []),
            {
              label: 'Submitted',
              value: p.submittedAt ? dateTime(p.submittedAt, p.timeZone) : 'Not submitted',
            },
            ...(p.requestedAmountCents != null
              ? [{ label: 'Amount requested', value: money(p.requestedAmountCents, currency), numeric: true }]
              : []),
          ]}
        />
        {p.submittedAt ? (
          <Panel brand={brand}>
            <Text style={s.bold}>Submission receipt</Text>
            <Text>
              Received by {brand.displayName} on {dateTime(p.submittedAt, p.timeZone)} under reference{' '}
              {p.referenceNumber}.
            </Text>
          </Panel>
        ) : null}
        <Text style={[s.small, { marginTop: 24 }]}>
          Packet generated {dateTime(p.generatedAt, p.timeZone)}
        </Text>
      </View>

      {/* Organization profile */}
      <View break>
        <Text style={s.title}>Organization profile</Text>
        <KeyValues
          rows={[
            { label: 'Name', value: org.name },
            ...(org.legalName && org.legalName !== org.name
              ? [{ label: 'Legal name', value: org.legalName }]
              : []),
            ...(org.ein ? [{ label: 'EIN', value: org.ein }] : []),
            ...(org.address?.length ? [{ label: 'Address', value: org.address.join('\n') }] : []),
            ...(org.website ? [{ label: 'Website', value: org.website }] : []),
            ...(org.annualBudgetCents != null
              ? [{ label: 'Annual budget', value: money(org.annualBudgetCents, currency), numeric: true }]
              : []),
            ...(org.contactName
              ? [{ label: 'Contact', value: [org.contactName, org.contactEmail].filter(Boolean).join(' · ') }]
              : []),
          ]}
        />
        {org.mission ? (
          <>
            <Text style={s.h2} minPresenceAhead={48}>
              Mission
            </Text>
            <Text style={s.p}>{org.mission}</Text>
          </>
        ) : null}

        {p.eligibility.length ? (
          <>
            <Text style={s.h2} minPresenceAhead={48}>
              Eligibility results
            </Text>
            <Table
              brand={brand}
              rows={p.eligibility}
              columns={[
                { header: 'Rule', width: '45%', cell: (r) => r.rule },
                { header: 'Result', width: '20%', cell: (r) => RESULT_LABEL[r.result] },
                { header: 'Detail', width: '35%', cell: (r) => r.detail ?? '—' },
              ]}
            />
          </>
        ) : null}
      </View>

      {/* Answers, one block per form section */}
      {groupBySection(p.answers).map((g, gi) => (
        <View key={gi} break={gi === 0}>
          <Text style={gi === 0 ? s.title : s.h2}>{g.section}</Text>
          {g.items.map((a, ai) => (
            <View
              key={ai}
              style={{ marginBottom: 10, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: RULE }}
            >
              <Text style={[s.bold, { marginBottom: 3 }]} minPresenceAhead={24}>
                {a.label}
              </Text>
              {a.value.trim() ? (
                <Text>{a.value}</Text>
              ) : (
                <Text style={{ color: MUTED, fontFamily: 'Helvetica-Oblique' }}>No answer</Text>
              )}
            </View>
          ))}
        </View>
      ))}

      <View minPresenceAhead={80}>
        <Text style={s.h2} minPresenceAhead={48}>
          Attachments
        </Text>
        {p.attachments.length ? (
          <Table
            brand={brand}
            rows={p.attachments}
            columns={[
              { header: 'File', width: '45%', cell: (r) => r.name },
              { header: 'Section', width: '30%', cell: (r) => r.section ?? '—' },
              { header: 'Size', width: '25%', numeric: true, cell: (r) => formatBytes(r.sizeBytes) },
            ]}
          />
        ) : (
          <Text style={{ color: MUTED }}>No attachments.</Text>
        )}
        <Text style={s.small}>Attachments are stored in GMS and are not embedded in this packet.</Text>
      </View>
    </BrandedDocument>
  );
}
