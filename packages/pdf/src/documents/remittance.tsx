// SPDX-License-Identifier: AGPL-3.0-or-later
// H-04: remittance advice sent with each payment.

import { Text, View } from '@react-pdf/renderer';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@gms/domain';
import type { ResolvedBrand } from '../brand';
import { Address, BrandedDocument, dateOnly, KeyValues, money, s, Table } from '../components';

export interface RemittanceAdviceProps {
  paymentId: string;
  payer: { name: string; address?: string[] };
  payee: { organizationName: string; address?: string[]; attention?: string | null };
  /** Date-only. */
  paymentDate: string;
  amountCents: number;
  currency?: string;
  method: PaymentMethod;
  awardReference: string;
  installmentLabel?: string | null;
  memo?: string | null;
  /** Bank/rail reference (e.g. trace number). Never an account number. */
  bankReference?: string | null;
  /** Optional breakdown; defaults to one line for the whole amount. */
  lines?: { description: string; amountCents: number }[];
}

export function RemittanceAdvice({ brand, p }: { brand: ResolvedBrand; p: RemittanceAdviceProps }) {
  const currency = p.currency ?? 'USD';
  const lines = p.lines?.length
    ? p.lines
    : [
        {
          description: `Grant payment ${p.installmentLabel ? `(${p.installmentLabel}) ` : ''}— ${p.awardReference}`,
          amountCents: p.amountCents,
        },
      ];
  return (
    <BrandedDocument
      brand={brand}
      meta={{
        title: `Remittance advice ${p.paymentId}`,
        subject: `${p.awardReference} — ${p.payee.organizationName}`,
      }}
      headerMeta={`Remittance advice · ${p.paymentId}`}
    >
      <Text style={s.title}>Remittance advice</Text>
      <Text style={s.subtitle}>
        {money(p.amountCents, currency)} · {dateOnly(p.paymentDate)}
      </Text>
      <View style={{ flexDirection: 'row', marginBottom: 14 }}>
        <View style={{ width: '50%', paddingRight: 8 }}>
          <Text style={s.h3}>From (payer)</Text>
          <Text>{p.payer.name}</Text>
          <Address lines={p.payer.address} />
        </View>
        <View style={{ width: '50%', paddingLeft: 8 }}>
          <Text style={s.h3}>To (payee)</Text>
          <Text>{p.payee.organizationName}</Text>
          {p.payee.attention ? <Text>Attn: {p.payee.attention}</Text> : null}
          <Address lines={p.payee.address} />
        </View>
      </View>
      <KeyValues
        rows={[
          { label: 'Payment date', value: dateOnly(p.paymentDate) },
          { label: 'Amount', value: money(p.amountCents, currency), numeric: true },
          { label: 'Method', value: PAYMENT_METHOD_LABELS[p.method] },
          { label: 'Award reference', value: p.awardReference },
          ...(p.installmentLabel ? [{ label: 'Installment', value: p.installmentLabel }] : []),
          { label: 'Bank reference', value: p.bankReference ?? '—' },
          { label: 'Payment ID', value: p.paymentId },
          ...(p.memo ? [{ label: 'Memo', value: p.memo }] : []),
        ]}
      />
      <Text style={s.h2} minPresenceAhead={48}>
        Details
      </Text>
      <Table
        brand={brand}
        rows={lines}
        columns={[
          { header: 'Description', width: '70%', cell: (r) => r.description },
          { header: 'Amount', width: '30%', numeric: true, cell: (r) => money(r.amountCents, currency) },
        ]}
        footer={[
          'Total paid',
          money(
            lines.reduce((sum, l) => sum + l.amountCents, 0),
            currency,
          ),
        ]}
      />
      <Text style={s.small}>
        This advice confirms a payment sent by {p.payer.name}. Bank account numbers are never shown on this
        document. Questions? Contact {brand.displayName} and mention award reference {p.awardReference}.
      </Text>
    </BrandedDocument>
  );
}
