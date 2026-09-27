// SPDX-License-Identifier: AGPL-3.0-only
// Applicant-facing application lifecycle emails.

import { APPLICATION_STATUS, formatDateOnly, formatInZone, type ApplicationStatus } from '@gms/domain';
import type { Block } from '../blocks';
import { defineTemplate, FIX, greeting } from './shared';

export interface SubmissionReceiptProps {
  recipientName?: string | null;
  organizationName: string;
  applicationTitle: string;
  opportunityName: string;
  referenceNumber: string;
  submittedAt: string;
  /** Workspace timezone (IANA), used for every timestamp. */
  timeZone: string;
  /** Optional date-only ("2027-02-13") when decisions are expected. */
  decisionsExpectedBy?: string | null;
  applicationUrl: string;
}

export const submissionReceipt = defineTemplate<SubmissionReceiptProps>({
  name: 'Submission receipt',
  description: 'Confirms an application was received, with a reference number.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    organizationName: FIX.org,
    applicationTitle: FIX.appTitle,
    opportunityName: FIX.opportunity,
    referenceNumber: FIX.appRef,
    submittedAt: '2026-11-18T22:41:07Z',
    timeZone: FIX.tz,
    decisionsExpectedBy: '2027-02-13',
    applicationUrl: `${FIX.portal}/applications/${FIX.appRef}`,
  },
  build: (p, { brand }) => ({
    subject: `We received your application (${p.referenceNumber})`,
    preheader: `Your reference number is ${p.referenceNumber}. Here’s what happens next.`,
    reason: `you submitted an application to ${brand.displayName}.`,
    blocks: [
      { type: 'heading', text: 'We received your application' },
      { type: 'paragraph', content: greeting(p.recipientName) },
      {
        type: 'paragraph',
        content: `Thank you for applying to ${p.opportunityName}. Your application is in, and you don’t need to do anything else right now.`,
      },
      {
        type: 'details',
        rows: [
          { label: 'Reference number', value: p.referenceNumber },
          { label: 'Application', value: p.applicationTitle },
          { label: 'Organization', value: p.organizationName },
          { label: 'Submitted', value: formatInZone(p.submittedAt, p.timeZone) },
        ],
      },
      {
        type: 'list',
        ordered: true,
        title: 'What happens next',
        items: [
          'Our team checks that your application is complete.',
          'Reviewers read it and share their thoughts.',
          p.decisionsExpectedBy
            ? `We plan to share decisions by ${formatDateOnly(p.decisionsExpectedBy)}. We’ll email you either way.`
            : 'We’ll email you when there’s a decision, either way.',
        ],
      },
      { type: 'button', label: 'View your application', href: p.applicationUrl },
      {
        type: 'fineprint',
        content: 'Keep this email for your records. Please include your reference number if you contact us.',
      },
    ],
  }),
});

export type StatusChangeStatus = ApplicationStatus | 'info_requested';

export interface StatusChangeProps {
  recipientName?: string | null;
  applicationTitle: string;
  opportunityName: string;
  referenceNumber: string;
  status: StatusChangeStatus;
  /** Optional note from the foundation (plain text). */
  note?: string | null;
  noteAuthor?: string | null;
  /** For info_requested / invited_to_next_stage: when a response is due (ISO timestamp). */
  respondBy?: string | null;
  timeZone: string;
  applicationUrl: string;
}

interface StatusCopy {
  subject: string;
  heading: string;
  body: string;
  next: string[];
  button?: string;
  tone?: 'info' | 'success' | 'warning';
}

