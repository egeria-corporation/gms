// SPDX-License-Identifier: AGPL-3.0-only
// Awards, agreements, payments and reports.

import {
  formatDateOnly,
  formatInZone,
  formatMoney,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@gms/domain';
import { defineTemplate, FIX, greeting } from './shared';

export interface AwardNoticeProps {
  recipientName?: string | null;
  organizationName: string;
  opportunityName: string;
  applicationTitle: string;
  awardReference: string;
  amountCents: number;
  currency?: string;
  /** Date-only grant period. */
  periodStart?: string | null;
  periodEnd?: string | null;
  awardUrl: string;
}

export const awardNotice = defineTemplate<AwardNoticeProps>({
  name: 'Award notice',
  description: 'Tells the applicant they received a grant, with the amount and next steps.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    organizationName: FIX.org,
    opportunityName: FIX.opportunity,
    applicationTitle: FIX.appTitle,
    awardReference: FIX.awardRef,
    amountCents: 2_500_000,
    currency: 'USD',
    periodStart: '2027-03-01',
    periodEnd: '2028-02-29',
    awardUrl: `${FIX.portal}/awards/${FIX.awardRef}`,
  },
  build: (p, { brand }) => {
    const amount = formatMoney(p.amountCents, p.currency ?? 'USD');
    return {
      subject: `You’ve been awarded ${amount} from ${brand.displayName}`,
      preheader: `Congratulations! Here’s what happens next for ${p.applicationTitle}.`,
      reason: `${p.organizationName} applied to ${p.opportunityName} with ${brand.displayName}.`,
      blocks: [
        { type: 'heading', text: 'Congratulations on your grant' },
        { type: 'paragraph', content: greeting(p.recipientName) },
        {
          type: 'paragraph',
          content: [
            `We’re glad to tell you that ${brand.displayName} is awarding `,
            { text: amount, bold: true },
            ` to ${p.organizationName} for “${p.applicationTitle}.” Thank you for the work you do.`,
          ],
        },
        {
          type: 'details',
          rows: [
            { label: 'Award amount', value: amount },
            { label: 'Award reference', value: p.awardReference },
            { label: 'Opportunity', value: p.opportunityName },
            ...(p.periodStart && p.periodEnd
              ? [
                  {
                    label: 'Grant period',
                    value: `${formatDateOnly(p.periodStart)} – ${formatDateOnly(p.periodEnd)}`,
                  },
                ]
              : []),
          ],
        },
        {
          type: 'list',
          ordered: true,
          title: 'What happens next',
          items: [
            'We’ll send your grant agreement to sign. Watch for a separate email.',
            'Then we’ll ask you to set up how you get paid.',
            'Payments go out on the schedule in your agreement.',
          ],
        },
        { type: 'button', label: 'See your award', href: p.awardUrl },
      ],
    };
  },
});

export interface AgreementReadyProps {
  recipientName?: string | null;
  organizationName: string;
  awardReference: string;
  amountCents: number;
  currency?: string;
  /** Date-only ("2027-01-31"). */
  signBy?: string | null;
  signUrl: string;
}

export const agreementReady = defineTemplate<AgreementReadyProps>({
  name: 'Agreement ready to sign',
  description: 'The grant agreement is ready for the grantee to sign.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    organizationName: FIX.org,
    awardReference: FIX.awardRef,
    amountCents: 2_500_000,
    currency: 'USD',
    signBy: '2027-01-31',
    signUrl: `${FIX.portal}/awards/${FIX.awardRef}/agreement`,
  },
  build: (p, { brand }) => ({
    subject: `Please sign your grant agreement (${p.awardReference})`,
    preheader: `Your agreement for ${formatMoney(p.amountCents, p.currency ?? 'USD')} is ready. It takes about 5 minutes.`,
    reason: `${p.organizationName} received a grant from ${brand.displayName}.`,
    blocks: [
      { type: 'heading', text: 'Your grant agreement is ready' },
      { type: 'paragraph', content: greeting(p.recipientName) },
      {
        type: 'paragraph',
        content:
          'Your grant agreement is ready to read and sign. It lists the amount, the payment schedule, and what we ask in return, like reports.',
      },
      {
        type: 'details',
        rows: [
          { label: 'Award reference', value: p.awardReference },
          { label: 'Amount', value: formatMoney(p.amountCents, p.currency ?? 'USD') },
          ...(p.signBy ? [{ label: 'Please sign by', value: formatDateOnly(p.signBy) }] : []),
        ],
      },
      { type: 'button', label: 'Read and sign', href: p.signUrl },
      {
        type: 'list',
        title: 'What happens next',
        items: [
          'Sign by typing your name. Only someone who can sign for your organization should do this.',
          'You’ll get a copy of the signed agreement by email.',
          'Then we’ll ask you to set up how you get paid.',
        ],
      },
      { type: 'fineprint', content: 'Questions about the terms? Reply to this email before you sign.' },
    ],
  }),
});

