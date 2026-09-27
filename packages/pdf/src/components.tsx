// SPDX-License-Identifier: AGPL-3.0-only
// Shared PDF building blocks. Only built-in PDF fonts (Helvetica/Times) are used, so nothing is fetched at render time
// (except an optional https logo). Helvetica's digits are all the same width, so right-aligned money columns line up.

import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { formatDateOnly, formatInZone, formatMoney } from '@gms/domain';
import type { ResolvedBrand } from './brand';

// Never hyphenate: reference numbers, names and amounts must stay intact.
Font.registerHyphenationCallback((word) => [word]);

export const INK = '#18181b';
export const MUTED = '#52525b';
export const RULE = '#d4d4d8';

export const s = StyleSheet.create({
  page: {
    paddingTop: 96,
    paddingBottom: 64,
    paddingHorizontal: 56,
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    lineHeight: 1.45,
    color: INK,
  },
  header: { position: 'absolute', top: 32, left: 56, right: 56 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 8,
  },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 13 },
  headerMeta: { fontSize: 8.5, color: MUTED, textAlign: 'right' },
  logo: { height: 28, maxWidth: 160, objectFit: 'contain' },
  // Footer uses `top` offsets (LETTER is 792pt tall): react-pdf misplaces dynamic `render` text positioned by `bottom`.
  footerRule: {
    position: 'absolute',
    top: 740,
    left: 56,
    right: 56,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
  },
  footerText: { position: 'absolute', top: 747, fontSize: 8, color: MUTED },
  title: { fontFamily: 'Times-Bold', fontSize: 22, lineHeight: 1.2, marginBottom: 4 },
  subtitle: { fontSize: 11, color: MUTED, marginBottom: 18 },
  h2: { fontFamily: 'Times-Bold', fontSize: 14, marginTop: 16, marginBottom: 6 },
  h3: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 10, marginBottom: 4 },
  p: { marginBottom: 8 },
  small: { fontSize: 8.5, color: MUTED },
  bold: { fontFamily: 'Helvetica-Bold' },
  mono: { fontFamily: 'Courier', fontSize: 8.5 },
  kvRow: { flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#e4e4e7' },
  kvLabel: { width: '34%', color: MUTED, paddingRight: 8 },
  kvValue: { width: '66%' },
  table: { borderWidth: 0.5, borderColor: RULE, marginBottom: 10 },
  tr: { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: RULE },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 9, paddingVertical: 5, paddingHorizontal: 6 },
  td: { paddingVertical: 5, paddingHorizontal: 6 },
  num: { textAlign: 'right' },
  li: { flexDirection: 'row', marginBottom: 4 },
  bullet: { width: 14 },
  liText: { flex: 1 },
  panel: { padding: 10, marginBottom: 10, borderLeftWidth: 3 },
});

export const money = (cents: number | null | undefined, currency = 'USD') => formatMoney(cents, currency);
export const dateOnly = formatDateOnly;
export const dateTime = (iso: string | null | undefined, tz: string) => formatInZone(iso, tz);

export interface DocMeta {
  title: string;
  subject?: string;
  keywords?: string;
}

/** Document + one page with the brand header, "Page X of Y" and the "Powered by GMS" footer on every page. */
export function BrandedDocument({
  brand,
  meta,
  headerMeta,
  children,
}: {
  brand: ResolvedBrand;
  meta: DocMeta;
  headerMeta?: string;
  children: ReactNode;
}) {
  return (
    <Document
      title={meta.title}
      author={brand.displayName}
      subject={meta.subject}
      keywords={meta.keywords}
      creator="GMS"
      producer="GMS (react-pdf)"
      language="en-US"
    >
      <BrandedPage brand={brand} headerMeta={headerMeta ?? meta.title}>
        {children}
      </BrandedPage>
    </Document>
  );
}

export function BrandedPage({
  brand,
  headerMeta,
  children,
}: {
  brand: ResolvedBrand;
  headerMeta: string;
  children: ReactNode;
}) {
  return (
    <Page size="LETTER" style={s.page} wrap>
      <View style={s.header} fixed>
        <View style={[s.headerRow, { borderBottomWidth: 2, borderBottomColor: brand.primary }]}>
          {brand.logo ? (
            // react-pdf images have no alt text; the foundation name is in the PDF author metadata.
            <Image src={brand.logo} style={s.logo} />
          ) : (
            <Text style={s.brandName}>{brand.displayName}</Text>
          )}
          <Text style={s.headerMeta}>{headerMeta}</Text>
        </View>
      </View>
      <View style={s.footerRule} fixed />
      <Text style={[s.footerText, { left: 56 }]} fixed>
        {brand.displayName} · Powered by GMS
      </Text>
      <Text
        style={[s.footerText, { right: 56, textAlign: 'right' }]}
        fixed
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
      {children}
    </Page>
  );
}