function statusCopy(p: StatusChangeProps, foundation: string): StatusCopy {
  const due = p.respondBy ? formatInZone(p.respondBy, p.timeZone) : null;
  switch (p.status) {
    case 'info_requested':
      return {
        subject: `We need a bit more information (${p.referenceNumber})`,
        heading: 'We need a bit more information',
        body: `We’re reviewing “${p.applicationTitle}” and have a question for you. Your application is still in the running.`,
        next: [
          'Open your application to see what we asked for.',
          due ? `Please reply by ${due}.` : 'Please reply as soon as you can.',
          'Once you reply, review picks up where it left off.',
        ],
        button: 'Add the information',
        tone: 'warning',
      };
    case 'in_progress':
      return {
        subject: `Your application is open for edits (${p.referenceNumber})`,
        heading: 'Your application is open for edits again',
        body: `${foundation} reopened “${p.applicationTitle}” so you can make changes.`,
        next: [
          'Make your changes.',
          due ? `Submit it again by ${due}.` : 'Submit it again when you’re done.',
        ],
        button: 'Edit your application',
      };
    case 'submitted':
      return {
        subject: `Your application is submitted (${p.referenceNumber})`,
        heading: 'Your application is submitted',
        body: `“${p.applicationTitle}” is in our hands. You don’t need to do anything right now.`,
        next: [
          'We’ll check that it’s complete and send it to reviewers.',
          'We’ll email you when there’s news.',
        ],
        button: 'View your application',
      };
    case 'under_review':
      return {
        subject: `Your application is being reviewed (${p.referenceNumber})`,
        heading: 'Your application is being reviewed',
        body: `Reviewers are now reading “${p.applicationTitle}”. You don’t need to do anything right now.`,
        next: [
          'Reviewers share their thoughts with our team.',
          'We’ll email you when there’s a decision, either way.',
        ],
        button: 'View your application',
      };
    case 'invited_to_next_stage':
      return {
        subject: `You’re invited to the next stage (${p.referenceNumber})`,
        heading: 'You’re invited to the next stage',
        body: `Good news: “${p.applicationTitle}” moved forward for ${p.opportunityName}. The next stage asks for a few more details.`,
        next: [
          'Open your application to see the next form.',
          due ? `Finish and submit it by ${due}.` : 'Finish and submit it when you’re ready.',
          'Your earlier answers are saved and carry over.',
        ],
        button: 'Start the next stage',
        tone: 'success',
      };
    case 'awarded':
      return {
        subject: `Good news about your application (${p.referenceNumber})`,
        heading: 'Your application was approved',
        body: `Congratulations! ${foundation} approved “${p.applicationTitle}” for ${p.opportunityName}.`,
        next: [
          'You’ll get a separate award email with the amount and details.',
          'Then we’ll send your grant agreement to sign.',
        ],
        button: 'See your award',
        tone: 'success',
      };
    case 'declined':
      return {
        subject: `An update on your application (${p.referenceNumber})`,
        heading: 'An update on your application',
        body: `Thank you for applying to ${p.opportunityName}. We’re sorry to say we can’t fund “${p.applicationTitle}” this time. We had many strong applications and limited funds.`,
        next: [
          'You don’t need to do anything.',
          'You’re welcome to apply to future opportunities.',
          'If you have questions, reply to this email.',
        ],
        button: 'View your application',
      };
    case 'withdrawn':
      return {
        subject: `Your application was withdrawn (${p.referenceNumber})`,
        heading: 'Your application was withdrawn',
        body: `“${p.applicationTitle}” was withdrawn from ${p.opportunityName}. It won’t be reviewed.`,
        next: [
          'You don’t need to do anything.',
          'If you didn’t mean to withdraw it, reply to this email right away.',
        ],
        button: 'View your application',
      };
    case 'ineligible':
      return {
        subject: `Your application isn’t eligible (${p.referenceNumber})`,
        heading: 'Your application isn’t eligible this time',
        body: `We looked at “${p.applicationTitle}” and it doesn’t meet the eligibility rules for ${p.opportunityName}, so it won’t move to review.`,
        next: [
          'See the note below for the reason.',
          'If you think we made a mistake, reply to this email and we’ll take another look.',
        ],
        button: 'View your application',
        tone: 'warning',
      };
  }
}

export const statusChange = defineTemplate<StatusChangeProps>({
  name: 'Application status change',
  description: 'Tells the applicant their application status changed, with tailored copy per status.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    applicationTitle: FIX.appTitle,
    opportunityName: FIX.opportunity,
    referenceNumber: FIX.appRef,
    status: 'info_requested',
    note: 'Could you share your budget for instrument repairs? A rough estimate is fine.',
    noteAuthor: FIX.officer,
    respondBy: '2026-12-12T01:00:00Z',
    timeZone: FIX.tz,
    applicationUrl: `${FIX.portal}/applications/${FIX.appRef}`,
  },
  build: (p, { brand }) => {
    const c = statusCopy(p, brand.displayName);
    const label =
      p.status === 'info_requested' ? 'Information requested' : APPLICATION_STATUS[p.status].label;
    const blocks: Block[] = [
      { type: 'heading', text: c.heading },
      { type: 'paragraph', content: greeting(p.recipientName) },
      { type: 'paragraph', content: c.body },
      {
        type: 'details',
        rows: [
          { label: 'Status', value: label },
          { label: 'Application', value: p.applicationTitle },
          { label: 'Reference number', value: p.referenceNumber },
        ],
      },
    ];
    if (p.note?.trim()) {
      blocks.push({
        type: 'quote',
        attribution: p.noteAuthor ? `Note from ${p.noteAuthor}` : `Note from ${brand.displayName}`,
        text: p.note.trim(),
      });
    }
    blocks.push({ type: 'list', title: 'What happens next', items: c.next });
    if (c.button) blocks.push({ type: 'button', label: c.button, href: p.applicationUrl });
    return {
      subject: c.subject,
      preheader: c.body.length > 110 ? `${c.body.slice(0, 107)}…` : c.body,
      reason: `you applied to ${p.opportunityName} with ${brand.displayName}.`,
      blocks,
    };
  },
});