export interface PayeeOnboardingProps {
  recipientName?: string | null;
  organizationName: string;
  awardReference: string;
  /** Mercury-hosted onboarding link. */
  onboardingUrl: string;
  expiresAt: string;
  timeZone: string;
}

export const payeeOnboarding = defineTemplate<PayeeOnboardingProps>({
  name: 'Payment setup',
  description: 'Asks the grantee to add their bank details through Mercury’s secure form.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    organizationName: FIX.org,
    awardReference: FIX.awardRef,
    onboardingUrl: 'https://payments.mercury.example/onboard/preview-only',
    expiresAt: '2027-02-14T08:00:00Z',
    timeZone: FIX.tz,
  },
  build: (p, { brand }) => ({
    subject: `Set up how ${p.organizationName} gets paid`,
    preheader: 'Add your bank details on Mercury’s secure form so we can send your grant.',
    reason: `${p.organizationName} received a grant from ${brand.displayName} (${p.awardReference}).`,
    blocks: [
      { type: 'heading', text: 'Set up how you get paid' },
      { type: 'paragraph', content: greeting(p.recipientName) },
      {
        type: 'paragraph',
        content: `To send your grant, ${brand.displayName} needs to know where to pay ${p.organizationName}. Our banking partner, Mercury, collects your bank details on its secure form.`,
      },
      { type: 'button', label: 'Add your bank details', href: p.onboardingUrl },
      {
        type: 'callout',
        tone: 'info',
        title: 'Your bank numbers stay private',
        content: `You’ll enter them on Mercury’s form, not in GMS. GMS never sees or stores your account or routing numbers. ${brand.displayName} only sees that your payment details are ready.`,
      },
      {
        type: 'details',
        rows: [
          { label: 'Award reference', value: p.awardReference },
          { label: 'Link expires', value: formatInZone(p.expiresAt, p.timeZone) },
        ],
      },
      {
        type: 'list',
        title: 'What happens next',
        items: [
          'The form takes about 5 minutes. Have your bank details handy.',
          'We’ll email you when each payment is sent.',
          'If the link expires, reply to this email and we’ll send a new one.',
        ],
      },
      {
        type: 'fineprint',
        content:
          'We’ll never ask for bank numbers by email or phone. If anyone does, don’t share them. Contact us instead.',
      },
    ],
  }),
});

export interface PaymentSentProps {
  recipientName?: string | null;
  organizationName: string;
  amountCents: number;
  currency?: string;
  method: PaymentMethod;
  sentAt: string;
  timeZone: string;
  /** Date-only estimate. */
  expectedArrival: string;
  awardReference: string;
  /** e.g. "Payment 1 of 2". */
  installmentLabel?: string | null;
  remittanceAttached: boolean;
  paymentUrl: string;
}

