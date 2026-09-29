// SPDX-License-Identifier: AGPL-3.0-or-later
// H-02: award letter and grant agreement.

import { Text, View } from '@react-pdf/renderer';
import type { ResolvedBrand } from '../brand';
import {
  Address,
  BrandedDocument,
  Bullets,
  dateOnly,
  type Installment,
  KeyValues,
  money,
  Panel,
  ReportingTable,
  type ReportingRequirement,
  s,
  ScheduleTable,
  SignatureBlocks,
  type SignatureParty,
} from '../components';

export interface AwardTerms {
  awardReference: string;
  opportunityName: string;
  projectTitle: string;
  amountCents: number;
  currency?: string;
  /** Date-only. */
  periodStart: string;
  periodEnd: string;
  purpose: string;
  installments: Installment[];
  conditions: string[];
  reportingRequirements: ReportingRequirement[];
}

export interface AwardLetterProps extends AwardTerms {
  /** Date-only. */
  letterDate: string;
  foundationAddress?: string[];
  recipient: { name: string; title?: string | null; organizationName: string; address?: string[] };
  /** Optional closing paragraph. */
  message?: string | null;
  signatory: { name: string; title: string };
  /** Optional signature blocks (e.g. acknowledgement of the letter). */
  signatures?: SignatureParty[];
  timeZone: string;
}

export interface GrantAgreementProps extends AwardTerms {
  /** Date-only. */
  agreementDate: string;
  foundation: { legalName: string; address?: string[]; ein?: string | null };
  grantee: { legalName: string; address?: string[]; ein?: string | null };
  /** Numbered standard terms (headings + body). */
  terms: { heading: string; body: string }[];
  signatures: SignatureParty[];
  timeZone: string;
}

function TermsSections({ brand, p }: { brand: ResolvedBrand; p: AwardTerms }) {
  const currency = p.currency ?? 'USD';
  return (
    <>
      <Text style={s.h2} minPresenceAhead={48}>
        Purpose
      </Text>
      <Text style={s.p}>{p.purpose}</Text>
      <Text style={s.h2} minPresenceAhead={48}>
        Payment schedule
      </Text>
      <ScheduleTable brand={brand} installments={p.installments} currency={currency} />
      {p.conditions.length ? (
        <>
          <Text style={s.h2} minPresenceAhead={48}>
            Conditions
          </Text>
          <Bullets items={p.conditions} ordered />
        </>
      ) : null}
      {p.reportingRequirements.length ? (
        <>
          <Text style={s.h2} minPresenceAhead={48}>
            Reporting requirements
          </Text>
          <ReportingTable brand={brand} items={p.reportingRequirements} />
        </>
      ) : null}
    </>
  );
}

function summaryRows(p: AwardTerms) {
  const currency = p.currency ?? 'USD';
  return [
    { label: 'Award reference', value: p.awardReference },
    { label: 'Opportunity', value: p.opportunityName },
    { label: 'Project', value: p.projectTitle },
    { label: 'Amount', value: money(p.amountCents, currency), numeric: true },
    { label: 'Grant period', value: `${dateOnly(p.periodStart)} – ${dateOnly(p.periodEnd)}` },
  ];
}