export interface DeadlineReminderProps {
  recipientName?: string | null;
  opportunityName: string;
  applicationTitle?: string | null;
  closesAt: string;
  timeZone: string;
  /** 0-100, if the applicant has started. */
  percentComplete?: number | null;
  applicationUrl: string;
}

export const deadlineReminder = defineTemplate<DeadlineReminderProps>({
  name: 'Deadline reminder',
  description: 'Reminds an applicant with an unsubmitted application that the deadline is near.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    opportunityName: FIX.opportunity,
    applicationTitle: FIX.appTitle,
    closesAt: '2026-12-06T01:00:00Z',
    timeZone: FIX.tz,
    percentComplete: 70,
    applicationUrl: `${FIX.portal}/applications/${FIX.appRef}`,
  },
  build: (p, { brand }) => {
    const when = formatInZone(p.closesAt, p.timeZone);
    const started = typeof p.percentComplete === 'number';
    return {
      subject: `Reminder: ${p.opportunityName} closes ${formatInZone(p.closesAt, p.timeZone, { dateOnly: true })}`,
      preheader: `Applications are due ${when}. Your work is saved.`,
      reason: `you started an application to ${p.opportunityName} and haven’t submitted it yet.`,
      blocks: [
        { type: 'heading', text: 'The deadline is coming up' },
        { type: 'paragraph', content: greeting(p.recipientName) },
        {
          type: 'paragraph',
          content: [
            `A friendly reminder: ${p.opportunityName} from ${brand.displayName} closes on `,
            { text: when, bold: true },
            '.',
          ],
        },
        {
          type: 'details',
          rows: [
            ...(p.applicationTitle ? [{ label: 'Application', value: p.applicationTitle }] : []),
            { label: 'Deadline', value: when },
            ...(started
              ? [{ label: 'Progress', value: `About ${Math.round(p.percentComplete!)}% done` }]
              : []),
          ],
        },
        {
          type: 'button',
          label: started ? 'Finish your application' : 'Start your application',
          href: p.applicationUrl,
        },
        {
          type: 'list',
          title: 'What happens next',
          items: [
            'Your answers save as you go, so you can pick up where you left off.',
            'Submit before the deadline. Late applications may not be accepted.',
            'You’ll get a receipt with a reference number as soon as you submit.',
          ],
        },
      ],
    };
  },
});

export interface RevisionsRequestedProps {
  recipientName?: string | null;
  itemKind: 'application' | 'report';
  itemName: string;
  requestedBy: string;
  notes: string;
  /** Date-only ("2027-03-01"). */
  respondBy?: string | null;
  itemUrl: string;
}

export const revisionsRequested = defineTemplate<RevisionsRequestedProps>({
  name: 'Revisions requested',
  description: 'Staff asked the applicant to change an application or report.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    itemKind: 'report',
    itemName: 'Interim report — After-School Strings Program',
    requestedBy: FIX.officer,
    notes:
      'Thanks for the report! Could you add attendance numbers for the spring session and a short note on the instrument library?',
    respondBy: '2027-08-15',
    itemUrl: `${FIX.portal}/reports/rep_preview`,
  },
  build: (p, { brand }) => ({
    subject: `Please update your ${p.itemKind}: ${p.itemName}`,
    preheader: `${p.requestedBy} asked for a few changes${p.respondBy ? ` by ${formatDateOnly(p.respondBy)}` : ''}.`,
    reason: `you submitted this ${p.itemKind} to ${brand.displayName}.`,
    blocks: [
      { type: 'heading', text: `A few changes to your ${p.itemKind}` },
      { type: 'paragraph', content: greeting(p.recipientName) },
      {
        type: 'paragraph',
        content: [
          `${p.requestedBy} reviewed `,
          { text: p.itemName, bold: true },
          ' and asked for a few changes.',
        ],
      },
      { type: 'quote', attribution: `Note from ${p.requestedBy}`, text: p.notes },
      ...(p.respondBy
        ? [
            {
              type: 'details' as const,
              rows: [{ label: 'Please send changes by', value: formatDateOnly(p.respondBy) }],
            },
          ]
        : []),
      { type: 'button', label: `Update your ${p.itemKind}`, href: p.itemUrl },
      {
        type: 'list',
        title: 'What happens next',
        items: [
          `Open your ${p.itemKind}. It’s unlocked so you can edit it.`,
          'Make the changes and submit it again.',
          `${p.requestedBy} will take another look and let you know.`,
        ],
      },
    ],
  }),
});