export const paymentSent = defineTemplate<PaymentSentProps>({
  name: 'Payment sent',
  description: 'Tells the grantee a payment is on its way.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    organizationName: FIX.org,
    amountCents: 1_250_000,
    currency: 'USD',
    method: 'ach',
    sentAt: '2027-03-02T17:30:00Z',
    timeZone: FIX.tz,
    expectedArrival: '2027-03-04',
    awardReference: FIX.awardRef,
    installmentLabel: 'Payment 1 of 2',
    remittanceAttached: true,
    paymentUrl: `${FIX.portal}/awards/${FIX.awardRef}/payments`,
  },
  build: (p, { brand }) => {
    const amount = formatMoney(p.amountCents, p.currency ?? 'USD');
    const method = PAYMENT_METHOD_LABELS[p.method];
    return {
      subject: `${amount} is on its way from ${brand.displayName}`,
      preheader: `Sent by ${method}. Expected to arrive by ${formatDateOnly(p.expectedArrival)}.`,
      reason: `${p.organizationName} has a grant from ${brand.displayName} (${p.awardReference}).`,
      blocks: [
        { type: 'heading', text: 'Your payment is on its way' },
        { type: 'paragraph', content: greeting(p.recipientName) },
        {
          type: 'paragraph',
          content: [`We sent `, { text: amount, bold: true }, ` to ${p.organizationName}.`],
        },
        {
          type: 'details',
          rows: [
            { label: 'Amount', value: amount },
            ...(p.installmentLabel ? [{ label: 'Installment', value: p.installmentLabel }] : []),
            { label: 'Method', value: method },
            { label: 'Sent', value: formatInZone(p.sentAt, p.timeZone) },
            { label: 'Expected to arrive', value: formatDateOnly(p.expectedArrival) },
            { label: 'Award reference', value: p.awardReference },
          ],
        },
        ...(p.remittanceAttached
          ? [
              {
                type: 'callout' as const,
                tone: 'info' as const,
                title: 'Remittance advice attached',
                content:
                  'A PDF with the payment details is attached to this email. Share it with whoever handles your books.',
              },
            ]
          : []),
        {
          type: 'list',
          title: 'What happens next',
          items: [
            'You don’t need to do anything.',
            'Bank timing can vary. If it hasn’t arrived 3 business days after the expected date, reply to this email.',
          ],
        },
        { type: 'button', label: 'View payment details', href: p.paymentUrl },
      ],
    };
  },
});

export interface ReportDueProps {
  recipientName?: string | null;
  organizationName: string;
  reportName: string;
  awardReference: string;
  /** Date-only. */
  dueDate: string;
  reportUrl: string;
}

export const reportDue = defineTemplate<ReportDueProps>({
  name: 'Report due',
  description: 'Reminds a grantee that a report is coming due.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    organizationName: FIX.org,
    reportName: 'Interim report',
    awardReference: FIX.awardRef,
    dueDate: '2027-08-31',
    reportUrl: `${FIX.portal}/reports/rep_preview`,
  },
  build: (p, { brand }) => ({
    subject: `Your ${p.reportName.toLowerCase()} is due ${formatDateOnly(p.dueDate)}`,
    preheader: `Tell ${brand.displayName} how your grant is going. Your answers save as you go.`,
    reason: `${p.organizationName} has a grant from ${brand.displayName} (${p.awardReference}) that includes reports.`,
    blocks: [
      { type: 'heading', text: `Your ${p.reportName.toLowerCase()} is due soon` },
      { type: 'paragraph', content: greeting(p.recipientName) },
      {
        type: 'paragraph',
        content: 'We’d love to hear how things are going. Your report helps us learn and share what works.',
      },
      {
        type: 'details',
        rows: [
          { label: 'Report', value: p.reportName },
          { label: 'Due', value: formatDateOnly(p.dueDate) },
          { label: 'Award reference', value: p.awardReference },
        ],
      },
      { type: 'button', label: 'Start your report', href: p.reportUrl },
      {
        type: 'list',
        title: 'What happens next',
        items: [
          'Your answers save as you go.',
          'After you submit, we’ll read it and let you know if we have questions.',
          'Need more time? Reply to this email before the due date.',
        ],
      },
    ],
  }),
});

export interface ReportOverdueProps extends ReportDueProps {
  daysOverdue: number;
  /** When true, say that upcoming payments are paused until the report arrives. */
  paymentsOnHold?: boolean;
}