export function KeyValues({ rows }: { rows: { label: string; value: string; numeric?: boolean }[] }) {
  return (
    <View style={{ marginBottom: 10 }}>
      {rows.map((r, i) => (
        <View key={i} style={s.kvRow} wrap={false}>
          <Text style={s.kvLabel}>{r.label}</Text>
          <Text style={[s.kvValue, r.numeric ? s.bold : {}]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export interface Column<T> {
  header: string;
  width: string;
  numeric?: boolean;
  cell: (row: T) => string;
}

export function Table<T>({
  brand,
  columns,
  rows,
  footer,
}: {
  brand: ResolvedBrand;
  columns: Column<T>[];
  rows: T[];
  footer?: string[];
}) {
  return (
    <View style={s.table}>
      <View style={[s.tr, { borderTopWidth: 0, backgroundColor: brand.tint }]} fixed>
        {columns.map((c, i) => (
          <Text key={i} style={[s.th, { width: c.width }, c.numeric ? s.num : {}]}>
            {c.header}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={s.tr} wrap={false}>
          {columns.map((c, ci) => (
            <Text key={ci} style={[s.td, { width: c.width }, c.numeric ? s.num : {}]}>
              {c.cell(r)}
            </Text>
          ))}
        </View>
      ))}
      {footer ? (
        <View style={[s.tr, { borderTopWidth: 1, borderTopColor: INK }]} wrap={false}>
          {columns.map((c, ci) => (
            <Text key={ci} style={[s.td, s.bold, { width: c.width }, c.numeric ? s.num : {}]}>
              {footer[ci] ?? ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Bullets({ items, ordered }: { items: string[]; ordered?: boolean }) {
  return (
    <View style={{ marginBottom: 8 }}>
      {items.map((it, i) => (
        <View key={i} style={s.li} wrap={false}>
          <Text style={s.bullet}>{ordered ? `${i + 1}.` : '•'}</Text>
          <Text style={s.liText}>{it}</Text>
        </View>
      ))}
    </View>
  );
}

export function Panel({ brand, children }: { brand: ResolvedBrand; children: ReactNode }) {
  return (
    <View style={[s.panel, { borderLeftColor: brand.accent, backgroundColor: '#f4f4f5' }]}>{children}</View>
  );
}

// --- Award terms shared by the award letter and the agreement ---

export interface Installment {
  label: string;
  /** Date-only ("2027-03-01"), or null when tied to a condition. */
  dueDate?: string | null;
  /** e.g. "On receipt of the interim report". */
  condition?: string | null;
  amountCents: number;
}

export interface ReportingRequirement {
  name: string;
  /** Date-only. */
  dueDate: string;
  description?: string | null;
}

export function ScheduleTable({
  brand,
  installments,
  currency,
}: {
  brand: ResolvedBrand;
  installments: Installment[];
  currency: string;
}) {
  const total = installments.reduce((sum, i) => sum + i.amountCents, 0);
  return (
    <Table
      brand={brand}
      rows={installments}
      columns={[
        { header: 'Installment', width: '30%', cell: (r) => r.label },
        {
          header: 'When',
          width: '45%',
          cell: (r) =>
            [r.dueDate ? dateOnly(r.dueDate) : null, r.condition ?? null].filter(Boolean).join(' · ') || '—',
        },
        { header: 'Amount', width: '25%', numeric: true, cell: (r) => money(r.amountCents, currency) },
      ]}
      footer={['Total', '', money(total, currency)]}
    />
  );
}

export function ReportingTable({ brand, items }: { brand: ResolvedBrand; items: ReportingRequirement[] }) {
  return (
    <Table
      brand={brand}
      rows={items}
      columns={[
        { header: 'Report', width: '30%', cell: (r) => r.name },
        { header: 'Due', width: '20%', cell: (r) => dateOnly(r.dueDate) },
        { header: 'What to include', width: '50%', cell: (r) => r.description ?? '—' },
      ]}
    />
  );
}

export interface SignatureRecord {
  typedName: string;
  /** ISO timestamp. */
  signedAt: string;
  ipAddress: string;
  /** sha256 hex of the document version that was signed. */
  documentHash: string;
}

export interface SignatureParty {
  /** e.g. "For the grantee". */
  party: string;
  organizationName: string;
  signerName?: string | null;
  signerTitle?: string | null;
  signature?: SignatureRecord | null;
}

export function SignatureBlocks({ parties, timeZone }: { parties: SignatureParty[]; timeZone: string }) {
  return (
    <View style={{ marginTop: 12 }}>
      {parties.map((p, i) => (
        <View
          key={i}
          wrap={false}
          style={{ marginBottom: 14, borderWidth: 0.5, borderColor: RULE, padding: 10 }}
        >
          <Text style={[s.small, { textTransform: 'uppercase', marginBottom: 2 }]}>{p.party}</Text>
          <Text style={[s.bold, { marginBottom: 6 }]}>{p.organizationName}</Text>
          {p.signature ? (
            <>
              <Text style={{ fontFamily: 'Times-Italic', fontSize: 16, marginBottom: 2 }}>
                /s/ {p.signature.typedName}
              </Text>
              <View style={{ borderTopWidth: 0.5, borderTopColor: INK, paddingTop: 3, marginBottom: 4 }}>
                <Text>
                  {p.signerName ?? p.signature.typedName}
                  {p.signerTitle ? `, ${p.signerTitle}` : ''}
                </Text>
              </View>
              <Text style={s.small}>Signed electronically: {dateTime(p.signature.signedAt, timeZone)}</Text>
              <Text style={s.small}>IP address: {p.signature.ipAddress}</Text>
              <Text style={[s.small, s.mono]}>Document SHA-256: {p.signature.documentHash}</Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 16, marginBottom: 2, color: MUTED }}> </Text>
              <View style={{ borderTopWidth: 0.5, borderTopColor: INK, paddingTop: 3, marginBottom: 4 }}>
                <Text>
                  {p.signerName ?? 'Authorized signer'}
                  {p.signerTitle ? `, ${p.signerTitle}` : ''}
                </Text>
              </View>
              <Text style={[s.small, s.bold]}>Not yet signed</Text>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

export function Address({ lines }: { lines?: string[] | null }) {
  if (!lines?.length) return null;
  return (
    <>
      {lines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
    </>
  );
}