export function AwardLetter({ brand, p }: { brand: ResolvedBrand; p: AwardLetterProps }) {
  const currency = p.currency ?? 'USD';
  return (
    <BrandedDocument
      brand={brand}
      meta={{
        title: `Award letter ${p.awardReference}`,
        subject: `${p.projectTitle} — ${p.recipient.organizationName}`,
      }}
      headerMeta={`Award letter · ${p.awardReference}`}
    >
      <View style={{ marginBottom: 16 }}>
        <Text>{dateOnly(p.letterDate)}</Text>
        <View style={{ marginTop: 10 }}>
          <Text>
            {p.recipient.name}
            {p.recipient.title ? `, ${p.recipient.title}` : ''}
          </Text>
          <Text>{p.recipient.organizationName}</Text>
          <Address lines={p.recipient.address} />
        </View>
      </View>
      <Text style={s.title}>Award letter</Text>
      <Text style={s.subtitle}>
        {p.opportunityName} · {p.awardReference}
      </Text>
      <Text style={s.p}>Dear {p.recipient.name},</Text>
      <Text style={s.p}>
        On behalf of {brand.displayName}, I am pleased to tell you that {p.recipient.organizationName} has
        been awarded a grant of {money(p.amountCents, currency)} for “{p.projectTitle}.” The details of the
        award are below.
      </Text>
      <KeyValues rows={summaryRows(p)} />
      <TermsSections brand={brand} p={p} />
      <Panel brand={brand}>
        <Text style={s.bold}>What happens next</Text>
        <Text>
          We will send a grant agreement for signature. Payments begin after the agreement is signed and
          payment details are set up.
        </Text>
      </Panel>
      {p.message ? <Text style={s.p}>{p.message}</Text> : null}
      <View wrap={false} style={{ marginTop: 8 }}>
        <Text style={s.p}>With warm regards,</Text>
        <Text style={[s.bold, { marginTop: 18 }]}>{p.signatory.name}</Text>
        <Text>{p.signatory.title}</Text>
        <Text>{brand.displayName}</Text>
        <Address lines={p.foundationAddress} />
      </View>
      {p.signatures?.length ? <SignatureBlocks parties={p.signatures} timeZone={p.timeZone} /> : null}
    </BrandedDocument>
  );
}

export function GrantAgreement({ brand, p }: { brand: ResolvedBrand; p: GrantAgreementProps }) {
  return (
    <BrandedDocument
      brand={brand}
      meta={{
        title: `Grant agreement ${p.awardReference}`,
        subject: `${p.projectTitle} — ${p.grantee.legalName}`,
      }}
      headerMeta={`Grant agreement · ${p.awardReference}`}
    >
      <Text style={s.title}>Grant agreement</Text>
      <Text style={s.subtitle}>
        {p.awardReference} · {dateOnly(p.agreementDate)}
      </Text>
      <Text style={s.p}>
        This grant agreement is between {p.foundation.legalName} (the “Foundation”) and {p.grantee.legalName}{' '}
        (the “Grantee”).
      </Text>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <View style={{ width: '50%', paddingRight: 8 }}>
          <Text style={s.h3}>Foundation</Text>
          <Text>{p.foundation.legalName}</Text>
          <Address lines={p.foundation.address} />
          {p.foundation.ein ? <Text style={s.small}>EIN {p.foundation.ein}</Text> : null}
        </View>
        <View style={{ width: '50%', paddingLeft: 8 }}>
          <Text style={s.h3}>Grantee</Text>
          <Text>{p.grantee.legalName}</Text>
          <Address lines={p.grantee.address} />
          {p.grantee.ein ? <Text style={s.small}>EIN {p.grantee.ein}</Text> : null}
        </View>
      </View>
      <KeyValues rows={summaryRows(p)} />
      <TermsSections brand={brand} p={p} />
      {p.terms.length ? (
        <>
          <Text style={s.h2} minPresenceAhead={48}>
            Terms
          </Text>
          {p.terms.map((t, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Text style={s.h3}>
                {i + 1}. {t.heading}
              </Text>
              <Text>{t.body}</Text>
            </View>
          ))}
        </>
      ) : null}
      <View>
        <Text style={s.h2} minPresenceAhead={170}>
          Signatures
        </Text>
        <Text style={s.small}>
          Each party signs electronically by typing their name. The timestamp, IP address and a SHA-256 hash
          of the signed document are recorded with each signature.
        </Text>
        <SignatureBlocks parties={p.signatures} timeZone={p.timeZone} />
      </View>
    </BrandedDocument>
  );
}