export const reportOverdue = defineTemplate<ReportOverdueProps>({
  name: 'Report overdue',
  description: 'Tells a grantee a report is past due.',
  audience: 'applicant',
  previewProps: {
    ...reportDue.previewProps,
    dueDate: '2027-08-31',
    daysOverdue: 7,
    paymentsOnHold: true,
  },
  build: (p, { brand }) => ({
    subject: `Your ${p.reportName.toLowerCase()} is overdue`,
    preheader: `It was due ${formatDateOnly(p.dueDate)}. Let us know if you need help.`,
    reason: `${p.organizationName} has a grant from ${brand.displayName} (${p.awardReference}) that includes reports.`,
    blocks: [
      { type: 'heading', text: `Your ${p.reportName.toLowerCase()} is overdue` },
      { type: 'paragraph', content: greeting(p.recipientName) },
      {
        type: 'paragraph',
        content: `Your ${p.reportName.toLowerCase()} was due on ${formatDateOnly(p.dueDate)}, ${p.daysOverdue} ${p.daysOverdue === 1 ? 'day' : 'days'} ago. We know things get busy. Please send it when you can.`,
      },
      ...(p.paymentsOnHold
        ? [
            {
              type: 'callout' as const,
              tone: 'warning' as const,
              title: 'Upcoming payments are paused',
              content: 'We’ll restart them as soon as we get your report.',
            },
          ]
        : []),
      {
        type: 'details',
        rows: [
          { label: 'Report', value: p.reportName },
          { label: 'Was due', value: formatDateOnly(p.dueDate) },
          { label: 'Award reference', value: p.awardReference },
        ],
      },
      { type: 'button', label: 'Finish your report', href: p.reportUrl },
      {
        type: 'list',
        title: 'What happens next',
        items: [
          'Submit your report. Your saved answers are still there.',
          'Stuck or need more time? Reply to this email and we’ll work it out together.',
        ],
      },
    ],
  }),
});

export interface ApprovalNeededProps {
  recipientName?: string | null;
  batchName: string;
  paymentCount: number;
  totalCents: number;
  currency?: string;
  submittedBy: string;
  /** Date-only. */
  scheduledFor?: string | null;
  approvalsReceived?: number;
  approvalsRequired?: number;
  approveUrl: string;
}

export const approvalNeeded = defineTemplate<ApprovalNeededProps>({
  name: 'Payment batch approval needed',
  description: 'Staff: a payment batch is waiting for your approval.',
  audience: 'staff',
  previewProps: {
    recipientName: FIX.owner,
    batchName: 'March 2027 grant payments',
    paymentCount: 12,
    totalCents: 18_437_500,
    currency: 'USD',
    submittedBy: FIX.finance,
    scheduledFor: '2027-03-02',
    approvalsReceived: 1,
    approvalsRequired: 2,
    approveUrl: `${FIX.staff}/payments/batches/bat_preview`,
  },
  build: (p, { brand }) => {
    const total = formatMoney(p.totalCents, p.currency ?? 'USD');
    return {
      subject: `Approval needed: ${p.batchName} (${total})`,
      preheader: `${p.paymentCount} payments from ${p.submittedBy} are waiting for you.`,
      reason: `you can approve payments for ${brand.displayName}.`,
      blocks: [
        { type: 'heading', text: 'A payment batch needs your approval' },
        { type: 'paragraph', content: greeting(p.recipientName) },
        {
          type: 'paragraph',
          content: `${p.submittedBy} sent a payment batch for approval. Nothing is paid until it’s approved.`,
        },
        {
          type: 'details',
          rows: [
            { label: 'Batch', value: p.batchName },
            { label: 'Payments', value: String(p.paymentCount) },
            { label: 'Total', value: total },
            ...(p.scheduledFor ? [{ label: 'Scheduled for', value: formatDateOnly(p.scheduledFor) }] : []),
            ...(p.approvalsRequired
              ? [{ label: 'Approvals', value: `${p.approvalsReceived ?? 0} of ${p.approvalsRequired}` }]
              : []),
          ],
        },
        { type: 'button', label: 'Review the batch', href: p.approveUrl },
        {
          type: 'list',
          title: 'What happens next',
          items: [
            'Check each payment and payee in GMS.',
            'Approve or reject the batch. You’ll confirm with two-step sign-in.',
            'Once it has every approval, it goes to the bank. Some banks ask for one more approval there.',
          ],
        },
        {
          type: 'fineprint',
          content:
            'Only a person can approve payments. AI agents can’t approve them, and replying to this email doesn’t approve anything.',
        },
      ],
    };
  },
});
