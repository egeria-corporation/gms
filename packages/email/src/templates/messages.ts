// SPDX-License-Identifier: AGPL-3.0-only
// Messages from the foundation.

import type { Block } from '../blocks';
import { renderMergeFields } from '../merge-fields';
import { defineTemplate, FIX, greeting } from './shared';

export interface MessageNotificationProps {
  recipientName?: string | null;
  senderName: string;
  /** What the thread is about, e.g. the application title. */
  about?: string | null;
  subjectLine: string;
  /** Plain-text excerpt of the message (never HTML). Long excerpts are shortened. */
  excerpt: string;
  threadUrl: string;
}

const MAX_EXCERPT = 600;

export const messageNotification = defineTemplate<MessageNotificationProps>({
  name: 'New message',
  description: 'Tells an applicant they have a new message from the foundation.',
  audience: 'applicant',
  previewProps: {
    recipientName: FIX.applicant,
    senderName: FIX.officer,
    about: FIX.appTitle,
    subjectLine: 'Site visit next month?',
    excerpt:
      'Hi Maya, we’d love to visit a rehearsal in October. Would a Tuesday or Thursday afternoon work for your team? It would take about an hour.',
    threadUrl: `${FIX.portal}/messages/thr_preview`,
  },
  build: (p, { brand }) => {
    const excerpt =
      p.excerpt.length > MAX_EXCERPT ? `${p.excerpt.slice(0, MAX_EXCERPT - 1).trimEnd()}…` : p.excerpt;
    return {
      subject: `New message from ${brand.displayName}: ${p.subjectLine}`,
      preheader: excerpt.slice(0, 120),
      reason: `you have an account with ${brand.displayName} and someone there sent you a message.`,
      blocks: [
        { type: 'heading', text: 'You have a new message' },
        { type: 'paragraph', content: greeting(p.recipientName) },
        {
          type: 'paragraph',
          content: [
            `${p.senderName} at ${brand.displayName} sent you a message`,
            ...(p.about ? [` about “${p.about}”`] : []),
            '.',
          ],
        },
        { type: 'quote', attribution: `${p.senderName} · ${p.subjectLine}`, text: excerpt },
        { type: 'button', label: 'Read and reply', href: p.threadUrl },
        {
          type: 'fineprint',
          content:
            'Reply in the portal so your answer stays with your application. The full message and any files are there too.',
        },
      ],
    };
  },
});

export interface BulkMessageProps {
  subject: string;
  preheader?: string | null;
  /** Staff-authored markdown (safe subset: paragraphs, bold, italic, links, lists). May include merge fields. */
  markdown: string;
  /** Values for {{merge.fields}}. Inserted as literal text. */
  mergeValues?: Record<string, string>;
  senderName: string;
  /** Completes "You're getting this email because …". */
  reason?: string | null;
  cta?: { label: string; url: string } | null;
}

export const bulkMessage = defineTemplate<BulkMessageProps>({
  name: 'Bulk message',
  description: 'A message staff wrote and sent to many applicants or grantees.',
  audience: 'applicant',
  previewProps: {
    subject: 'Info session for {{opportunity.name}}',
    preheader: 'Join us online on October 14 to ask questions.',
    markdown: [
      'Hi {{applicant.first_name}},',
      '',
      'We’re hosting a **free online info session** for {{opportunity.name}} on *October 14 at noon Pacific*.',
      '',
      'We’ll cover:',
      '- Who can apply',
      '- How to write a strong budget',
      '- Questions from you',
      '',
      'Can’t make it? We’ll post the recording on our [info page](https://halcyon-ridge.example/youth-arts).',
      '',
      'Warmly,',
      'Priya Natarajan',
    ].join('\n'),
    mergeValues: { 'applicant.first_name': 'Maya', 'opportunity.name': FIX.opportunity },
    senderName: FIX.officer,
    reason: `you signed up for updates about ${FIX.opportunity}.`,
    cta: { label: 'Save your spot', url: 'https://halcyon-ridge.example/youth-arts/info-session' },
  },
  build: (p, { brand }) => {
    const values = p.mergeValues ?? {};
    const subject = renderMergeFields(p.subject, values, { escape: 'none' })
      .replace(/[\r\n]+/g, ' ')
      .trim();
    const source = renderMergeFields(p.markdown, values, { escape: 'markdown' });
    const blocks: Block[] = [{ type: 'markdown', source }];
    if (p.cta) blocks.push({ type: 'button', label: p.cta.label, href: p.cta.url });
    blocks.push({
      type: 'fineprint',
      content: `Sent by ${p.senderName} at ${brand.displayName}. You can reply to this email.`,
    });
    return {
      subject,
      preheader: p.preheader
        ? renderMergeFields(p.preheader, values, { escape: 'none' })
        : `A message from ${brand.displayName}`,
      reason: p.reason?.trim() || `you applied to or have a grant with ${brand.displayName}.`,
      blocks,
    };
  },
});
